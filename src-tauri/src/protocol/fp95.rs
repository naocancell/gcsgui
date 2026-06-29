use gcs_macros::{self, FPPacketParser, FPSubFrame};
use serde::Serialize;

// ================= 94 帧 =================
/// 传输层原始结构体（由宏负责严格校验24字节与纯解包）
#[derive(FPPacketParser, Debug, Clone, Serialize)]
#[frame(id = 0x94, payload_size = 24)]
pub struct FP95Frame94Sub1Raw {
    pub address_type: u8,   // 地址类型
    pub s_address: [u8; 3], // S模式地址
    #[scale(raw_type = "u24", factor = "2.14577 * 1e-5")]
    pub ads_lon: f64, // 经度
    #[scale(raw_type = "u24", factor = "2.14577 * 1e-5")]
    pub ads_lat: f64, // 纬度
    pub ads_alt: u16,       // 高度原始2字节
    pub ads_speed: [u8; 3], // 水平速度+垂直速度原始3字节
    pub ads_yaw: u8,        // 航向角原始1字节
    pub flight_num: [u8; 8], // 航班号
}

/// 业务消费层结构体（包含所有衍生计算字段）
#[derive(Debug, Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FP95Frame94Sub1 {
    pub address_type: String,
    pub s_address: String,
    #[serde(skip)]
    pub raw_s_address: [u8; 3],
    pub ads_lon: f64,
    pub ads_lat: f64,
    pub ads_alt: f32,
    pub ads_vl: f32,
    pub ads_vu: f32,
    pub ads_yaw: f32,
    pub flight_num: [u8; 8],

    pub ads_alt2: u16,
    pub ads_speed: [u8; 3],
    pub ads_yaw2: u8,
}

impl FP95Frame94Sub1 {
    pub fn from_bytes(data: &[u8]) -> Result<Self, String> {
        let raw = FP95Frame94Sub1Raw::from_bytes(data)?;
        Ok(Self::from(raw))
    }
}

impl From<FP95Frame94Sub1Raw> for FP95Frame94Sub1 {
    fn from(raw: FP95Frame94Sub1Raw) -> Self {
        let factor = 2.14577 * 1e-5;

        // 经度处理：由于宏底层按小端序解包了网络大端序的3字节，此处逆推原始字节并按大端补码还原
        let lon_le = (raw.ads_lon / factor).round() as u32;
        let lon_bytes = lon_le.to_le_bytes(); // [b0, b1, b2, 0] 刚好是物理线路上收到的先后字节
        let lon_be = u32::from_be_bytes([0, lon_bytes[0], lon_bytes[1], lon_bytes[2]]);
        let lon_i32 = if (lon_be & 0x00800000) != 0 {
            (lon_be | 0xFF000000) as i32
        } else {
            lon_be as i32
        };
        let ads_lon = lon_i32 as f64 * factor;

        // 纬度处理：同理逆推并按大端补码还原
        let lat_le = (raw.ads_lat / factor).round() as u32;
        let lat_bytes = lat_le.to_le_bytes();
        let lat_be = u32::from_be_bytes([0, lat_bytes[0], lat_bytes[1], lat_bytes[2]]);
        let lat_i32 = if (lat_be & 0x00800000) != 0 {
            (lat_be | 0xFF000000) as i32
        } else {
            lat_be as i32
        };
        let ads_lat = lat_i32 as f64 * factor;

        // 高度处理：大端序2字节被宏按小端解包，执行 swap_bytes 还原为主机序
        let ads_alt2 = raw.ads_alt.swap_bytes() & 0x0FFF;
        let ads_alt = (ads_alt2 as f32 * 25.0 - 1000.0) * 0.3048;

        // 速度处理：大端字流排布，前12位为水平速度，后12位为带补码的垂直速度
        let spd_be = u32::from_be_bytes([0, raw.ads_speed[0], raw.ads_speed[1], raw.ads_speed[2]]);
        let vl_u12 = spd_be >> 12;
        let ads_vl = vl_u12 as f32 * 0.514444;

        let vu_u12 = spd_be & 0x0FFF;
        let vu_i32 = if (vu_u12 & 0x0800) != 0 {
            (vu_u12 as i32) | !0x0FFF
        } else {
            vu_u12 as i32
        };
        let ads_vu = vu_i32 as f32 * (64.0 / 60.0) * 0.3048;

        // 航向角处理
        let ads_yaw = raw.ads_yaw as f32 * 1.42;

        let address_type = if (raw.address_type & 1) == 0 {
            "ICAO地址".to_string()
        } else {
            "临时地址".to_string()
        };
        let s_address = format!(
            "{:02X}{:02X}{:02X}",
            raw.s_address[0], raw.s_address[1], raw.s_address[2]
        );

        Self {
            address_type,
            s_address,
            raw_s_address: raw.s_address,
            ads_lon,
            ads_lat,
            ads_alt,
            ads_vl,
            ads_vu,
            ads_yaw,
            flight_num: raw.flight_num,
            ads_alt2,
            ads_speed: raw.ads_speed,
            ads_yaw2: raw.ads_yaw,
        }
    }
}

// ================= 解析入口 =================
#[derive(FPSubFrame, Debug, Clone, Serialize)]
pub enum ParsedSubFrame {
    #[id(0x94)]
    Frame94Sub1(FP95Frame94Sub1),
}
