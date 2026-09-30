//! 任管载荷控制与查询 Tauri 命令层

use crate::protocol::payload::{
    build_read_coils_cmd, build_write_coils_cmd, pack_payload_frame, MissionPayloadAggregate,
    RelayStatus, CODE_UPLINK, PAYLOAD_ID_RELAY,
};
use crate::state::AppState;
use crate::uplink::dispatcher::broadcast_raw_payload;

/// 单路继电器开关控制（继电器序号 1~16）
#[tauri::command]
pub async fn send_relay_control(
    state: tauri::State<'_, AppState>,
    uav_id: u8,
    relay_index: u8,
    enabled: bool,
) -> Result<(), String> {
    if !(1..=16).contains(&relay_index) {
        return Err(format!("继电器编号超出范围 (1~16): {}", relay_index));
    }

    // 根据协议图映射：b0~b7 对应线圈 9~16，b8~b15 对应线圈 1~8
    let bit_pos = RelayStatus::coil_to_bit_pos(relay_index);
    let current_mask = state
        .mission_payload_pool
        .get(&uav_id)
        .and_then(|agg| agg.relay.map(|r| r.mask))
        .unwrap_or(0);

    let new_mask = if enabled {
        current_mask | (1 << bit_pos)
    } else {
        current_mask & !(1 << bit_pos)
    };

    let inner_cmd = build_write_coils_cmd(new_mask);
    let frame = pack_payload_frame(CODE_UPLINK, PAYLOAD_ID_RELAY, 0, &inner_cmd);
    let res = broadcast_raw_payload(&state, &frame).await;
    if res.is_ok() {
        let state_clone = state.inner().clone();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
            let inner_cmd = build_read_coils_cmd();
            let query_frame = pack_payload_frame(CODE_UPLINK, PAYLOAD_ID_RELAY, 0, &inner_cmd);
            let _ = broadcast_raw_payload(&state_clone, &query_frame).await;
        });
    }
    res
}

/// 批量设置 16 路继电器状态（掩码控制）
#[tauri::command]
pub async fn send_relay_batch(
    state: tauri::State<'_, AppState>,
    _uav_id: u8,
    mask: u16,
) -> Result<(), String> {
    let inner_cmd = build_write_coils_cmd(mask);
    let frame = pack_payload_frame(CODE_UPLINK, PAYLOAD_ID_RELAY, 0, &inner_cmd);
    let res = broadcast_raw_payload(&state, &frame).await;
    if res.is_ok() {
        let state_clone = state.inner().clone();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
            let inner_cmd = build_read_coils_cmd();
            let query_frame = pack_payload_frame(CODE_UPLINK, PAYLOAD_ID_RELAY, 0, &inner_cmd);
            let _ = broadcast_raw_payload(&state_clone, &query_frame).await;
        });
    }
    res
}

/// 启动地面站 0xC3 继电器自主轮询后台任务（频率 0.5Hz，即 2 秒 1 次）
///
/// 穿插在原本的上行链路中，当存在活动通信链路时自动周期性发送读线圈指令
pub fn start_relay_status_poller(state: AppState) {
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_millis(2000));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

        loop {
            interval.tick().await;

            // 仅在存在活动的上行通信链路时穿插发送读线圈指令；
            // 回放安全围栏：回放会话存在时暂停轮询，避免向真实链路发包
            let has_active_uplink = state
                .active_links
                .iter()
                .any(|entry| matches!(entry.protocol, crate::comms::ProtocolType::FP981C | crate::comms::ProtocolType::FP95));

            if has_active_uplink && !state.replay_active() {
                let inner_cmd = build_read_coils_cmd();
                let frame = pack_payload_frame(CODE_UPLINK, PAYLOAD_ID_RELAY, 0, &inner_cmd);
                let _ = broadcast_raw_payload(&state, &frame).await;
            }
        }
    });
}

/// 下发读线圈指令，主动查询 16 路继电器当前状态
#[tauri::command]
pub async fn query_relay_status(
    state: tauri::State<'_, AppState>,
    _uav_id: u8,
) -> Result<(), String> {
    let inner_cmd = build_read_coils_cmd();
    let frame = pack_payload_frame(CODE_UPLINK, PAYLOAD_ID_RELAY, 0, &inner_cmd);
    broadcast_raw_payload(&state, &frame).await
}

/// 获取指定飞机当前载荷状态快照
#[tauri::command]
pub async fn get_mission_payload_snapshot(
    state: tauri::State<'_, AppState>,
    uav_id: u8,
) -> Result<Option<MissionPayloadAggregate>, String> {
    Ok(state.mission_payload_pool.get(&uav_id).map(|kv| kv.value().clone()))
}

/// 螺旋桨加热模式与功率/温度控制指令
///
/// 工作模式: 0x00 关闭模式, 0x01 指令调节, 0x02 恒功率模式, 0x03 恒温模式
#[tauri::command]
pub async fn send_propeller_deice_command(
    state: tauri::State<'_, AppState>,
    _uav_id: u8,
    work_mode: u8,
    target_power: u16,
    target_temp: i16,
) -> Result<(), String> {
    // 组装螺旋桨加热控制器控制指令帧 (透传上行或载荷格式)
    // 报文结构: 0xEB 0x90 [目标功率u16_le] [工作模式u8] [目标温度i16_le] [校验和u8]
    let mut cmd_bytes = Vec::with_capacity(8);
    cmd_bytes.extend_from_slice(&[0xEB, 0x90]);
    cmd_bytes.extend_from_slice(&target_power.to_le_bytes());
    cmd_bytes.push(work_mode);
    cmd_bytes.extend_from_slice(&target_temp.to_le_bytes());
    let sum: u32 = cmd_bytes.iter().map(|&b| b as u32).sum();
    cmd_bytes.push((sum & 0xFF) as u8);

    // 通过外层任管报文或广播信道下发
    let frame = pack_payload_frame(CODE_UPLINK, 0x94, 0, &cmd_bytes);
    broadcast_raw_payload(&state, &frame).await
}

