//! 0xC3 继电器控制器协议（Modbus RTU 变种）
//!
//! 支持 16 路继电器状态读取与控制：
//! - 读线圈（功能码 0x01）：读取当前 16 路继电器闭合/断开状态
//! - 写线圈（功能码 0x0F）：设置 16 路继电器闭合/断开状态

use serde::{Deserialize, Serialize};

pub const RELAY_DEVICE_ID: u8 = 0x01;
pub const FC_READ_COILS: u8 = 0x01;
pub const FC_WRITE_COILS: u8 = 0x0F;

/// Modbus CRC-16 (多项式 0xA001, 初始值 0xFFFF)
///
/// 注意文档报文序列（如 01 01 00 00 00 10 C6 3D），高字节在前（Big-Endian）
pub fn calculate_modbus_crc16(data: &[u8]) -> (u8, u8) {
    let mut crc: u16 = 0xFFFF;
    for &byte in data {
        crc ^= byte as u16;
        for _ in 0..8 {
            if (crc & 0x0001) != 0 {
                crc = (crc >> 1) ^ 0xA001;
            } else {
                crc >>= 1;
            }
        }
    }
    // 返回 (高字节, 低字节)
    let high = ((crc >> 8) & 0xFF) as u8;
    let low = (crc & 0xFF) as u8;
    (high, low)
}

/// 继电器当前状态模型（16 路开关）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayStatus {
    /// 16 位掩码，Bit0 对应 1 号继电器，Bit15 对应 16 号继电器（1 为闭合，0 为断开）
    pub mask: u16,
    /// 16 路各个开关布尔值数组（索引 0 对应继电器 1）
    pub channels: [bool; 16],
}

impl RelayStatus {
    pub fn from_u16(mask: u16) -> Self {
        let mut channels = [false; 16];
        for i in 0..16 {
            channels[i] = ((mask >> i) & 1) == 1;
        }
        Self { mask, channels }
    }

    pub fn to_u16(&self) -> u16 {
        self.mask
    }
}

/// 构建读线圈上行请求报文（读取 16 路继电器）
/// 示例：01 01 00 00 00 10 C6 3D
pub fn build_read_coils_cmd() -> [u8; 8] {
    let mut cmd = [0u8; 8];
    cmd[0] = RELAY_DEVICE_ID;
    cmd[1] = FC_READ_COILS;
    cmd[2] = 0x00; // 起始地址高
    cmd[3] = 0x00; // 起始地址低
    cmd[4] = 0x00; // 数量高
    cmd[5] = 0x10; // 数量低 (16)
    let (crch, crcl) = calculate_modbus_crc16(&cmd[0..6]);
    cmd[6] = crch;
    cmd[7] = crcl;
    cmd
}

/// 构建写线圈上行控制报文（设置 16 路继电器）
/// 示例：01 0F 00 00 00 10 02 0F F0 94 E7
/// 注意：协议文档中：
/// 第 8 字节为 B15~B8 (高字节)，第 9 字节为 B7~B0 (低字节)
pub fn build_write_coils_cmd(mask: u16) -> [u8; 11] {
    let mut cmd = [0u8; 11];
    cmd[0] = RELAY_DEVICE_ID;
    cmd[1] = FC_WRITE_COILS;
    cmd[2] = 0x00; // 起始地址高
    cmd[3] = 0x00; // 起始地址低
    cmd[4] = 0x00; // 数量高
    cmd[5] = 0x10; // 数量低 (16)
    cmd[6] = 0x02; // 字节数 (2)
    // 根据文档：字节8是B15~B8，字节9是B7~B0
    cmd[7] = ((mask >> 8) & 0xFF) as u8;
    cmd[8] = (mask & 0xFF) as u8;
    let (crch, crcl) = calculate_modbus_crc16(&cmd[0..9]);
    cmd[9] = crch;
    cmd[10] = crcl;
    cmd
}

