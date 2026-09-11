//! 13所吊舱控制 Tauri 命令层。
//!
//! 时序设计（对应规范第五节）：
//! - 单次触发：`RepeatCycles { cycles: 5 }`，以 20ms tick 连发 5 帧 = 约 100ms
//!   注入窗口，随后自动回落周期常发帧（fcode 0x51），等效"单发 + 100ms + 清空复位"。
//! - 连续/长按：`UntilClearedPeriodic { interval_ticks: 5 }`，100ms 周期（10Hz）
//!   持续发送，松开时调用 `stop_pod_command` 立即回落，等效"长按循环 + 松开清空"。
//! - VMC 通道指令：复用飞行开关三判二机制（6 帧指令 + 4 帧释放）。

use crate::protocol::pod13::{
    encode_pod_injection, validate_vmc_code, PodCommandRequest, PodSendMode, POD_INJECT_CODE,
};
use crate::protocol::uplink::{FlightSwitchCommand, NoAckCommand, UplinkFrameContext};
use crate::uplink::{CommandSendPolicy, UplinkCommandError, UplinkHandle};

/// 上行 actor 的固定 tick 周期（毫秒）。
const UPLINK_TICK_MS: u8 = 20;
/// 单次触发指令的注入窗口（毫秒），对应规范 5.1 的 100ms 延时窗口。
const SINGLE_INJECT_WINDOW_MS: u8 = 100;
/// 连续指令的发送周期（毫秒），对应规范 5.2 的 10Hz 循环。
const CONTINUOUS_PERIOD_MS: u8 = 100;

fn command_context(aircraft_id: u8) -> UplinkFrameContext {
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

/// 发送 13所吊舱 Z45 指令。
#[tauri::command]
pub async fn send_pod_command(
    handle: tauri::State<'_, UplinkHandle>,
    aircraft_id: u8,
    request: PodCommandRequest,
) -> Result<(), String> {
    let payload = encode_pod_injection(&request)?;
    let cycles = u16::from(SINGLE_INJECT_WINDOW_MS / UPLINK_TICK_MS);
    let interval_ticks = CONTINUOUS_PERIOD_MS / UPLINK_TICK_MS;
    let policy = match request.mode {
        PodSendMode::Single => CommandSendPolicy::RepeatCycles { cycles },
        PodSendMode::Continuous => CommandSendPolicy::UntilClearedPeriodic { interval_ticks },
    };

    handle.configure(command_context(aircraft_id)).await?;
    if request.mode == PodSendMode::Continuous {
        // 长按控制采用替换语义：切换控制键时先清掉在途的吊舱注入，
        // 避免上一个按键的指令占位导致 Conflict。
        let _ = handle.clear_command_if(POD_INJECT_CODE).await;
    }
    handle
        .submit_command(
            NoAckCommand {
                function_code: POD_INJECT_CODE,
                payload,
            },
            policy,
        )
        .await
        .map_err(uplink_error_message)
}

/// 停止吊舱连续/长按指令（松开按键时调用）。
#[tauri::command]
pub async fn stop_pod_command(handle: tauri::State<'_, UplinkHandle>) -> Result<(), String> {
    handle.clear_command_if(POD_INJECT_CODE).await.map(|_| ())
}

/// 发送 VMC（视频管理计算机）通道切换指令（0xC0 ~ 0xCD）。
///
/// 通过飞控开关指令帧三判二字段下发：码率设置、吊舱通道、拼图模式、
/// 记录控制、数据清空与视频链路输出选择。
#[tauri::command]
pub async fn submit_vmc_command(
    handle: tauri::State<'_, UplinkHandle>,
    aircraft_id: u8,
    switch_code: u8,
) -> Result<(), String> {
    let code = validate_vmc_code(switch_code)?;
    handle
        .submit_flight_switch(aircraft_id, FlightSwitchCommand::Vmc(code))
        .await
        .map_err(uplink_error_message)
}
