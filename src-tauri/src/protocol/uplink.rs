use serde::{Deserialize, Serialize};
use std::fmt;

use crate::protocol::fkd_crc::calculate_fkd_crc;

pub const UPLINK_FRAME_LEN: usize = 32;
pub const PERIODIC_FUNCTION_CODE: u8 = 0x51;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UplinkFrameContext {
    pub destination: u8,
    pub source: u8,
    pub aircraft_id: u8,
    pub data_source: u8,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UplinkControlState {
    pub switch_command: u8,
    pub continuous: [u8; 4],
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeriodicNavigationData {
    pub heading_deg: f64,
    pub longitude_deg: f64,
    pub latitude_deg: f64,
    pub task_switch: u8,
    pub task_continuous: [u8; 4],
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FlightSwitchCommand {
    PayloadOn,
    PayloadOff,
    TransponderOn,
    TransponderOff,
}

impl FlightSwitchCommand {
    pub const fn code(self) -> u8 {
        match self {
            Self::PayloadOn => 0x52,
            Self::PayloadOff => 0x53,
            Self::TransponderOn => 0xD8,
            Self::TransponderOff => 0xD9,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoAckCommand {
    pub function_code: u8,
    pub payload: [u8; 15],
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum UplinkPayload {
    Periodic(PeriodicNavigationData),
    Command(NoAckCommand),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UplinkEncodeError {
    InvalidDataSource(u8),
    InvalidPhysicalValue(&'static str),
}

impl fmt::Display for UplinkEncodeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidDataSource(value) => {
                write!(
                    formatter,
                    "无效的数据来源 0x{value:02X}，仅允许 0xAA 或 0xCC"
                )
            }
            Self::InvalidPhysicalValue(field) => write!(formatter, "{field} 超出协议范围"),
        }
    }
}

impl std::error::Error for UplinkEncodeError {}

fn checked_scaled_i32(
    value: f64,
    min: f64,
    max: f64,
    scale: f64,
    field: &'static str,
) -> Result<i32, UplinkEncodeError> {
    if !value.is_finite() || !(min..=max).contains(&value) {
        return Err(UplinkEncodeError::InvalidPhysicalValue(field));
    }
    Ok((value * scale).round() as i32)
}

fn encode_periodic_payload(data: PeriodicNavigationData) -> Result<[u8; 15], UplinkEncodeError> {
    if !data.heading_deg.is_finite() || !(0.0..=360.0).contains(&data.heading_deg) {
        return Err(UplinkEncodeError::InvalidPhysicalValue("航向"));
    }

    let heading = (data.heading_deg * 100.0).round() as u16;
    let longitude = checked_scaled_i32(data.longitude_deg, -180.0, 180.0, 10_000_000.0, "经度")?;
    let latitude = checked_scaled_i32(data.latitude_deg, -90.0, 90.0, 10_000_000.0, "纬度")?;

    let mut payload = [0u8; 15];
    payload[0..2].copy_from_slice(&heading.to_le_bytes());
    payload[2..6].copy_from_slice(&longitude.to_le_bytes());
    payload[6..10].copy_from_slice(&latitude.to_le_bytes());
    payload[10] = data.task_switch;
    payload[11..15].copy_from_slice(&data.task_continuous);
    Ok(payload)
}

pub fn encode_uplink_frame(
    context: UplinkFrameContext,
    control: UplinkControlState,
    sequence: u8,
    payload: UplinkPayload,
) -> Result<[u8; UPLINK_FRAME_LEN], UplinkEncodeError> {
    if !matches!(context.data_source, 0xAA | 0xCC) {
        return Err(UplinkEncodeError::InvalidDataSource(context.data_source));
    }

    let (function_code, business_data) = match payload {
        UplinkPayload::Periodic(data) => (PERIODIC_FUNCTION_CODE, encode_periodic_payload(data)?),
        UplinkPayload::Command(command) => (command.function_code, command.payload),
    };

    let mut frame = [0u8; UPLINK_FRAME_LEN];
    frame[0..2].copy_from_slice(&[0xEB, 0x90]);
    frame[2] = context.destination;
    frame[3] = context.source;
    frame[4] = context.aircraft_id;
    frame[5] = sequence;
    frame[6..9].fill(control.switch_command);
    frame[9..13].copy_from_slice(&control.continuous);
    frame[13] = function_code;
    frame[14..29].copy_from_slice(&business_data);
    frame[29] = context.data_source;
    let crc = calculate_fkd_crc(&frame[2..30]);
    frame[30..32].copy_from_slice(&crc);
    Ok(frame)
}

