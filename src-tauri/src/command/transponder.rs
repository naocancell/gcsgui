use std::future::Future;
use std::time::Duration;

use crate::protocol::fp95_command::{
    encode_air_traffic_binding, encode_switch_binding, AirTrafficParamConfig,
    AirTrafficParamReadback, TransponderSwitchConfig, TransponderSwitchReadback,
    AIR_TRAFFIC_BIND_CODE, AIR_TRAFFIC_QUERY_CODE, SWITCH_BIND_CODE, SWITCH_QUERY_CODE,
};
use crate::protocol::uplink::{NoAckCommand, UplinkFrameContext};
use crate::uplink::{
    CommandSendPolicy, ExpectedResponse, FP95Response, FP95ResponseCoordinator, UplinkCommandError,
    UplinkHandle,
};

const RESPONSE_TIMEOUT: Duration = Duration::from_secs(2);

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

async fn execute_with_response<F, Fut, C, CleanupFut>(
    coordinator: &FP95ResponseCoordinator,
    aircraft_id: u8,
    expected: ExpectedResponse,
    mut send: F,
    mut cleanup: C,
    timeout_duration: Duration,
) -> Result<FP95Response, String>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<(), String>>,
    C: FnMut() -> CleanupFut,
    CleanupFut: Future<Output = Result<(), String>>,
{
    for attempt in 1..=2 {
        let pending = coordinator.register(aircraft_id, expected.clone())?;
        if let Err(error) = send().await {
            coordinator.cancel(pending.id);
            return Err(error);
        }

        match tokio::time::timeout(timeout_duration, pending.receiver).await {
            Ok(Ok(result)) => return result,
            Ok(Err(_)) => {
                coordinator.cancel(pending.id);
                return Err("0x80回报等待通道异常关闭".to_string());
            }
            Err(_) => {
                coordinator.cancel(pending.id);
                cleanup().await?;
                if attempt == 2 {
                    return Err("等待0x80回报超时，已尝试2次".to_string());
                }
            }
        }
    }
    unreachable!("FP95 response loop always returns within two attempts")
}

async fn submit_acknowledged_command(
    handle: &UplinkHandle,
    coordinator: &FP95ResponseCoordinator,
    aircraft_id: u8,
    function_code: u8,
    payload: [u8; 15],
    expected: ExpectedResponse,
) -> Result<FP95Response, String> {
    execute_with_response(
        coordinator,
        aircraft_id,
        expected,
        || async {
            handle.configure(command_context(aircraft_id)).await?;
            handle
                .submit_command(
                    NoAckCommand {
                        function_code,
                        payload,
                    },
                    CommandSendPolicy::Once,
                )
                .await
                .map_err(uplink_error_message)
        },
        || async { handle.clear_command_if(function_code).await.map(|_| ()) },
        RESPONSE_TIMEOUT,
    )
    .await
}

#[tauri::command]
pub async fn bind_transponder_switches(
    handle: tauri::State<'_, UplinkHandle>,
    coordinator: tauri::State<'_, FP95ResponseCoordinator>,
    aircraft_id: u8,
    config: TransponderSwitchConfig,
) -> Result<(), String> {
    let payload = encode_switch_binding(&config)?;
    match submit_acknowledged_command(
        &handle,
        &coordinator,
        aircraft_id,
        SWITCH_BIND_CODE,
        payload,
        ExpectedResponse::SwitchBinding(payload),
    )
    .await?
    {
        FP95Response::BindingConfirmed => Ok(()),
        _ => Err("应答机状态装订收到非预期回报".to_string()),
    }
}

#[tauri::command]
pub async fn query_transponder_switches(
    handle: tauri::State<'_, UplinkHandle>,
    coordinator: tauri::State<'_, FP95ResponseCoordinator>,
    aircraft_id: u8,
) -> Result<TransponderSwitchReadback, String> {
    match submit_acknowledged_command(
        &handle,
        &coordinator,
        aircraft_id,
        SWITCH_QUERY_CODE,
        [0u8; 15],
        ExpectedResponse::SwitchQuery,
    )
    .await?
    {
        FP95Response::SwitchQuery(readback) => Ok(readback),
        _ => Err("应答机状态查询收到非预期回报".to_string()),
    }
}

#[tauri::command]
pub async fn bind_air_traffic_params(
    handle: tauri::State<'_, UplinkHandle>,
    coordinator: tauri::State<'_, FP95ResponseCoordinator>,
    aircraft_id: u8,
    config: AirTrafficParamConfig,
) -> Result<(), String> {
    let payload = encode_air_traffic_binding(&config)?;
    match submit_acknowledged_command(
        &handle,
        &coordinator,
        aircraft_id,
        AIR_TRAFFIC_BIND_CODE,
        payload,
        ExpectedResponse::AirTrafficBinding(payload),
    )
    .await?
    {
        FP95Response::BindingConfirmed => Ok(()),
        _ => Err("航管参数装订收到非预期回报".to_string()),
    }
}

#[tauri::command]
pub async fn query_air_traffic_params(
    handle: tauri::State<'_, UplinkHandle>,
    coordinator: tauri::State<'_, FP95ResponseCoordinator>,
    aircraft_id: u8,
) -> Result<AirTrafficParamReadback, String> {
    match submit_acknowledged_command(
        &handle,
        &coordinator,
        aircraft_id,
        AIR_TRAFFIC_QUERY_CODE,
        [0u8; 15],
        ExpectedResponse::AirTrafficQuery,
    )
    .await?
    {
        FP95Response::AirTrafficQuery(readback) => Ok(readback),
        _ => Err("航管参数查询收到非预期回报".to_string()),
    }
}


