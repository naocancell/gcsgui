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
/// 遵循标准 Modbus RTU 传输规则及最新版协议 V1.0(2)：低字节在前，高字节在后（Little-Endian）
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
    // 返回 (低字节, 高字节)
    let low = (crc & 0xFF) as u8;
    let high = ((crc >> 8) & 0xFF) as u8;
    (low, high)
}

/// 继电器当前状态模型（16 路开关）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayStatus {
    /// 16 位掩码，按协议图示定义：
    /// - Bit8~Bit15: 对应线圈 1~8 (高字节 B8~B15)
    /// - Bit0~Bit7:  对应线圈 9~16 (低字节 B0~B7)
    pub mask: u16,
    /// 16 路各个开关布尔值数组（索引 0 对应线圈 1，索引 15 对应线圈 16）
    pub channels: [bool; 16],
}

impl RelayStatus {
    /// 计算线圈编号 (1~16) 在 16 位掩码中的 bit 偏移 (0~15)
    /// 协议规则：b0~b7 对应线圈 9~16，b8~b15 对应线圈 1~8
    pub fn coil_to_bit_pos(coil_index: u8) -> usize {
        if coil_index <= 8 {
            (coil_index - 1 + 8) as usize
        } else {
            (coil_index - 9) as usize
        }
    }

    /// 从 16 位掩码构建状态模型
    /// 规则：
    /// - b8~b15 映射到 channels[0..8] (线圈 1~8)
    /// - b0~b7  映射到 channels[8..16] (线圈 9~16)
    pub fn from_u16(mask: u16) -> Self {
        let mut channels = [false; 16];
        for i in 0..8 {
            channels[i] = ((mask >> (i + 8)) & 1) == 1;
        }
        for i in 0..8 {
            channels[i + 8] = ((mask >> i) & 1) == 1;
        }
        Self { mask, channels }
    }

    /// 从 16 路开关布尔数组构建状态模型
    pub fn from_channels(channels: [bool; 16]) -> Self {
        let mut mask = 0u16;
        for i in 0..8 {
            if channels[i] {
                mask |= 1 << (i + 8);
            }
        }
        for i in 0..8 {
            if channels[i + 8] {
                mask |= 1 << i;
            }
        }
        Self { mask, channels }
    }

    pub fn to_u16(&self) -> u16 {
        self.mask
    }
}

/// 构建读线圈上行请求报文（读取 16 路继电器）
/// 最新协议示例：01 01 00 00 00 10 3D C6
pub fn build_read_coils_cmd() -> [u8; 8] {
    let mut cmd = [0u8; 8];
    cmd[0] = RELAY_DEVICE_ID;
    cmd[1] = FC_READ_COILS;
    cmd[2] = 0x00; // 起始地址高
    cmd[3] = 0x00; // 起始地址低
    cmd[4] = 0x00; // 数量高
    cmd[5] = 0x10; // 数量低 (16)
    let (crcl, crch) = calculate_modbus_crc16(&cmd[0..6]);
    cmd[6] = crcl;
    cmd[7] = crch;
    cmd
}

/// 构建写线圈上行控制报文（设置 16 路继电器）
/// 最新协议示例：01 0F 00 00 00 10 02 0F F0 E7 94
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
    let (crcl, crch) = calculate_modbus_crc16(&cmd[0..9]);
    cmd[9] = crcl;
    cmd[10] = crch;
    cmd
}

