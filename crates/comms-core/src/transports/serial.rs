use std::collections::VecDeque;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};
use tokio::sync::{mpsc::Sender, oneshot};

pub use serialport::{DataBits, Parity, StopBits};

use crate::error::CommsError;
use crate::event::{LinkEvent, LinkStatus};
use crate::transport::{TransportLink, TxPriority};

#[derive(Debug, Clone)]
pub struct SerialConfig {
    pub name: String,
    pub port_name: String,
    pub baud_rate: u32,
    pub data_bits: DataBits,
    pub stop_bits: StopBits,
    pub parity: Parity,
    pub buffer_size: usize,
}

impl SerialConfig {
    /// 常用 8N1 配置
    pub fn new(name: impl Into<String>, port_name: impl Into<String>, baud_rate: u32) -> Self {
        Self {
            name: name.into(),
            port_name: port_name.into(),
            baud_rate,
            data_bits: DataBits::Eight,
            stop_bits: StopBits::One,
            parity: Parity::None,
            buffer_size: 4096,
        }
    }
}

/// 获取当前系统中所有可用物理串口列表
pub fn list_available_ports() -> Result<Vec<serialport::SerialPortInfo>, CommsError> {
    serialport::available_ports().map_err(CommsError::Serial)
}

/// 控制指令队列容量：满了直接向调用方报错，不悄悄丢指令
const CONTROL_QUEUE_CAPACITY: usize = 32;
/// 周期帧队列容量：满了丢最旧的一帧，避免低波特率下积压造成越来越大的时延
const PERIODIC_QUEUE_CAPACITY: usize = 2;
/// 轮询帧队列容量：满了直接丢弃本次轮询
const BACKGROUND_QUEUE_CAPACITY: usize = 2;
/// shutdown 等待读写线程退出的上限（读超时 50ms，正常远小于该值）
const SHUTDOWN_TIMEOUT: Duration = Duration::from_millis(500);

type TxReply = oneshot::Sender<Result<usize, CommsError>>;

struct TxRequest {
    data: Vec<u8>,
    /// None 表示非阻塞投递，不回报结果
    reply: Option<TxReply>,
}

impl TxRequest {
    fn finish(self, result: Result<usize, CommsError>) {
        if let Some(reply) = self.reply {
            let _ = reply.send(result);
        }
    }
}

#[derive(Default)]
struct TxQueueState {
    control: VecDeque<TxRequest>,
    periodic: VecDeque<TxRequest>,
    background: VecDeque<TxRequest>,
    closed: bool,
}

impl TxQueueState {
    fn pop_highest(&mut self) -> Option<TxRequest> {
        self.control
            .pop_front()
            .or_else(|| self.periodic.pop_front())
            .or_else(|| self.background.pop_front())
    }
}

/// 单条串口链路的带优先级有界发送队列，由唯一的写线程按优先级顺序消费
struct TxQueue {
    state: Mutex<TxQueueState>,
    ready: Condvar,
}

impl TxQueue {
    fn new() -> Self {
        Self {
            state: Mutex::new(TxQueueState::default()),
            ready: Condvar::new(),
        }
    }

