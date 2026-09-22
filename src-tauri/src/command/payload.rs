//! 任管载荷控制与查询 Tauri 命令层

use crate::protocol::payload::{
    build_read_coils_cmd, build_write_coils_cmd, pack_payload_frame, MissionPayloadAggregate,
    CODE_UPLINK, PAYLOAD_ID_RELAY,
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

    // 获取当前掩码（如果已有），在此基础上修改对应 bit
    let bit_pos = relay_index - 1;
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
    broadcast_raw_payload(&state, &frame).await
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
    broadcast_raw_payload(&state, &frame).await
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
