use gcs_macros::FPPacketParser;
use serde::Serialize;

/// 0x80 数据注入回报帧的25字节内容区。
#[derive(FPPacketParser, Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[frame(id = 0x80, payload_size = 25)]
pub struct FP95Frame80 {
    pub reserved: [u8; 8],
    pub injection_response: [u8; 16],
    pub trailing_reserved: u8,
}

/// 0x81 姿态帧的25字节内容区。
#[derive(FPPacketParser, Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[frame(id = 0x81, payload_size = 25)]
pub struct FP95Frame81 {
    #[scale(raw_type = "i16", factor = "0.01")]
    pub pitch_angle: f32,
    #[scale(raw_type = "i16", factor = "0.01")]
    pub roll_angle: f32,
    #[scale(raw_type = "u16", factor = "0.01")]
    pub heading_angle: f32,
    #[scale(raw_type = "i16", factor = "0.01")]
    pub pitch_rate: f32,
    #[scale(raw_type = "i16", factor = "0.01")]
    pub roll_rate: f32,
    #[scale(raw_type = "i16", factor = "0.01")]
    pub heading_rate: f32,
    #[scale(raw_type = "i16", factor = "0.01")]
    pub forward_acceleration: f32,
    #[scale(raw_type = "i16", factor = "0.01")]
    pub right_acceleration: f32,
    #[scale(raw_type = "i16", factor = "0.01")]
    pub vertical_acceleration: f32,
    #[scale(raw_type = "i8", factor = "0.5")]
    pub pitch_command: f32,
    #[scale(raw_type = "i8", factor = "0.5")]
    pub roll_command: f32,
    #[scale(raw_type = "u16", factor = "0.01")]
    pub heading_command: f32,
    pub ground_station_id: u8,
    pub flight_warning_code: i8,
    pub remote_switch_feedback: u8,
}

/// 0x83 位置帧的25字节内容区。
#[derive(FPPacketParser, Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[frame(id = 0x83, payload_size = 25)]
pub struct FP95Frame83 {
    #[scale(raw_type = "i8", factor = "0.1")]
    pub lateral_speed: f32,
    #[scale(raw_type = "i32", factor = "1e-7")]
    pub longitude: f64,
    #[scale(raw_type = "i32", factor = "1e-7")]
    pub latitude: f64,
    #[scale(raw_type = "u16", factor = "0.2", offset = "-500.0")]
    pub altitude: f32,
    #[scale(raw_type = "u16", factor = "0.2", offset = "-500.0")]
    pub pressure_altitude: f32,
    #[scale(raw_type = "u16", factor = "0.2", offset = "-500.0")]
    pub relative_altitude: f32,
    #[scale(raw_type = "u16", factor = "0.01")]
    pub air_speed: f32,
    #[scale(raw_type = "u16", factor = "0.01")]
    pub ground_speed: f32,
    #[scale(raw_type = "u16", factor = "0.01")]
    pub ground_track: f32,
    #[scale(raw_type = "i16", factor = "0.01")]
    pub vertical_speed: f32,
    #[scale(raw_type = "u16", factor = "0.01")]
    pub true_air_speed: f32,
}