/// 解析继电器控制器下行响应报文
/// 读线圈反馈格式：01 01 02 F0 0F BD F8 (7 字节，最新版协议)
/// 写线圈反馈格式：01 0F 00 00 00 10 54 07 (8 字节，最新版协议)
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
            let (crcl, crch) = calculate_modbus_crc16(&data[0..5]);
            let crc_ok = (data[5] == crcl && data[6] == crch) || (data[5] == crch && data[6] == crcl);
            if !crc_ok {
                return Err(format!(
                    "读线圈 CRC 校验失败: 收到 {:02X}{:02X}, 计算得到 低={:02X} 高={:02X}",
                    data[5], data[6], crcl, crch
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
            let (crcl, crch) = calculate_modbus_crc16(&data[0..6]);
            let crc_ok = (data[6] == crcl && data[7] == crch) || (data[6] == crch && data[7] == crcl);
            if !crc_ok {
                return Err(format!(
                    "写线圈 CRC 校验失败: 收到 {:02X}{:02X}, 计算得到 低={:02X} 高={:02X}",
                    data[6], data[7], crcl, crch
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
        // 验证与新版协议(2)示例一致：01 01 00 00 00 10 3D C6
        assert_eq!(cmd, [0x01, 0x01, 0x00, 0x00, 0x00, 0x10, 0x3D, 0xC6]);
    }

    #[test]
    fn test_coil_bit_mapping() {
        // 验证线圈与 bit 的映射关系：b8~b15 对应线圈 1~8，b0~b7 对应线圈 9~16
        assert_eq!(RelayStatus::coil_to_bit_pos(1), 8);
        assert_eq!(RelayStatus::coil_to_bit_pos(8), 15);
        assert_eq!(RelayStatus::coil_to_bit_pos(9), 0);
        assert_eq!(RelayStatus::coil_to_bit_pos(16), 7);

        // 构造仅线圈 1 闭合
        let mut ch1 = [false; 16];
        ch1[0] = true;
        let s1 = RelayStatus::from_channels(ch1);
        assert_eq!(s1.mask, 1 << 8);
        assert!(s1.channels[0]);
        assert_eq!(RelayStatus::from_u16(1 << 8), s1);

        // 构造仅线圈 9 闭合
        let mut ch9 = [false; 16];
        ch9[8] = true;
        let s9 = RelayStatus::from_channels(ch9);
        assert_eq!(s9.mask, 1 << 0);
        assert!(s9.channels[8]);
        assert_eq!(RelayStatus::from_u16(1 << 0), s9);
    }

    #[test]
    fn test_parse_read_coils_response() {
        // 新版协议(2)示例报文：01 01 02 F0 0F BD F8
        // 字节 3 (高字节) = 0xF0 (B15~B12 为 1 -> 线圈 5, 6, 7, 8 闭合)
        // 字节 4 (低字节) = 0x0F (B3~B0 为 1 -> 线圈 9, 10, 11, 12 闭合)
        let resp = [0x01, 0x01, 0x02, 0xF0, 0x0F, 0xBD, 0xF8];
        let res = parse_relay_response(&resp).expect("应该解析成功");
        assert!(res.is_some());
        let status = res.unwrap();
        assert_eq!(status.mask, 0xF00F);

        // 验证线圈 5, 6, 7, 8 闭合 (索引 4, 5, 6, 7)
        assert!(!status.channels[0]);
        assert!(!status.channels[1]);
        assert!(!status.channels[2]);
        assert!(!status.channels[3]);
        assert!(status.channels[4]);
        assert!(status.channels[5]);
        assert!(status.channels[6]);
        assert!(status.channels[7]);

        // 验证线圈 9, 10, 11, 12 闭合 (索引 8, 9, 10, 11)
        assert!(status.channels[8]);
        assert!(status.channels[9]);
        assert!(status.channels[10]);
        assert!(status.channels[11]);
        assert!(!status.channels[12]);
        assert!(!status.channels[13]);
        assert!(!status.channels[14]);
        assert!(!status.channels[15]);

        // 测试旧版协议兼容性（高字节在前 F8 BD 也应能正常解析）
        let old_resp = [0x01, 0x01, 0x02, 0xF0, 0x0F, 0xF8, 0xBD];
        assert!(parse_relay_response(&old_resp).is_ok());
    }

    #[test]
    fn test_write_coils_cmd() {
        // 文档示例报文：01 0F 00 00 00 10 02 0F F0 E7 94
        // 高字节为 0x0F, 低字节为 0xF0 -> mask = 0x0FF0
        let mask = 0x0FF0;
        let cmd = build_write_coils_cmd(mask);
        assert_eq!(
            cmd,
            [0x01, 0x0F, 0x00, 0x00, 0x00, 0x10, 0x02, 0x0F, 0xF0, 0xE7, 0x94]
        );
    }

    #[test]
    fn test_parse_write_coils_response() {
        // 新版协议(2)示例：01 0F 00 00 00 10 54 07
        let resp = [0x01, 0x0F, 0x00, 0x00, 0x00, 0x10, 0x54, 0x07];
        let res = parse_relay_response(&resp).expect("应该解析成功");
        assert!(res.is_none());

        // 测试旧版协议兼容性（高字节在前 07 54 也应能正常解析）
        let old_resp = [0x01, 0x0F, 0x00, 0x00, 0x00, 0x10, 0x07, 0x54];
        assert!(parse_relay_response(&old_resp).is_ok());
    }
}
