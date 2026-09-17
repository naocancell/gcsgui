use gcs_macros::{FPBitFlags, FPPacketParser};
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
#[derive(Debug, Default, Clone, Serialize, PartialEq)]
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

/// 防除冰状态信息1（表2 状态信息表1），对应字节7的Bit0~Bit6。
#[derive(FPBitFlags, Debug, Clone, Serialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FP95DeiceStatus1 {
    /// D0: 控制器输出电流超过设定值，持续超过1秒（1为异常，0为正常）
    pub over_current: bool,
    /// D1: 电压超出最大值，持续200ms（1为异常，0为正常）
    pub over_voltage: bool,
    /// D2: 电压低于最小值，持续200ms（1为异常，0为正常）
    pub under_voltage: bool,
    /// D3: 2s内未收到飞管计算机信号（1为异常，0为正常）
    pub comm_error: bool,
    /// D4: 控制盒温度超过正常范围（-40~85℃）（1为异常，0为正常）
    pub temp_error: bool,
    /// D5: 上位机发送的目标功率超过范围（1为超出，0为未超出）
    pub target_power_overflow: bool,
    /// D6: 20s内未达到目标功率（1为异常，0为正常）
    pub target_power_timeout: bool,
}

/// 94帧子帧2（防除冰控制器透传数据）传输层原始结构，长度固定为24字节。
///
/// 前14字节为防除冰控制器完整报文，后10字节为预留备用。
#[derive(FPPacketParser, Debug, Clone, Serialize)]
#[frame(id = 0x94, payload_size = 24)]
pub struct FP95Frame94Sub2Raw {
    pub sync_code: [u8; 2],
    pub target_power: u16,
    pub current_power: u16,
    pub work_mode: u8,
    #[bitflags(raw_type = "u8")]
    pub status1: FP95DeiceStatus1,
    pub status2: u8,
    #[scale(raw_type = "u8", factor = "1.0", offset = "-45.0")]
    pub controller_temp: f32,
    #[scale(raw_type = "u8", factor = "0.2")]
    pub voltage: f32,
    #[scale(raw_type = "u8", factor = "0.2")]
    pub current: f32,
    pub frame_count: u8,
    pub checksum: u8,
    pub reserved: [u8; 10],
}

/// 94帧子帧2业务消费结构，包含工程量转换、模式语义说明与零和校验验证。
#[derive(Debug, Default, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FP95Frame94Sub2 {
    pub sync_code: [u8; 2],
    pub sync_valid: bool,
    pub target_power: u16,
    pub current_power: u16,
    pub work_mode: u8,
    pub work_mode_desc: String,
    pub status1: FP95DeiceStatus1,
    pub raw_status1: u8,
    pub status2: u8,
    pub controller_temp: f32,
    pub voltage: f32,
    pub current: f32,
    pub frame_count: u8,
    pub checksum: u8,
    pub checksum_valid: bool,
    pub raw_bytes: [u8; 14],
    pub reserved: [u8; 10],
}

impl FP95Frame94Sub2 {
    pub fn from_bytes(data: &[u8]) -> Result<Self, String> {
        if data.len() < 24 {
            return Err(format!("94帧子帧2长度不足: 期望24字节，实际{}字节", data.len()));
        }
        let raw = FP95Frame94Sub2Raw::from_bytes(data)?;
        let raw_bytes: [u8; 14] = data[..14]
            .try_into()
            .map_err(|_| "提取防除冰14字节失败".to_string())?;

        // 协议规定：“同步码”+“帧内容”+“校验码” = 0 MOD 256
        let sum: u32 = raw_bytes.iter().map(|&b| b as u32).sum();
        let checksum_valid = (sum % 256) == 0;
        let sync_valid = raw.sync_code == [0xEB, 0x90];

        let work_mode_desc = match raw.work_mode {
            0x00 => "关闭模式".to_string(),
            0x01 => "指令调节模式".to_string(),
            0x02 => "恒功率模式".to_string(),
            0x03 => "恒温模式".to_string(),
            other => format!("未知模式(0x{:02X})", other),
        };

        let raw_status1 = data[7];

        Ok(Self {
            sync_code: raw.sync_code,
            sync_valid,
            target_power: raw.target_power,
            current_power: raw.current_power,
            work_mode: raw.work_mode,
            work_mode_desc,
            status1: raw.status1,
            raw_status1,
            status2: raw.status2,
            controller_temp: raw.controller_temp,
            voltage: raw.voltage,
            current: raw.current,
            frame_count: raw.frame_count,
            checksum: raw.checksum,
            checksum_valid,
            raw_bytes,
            reserved: raw.reserved,
        })
    }
}

