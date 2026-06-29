use gcs_macros::FPPacketParser;
use serde::{Deserialize, Serialize, Serializer};

#[derive(FPPacketParser, Serialize, Deserialize, Debug, Clone, Default)]
#[frame(payload_size = 75)]
#[serde(rename_all = "camelCase")]
pub struct UAVInfo {
    #[serde(serialize_with = "serialize_uav_series")]
    pub uav_series: u8, // uav型号，0->981A; 1->981C; 2->981C;3->98;4->985;
    pub uav_id: u32,            // 飞机号
    pub longitude: f64,         // 经度
    pub latitude: f64,          // 纬度
    pub altitude: f32,          // 海拔高度
    pub relative_altitude: f32, // 相对海拔高度

    pub ground_speed: f32,           // 地速 m/s
    pub ground_speed_direction: f32, // 地速方向 0->360°
    pub vertical_speed: f32,         // 垂直速度 m/s
    pub airspeed: f32,               // 空速 m/s
    pub true_airspeed: f32,          // 真空速 m/s

    pub pitch_angle: f32,   // 俯仰角°
    pub roll_angle: f32,    // 滚转角°
    pub heading_angle: f32, // 航向角°

    pub current_route_id: i32, // 当前航线号       暂时没用
    pub next_route_id: i32,    // 下一航线号       暂时没用
    pub next_point: i32,       // 下一个航点号     暂时没用
    pub distance_next: i16,    // 待飞距           暂时没用
}

fn serialize_uav_series<S>(series: &u8, serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    let series_name = match series {
        0 => "981A",
        1 => "981C",
        2 => "981C",
        3 => "98",
        4 => "985",
        _ => "未知型号",
    };
    series_name.serialize(serializer)
}
