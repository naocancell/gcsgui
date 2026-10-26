//! 0xC3 继电器控制器协议（Modbus RTU）
//!
//! 依据《FP-95防除冰航电系统通信协议》1.2.6（设备 ID 0x00 暂定，波特率 115200）：
//! - 读线圈（功能码 0x01）：`00 01 00 00 00 0F CRC`，读取 15 路（第 16 路为空）；
//!   反馈 `00 01 02 <线圈1~8> <线圈9~16> CRC`，每字节 bit0 对应该组第一路
//! - 写单个线圈（功能码 0x05）：`00 05 00 <00~0F> <FF/00> 00 CRC`，
//!   地址 0x00~0x0F 对应继电器 1~16，0xFF00 打开、0x0000 关闭；设备反馈与指令一致
//! - CRC16/Modbus，低字节在前

use serde::{Deserialize, Serialize};

/// 继电器控制器设备 ID（协议暂定 0x00）
pub const RELAY_DEVICE_ID: u8 = 0x00;
pub const FC_READ_COILS: u8 = 0x01;
pub const FC_WRITE_SINGLE_COIL: u8 = 0x05;
/// 继电器总路数（第 16 路为空）
pub const RELAY_CHANNEL_COUNT: u8 = 16;
/// 读线圈数量（协议 0x000F：第 1~15 路），也是批量操作覆盖的路数
pub const RELAY_READ_COIL_COUNT: u8 = 15;
/// 读线圈反馈长度：ID + 功能码 + 字节数 + 2 字节状态 + CRC
pub const RELAY_READ_RESPONSE_LEN: usize = 7;
/// 写单个线圈指令/反馈长度
pub const RELAY_WRITE_FRAME_LEN: usize = 8;

const COIL_ON: u16 = 0xFF00;
const COIL_OFF: u16 = 0x0000;

/// Modbus CRC-16 (多项式 0xA001, 初始值 0xFFFF)
///
/// 返回 (低字节, 高字节)，Modbus RTU 传输时低字节在前
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
    let low = (crc & 0xFF) as u8;
    let high = ((crc >> 8) & 0xFF) as u8;
    (low, high)
}

/// 校验末尾 2 字节 CRC（兼容低字节在前 / 高字节在前）
fn crc_matches(frame: &[u8]) -> bool {
    let n = frame.len();
    let (l, h) = calculate_modbus_crc16(&frame[..n - 2]);
    (frame[n - 2] == l && frame[n - 1] == h) || (frame[n - 2] == h && frame[n - 1] == l)
}

/// 继电器当前状态模型（16 路开关）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayStatus {
    /// 16 位掩码，按读线圈反馈的两个状态字节拼接（高字节在前）：
    /// - Bit8~Bit15: 线圈 1~8（反馈第 1 个状态字节，bit8 = 线圈 1）
    /// - Bit0~Bit7:  线圈 9~16（反馈第 2 个状态字节，bit0 = 线圈 9）
    pub mask: u16,
    /// 16 路各个开关布尔值数组（索引 0 对应线圈 1，索引 15 对应线圈 16）
    pub channels: [bool; 16],
}

impl RelayStatus {
    /// 计算线圈编号 (1~16) 在 16 位掩码中的 bit 偏移 (0~15)
    /// 规则：b8~b15 对应线圈 1~8，b0~b7 对应线圈 9~16
    pub fn coil_to_bit_pos(coil_index: u8) -> usize {
        if coil_index <= 8 {
            (coil_index - 1 + 8) as usize
        } else {
            (coil_index - 9) as usize
        }
    }

    /// 从 16 位掩码构建状态模型
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

    /// 掩码中线圈 (1~16) 是否闭合
    pub fn mask_has_coil(mask: u16, coil_index: u8) -> bool {
        (1..=RELAY_CHANNEL_COUNT).contains(&coil_index)
            && (mask >> Self::coil_to_bit_pos(coil_index)) & 1 == 1
    }

    /// 更新单路状态（写单个线圈反馈确认后使用），编号越界时忽略
    pub fn set_coil(&mut self, coil_index: u8, on: bool) {
        if !(1..=RELAY_CHANNEL_COUNT).contains(&coil_index) {
            return;
        }
        let bit = 1u16 << Self::coil_to_bit_pos(coil_index);
        if on {
            self.mask |= bit;
        } else {
            self.mask &= !bit;
        }
        self.channels[(coil_index - 1) as usize] = on;
    }
}

/// 继电器控制器下行反馈
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RelayResponse {
    /// 读线圈反馈：全部回路状态
    Status(RelayStatus),
    /// 写单个线圈反馈（与指令一致）：该路已按指令打开/关闭
    CoilWritten { coil_index: u8, on: bool },
}