/// 解析继电器控制器下行响应报文
/// 读线圈反馈格式：01 01 02 F0 0F F8 BD (7 字节)
/// 写线圈反馈格式：01 0F 00 00 00 10 07 54 (8 字节)
pub fn parse_relay_response(data: &[u8]) -> Result<Option<RelayStatus>, String> {
    if data.len() < 7 {
        return Err(format!("继电器报文长度过短: {}", data.len()));
    }
    if data[0] != RELAY_DEVICE_ID {
        return Err(format!("非继电器设备ID: 0x{:02X}", data[0]));
    }

    match data[1] {
        FC_READ_COILS => {
            if data.len() < 7 {
                return Err("读线圈响应长度不足 7 字节".to_string());
            }
            let byte_count = data[2];
            if byte_count != 2 {
                return Err(format!("读线圈返回字节数异常: {}", byte_count));
            }
            let (crch, crcl) = calculate_modbus_crc16(&data[0..5]);
            if data[5] != crch || data[6] != crcl {
                return Err(format!(
                    "读线圈 CRC 校验失败: 收到 {:02X}{:02X}, 计算得到 {:02X}{:02X}",
                    data[5], data[6], crch, crcl
                ));
            }
            // 字节3是B15~B8，字节4是B7~B0
            let high = data[3] as u16;
            let low = data[4] as u16;
            let mask = (high << 8) | low;
            Ok(Some(RelayStatus::from_u16(mask)))
        }
        FC_WRITE_COILS => {
            if data.len() < 8 {
                return Err("写线圈响应长度不足 8 字节".to_string());
            }
            let (crch, crcl) = calculate_modbus_crc16(&data[0..6]);
            if data[6] != crch || data[7] != crcl {
                return Err(format!(
                    "写线圈 CRC 校验失败: 收到 {:02X}{:02X}, 计算得到 {:02X}{:02X}",
                    data[6], data[7], crch, crcl
                ));
            }
            // 写线圈确认帧，无需更新状态
            Ok(None)
        }
        other => Err(format!("未知继电器功能码: 0x{:02X}", other)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_read_coils_cmd() {
        let cmd = build_read_coils_cmd();
        // 验证与文档示例一致：01 01 00 00 00 10 C6 3D
        assert_eq!(cmd, [0x01, 0x01, 0x00, 0x00, 0x00, 0x10, 0xC6, 0x3D]);
    }

    #[test]
    fn test_parse_read_coils_response() {
        // 文档示例：01 01 02 F0 0F F8 BD
        // 注释：线圈反馈 1 2 3 4 13 14 15 16 闭合
        let resp = [0x01, 0x01, 0x02, 0xF0, 0x0F, 0xF8, 0xBD];
        let res = parse_relay_response(&resp).expect("应该解析成功");
        assert!(res.is_some());
        let status = res.unwrap();
        assert_eq!(status.mask, 0xF00F);
        // 验证 1, 2, 3, 4 闭合 (索引 0, 1, 2, 3)
        assert!(status.channels[0]);
        assert!(status.channels[1]);
        assert!(status.channels[2]);
        assert!(status.channels[3]);
        assert!(!status.channels[4]);
        // 验证 13, 14, 15, 16 闭合 (索引 12, 13, 14, 15)
        assert!(status.channels[12]);
        assert!(status.channels[13]);
        assert!(status.channels[14]);
        assert!(status.channels[15]);
    }

    #[test]
    fn test_write_coils_cmd() {
        // 5 6 7 8 9 10 11 12 闭合 -> 高字节 0x0F, 低字节 0xF0
        // 文档示例：01 0F 00 00 00 10 02 0F F0 94 E7
        let mask = 0x0FF0;
        let cmd = build_write_coils_cmd(mask);
        assert_eq!(
            cmd,
            [0x01, 0x0F, 0x00, 0x00, 0x00, 0x10, 0x02, 0x0F, 0xF0, 0x94, 0xE7]
        );
    }

    #[test]
    fn test_parse_write_coils_response() {
        // 设备反馈：01 0F 00 00 00 10 07 54
        let resp = [0x01, 0x0F, 0x00, 0x00, 0x00, 0x10, 0x07, 0x54];
        let res = parse_relay_response(&resp).expect("应该解析成功");
        assert!(res.is_none());
    }
}
