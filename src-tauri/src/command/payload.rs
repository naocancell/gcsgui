//! 任管载荷控制与查询 Tauri 命令层

use crate::protocol::payload::{
    build_read_coils_cmd, build_write_coils_cmd, pack_payload_frame, MissionPayloadAggregate,
    RelayStatus, CODE_UPLINK, PAYLOAD_ID_RELAY,
};
use crate::state::AppState;
use crate::uplink::dispatcher::{broadcast_raw_payload, broadcast_raw_payload_poll};

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
                let _ = broadcast_raw_payload_poll(&state, &frame).await;
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

use crate::protocol::uplink::{NoAckCommand, UplinkFrameContext};
use crate::uplink::{CommandSendPolicy, UplinkCommandError, UplinkHandle};

/// 电防冰功能码（测控上行链路，指令码 0x77）
pub const PROPELLER_DEICE_FUNCTION_CODE: u8 = 0x77;

fn deice_command_context(aircraft_id: u8) -> UplinkFrameContext {
    UplinkFrameContext {
        destination: 0x02,
        source: 0x01,
        aircraft_id,
        data_source: 0xAA,
    }
}

fn uplink_error_message(error: UplinkCommandError) -> String {
    match error {
        UplinkCommandError::Conflict { message, .. }
        | UplinkCommandError::InvalidPolicy { message }
        | UplinkCommandError::ServiceUnavailable { message } => message,
    }
}

/// 构建电防冰控制器 (DFB-2000-48-A) 接收控制帧（标准 12 字节）
///
/// 协议来源：《电防冰控制器(DFB-2000-48-A)通信协议V10.pdf》 表 3 & 表 4
///
/// 报文结构（12 字节定长）：
/// - 字节 0~1: 同步码固定为 0xEB, 0x90
/// - 字节 2~4: 指令码（重复 3 次）
///   - 0x00: 关闭模式
///   - 0x01: 指令调节
///   - 0x02: 恒功率模式
///   - 0x03: 恒温模式
/// - 字节 5~10: 指令参数（2 字节小端 u16 LE，重复 3 次）
///   - 关闭模式: 0x0000（停止加热）
///   - 指令调节: 0x0000 (减小 1%) 或 0x0001 (增大 1%)
///   - 恒功率模式: 目标设定功率 (0 ~ 65535 W)
///   - 恒温模式: 目标设定温度 (0 ~ 65535 ℃)
/// - 字节 11: 校验码，使得 “同步码” + “帧内容” + “校验码” = 0 MOD 256
pub fn build_propeller_deice_cmd(work_mode: u8, param: u16) -> [u8; 12] {
    let mut buf = [0u8; 12];
    buf[0] = 0xEB;
    buf[1] = 0x90;
    buf[2] = work_mode;
    buf[3] = work_mode;
    buf[4] = work_mode;

    let p = param.to_le_bytes();
    buf[5] = p[0];
    buf[6] = p[1];
    buf[7] = p[0];
    buf[8] = p[1];
    buf[9] = p[0];
    buf[10] = p[1];

    let sum_11: u32 = buf[..11].iter().map(|&b| b as u32).sum();
    buf[11] = ((256 - (sum_11 % 256)) % 256) as u8;
    buf
}

/// 构建放入 32 字节测控上行外层中的 15 字节业务载荷
///
/// 结构：前 12 字节为电防冰控制器标准控制帧，后 3 字节补 0。
pub fn build_propeller_deice_uplink_payload(work_mode: u8, param: u16) -> [u8; 15] {
    let inner_cmd = build_propeller_deice_cmd(work_mode, param);
    let mut payload = [0u8; 15];
    payload[..12].copy_from_slice(&inner_cmd);
    payload
}