/// 构建读线圈指令：`00 01 00 00 00 0F 7D DF`
pub fn build_read_coils_cmd() -> [u8; 8] {
    let mut cmd = [
        RELAY_DEVICE_ID,
        FC_READ_COILS,
        0x00, // 起始地址高
        0x00, // 起始地址低
        0x00, // 数量高
        RELAY_READ_COIL_COUNT,
        0,
        0,
    ];
    let (crcl, crch) = calculate_modbus_crc16(&cmd[..6]);
    cmd[6] = crcl;
    cmd[7] = crch;
    cmd
}

/// 构建写单个线圈指令（继电器编号 1~16）
///
/// 示例：第 6 路打开 `00 05 00 05 FF 00 9D EA`
pub fn build_write_single_coil_cmd(coil_index: u8, on: bool) -> Result<[u8; 8], String> {
    if !(1..=RELAY_CHANNEL_COUNT).contains(&coil_index) {
        return Err(format!("继电器编号超出范围 (1~16): {coil_index}"));
    }
    let value = (if on { COIL_ON } else { COIL_OFF }).to_be_bytes();
    let mut cmd = [
        RELAY_DEVICE_ID,
        FC_WRITE_SINGLE_COIL,
        0x00,           // 起始地址高
        coil_index - 1, // 起始地址低：0x00~0x0F 对应继电器 1~16
        value[0],
        value[1],
        0,
        0,
    ];
    let (crcl, crch) = calculate_modbus_crc16(&cmd[..6]);
    cmd[6] = crcl;
    cmd[7] = crch;
    Ok(cmd)
}