    fn lock(&self) -> MutexGuard<'_, TxQueueState> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn push(&self, priority: TxPriority, request: TxRequest) -> Result<(), CommsError> {
        {
            let mut state = self.lock();
            if state.closed {
                return Err(CommsError::LinkClosed);
            }
            match priority {
                TxPriority::Control => {
                    if state.control.len() >= CONTROL_QUEUE_CAPACITY {
                        return Err(CommsError::QueueFull);
                    }
                    state.control.push_back(request);
                }
                TxPriority::Periodic => {
                    if state.periodic.len() >= PERIODIC_QUEUE_CAPACITY
                        && let Some(stale) = state.periodic.pop_front()
                    {
                        stale.finish(Err(CommsError::QueueFull));
                    }
                    state.periodic.push_back(request);
                }
                TxPriority::Background => {
                    if state.background.len() >= BACKGROUND_QUEUE_CAPACITY {
                        return Err(CommsError::QueueFull);
                    }
                    state.background.push_back(request);
                }
            }
        }
        self.ready.notify_one();
        Ok(())
    }

    /// 阻塞取出下一条待发请求；队列关闭后返回 None
    fn pop(&self) -> Option<TxRequest> {
        let mut state = self.lock();
        loop {
            if state.closed {
                return None;
            }
            if let Some(request) = state.pop_highest() {
                return Some(request);
            }
            state = self
                .ready
                .wait(state)
                .unwrap_or_else(|poisoned| poisoned.into_inner());
        }
    }

    /// 关闭队列：未发出的请求立即以 LinkClosed 结束，唤醒写线程退出并释放串口句柄
    fn close(&self) {
        let pending: Vec<TxRequest> = {
            let mut state = self.lock();
            state.closed = true;
            let mut pending = Vec::new();
            while let Some(request) = state.pop_highest() {
                pending.push(request);
            }
            pending
        };
        self.ready.notify_all();
        for request in pending {
            request.finish(Err(CommsError::LinkClosed));
        }
    }
}

pub struct SerialLink {
    name: String,
    /// 串口写是阻塞 IO：所有发送先进入本链路的优先级队列，由唯一的写线程顺序写出，
    /// 不再为每包起 spawn_blocking 任务争抢互斥锁。
    queue: Arc<TxQueue>,
    is_running: Arc<AtomicBool>,
    /// 读线程、写线程句柄：shutdown 时等待两者退出，确保同名端口可立即重新打开（Windows 串口独占）
    threads: Mutex<Vec<JoinHandle<()>>>,
}

fn configure(builder: serialport::SerialPortBuilder, config: &SerialConfig) -> serialport::SerialPortBuilder {
    builder
        .data_bits(config.data_bits)
        .stop_bits(config.stop_bits)
        .parity(config.parity)
        .flow_control(serialport::FlowControl::None)
        .timeout(Duration::from_millis(50))
}

/// 打开串口（读写超时 50ms）。
///
/// Unix 下 `set_exclusive` 只在原生 `TTYPort` 上提供，需先 `open_native` 取消独占后再装箱；
/// 直接在 `Box<dyn SerialPort>` 上调用会导致 Linux/macOS 编译失败。
#[cfg(unix)]
fn open_port(config: &SerialConfig) -> Result<Box<dyn serialport::SerialPort>, CommsError> {
    let mut port = configure(serialport::new(&config.port_name, config.baud_rate), config)
        .open_native()
        .map_err(CommsError::Serial)?;
    port.set_exclusive(false).map_err(CommsError::Serial)?;
    Ok(Box::new(port))
}

#[cfg(not(unix))]
fn open_port(config: &SerialConfig) -> Result<Box<dyn serialport::SerialPort>, CommsError> {
    configure(serialport::new(&config.port_name, config.baud_rate), config)
        .open()
        .map_err(CommsError::Serial)
}

/// 写线程：按优先级逐条写出，队列关闭后退出并随之释放写句柄
fn writer_loop(mut port: Box<dyn serialport::SerialPort>, queue: Arc<TxQueue>) {
    while let Some(request) = queue.pop() {
        let result = port
            .write_all(&request.data)
            .and_then(|_| port.flush())
            .map(|_| request.data.len())
            .map_err(CommsError::Io);
        request.finish(result);
    }
}

