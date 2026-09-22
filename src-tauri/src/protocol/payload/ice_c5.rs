//! 0xC5 结冰传感器协议解析
//!
//! 报文结构（8 字节定长）：
//! - 序号 1: 0xEB (帧头1)
//! - 序号 2: 0x90 (帧头2)
//! - 序号 3: 0x08 (返回数据个数)
//! - 序号 4: 循环计数器 (0~255)
//! - 序号 5: 结冰状态及探测器周期 BIT
//!   - Bit0: 探测器状态 (1 故障, 0 正常)
//!   - Bit1~3: 结冰状态 (0: 未结冰, 1: 结冰告警且解算中, 2: 弱结冰, 3: 中度结冰, 4: 强结冰, 5: 极强结冰)
//!   - Bit4: 加热状态 (1 加热, 0 不加热)
//!   - Bit5~7: 备用
//! - 序号 6: 备用
//! - 序号 7: 软件版本号 Vx.y (x = D7~D5, y = D4~D0)
//! - 序号 8: 校验和 (前面所有字节，帧头除外，即字节 3~7 累加和低 8 位)

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum IcingSeverity {
    #[default]
    NoIce = 0, // 未结冰
    AlertCalculating = 1, // 结冰告警且解算结冰速率中
    Light = 2,            // 弱结冰
    Moderate = 3,         // 中度结冰
    Severe = 4,           // 强结冰
    Extreme = 5,          // 极强结冰
    Unknown = 6,
}

impl From<u8> for IcingSeverity {
    fn from(val: u8) -> Self {
        match val {
            0 => Self::NoIce,
            1 => Self::AlertCalculating,
            2 => Self::Light,
            3 => Self::Moderate,
            4 => Self::Severe,
            5 => Self::Extreme,
            _ => Self::Unknown,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IcingSensorData {
    pub counter: u8,
    pub detector_fault: bool,
    pub icing_severity: IcingSeverity,
    pub heating_active: bool,
    pub version_major: u8,
    pub version_minor: u8,
}

pub fn parse_icing_frame(data: &[u8]) -> Result<IcingSensorData, String> {
    if data.len() < 8 {
        return Err(format!("结冰传感器数据长度不足 8 字节: {}", data.len()));
    }
    if data[0] != 0xEB || data[1] != 0x90 {
        return Err(format!("结冰传感器帧头错误: {:02X} {:02X}", data[0], data[1]));
    }
    let data_len = data[2];
    if data_len != 0x08 {
        return Err(format!("结冰传感器数据个数异常: {}", data_len));
    }

    // 校验和：前面所有字节（帧头除外）累加和取低8位，即 data[2..7]
    let sum: u32 = data[2..7].iter().map(|&b| b as u32).sum();
    let expected_checksum = (sum & 0xFF) as u8;
    if data[7] != expected_checksum {
        return Err(format!(
            "结冰传感器校验和失败: 收到 0x{:02X}, 计算得到 0x{:02X}",
            data[7], expected_checksum
        ));
    }

    let counter = data[3];
    let status_byte = data[4];
    let detector_fault = (status_byte & 0x01) != 0;
    let icing_severity = IcingSeverity::from((status_byte >> 1) & 0x07);
    let heating_active = ((status_byte >> 4) & 0x01) != 0;

    let ver_byte = data[6];
    let version_major = (ver_byte >> 5) & 0x07;
    let version_minor = ver_byte & 0x1F;

    Ok(IcingSensorData {
        counter,
        detector_fault,
        icing_severity,
        heating_active,
        version_major,
        version_minor,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_icing_frame() {
        // 构建一帧：
        // 0xEB, 0x90, 0x08
        // counter = 10
        // status = 故障(1) | 中度结冰(3 << 1 = 6) | 加热(1 << 4 = 16) = 23 (0x17)
        // reserve = 0
        // ver = V1.2 -> major 1 (1 << 5 = 32), minor 2 -> 34 (0x22)
        // checksum = (0x08 + 10 + 0x17 + 0 + 0x22) & 0xFF = 8 + 10 + 23 + 0 + 34 = 75 (0x4B)
        let frame = [0xEB, 0x90, 0x08, 10, 0x17, 0x00, 0x22, 0x4B];
        let parsed = parse_icing_frame(&frame).expect("应该解析成功");
        assert_eq!(parsed.counter, 10);
        assert!(parsed.detector_fault);
        assert_eq!(parsed.icing_severity, IcingSeverity::Moderate);
        assert!(parsed.heating_active);
        assert_eq!(parsed.version_major, 1);
        assert_eq!(parsed.version_minor, 2);
    }
}