#[derive(Debug, Clone, Serialize)]
pub enum FP95Frame94 {
    Sub1(FP95Frame94Sub1),
    Sub2(FP95Frame94Sub2),
}

impl FP95Frame94 {
    pub fn from_bytes(data: &[u8]) -> Result<Self, String> {
        let (&subframe_id, payload) = data
            .split_first()
            .ok_or_else(|| "94帧缺少子帧编号".to_string())?;

        match subframe_id {
            1 => Ok(Self::Sub1(FP95Frame94Sub1::from_bytes(payload)?)),
            2 => Ok(Self::Sub2(FP95Frame94Sub2::from_bytes(payload)?)),
            other => Err(format!("未知94子帧编号: {}", other)),
        }
    }
}

/// 94帧多子帧状态聚合结构，支持各个子帧（ADS-B、防除冰等）长期并存、独立刷新。
#[derive(Debug, Default, Clone, Serialize, PartialEq)]
pub struct FP95Frame94Aggregate {
    #[serde(rename = "Sub1", skip_serializing_if = "Option::is_none")]
    pub sub1: Option<FP95Frame94Sub1>,
    #[serde(rename = "Sub2", skip_serializing_if = "Option::is_none")]
    pub sub2: Option<FP95Frame94Sub2>,
    // 预留未来扩展：
    // #[serde(rename = "Sub3", skip_serializing_if = "Option::is_none")]
    // pub sub3: Option<FP95Frame94Sub3>,
    // #[serde(rename = "Sub4", skip_serializing_if = "Option::is_none")]
    // pub sub4: Option<FP95Frame94Sub4>,
}

