//! 记录回放子系统的 Tauri 命令入口。

use std::path::PathBuf;

use super::replay::{ReplayInfo, ReplayStatus};
use super::writer::{RecorderStatus, RecorderSummary};
use crate::state::AppState;

/// 手动触发记录（兼容指令：自动记录模式下为当前所有活动链路确保开启记录）
#[tauri::command]
pub async fn start_recording(
    _app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    for entry in state.active_links.iter() {
        let link = entry.value();
        let _ = state.recorder.start_link(&link.name, link.protocol, &link.link_type);
    }
    let count = state.recorder.sessions_count();
    Ok(format!("自动记录托管中，当前活动录制链路数: {count}"))
}

/// 停止全部正在记录的链路并落盘，返回各链路会话摘要
#[tauri::command]
pub async fn stop_recording(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<RecorderSummary>, String> {
    Ok(state.recorder.stop_all().await)
}

/// 查询记录器状态（正常情况下前端监听 recorder-status-event 即可）
#[tauri::command]
pub fn get_recorder_status(state: tauri::State<'_, AppState>) -> RecorderStatus {
    state.recorder.status()
}

/// 开始回放 dat 文件；speed 缺省 1.0，0 = MAX 全速
#[tauri::command]
pub fn start_replay(
    state: tauri::State<'_, AppState>,
    router_tx: tauri::State<'_, crate::comms::RouterTx>,
    path: String,
    speed: Option<f32>,
) -> Result<ReplayInfo, String> {
    state
        .replay
        .start(&state, &router_tx, PathBuf::from(path), speed.unwrap_or(1.0))
}

/// 暂停回放（幂等）
#[tauri::command]
pub fn pause_replay(state: tauri::State<'_, AppState>) -> Result<(), String> {
    state.replay.pause(&state)
}

/// 恢复播放
#[tauri::command]
pub fn resume_replay(state: tauri::State<'_, AppState>) -> Result<(), String> {
    state.replay.resume(&state)
}

/// 停止回放（幂等；注销虚拟链路，保留最后画面）
#[tauri::command]
pub async fn stop_replay(state: tauri::State<'_, AppState>) -> Result<(), String> {
    state.replay.stop(&state).await
}

/// 调整倍速（0 = MAX 全速）
#[tauri::command]
pub fn set_replay_speed(
    state: tauri::State<'_, AppState>,
    speed: f32,
) -> Result<(), String> {
    state.replay.set_speed(&state, speed)
}

/// 跳转到指定时间点（纳秒）：重启会话 + MAX 快进，状态一致
#[tauri::command]
pub async fn seek_replay(
    state: tauri::State<'_, AppState>,
    router_tx: tauri::State<'_, crate::comms::RouterTx>,
    position_ns: u64,
) -> Result<(), String> {
    state.replay.seek(&state, &router_tx, position_ns).await
}

/// 查询回放状态（正常靠 replay-status-event 事件流）
#[tauri::command]
pub fn get_replay_status(state: tauri::State<'_, AppState>) -> Option<ReplayStatus> {
    state.replay_status_snapshot()
}
