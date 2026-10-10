use crate::protocol::uplink::{
    NoAckCommand, PeriodicNavigationData, UplinkControlState, UplinkFrameContext,
};
use crate::uplink::{
    CommandSendPolicy, FlightSwitchCommand, UplinkCommandError, UplinkHandle, UplinkStatus,
};

#[tauri::command]
pub async fn configure_uplink(
    handle: tauri::State<'_, UplinkHandle>,
    context: UplinkFrameContext,
) -> Result<(), crate::error::AppError> {
    handle
        .configure(context)
        .await
        .map_err(|e| crate::error::AppError::uplink(40001, e))
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
    aircraft_id: u8,
    command: FlightSwitchCommand,
) -> Result<(), UplinkCommandError> {
    handle.submit_flight_switch(aircraft_id, command).await
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