/// 螺旋桨加热模式与功率/温度控制指令
///
/// 外层采用 0xEB 0x90 开头的 32 字节测控上行帧，指令码 (功能码) 为 0x77；
/// 内层控制帧固定 12 字节（DFB-2000-48-A 规范），置于 15 字节业务区前部，尾部 3 字节补 0；
/// 下发策略为单次触发发送 (CommandSendPolicy::Once)。
#[tauri::command]
pub async fn send_propeller_deice_command(
    handle: tauri::State<'_, UplinkHandle>,
    uav_id: u8,
    work_mode: u8,
    target_power: u16,
    target_temp: i16,
) -> Result<(), String> {
    let param: u16 = match work_mode {
        0x00 => 0x0000,
        0x01 => target_power, // 0: 减小 1%, 1: 增大 1%
        0x02 => target_power, // 目标功率 (W)
        0x03 => target_temp as u16, // 目标温度 (℃)
        _ => target_power,
    };

    let payload_15 = build_propeller_deice_uplink_payload(work_mode, param);

    handle
        .configure(deice_command_context(uav_id))
        .await
        .map_err(|e| e.to_string())?;

    handle
        .submit_command(
            NoAckCommand {
                function_code: PROPELLER_DEICE_FUNCTION_CODE,
                payload: payload_15,
            },
            CommandSendPolicy::Once,
        )
        .await
        .map_err(uplink_error_message)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::uplink::{
        encode_uplink_frame, UplinkControlState, UplinkPayload, UPLINK_FRAME_LEN,
    };

    #[test]
    fn test_build_propeller_deice_cmd_zero_sum_checksum() {
        // 模式 0: 关闭模式，参数 0
        let cmd0 = build_propeller_deice_cmd(0x00, 0x0000);
        assert_eq!(&cmd0[0..2], &[0xEB, 0x90]);
        assert_eq!(&cmd0[2..5], &[0x00, 0x00, 0x00]);
        assert_eq!(&cmd0[5..11], &[0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
        let sum0: u32 = cmd0.iter().map(|&b| b as u32).sum();
        assert_eq!(sum0 % 256, 0, "模式0必须满足零和校验");

        // 模式 1: 指令调节（增大），参数 1
        let cmd1 = build_propeller_deice_cmd(0x01, 0x0001);
        assert_eq!(&cmd1[2..5], &[0x01, 0x01, 0x01]);
        assert_eq!(&cmd1[5..11], &[0x01, 0x00, 0x01, 0x00, 0x01, 0x00]);
        let sum1: u32 = cmd1.iter().map(|&b| b as u32).sum();
        assert_eq!(sum1 % 256, 0, "模式1必须满足零和校验");

        // 模式 2: 恒功率模式 2000W (0x07D0)
        let cmd2 = build_propeller_deice_cmd(0x02, 2000);
        assert_eq!(&cmd2[2..5], &[0x02, 0x02, 0x02]);
        assert_eq!(&cmd2[5..11], &[0xD0, 0x07, 0xD0, 0x07, 0xD0, 0x07]);
        let sum2: u32 = cmd2.iter().map(|&b| b as u32).sum();
        assert_eq!(sum2 % 256, 0, "模式2必须满足零和校验");

        // 模式 3: 恒温模式 15℃ (0x000F)
        let cmd3 = build_propeller_deice_cmd(0x03, 15);
        assert_eq!(&cmd3[2..5], &[0x03, 0x03, 0x03]);
        assert_eq!(&cmd3[5..11], &[0x0F, 0x00, 0x0F, 0x00, 0x0F, 0x00]);
        let sum3: u32 = cmd3.iter().map(|&b| b as u32).sum();
        assert_eq!(sum3 % 256, 0, "模式3必须满足零和校验");
    }

    #[test]
    fn test_build_propeller_deice_uplink_payload_and_32byte_frame() {
        // 构建 15 字节载荷（模式2 恒功率 2000W）
        let payload15 = build_propeller_deice_uplink_payload(0x02, 2000);
        // 前 12 字节为内层控制帧，零和校验验证
        let sum12: u32 = payload15[..12].iter().map(|&b| b as u32).sum();
        assert_eq!(sum12 % 256, 0);
        // 后 3 字节补 0
        assert_eq!(&payload15[12..15], &[0x00, 0x00, 0x00]);

        // 测试外层 32 字节测控上行帧封装
        let context = UplinkFrameContext {
            destination: 0x02,
            source: 0x01,
            aircraft_id: 3,
            data_source: 0xAA,
        };
        let frame = encode_uplink_frame(
            context,
            UplinkControlState::default(),
            1,
            UplinkPayload::Command(NoAckCommand {
                function_code: PROPELLER_DEICE_FUNCTION_CODE,
                payload: payload15,
            }),
        )
        .expect("编码测控上行帧成功");

        assert_eq!(frame.len(), UPLINK_FRAME_LEN);
        assert_eq!(&frame[0..2], &[0xEB, 0x90]); // 外层同步码
        assert_eq!(frame[2], 0x02); // 目的地址
        assert_eq!(frame[3], 0x01); // 源地址
        assert_eq!(frame[4], 3); // 飞机号
        assert_eq!(frame[13], 0x77); // 指令码 / 功能码 0x77
        assert_eq!(&frame[14..26], &payload15[..12]); // 内层 12 字节
        assert_eq!(&frame[26..29], &[0x00, 0x00, 0x00]); // 尾部补 0
        assert_eq!(frame[29], 0xAA); // 数据来源
        // 验证尾部 2 字节 FKD-CRC 校验码正确
        assert!(crate::protocol::fkd_crc::verify_fkd_crc(&frame, 0xEB, 0x90));
    }
}

