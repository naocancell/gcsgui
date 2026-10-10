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

        // 回放暂停或播完留存时跳过 10s 死链剔除，保住复盘画面
        let skip_eviction = app_state.replay_paused() || (!app_state.replay_active() && app_state.replay_retained());

        // 驱逐超过 10 秒未更新的死链路
        if !skip_eviction {
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
            app_state.mission_payload_seen.retain(|id, last_seen| {
                if now.duration_since(*last_seen) > evict_timeout {
                    app_state.mission_payload_pool.remove(id);
                    false
                } else {
                    true
                }
            });
        }

        // 推送 UAVInfo 原始状态
        let uavs: Vec<_> = app_state
            .uav_pool
            .iter()
            .map(|kv| kv.value().clone())
            .collect();
        if !uavs.is_empty() {
            if let Err(e) = app_handle.emit("uav-info-event", &uavs) {
                log_throttled_emit_error("uav-info-event", &e);
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
                log_throttled_emit_error("fp981c-event", &e);
            }
        }

        // 推送 FP95 状态
        if let Some(fp95) = app_state.fp95_snapshot(now, evict_timeout) {
            if let Err(e) = app_handle.emit("fp95-event", &fp95) {
                log_throttled_emit_error("fp95-event", &e);
            }
        }

        // 推送任管载荷聚合状态
        let payload_list: Vec<_> = app_state
            .mission_payload_pool
            .iter()
            .map(|kv| kv.value().clone())
            .collect();
        if !payload_list.is_empty() {
            if let Err(e) = app_handle.emit("mission-payload-event", &payload_list) {
                log_throttled_emit_error("mission-payload-event", &e);
            }
        }

        if should_emit_health(tick_count) {
            let snapshot = app_state.rx_health_snapshot();
            if let Err(e) = app_handle.emit("link-health-event", snapshot) {
                log_throttled_emit_error("link-health-event", &e);
            }
        }

        // 定期向持久化日志打印全链路质量健康心跳（每 30 秒一次）
        if tick_count % 300 == 0 {
            let m = app_state.metrics.snapshot();
            log::info!(
                "[全链路质量健康心跳] 成功解包帧: {}, CRC校验失败: {}, 解析异常: {}, 缓冲区溢出: {}, 重复过滤: {}, 乱序迟滞: {}, 链路冲突: {}, 补帧入队: {}, 全链路缺失: {}",
                m.frames_ok,
                m.frames_crc_fail,
                m.parse_err,
                m.buffer_overflow,
                m.dedup_hit,
                m.stale_frame,
                m.conflict_frame,
                m.recovery_buffered,
                m.all_links_missing
            );
        }

        // 每秒向前端推送一次全链路质量指标快照（1Hz）
        if tick_count % 10 == 0 {
            let metrics_snapshot = app_state.metrics.snapshot();
            if let Err(e) = app_handle.emit("link-metrics-event", &metrics_snapshot) {
                log_throttled_emit_error("link-metrics-event", &e);
            }
        }

        // 回放会话存在时推送回放状态（10Hz，前端进度条数据源）
        if let Some(status) = app_state.replay_status_snapshot() {
            if let Err(e) = app_handle.emit("replay-status-event", &status) {
                log_throttled_emit_error("replay-status-event", &e);
            }
        }
    }
}

fn should_emit_health(tick: u64) -> bool {
    tick % 5 == 0
}

/// 10Hz 高频推送异常防风暴节流告警（按事件隔离，1 秒最多输出 1 次警告，统计抑制次数）
fn log_throttled_emit_error(event: &str, err: &tauri::Error) {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};
    use once_cell::sync::Lazy;
    use dashmap::DashMap;

    static EVENT_THROTTLES: Lazy<DashMap<String, (AtomicU64, AtomicU64)>> = Lazy::new(DashMap::new);

    let current_sec = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let entry = EVENT_THROTTLES
        .entry(event.to_string())
        .or_insert_with(|| (AtomicU64::new(0), AtomicU64::new(0)));

    let (ref last_sec_atomic, ref suppressed_atomic) = *entry;
    let last_sec = last_sec_atomic.load(Ordering::Relaxed);

    if current_sec > last_sec
        && last_sec_atomic
            .compare_exchange(last_sec, current_sec, Ordering::Relaxed, Ordering::Relaxed)
            .is_ok()
    {
        let suppressed = suppressed_atomic.swap(0, Ordering::Relaxed);
        if suppressed > 0 {
            let time_desc = if current_sec == last_sec + 1 {
                "前 1 秒内"
            } else {
                "上一轮广播波动中"
            };
            log::warn!(
                "Tauri emitter 发送事件 {} 失败: {} ({}累计抑制了 {} 次重复错误，前端可能正处于刷新/未就绪状态)",
                event,
                err,
                time_desc,
                suppressed
            );
        } else {
            log::warn!(
                "Tauri emitter 发送事件 {} 失败: {} (前端可能正处于刷新/未就绪状态)",
                event,
                err
            );
        }
    } else {
        suppressed_atomic.fetch_add(1, Ordering::Relaxed);
    }
}