impl FP95Frame94Aggregate {
    pub fn merge(&mut self, sub: FP95Frame94) {
        match sub {
            FP95Frame94::Sub1(s1) => self.sub1 = Some(s1),
            FP95Frame94::Sub2(s2) => self.sub2 = Some(s2),
        }
    }
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fp95_frame94_sub2_parsing() {
        // 构造14字节防除冰报文：
        // 0..2: 0xEB, 0x90 (同步码)
        // 2..4: 目标功率 2000W -> 0x07D0 (小端: 0xD0, 0x07)
        // 4..6: 当前功率 1950W -> 0x079E (小端: 0x9E, 0x07)
        // 6: 工作模式 0x02 (恒功率模式)
        // 7: 状态信息1: D0(过流)=1, D4(温度异常)=1 -> 0x01 | 0x10 = 0x11
        // 8: 状态信息2: 0x00
        // 9: 控制盒温度: 50 -> 50 - 45 = 5℃
        // 10: 电压: 140 -> 140 * 0.2 = 28.0V
        // 11: 电流: 24 -> 24 * 0.2 = 4.8A
        // 12: 帧计数: 42
        // 13: 校验和: 计算使得前14字节和对256取模为0
        let mut deice_14 = [
            0xEB, 0x90,
            0xD0, 0x07,
            0x9E, 0x07,
            0x02,
            0x11,
            0x00,
            50,
            140,
            24,
            42,
            0x00, // 暂填0
        ];
        let sum_13: u32 = deice_14[..13].iter().map(|&b| b as u32).sum();
        let checksum = ((256 - (sum_13 % 256)) % 256) as u8;
        deice_14[13] = checksum;

        // 验证累加和模256为0
        let total_sum: u32 = deice_14.iter().map(|&b| b as u32).sum();
        assert_eq!(total_sum % 256, 0);

        // 组装24字节有效载荷（前14字节防除冰，后10字节预留0）
        let mut payload_24 = [0u8; 24];
        payload_24[..14].copy_from_slice(&deice_14);

        let sub2 = FP95Frame94Sub2::from_bytes(&payload_24).expect("解析子帧2应当成功");
        assert!(sub2.sync_valid);
        assert!(sub2.checksum_valid);
        assert_eq!(sub2.target_power, 2000);
        assert_eq!(sub2.current_power, 1950);
        assert_eq!(sub2.work_mode, 0x02);
        assert_eq!(sub2.work_mode_desc, "恒功率模式");
        assert!(sub2.status1.over_current);
        assert!(!sub2.status1.over_voltage);
        assert!(!sub2.status1.under_voltage);
        assert!(!sub2.status1.comm_error);
        assert!(sub2.status1.temp_error);
        assert!(!sub2.status1.target_power_overflow);
        assert!(!sub2.status1.target_power_timeout);
        assert_eq!(sub2.raw_status1, 0x11);
        assert_eq!(sub2.status2, 0x00);
        assert!((sub2.controller_temp - 5.0).abs() < 1e-4);
        assert!((sub2.voltage - 28.0).abs() < 1e-4);
        assert!((sub2.current - 4.8).abs() < 1e-4);
        assert_eq!(sub2.frame_count, 42);
        assert_eq!(sub2.raw_bytes, deice_14);

        // 测试包含子帧编号的整包路由 (1字节子帧号 + 24字节payload = 25字节)
        let mut frame_data = [0u8; 25];
        frame_data[0] = 2; // 子帧编号 2
        frame_data[1..].copy_from_slice(&payload_24);

        let parsed = FP95Frame94::from_bytes(&frame_data).expect("FP95Frame94应当成功路由到子帧2");
        match parsed {
            FP95Frame94::Sub2(res) => {
                assert_eq!(res.target_power, 2000);
                assert_eq!(res.current_power, 1950);
            }
            _ => panic!("应当解析为Sub2变体"),
        }
    }

    #[test]
    fn test_fp95_frame94_aggregate_concurrent() {
        let mut agg = FP95Frame94Aggregate::default();
        assert!(agg.sub1.is_none());
        assert!(agg.sub2.is_none());

        // 1. 合并 Sub1
        let sub1 = FP95Frame94Sub1 {
            s_address: "112233".to_string(),
            ads_alt: 1200.0,
            ..Default::default()
        };
        agg.merge(FP95Frame94::Sub1(sub1.clone()));
        assert!(agg.sub1.is_some());
        assert!(agg.sub2.is_none());
        assert_eq!(agg.sub1.as_ref().unwrap().s_address, "112233");

        // 2. 合并 Sub2（防除冰）
        let sub2 = FP95Frame94Sub2 {
            target_power: 3500,
            work_mode_desc: "恒功率模式".to_string(),
            ..Default::default()
        };
        agg.merge(FP95Frame94::Sub2(sub2.clone()));

        // 验证两者并存
        assert!(agg.sub1.is_some(), "合并Sub2后Sub1不应被覆盖丢失");
        assert!(agg.sub2.is_some(), "Sub2应成功写入");
        assert_eq!(agg.sub1.as_ref().unwrap().s_address, "112233");
        assert_eq!(agg.sub2.as_ref().unwrap().target_power, 3500);

        // 3. 验证序列化格式包含大写 Sub1 与 Sub2 字段（与前端兼容）
        let json = serde_json::to_string(&agg).expect("序列化应当成功");
        assert!(json.contains("\"Sub1\""));
        assert!(json.contains("\"Sub2\""));

        // 4. 再次合并更新后的 Sub1，验证 Sub2 不受影响
        let mut updated_sub1 = sub1;
        updated_sub1.ads_alt = 1500.0;
        agg.merge(FP95Frame94::Sub1(updated_sub1));
        assert_eq!(agg.sub1.as_ref().unwrap().ads_alt, 1500.0);
        assert_eq!(agg.sub2.as_ref().unwrap().target_power, 3500, "再次更新Sub1时Sub2不应受影响");
    }
}


