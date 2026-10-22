use crate::protocol::uplink::{NoAckCommand, PeriodicNavigationData, UplinkControlState};
use crate::uplink::{
    CommandSendPolicy, FlightSwitchCommand, UplinkCommandError, UplinkHandle, UplinkStatus,
};

/// 查询当前生效的上行机号（由通信配置统一设置，各业务指令不再单独传机号）
#[tauri::command]
pub fn get_uplink_aircraft_id(handle: tauri::State<'_, UplinkHandle>) -> u8 {
    handle.aircraft_id()
}

#[tauri::command]
pub async fn update_uplink_control(
    handle: tauri::State<'_, UplinkHandle>,
    control: UplinkControlState,
) -> Result<(), String> {
    handle.update_control(control).await
}

#[tauri::command]
pub async fn update_uplink_periodic(
    handle: tauri::State<'_, UplinkHandle>,
    periodic: PeriodicNavigationData,
) -> Result<(), String> {
    handle.update_periodic(periodic).await
}

#[tauri::command]
pub async fn submit_uplink_command(
    handle: tauri::State<'_, UplinkHandle>,
    command: NoAckCommand,
    policy: CommandSendPolicy,
) -> Result<(), UplinkCommandError> {
    handle.submit_command(command, policy).await
}

#[tauri::command]
pub async fn submit_flight_switch_command(
    handle: tauri::State<'_, UplinkHandle>,
    command: FlightSwitchCommand,
) -> Result<(), UplinkCommandError> {
    log::info!(
        "[操作] 飞行开关指令 {:?}（0x{:02X}），机号 {}",
        command,
        command.code(),
        handle.aircraft_id()
    );
    handle.submit_flight_switch(command).await
}

#[tauri::command]
pub async fn clear_uplink_command(handle: tauri::State<'_, UplinkHandle>) -> Result<(), String> {
    handle.clear_command().await
}

#[tauri::command]
pub async fn get_uplink_status(
    handle: tauri::State<'_, UplinkHandle>,
) -> Result<UplinkStatus, String> {
    handle.status().await
}
