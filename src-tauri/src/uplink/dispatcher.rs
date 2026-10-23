use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio::task::JoinSet;

use comms_core::TxPriority;

use crate::comms::ProtocolType;
use crate::state::AppState;
use crate::uplink::actor::UplinkFrameSink;

fn supports_uplink(protocol: ProtocolType) -> bool {
    matches!(protocol, ProtocolType::FP981C | ProtocolType::FP95)
}

pub(crate) async fn broadcast_frame(state: &AppState, frame: [u8; 32]) {
    // 回放安全围栏：回放会话存在时禁止一切上行发送（防误触真实设备）
    if state.replay_active() {
        log::warn!("[Replay] 回放会话进行中，已拦截一帧上行广播");
        return;
    }

    let targets: Vec<_> = state
        .active_links
        .iter()
        .filter(|entry| supports_uplink(entry.protocol))
        .map(|entry| (entry.name.clone(), entry.transport.clone()))
        .collect();

    let mut sends = JoinSet::new();
    for (name, transport) in targets {
        sends.spawn(async move {
            // 50Hz 周期帧：串口链路上让位于控制指令，积压时只保留最新帧
            let result = tokio::time::timeout(
                Duration::from_millis(100),
                transport.send_with_priority(&frame, TxPriority::Periodic),
            )
            .await;
            (name, result)
        });
    }

    while let Some(result) = sends.join_next().await {
        match result {
            Ok((_name, Ok(Ok(_)))) => {}
            Ok((_name, Ok(Err(comms_core::CommsError::QueueFull)))) => {
                // 被同链路更新的周期帧顶替，属正常节流
            }
            Ok((name, Ok(Err(error)))) => {
                log::warn!("上行链路 {name} 发送失败: {error}");
            }
            Ok((name, Err(_))) => {
                log::warn!("上行链路 {name} 发送超时");
            }
            Err(error) => {
                log::warn!("上行广播任务异常结束: {error}");
            }
        }
    }
}

/// 控制指令上行（继电器、防除冰、透传等）：串口链路上优先于周期帧与轮询帧发送
pub async fn broadcast_raw_payload(state: &AppState, bytes: &[u8]) -> Result<(), String> {
    broadcast_raw_payload_internal(state, bytes, TxPriority::Control, true).await
}

/// 后台轮询上行：优先级最低，链路忙时直接丢弃本次轮询
pub async fn broadcast_raw_payload_poll(state: &AppState, bytes: &[u8]) -> Result<(), String> {
    broadcast_raw_payload_internal(state, bytes, TxPriority::Background, false).await
}

/// 非阻塞投递上行载荷：按调用顺序进入各链路发送队列，不等待写入完成。
/// 供路由热路径（透传上行）使用，避免每帧单独起异步任务导致乱序。
pub fn try_broadcast_raw_payload(
    state: &AppState,
    bytes: &[u8],
    priority: TxPriority,
) -> Result<(), String> {
    if state.replay_active() {
        return Err("回放会话进行中，已禁止上行发送".to_string());
    }

    let mut targets = 0usize;
    let mut failed_details = Vec::new();
    for entry in state.active_links.iter() {
        if !supports_uplink(entry.protocol) {
            continue;
        }
        targets += 1;
        if let Err(error) = entry.transport.try_send(bytes, priority) {
            failed_details.push(format!("{}: {error}", entry.name));
        }
    }

    if targets == 0 {
        return Err("无活动的上行链路".to_string());
    }
    if failed_details.len() == targets {
        return Err(format!("所有上行链路均投递失败 [{}]", failed_details.join("; ")));
    }
    Ok(())
}

async fn broadcast_raw_payload_internal(
    state: &AppState,
    bytes: &[u8],
    priority: TxPriority,
    log_errors: bool,
) -> Result<(), String> {
    // 回放安全围栏：回放会话存在时禁止一切上行发送（防误触真实设备）
    if state.replay_active() {
        return Err("回放会话进行中，已禁止上行发送".to_string());
    }

    let targets: Vec<_> = state
        .active_links
        .iter()
        .filter(|entry| supports_uplink(entry.protocol))
        .map(|entry| (entry.name.clone(), entry.transport.clone()))
        .collect();

    if targets.is_empty() {
        return Err("无活动的上行链路".to_string());
    }

    let mut sends = JoinSet::new();
    for (name, transport) in targets {
        let frame = bytes.to_vec();
        sends.spawn(async move {
            let result = tokio::time::timeout(
                Duration::from_millis(100),
                transport.send_with_priority(&frame, priority),
            )
            .await;
            (name, result)
        });
    }

    let mut success_count = 0usize;
    let mut failed_details = Vec::new();

    while let Some(result) = sends.join_next().await {
        match result {
            Ok((_name, Ok(Ok(_)))) => {
                success_count += 1;
            }
            Ok((name, Ok(Err(error)))) => {
                failed_details.push(format!("{name}: {error}"));
            }
            Ok((name, Err(_))) => {
                failed_details.push(format!("{name}: 发送超时"));
            }
            Err(error) => {
                failed_details.push(format!("广播任务异常: {error}"));
            }
        }
    }

    if success_count == 0 {
        let err_msg = format!("所有上行链路均发送失败或响应超时 [{}]", failed_details.join("; "));
        if log_errors {
            log::error!("{err_msg}");
        }
        return Err(err_msg);
    } else if !failed_details.is_empty() && log_errors {
        log::warn!("部分上行链路发送异常 [{}]", failed_details.join("; "));
    }

    Ok(())
}

struct DispatcherSink {
    state: AppState,
    tx: mpsc::Sender<[u8; 32]>,
}

impl UplinkFrameSink for DispatcherSink {
    fn has_targets(&self) -> bool {
        self.state
            .active_links
            .iter()
            .any(|entry| supports_uplink(entry.protocol))
    }

    fn try_dispatch(&self, frame: [u8; 32]) -> Result<(), ()> {
        self.tx.try_send(frame).map_err(|_| ())
    }
}

pub(crate) fn start_dispatcher(state: AppState) -> Arc<dyn UplinkFrameSink> {
    let (tx, mut rx) = mpsc::channel(1);
    let dispatcher_state = state.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(frame) = rx.recv().await {
            broadcast_frame(&dispatcher_state, frame).await;
        }
    });
    Arc::new(DispatcherSink { state, tx })
}

