use crate::state::AppState;
use std::time::Instant;
use tauri::{AppHandle, Emitter};
use tokio::time::{interval, Duration};

pub async fn start_emitter(app_handle: AppHandle, app_state: AppState) {
    let mut interval = interval(Duration::from_millis(100)); // 10Hz
    let evict_timeout = std::time::Duration::from_secs(10); // 10秒死链剔除阈值
    let mut tick_count = 0_u64;

    loop {
        interval.tick().await;
        tick_count = tick_count.wrapping_add(1);
        let now = Instant::now();

        // 驱逐超过 10 秒未更新的死链路
        app_state.uav_seen.retain(|id, last_seen| {
            if now.duration_since(*last_seen) > evict_timeout {
                app_state.uav_pool.remove(id);
                false
            } else {
                true
            }
        });
        app_state.fp981c_seen.retain(|id, last_seen| {
            if now.duration_since(*last_seen) > evict_timeout {
                app_state.fp981c_pool.remove(id);
                false
            } else {
                true
            }
        });

        // 推送 UAVInfo 原始状态
        let uavs: Vec<_> = app_state
            .uav_pool
            .iter()
            .map(|kv| kv.value().clone())
            .collect();
        if !uavs.is_empty() {
            if let Err(e) = app_handle.emit("uav-info-event", &uavs) {
                log::error!("Tauri emitter 发送 uav-info-event 失败: {}", e);
            }
        }

        // 推送 FP981C 聚合状态
        let fp981c_list: Vec<_> = app_state
            .fp981c_pool
            .iter()
            .map(|kv| kv.value().clone())
            .collect();
        if !fp981c_list.is_empty() {
            if let Err(e) = app_handle.emit("fp981c-event", &fp981c_list) {
                log::error!("Tauri emitter 发送 fp981c-event 失败: {}", e);
            }
        }

        // 推送 FP95 状态
        if let Some(fp95) = app_state.fp95_snapshot(now, evict_timeout) {
            if let Err(e) = app_handle.emit("fp95-event", &fp95) {
                log::error!("Tauri emitter 发送 fp95-event 失败: {}", e);
            }
        }

        if should_emit_health(tick_count) {
            let snapshot = app_state.rx_health_snapshot();
            if let Err(e) = app_handle.emit("link-health-event", snapshot) {
                log::error!("Tauri emitter 发送 link-health-event 失败: {}", e);
            }
        }
    }
}

fn should_emit_health(tick: u64) -> bool {
    tick % 5 == 0
}
