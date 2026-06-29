use gcs_macros::{self, FPPacketParser, FPSubFrame};
use serde::Serialize;

// ================= C3 状态帧 (带子帧结构) =================
// 完美对应 C++ 中的 ProtocalFKDC3 结构体

#[derive(FPPacketParser, Debug, Clone, Serialize)]
#[frame(payload_size = 25)] // C3帧公共部分18字节 + ID 1字节 + 子帧 6字节 = 25字节
pub struct C3StatusFrame {
    pub fly_status_mode_period: u8,
    pub navi_mode_step: u8,
    pub hor_ver_ctrl_mode: u8,
    pub ver_cmd_step: u8,
    pub gas_mode_hor_cmd: u8,
    pub fly_state_flag: u32,
    pub fly_error_status: u16,
    pub hd_error_status: u32,
    pub sensor_status_16: u16,
    pub sensor_status_8: u8,

    // 等同于 C++ 中的 union subFrames
    #[subframe(size = 6)] // 告诉宏，这个子帧占用 6 字节。宏会自动把 1(ID) + 6 计入主帧大小校验中
    pub sub_frames: C3SubFrames,
}

#[derive(FPSubFrame, Debug, Clone, Serialize)]
pub enum C3SubFrames {
    #[id(0)]
    Sub0(C3Sub0),
    #[id(1)]
    Sub1(C3Sub1),
    #[id(2)]
    Sub2(C3Sub2),
    #[id(3)]
    Sub3(C3Sub3),
}

#[derive(FPPacketParser, Debug, Clone, Serialize)]
#[frame(payload_size = 6)]
pub struct C3Sub0 {
    pub data_use_status: u32,
    pub data_bind_flag: u16,
}

#[derive(FPPacketParser, Debug, Clone, Serialize)]
#[frame(payload_size = 6)]
pub struct C3Sub1 {
    pub sensor_on_off_flag: u16,
    pub ctrl_in_loop_flag: u16,
    pub fly_area_flag: u16,
}

#[derive(FPPacketParser, Debug, Clone, Serialize)]
#[frame(payload_size = 6)]
pub struct C3Sub2 {
    pub self_check_flag: u16,
    pub iron_read_flag: u16,
    pub vtol_flag: u16,
}

#[derive(FPPacketParser, Debug, Clone, Serialize)]
#[frame(payload_size = 6)]
pub struct C3Sub3 {
    pub status_sensor_limit: u16,

    // C++ 中这里是 UINT8，宏自动读取 1 字节并乘以 0.2 转为 f32
    #[scale(raw_type = "u8", factor = "0.2")]
    pub wind_speed: f32,

    // C++ 中这里是 UINT16，宏自动读取 2 字节并乘以 0.01 转为 f32
    #[scale(raw_type = "u16", factor = "0.01")]
    pub wind_direction: f32,

    pub ground_station_id: u8,
}

// ================= C0 帧 =================
#[derive(FPPacketParser, Debug, Clone, Serialize)]
#[frame(id = 0xC0, payload_size = 25)]
pub struct C0Frame {
    pub by_reserved: u64, // 备用
    pub data_return1: u64,
    pub data_return2: u64, // 数据注入回报
    pub reserverd: u8,     // 保留
}

// ================= C1 帧 =================
#[derive(FPPacketParser, Debug, Clone, Serialize)]
#[frame(id = 0xC1, payload_size = 25)]
pub struct C1Frame {
    pub fy_angle: i16,      // 俯仰角
    pub gz_angle: i16,      // 滚转角
    pub head_angle: u16,    // 航向角
    pub fy_w: i16,          // 俯仰角速率
    pub gz_w: i16,          // 滚转角速率
    pub ph_w: i16,          // 航向角速率
    pub xw: i16,            // 前向加速度
    pub yw: i16,            // 右向加速度
    pub zw: i16,            // 垂向加速度
    pub fy_given: i8,       // 固定翼俯仰角给定
    pub gz_given: i8,       // 固定翼滚转角给定
    pub rotor_fy_given: i8, // 旋翼俯仰角给定
    pub rotor_gz_given: i8, // 旋翼滚转角给定
    pub fault_codes: u16,   // 故障码
    pub open_cmd_re: u8,    // 遥控开关指令回报
}

// ================= C2 帧 =================
#[derive(FPPacketParser, Debug, Clone, Serialize)]
#[frame(id = 0xC2, payload_size = 25)]
pub struct C2Frame {
    pub gps_longitude: i32,       // 经度
    pub gps_latitude: i32,        // 纬度
    pub hb_height: u16,           // 海拔高度
    pub air_height: u16,          // 气压高度
    pub rel_height: u16,          // 相对海拔高度
    pub ground_speed: u16,        // 地速
    pub ground_speed_direct: u16, // 地速方向
    pub ve_speed: i16,            // 垂速
    pub air_speed: i16,           // 空速
    pub real_air_spped: u8,       // 真空速
    pub head_given: u16,          // 旋翼航向角给定
}

// ================= C5 帧 =================
#[derive(FPPacketParser, Debug, Clone, Serialize)]
#[frame(id = 0xC5, payload_size = 25)]
pub struct C5Frame {
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

// ================= 解析入口 =================
#[derive(FPSubFrame, Debug, Clone, Serialize)]
pub enum ParsedSubFrame {
    #[id(0xC0)]
    C0(C0Frame),
    #[id(0xC1)]
    C1(C1Frame),
    #[id(0xC2)]
    C2(C2Frame),
    #[id(0xC3)]
    C3(C3StatusFrame),
    #[id(0xC5)]
    C5(C5Frame),
}

/// FP981C 无人机数据聚合结构体
#[derive(Debug, Default, Clone, Serialize)]
pub struct FP981CAggregate {
    pub uav_id: u8,
    pub c0: Option<C0Frame>,
    pub c1: Option<C1Frame>,
    pub c2: Option<C2Frame>,
    pub c3: Option<C3StatusFrame>,
    pub c3_sub0: Option<C3Sub0>,
    pub c3_sub1: Option<C3Sub1>,
    pub c3_sub2: Option<C3Sub2>,
    pub c3_sub3: Option<C3Sub3>,
    pub c5: Option<C5Frame>,
}
