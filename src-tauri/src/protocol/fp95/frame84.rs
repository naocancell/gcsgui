use gcs_macros::{FPBitFlags, FPPacketParser};
use serde::Serialize;

/// 航电设备开关控制状态，按协议Bit0~Bit6排列。
#[derive(FPBitFlags, Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FP95AvionicsSwitchState {
    pub payload_power: bool,
    pub satcom1: bool,
    pub fire_extinguishing_equipment: bool,
    pub video_management_computer: bool,
    pub transponder: bool,
    pub temperature_humidity: bool,
    pub data_recorder: bool,
}

/// 0x84 状态帧的25字节内容区。
///
/// 协议引用但未附带定义的表33~42字段保留原始整数值。
#[derive(FPPacketParser, Debug, Clone, Serialize)]
#[frame(id = 0x84, payload_size = 25)]
#[serde(rename_all = "camelCase")]
pub struct FP95Frame84 {
    pub control_mode: u16,
    pub flight_navigation_state: u8,
    pub flight_fault_flags: u16,
    pub avionics_fault_state: u16,
    #[bitflags(raw_type = "u8")]
    pub avionics_switch_state: FP95AvionicsSwitchState,
    pub other_device_switch_state: u8,
    pub flight_state_flags: u16,
    pub data_use_state: u32,
    pub route_number: u8,
    pub target_waypoint_number: u8,
    #[scale(raw_type = "i16", factor = "10.0")]
    pub remaining_distance: f32,
    #[scale(raw_type = "i16", factor = "0.1")]
    pub cross_track_distance: f32,
    #[scale(raw_type = "i16", factor = "0.01")]
    pub heading_error: f32,
    pub fault_state: u8,
    pub actuator_fault_state: u8,
}