/// 解析继电器控制器下行反馈（读线圈 7 字节 / 写单个线圈 8 字节）
pub fn parse_relay_response(data: &[u8]) -> Result<RelayResponse, String> {
    if data.len() < RELAY_READ_RESPONSE_LEN {
        return Err(format!("继电器报文长度过短: {}", data.len()));
    }
    if data[0] != RELAY_DEVICE_ID {
        return Err(format!("非继电器设备ID: 0x{:02X}", data[0]));
    }

    match data[1] {
        FC_READ_COILS => {
            let frame = &data[..RELAY_READ_RESPONSE_LEN];
            if frame[2] != 2 {
                return Err(format!("读线圈返回字节数异常: {}", frame[2]));
            }
            if !crc_matches(frame) {
                return Err("读线圈 CRC 校验失败".to_string());
            }
            // 第 1 个状态字节 = 线圈 1~8，第 2 个 = 线圈 9~16
            let mask = u16::from_be_bytes([frame[3], frame[4]]);
            Ok(RelayResponse::Status(RelayStatus::from_u16(mask)))
        }
        FC_WRITE_SINGLE_COIL => {
            if data.len() < RELAY_WRITE_FRAME_LEN {
                return Err("写线圈反馈长度不足 8 字节".to_string());
            }
            let frame = &data[..RELAY_WRITE_FRAME_LEN];
            if !crc_matches(frame) {
                return Err("写线圈 CRC 校验失败".to_string());
            }
            let address = u16::from_be_bytes([frame[2], frame[3]]);
            if address >= RELAY_CHANNEL_COUNT as u16 {
                return Err(format!("写线圈地址超出范围: 0x{address:04X}"));
            }
            let on = match u16::from_be_bytes([frame[4], frame[5]]) {
                COIL_ON => true,
                COIL_OFF => false,
                other => return Err(format!("写线圈状态值异常: 0x{other:04X}")),
            };
            Ok(RelayResponse::CoilWritten {
                coil_index: address as u8 + 1,
                on,
            })
        }
        other => Err(format!("未知继电器功能码: 0x{:02X}", other)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_read_coils_cmd() {
        // 协议示例：00 01 00 00 00 0F 7D DF
        assert_eq!(
            build_read_coils_cmd(),
            [0x00, 0x01, 0x00, 0x00, 0x00, 0x0F, 0x7D, 0xDF]
        );
    }

    #[test]
    fn test_write_single_coil_cmd() {
        // 协议示例：第 6 个继电器打开 00 05 00 05 FF 00 9D EA
        assert_eq!(
            build_write_single_coil_cmd(6, true).unwrap(),
            [0x00, 0x05, 0x00, 0x05, 0xFF, 0x00, 0x9D, 0xEA]
        );
        let off = build_write_single_coil_cmd(16, false).unwrap();
        assert_eq!(&off[..6], &[0x00, 0x05, 0x00, 0x0F, 0x00, 0x00]);
        assert!(crc_matches(&off));
        assert!(build_write_single_coil_cmd(0, true).is_err());
        assert!(build_write_single_coil_cmd(17, true).is_err());
    }

    #[test]
    fn test_coil_bit_mapping() {
        // b8~b15 对应线圈 1~8，b0~b7 对应线圈 9~16
        assert_eq!(RelayStatus::coil_to_bit_pos(1), 8);
        assert_eq!(RelayStatus::coil_to_bit_pos(8), 15);
        assert_eq!(RelayStatus::coil_to_bit_pos(9), 0);
        assert_eq!(RelayStatus::coil_to_bit_pos(16), 7);

        let mut ch1 = [false; 16];
        ch1[0] = true;
        let s1 = RelayStatus::from_channels(ch1);
        assert_eq!(s1.mask, 1 << 8);
        assert_eq!(RelayStatus::from_u16(1 << 8), s1);

        let mut ch9 = [false; 16];
        ch9[8] = true;
        let s9 = RelayStatus::from_channels(ch9);
        assert_eq!(s9.mask, 1 << 0);
        assert_eq!(RelayStatus::from_u16(1 << 0), s9);

        assert!(RelayStatus::mask_has_coil(0xFFFF, 15));
        assert!(!RelayStatus::mask_has_coil(0x0000, 1));
        assert!(!RelayStatus::mask_has_coil(0xFFFF, 0));
    }

    #[test]
    fn test_parse_read_coils_response() {
        // 协议示例：00 01 02 20 00 9D FC —— 线圈 6 反馈闭合
        let resp = [0x00, 0x01, 0x02, 0x20, 0x00, 0x9D, 0xFC];
        let RelayResponse::Status(status) = parse_relay_response(&resp).unwrap() else {
            panic!("应解析为状态反馈");
        };
        assert_eq!(status.mask, 0x2000);
        for (i, closed) in status.channels.iter().enumerate() {
            assert_eq!(*closed, i == 5, "仅线圈 6 闭合，索引 {i}");
        }

        // CRC 高字节在前同样接受
        let swapped = [0x00, 0x01, 0x02, 0x20, 0x00, 0xFC, 0x9D];
        assert!(parse_relay_response(&swapped).is_ok());

        // CRC 错误 / 字节数异常 / 设备 ID 不符
        assert!(parse_relay_response(&[0x00, 0x01, 0x02, 0x20, 0x00, 0x9D, 0xFD]).is_err());
        assert!(parse_relay_response(&[0x00, 0x01, 0x03, 0x20, 0x00, 0x9D, 0xFC]).is_err());
        assert!(parse_relay_response(&[0x01, 0x01, 0x02, 0x20, 0x00, 0x9D, 0xFC]).is_err());
    }

    #[test]
    fn test_parse_write_single_coil_echo() {
        // 协议示例：设备反馈与指令一致 00 05 00 05 FF 00 9D EA
        let echo = [0x00, 0x05, 0x00, 0x05, 0xFF, 0x00, 0x9D, 0xEA];
        assert_eq!(
            parse_relay_response(&echo),
            Ok(RelayResponse::CoilWritten {
                coil_index: 6,
                on: true
            })
        );

        let off = build_write_single_coil_cmd(3, false).unwrap();
        assert_eq!(
            parse_relay_response(&off),
            Ok(RelayResponse::CoilWritten {
                coil_index: 3,
                on: false
            })
        );

        // 非法状态值 / 地址越界
        let mut bad = [0x00, 0x05, 0x00, 0x05, 0x12, 0x34, 0, 0];
        let (l, h) = calculate_modbus_crc16(&bad[..6]);
        bad[6] = l;
        bad[7] = h;
        assert!(parse_relay_response(&bad).is_err());
        let mut out_of_range = [0x00, 0x05, 0x00, 0x10, 0xFF, 0x00, 0, 0];
        let (l, h) = calculate_modbus_crc16(&out_of_range[..6]);
        out_of_range[6] = l;
        out_of_range[7] = h;
        assert!(parse_relay_response(&out_of_range).is_err());
    }

    #[test]
    fn test_set_coil_updates_mask_and_channels() {
        let mut status = RelayStatus::from_u16(0x2000); // 线圈 6 闭合
        status.set_coil(1, true);
        status.set_coil(9, true);
        status.set_coil(6, false);
        assert_eq!(status, RelayStatus::from_u16(0x0101));
        status.set_coil(0, true); // 越界忽略
        status.set_coil(17, true);
        assert_eq!(status.mask, 0x0101);
    }
}
