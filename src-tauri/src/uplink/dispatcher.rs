use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio::task::JoinSet;

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
            let result =
                tokio::time::timeout(Duration::from_millis(100), transport.send(&frame)).await;
            (name, result)
        });
    }

    while let Some(result) = sends.join_next().await {
        match result {
            Ok((_name, Ok(Ok(_)))) => {}
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

pub async fn broadcast_raw_payload(state: &AppState, bytes: &[u8]) -> Result<(), String> {
    broadcast_raw_payload_internal(state, bytes, true).await
}

pub async fn broadcast_raw_payload_poll(state: &AppState, bytes: &[u8]) -> Result<(), String> {
    broadcast_raw_payload_internal(state, bytes, false).await
}

async fn broadcast_raw_payload_internal(
    state: &AppState,
    bytes: &[u8],
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
            let result =
                tokio::time::timeout(Duration::from_millis(100), transport.send(&frame)).await;
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