impl SerialLink {
    pub async fn start(
        config: SerialConfig,
        event_tx: Sender<LinkEvent>,
    ) -> Result<Arc<Self>, CommsError> {
        let port = open_port(&config)?;
        let mut reader = port.try_clone().map_err(CommsError::Serial)?;

        let queue = Arc::new(TxQueue::new());
        let is_running = Arc::new(AtomicBool::new(true));

        let writer_queue = queue.clone();
        let writer_thread = thread::Builder::new()
            .name(format!("serial_tx_{}", config.name))
            .spawn(move || writer_loop(port, writer_queue))
            .map_err(CommsError::Io)?;

        let link = Arc::new(Self {
            name: config.name.clone(),
            queue: queue.clone(),
            is_running: is_running.clone(),
            threads: Mutex::new(vec![writer_thread]),
        });

        let rx_tx = event_tx.clone();
        let rx_name = config.name.clone();
        let buf_size = if config.buffer_size == 0 {
            4096
        } else {
            config.buffer_size
        };

        let _ = event_tx
            .send(LinkEvent::StatusChanged {
                link_name: rx_name.clone(),
                status: LinkStatus::Running,
            })
            .await;

        log::info!(
            "串口链路 [{}] 已启动监听 (端口: {}, 波特率: {}, 数据位: {:?}, 校验: {:?}, 停止位: {:?})",
            rx_name,
            config.port_name,
            config.baud_rate,
            config.data_bits,
            config.parity,
            config.stop_bits
        );

        let fault_queue = queue;
        let reader_thread = thread::Builder::new()
            .name(format!("serial_rx_{}", rx_name))
            .spawn(move || {
                let mut buf = vec![0u8; buf_size];
                let mut faulted = false;

                while is_running.load(Ordering::Relaxed) {
                    match reader.read(&mut buf) {
                        Ok(0) => {
                            // 物理串口无数据时可能返回 Ok(0)，绝不能 break 退出，稍作等待继续监听
                            thread::sleep(Duration::from_millis(5));
                        }
                        Ok(n) => {
                            let _ = rx_tx.blocking_send(LinkEvent::Data {
                                link_name: rx_name.clone(),
                                payload: buf[..n].to_vec(),
                                received_at: Instant::now(),
                            });
                        }
                        Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => {
                            // 50ms 内无数据到达触发超时，属于正常等待，继续循环检测 is_running
                            continue;
                        }
                        Err(e) => {
                            log::error!("串口链路 [{}] 读取异常 (可能已拔出): {}", rx_name, e);
                            // 关闭发送队列让写线程退出释放写句柄；读句柄随本线程退出释放，
                            // 两者都关闭后端口才能被重新打开
                            fault_queue.close();
                            let _ = rx_tx.blocking_send(LinkEvent::StatusChanged {
                                link_name: rx_name.clone(),
                                status: LinkStatus::Faulted(e.to_string()),
                            });
                            faulted = true;
                            break;
                        }
                    }
                }

                if !faulted {
                    let _ = rx_tx.blocking_send(LinkEvent::StatusChanged {
                        link_name: rx_name,
                        status: LinkStatus::Stopped,
                    });
                }
            });

        match reader_thread {
            Ok(handle) => link
                .threads
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .push(handle),
            Err(error) => {
                link.stop();
                return Err(CommsError::Io(error));
            }
        }

        Ok(link)
    }
}

#[async_trait::async_trait]
impl TransportLink for SerialLink {
    fn name(&self) -> &str {
        &self.name
    }

    fn link_type(&self) -> &str {
        "Serial"
    }

    async fn send(&self, payload: &[u8]) -> Result<usize, CommsError> {
        self.send_with_priority(payload, TxPriority::Control).await
    }

    async fn send_with_priority(
        &self,
        payload: &[u8],
        priority: TxPriority,
    ) -> Result<usize, CommsError> {
        let (reply, result) = oneshot::channel();
        self.queue.push(
            priority,
            TxRequest {
                data: payload.to_vec(),
                reply: Some(reply),
            },
        )?;
        result.await.unwrap_or(Err(CommsError::LinkClosed))
    }

    fn try_send(&self, payload: &[u8], priority: TxPriority) -> Result<(), CommsError> {
        self.queue.push(
            priority,
            TxRequest {
                data: payload.to_vec(),
                reply: None,
            },
        )
    }

