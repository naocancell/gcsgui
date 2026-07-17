use gcs_macros::FPPacketParser;
use serde::Serialize;

/// 94帧子帧1传输层原始结构。
#[derive(FPPacketParser, Debug, Clone, Serialize)]
#[frame(id = 0x94, payload_size = 24)]
pub struct FP95Frame94Sub1Raw {
    pub address_type: u8,
    pub s_address: [u8; 3],
    #[scale(raw_type = "u24", factor = "2.14577 * 1e-5")]
    pub ads_lon: f64,
    #[scale(raw_type = "u24", factor = "2.14577 * 1e-5")]
    pub ads_lat: f64,
    pub ads_alt: u16,
    pub ads_speed: [u8; 3],
    pub ads_yaw: u8,
    pub flight_num: [u8; 8],
}

/// 94帧子帧1业务消费结构，保持现有前端序列化字段兼容。
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

        let lon_le = (raw.ads_lon / factor).round() as u32;
        let lon_bytes = lon_le.to_le_bytes();
        let lon_be = u32::from_be_bytes([0, lon_bytes[0], lon_bytes[1], lon_bytes[2]]);
        let lon_i32 = if (lon_be & 0x00800000) != 0 {
            (lon_be | 0xFF000000) as i32
        } else {
            lon_be as i32
        };
        let ads_lon = lon_i32 as f64 * factor;

        let lat_le = (raw.ads_lat / factor).round() as u32;
        let lat_bytes = lat_le.to_le_bytes();
        let lat_be = u32::from_be_bytes([0, lat_bytes[0], lat_bytes[1], lat_bytes[2]]);
        let lat_i32 = if (lat_be & 0x00800000) != 0 {
            (lat_be | 0xFF000000) as i32
        } else {
            lat_be as i32
        };
        let ads_lat = lat_i32 as f64 * factor;

        let ads_alt2 = raw.ads_alt.swap_bytes() & 0x0FFF;
        let ads_alt = (ads_alt2 as f32 * 25.0 - 1000.0) * 0.3048;

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

#[derive(Debug, Clone, Serialize)]
pub enum FP95Frame94 {
    Sub1(FP95Frame94Sub1),
}

impl FP95Frame94 {
    pub fn from_bytes(data: &[u8]) -> Result<Self, String> {
        let (&subframe_id, payload) = data
            .split_first()
            .ok_or_else(|| "94帧缺少子帧编号".to_string())?;

        match subframe_id {
            1 => Ok(Self::Sub1(FP95Frame94Sub1::from_bytes(payload)?)),
            other => Err(format!("未知94子帧编号: {}", other)),
        }
    }
}
