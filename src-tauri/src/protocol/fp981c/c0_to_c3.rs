use gcs_macros::{self, FPBitFlags, FPPacketParser, FPSubFrame};
use serde::Serialize;

// ================= C0 帧 =================
#[derive(FPPacketParser, Debug, Clone, Serialize)]
#[frame(payload_size = 25)]
pub struct FrameC0 {
    pub by_reserved: u64, // 备用
    pub data_return1: u64,
    pub data_return2: u64, // 数据注入回报
    pub reserverd: u8,     // 保留
}

// ================= C1 帧 =================
#[derive(FPPacketParser, Debug, Clone, Serialize)]
#[frame(id = 0xC1, payload_size = 25)]
pub struct FrameC1 {
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
pub struct FrameC2 {
    pub gps_longitude: i32, // 经度
    pub gps_latitude: i32,  // 纬度
    #[scale(raw_type = "u16", factor = "0.1", offset = "-500.0")]
    pub hb_height: f32, // 海拔高度
    #[scale(raw_type = "u16", factor = "0.1", offset = "-500.0")]
    pub air_height: f32, // 气压高度
    #[scale(raw_type = "u16", factor = "0.1", offset = "-500.0")]
    pub rel_height: f32, // 相对海拔高度
    pub ground_speed: u16,  // 地速
    pub ground_speed_direct: u16, // 地速方向
    pub ve_speed: i16,      // 垂速
    pub air_speed: i16,     // 空速
    pub real_air_spped: u8, // 真空速
    pub head_given: u16,    // 旋翼航向角给定
}

// ================= C3 状态帧 (带子帧结构) =================
#[derive(FPBitFlags, Debug, Clone, Serialize, Default)]
pub struct FlyStateFlags {
    pub pre_takeoff: bool,       // Bit0: 预起飞
    pub fw_takeoff: bool,        // Bit1: 固定翼起飞
    pub in_air: bool,            // Bit2: 在空中
    pub allow_landing: bool,     // Bit3: 允许着陆
    pub fw_landing: bool,        // Bit4: 固定翼着陆
    pub deep_glide: bool,        // Bit5: 深下滑
    pub backup_landing: bool,    // Bit6: 备降着陆
    pub airdrop: bool,           // Bit7: 空投
    pub unlocked: bool,          // Bit8: 解锁
    pub hovering: bool,          // Bit9: 悬停
    pub fixed_point_lock: bool,  // Bit10: 定点锁定
    pub stick_center: bool,      // Bit11: 杆量中位
    pub manual_ground: bool,     // Bit12: 手动接地
    pub takeoff_test: bool,      // Bit13: 起飞测试
    pub airdrop_retakeoff: bool, // Bit14: 空投再起飞
    pub lock_prop: bool,         // Bit15: 锁桨
    pub transition: bool,        // Bit16: 转换
    pub accel_phase: bool,       // Bit17: 加速段
    pub decel_phase: bool,       // Bit18: 减速段
    pub self_check_in: bool,     // Bit19: 自检中
    pub self_check_done: bool,   // Bit20: 自检完成
    pub decel_distance: bool,    // Bit21: 减速距离
    #[skip(2)] // Bit22-23: 跳过
    pub power_reset: bool, // Bit24: 上电复位
    pub ground_test: bool,       // Bit25: 地面测试
    pub wind_source: bool,       // Bit26: 风源
    pub engine_start: bool,      // Bit27: 起车
    #[skip(2)] // Bit28-29: 跳过
    pub landing_alt: bool, // Bit30: 降落点高度
    pub manual_enable: bool,     // Bit31: 手动使能
}

#[derive(FPPacketParser, Debug, Clone, Serialize)]
#[frame(payload_size = 25)] // C3帧公共部分18字节 + ID 1字节 + 子帧 6字节 = 25字节
pub struct C3StatusFrame {
    pub fly_status_mode_period: u8,
    pub navi_mode_step: u8,
    pub hor_ver_ctrl_mode: u8,
    pub ver_cmd_step: u8,
    pub gas_mode_hor_cmd: u8,
    #[bitflags(raw_type = "u32")]
    pub fly_state_flag: FlyStateFlags,
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