    fn stop(&self) {
        self.is_running.store(false, Ordering::Relaxed);
        // 立即关闭发送队列：写线程写完当前一包即退出并释放写句柄
        self.queue.close();
    }

    async fn shutdown(&self) {
        self.stop();
        let handles: Vec<JoinHandle<()>> = std::mem::take(
            &mut *self
                .threads
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()),
        );
        let deadline = Instant::now() + SHUTDOWN_TIMEOUT;
        for handle in handles {
            while !handle.is_finished() {
                if Instant::now() >= deadline {
                    log::warn!("串口链路 [{}] 读写线程未在 {}ms 内退出", self.name, SHUTDOWN_TIMEOUT.as_millis());
                    return;
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
            let _ = handle.join();
        }
    }

    fn as_any(&self) -> &dyn std::any::Any {
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(byte: u8) -> (TxRequest, oneshot::Receiver<Result<usize, CommsError>>) {
        let (reply, result) = oneshot::channel();
        (
            TxRequest {
                data: vec![byte],
                reply: Some(reply),
            },
            result,
        )
    }

    fn pop_byte(queue: &TxQueue) -> u8 {
        queue.pop().expect("队列应有数据").data[0]
    }

    #[test]
    fn queue_pops_by_priority_then_fifo() {
        let queue = TxQueue::new();
        queue.push(TxPriority::Background, request(30).0).unwrap();
        queue.push(TxPriority::Periodic, request(20).0).unwrap();
        queue.push(TxPriority::Control, request(10).0).unwrap();
        queue.push(TxPriority::Control, request(11).0).unwrap();

        assert_eq!(pop_byte(&queue), 10);
        assert_eq!(pop_byte(&queue), 11);
        assert_eq!(pop_byte(&queue), 20);
        assert_eq!(pop_byte(&queue), 30);
    }

    #[test]
    fn periodic_overflow_drops_oldest_frame() {
        let queue = TxQueue::new();
        let (first, mut first_result) = request(1);
        queue.push(TxPriority::Periodic, first).unwrap();
        queue.push(TxPriority::Periodic, request(2).0).unwrap();
        queue.push(TxPriority::Periodic, request(3).0).unwrap();

        assert!(matches!(first_result.try_recv(), Ok(Err(CommsError::QueueFull))));
        assert_eq!(pop_byte(&queue), 2);
        assert_eq!(pop_byte(&queue), 3);
    }

    #[test]
    fn control_and_background_overflow_are_rejected() {
        let queue = TxQueue::new();
        for byte in 0..CONTROL_QUEUE_CAPACITY as u8 {
            queue.push(TxPriority::Control, request(byte).0).unwrap();
        }
        assert!(matches!(
            queue.push(TxPriority::Control, request(0xFF).0),
            Err(CommsError::QueueFull)
        ));

        for byte in 0..BACKGROUND_QUEUE_CAPACITY as u8 {
            queue.push(TxPriority::Background, request(byte).0).unwrap();
        }
        assert!(matches!(
            queue.push(TxPriority::Background, request(0xFF).0),
            Err(CommsError::QueueFull)
        ));
    }

    #[test]
    fn close_fails_pending_requests_and_rejects_new_ones() {
        let queue = TxQueue::new();
        let (pending, mut pending_result) = request(1);
        queue.push(TxPriority::Control, pending).unwrap();

        queue.close();

        assert!(matches!(pending_result.try_recv(), Ok(Err(CommsError::LinkClosed))));
        assert!(queue.pop().is_none());
        assert!(matches!(
            queue.push(TxPriority::Control, request(2).0),
            Err(CommsError::LinkClosed)
        ));
    }

    #[test]
    fn close_wakes_blocked_writer() {
        let queue = Arc::new(TxQueue::new());
        let worker_queue = queue.clone();
        let worker = thread::spawn(move || worker_queue.pop().is_none());
        thread::sleep(Duration::from_millis(20));
        queue.close();
        assert!(worker.join().unwrap());
    }
}
