use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tokio::sync::mpsc::Sender;

use crate::error::CommsError;
use crate::event::{LinkEvent, LinkStatus};
use crate::transport::TransportLink;

#[derive(Debug, Clone)]
pub struct SerialConfig {
    pub name: String,
    pub port_name: String,
    pub baud_rate: u32,
    pub buffer_size: usize,
}

/// 获取当前系统中所有可用物理串口列表
pub fn list_available_ports() -> Result<Vec<serialport::SerialPortInfo>, CommsError> {
    serialport::available_ports().map_err(CommsError::Serial)
}

pub struct SerialLink {
    name: String,
    /// 串口写是阻塞 IO：用标准库互斥锁 + spawn_blocking 发送，避免阻塞 tokio 工作线程。
    /// 读线程检测到设备异常时置为 None，立即释放句柄，便于同名端口重新打开（Windows 串口独占）
    writer: Arc<Mutex<Option<Box<dyn serialport::SerialPort>>>>,
    is_running: Arc<AtomicBool>,
}

/// 打开串口（读写超时 50ms）。
///
/// Unix 下 `set_exclusive` 只在原生 `TTYPort` 上提供，需先 `open_native` 取消独占后再装箱；
/// 直接在 `Box<dyn SerialPort>` 上调用会导致 Linux/macOS 编译失败。
#[cfg(unix)]
fn open_port(config: &SerialConfig) -> Result<Box<dyn serialport::SerialPort>, CommsError> {
    let mut port = serialport::new(&config.port_name, config.baud_rate)
        .timeout(Duration::from_millis(50))
        .open_native()
        .map_err(CommsError::Serial)?;
    port.set_exclusive(false).map_err(CommsError::Serial)?;
    Ok(Box::new(port))
}

#[cfg(not(unix))]
fn open_port(config: &SerialConfig) -> Result<Box<dyn serialport::SerialPort>, CommsError> {
    serialport::new(&config.port_name, config.baud_rate)
        .timeout(Duration::from_millis(50))
        .open()
        .map_err(CommsError::Serial)
}

impl SerialLink {
    pub async fn start(
        config: SerialConfig,
        event_tx: Sender<LinkEvent>,
    ) -> Result<Arc<Self>, CommsError> {
        let port = open_port(&config)?;

        // let (mut reader, writer) = tokio::io::split(port);
        let mut reader = port.try_clone().map_err(CommsError::Serial)?;
        let writer = Arc::new(Mutex::new(Some(port)));
        let fault_writer = writer.clone();
        let is_running = Arc::new(AtomicBool::new(true));

        let link = Arc::new(Self {
            name: config.name.clone(),
            writer,
            is_running: is_running.clone(),
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
            "串口链路 [{}] 已启动监听 (端口: {}, 波特率: {})",
            rx_name,
            config.port_name,
            config.baud_rate
        );

        let thread_name = format!("serial_rx_{}", rx_name);

        let _ = thread::Builder::new().name(thread_name).spawn(move || {
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
                        // 释放写句柄：读句柄随线程退出释放，两者都关闭后端口才能被重新打开
                        fault_writer
                            .lock()
                            .unwrap_or_else(|poisoned| poisoned.into_inner())
                            .take();
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
        let writer = self.writer.clone();
        let data = payload.to_vec();
        tokio::task::spawn_blocking(move || {
            let mut guard = writer
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let Some(w) = guard.as_mut() else {
                return Err(CommsError::LinkClosed);
            };
            w.write_all(&data)?;
            w.flush()?;
            Ok(data.len())
        })
        .await
        .map_err(|e| CommsError::LinkFaulted(format!("串口发送任务异常: {e}")))?
    }

    fn stop(&self) {
        self.is_running.store(false, Ordering::Relaxed);
    }

    fn as_any(&self) -> &dyn std::any::Any {
        self
    }
}
