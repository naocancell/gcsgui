use gcs_macros::FPPacketParser;
use serde::Serialize;

// ================= C5 帧 =================
#[derive(FPPacketParser, Debug, Clone, Serialize)]
#[frame(id = 0xC5, payload_size = 25)]
pub struct FrameC5 {
    pub mc_height_i: i8,            // 旋翼高度积分
    pub mc_height_given: u16,       // 旋翼高度给定
    pub mc_ver_sped_given: i16,     // 旋翼天向速度给定
    pub mc_nor_sped_given: i16,     // 旋翼北向速度给定
    pub mc_east_sped_given: i16,    // 旋翼东向速度给定
    pub mc_roll_rate_given: i16,    // 旋翼滚转角速度给定
    pub mc_pitch_rate_given: i16,   // 旋翼俯仰角速度给定
    pub mc_heading_rate_given: i16, // 旋翼航向角速度给定
    pub mc_elevator_given: i8,      // 旋翼升降舵给定
    pub mc_aileron_given: i8,       // 旋翼副翼舵给定
    pub mc_rudder_given: i8,        // 旋翼方向舵给定
    pub mc_output_oil: i8,          // 旋翼输出油门
    pub mc_balanced_oil: i8,        // 旋翼配平油门
    pub mc_pitch_continus: i8,      // 旋翼俯仰连续量 俯仰杆量
    pub mc_roll_continus: i8,       // 旋翼滚转连续量 滚转杆量
    pub mc_heading_continus: i8,    // 旋翼偏航连续量 航向杆量
    pub m_ctrl_handle_value: i8,    // 旋翼遥控杆量		油门杆量
    pub reserve: i8,                // 预留
}
