//! 任管-载荷外层通信协议编解码
//!
//! 报文结构：
//! - 帧头：0xAA 0x55 (2字节)
//! - 协议识别码：0x0A(上行) / 0x0B(下行) (1字节)
//! - 载荷ID：0xC0 ~ 0xC5 (1字节)
//! - 数据长度：有效数据内容字节数，低字节在前 (2字节, u16 LE)
//! - 帧计数：0 ~ 255 (1字节)
//! - 有效数据内容：N 字节 (不定长)
//! - 校验：和校验，帧头至有效数据内容所有字节累加和低8位 (1字节)

use serde::{Deserialize, Serialize};

pub const PAYLOAD_HEADER: [u8; 2] = [0xAA, 0x55];
pub const CODE_UPLINK: u8 = 0x0A;
pub const CODE_DOWNLINK: u8 = 0x0B;

pub const PAYLOAD_ID_ATMOSPHERE: u8 = 0xC0; // 人影大气数据测量
pub const PAYLOAD_ID_FLARE: u8 = 0xC1; // 人影焰条
pub const PAYLOAD_ID_CLOUD_DROP: u8 = 0xC2; // 人影云滴探测
pub const PAYLOAD_ID_RELAY: u8 = 0xC3; // 继电器控制器
pub const PAYLOAD_ID_BUS_SENSORS: u8 = 0xC4; // 1-3总线挂载设备
pub const PAYLOAD_ID_ICING: u8 = 0xC5; // 结冰传感器

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PayloadOuterFrame {
    pub direction_code: u8, // 0x0A 上行 / 0x0B 下行
    pub payload_id: u8,     // 0xC0 ~ 0xC5
    pub seq_num: u8,        // 帧计数
    pub data: Vec<u8>,      // 有效数据内容
}

/// 计算和校验：从帧头至有效数据内容所有字节累加取低8位
pub fn calculate_checksum(bytes: &[u8]) -> u8 {
    let sum: u32 = bytes.iter().map(|&b| b as u32).sum();
    (sum & 0xFF) as u8
}

/// 打包外层报文
pub fn pack_payload_frame(
    direction_code: u8,
    payload_id: u8,
    seq_num: u8,
    data: &[u8],
) -> Vec<u8> {
    let data_len = data.len() as u16;
    let mut frame = Vec::with_capacity(8 + data.len());
    frame.extend_from_slice(&PAYLOAD_HEADER);
    frame.push(direction_code);
    frame.push(payload_id);
    frame.extend_from_slice(&data_len.to_le_bytes());
    frame.push(seq_num);
    frame.extend_from_slice(data);
    let checksum = calculate_checksum(&frame);
    frame.push(checksum);
    frame
}

/// 解包外层报文（传入必须是一包完整数据）
pub fn unpack_payload_frame(frame: &[u8]) -> Result<PayloadOuterFrame, String> {
    if frame.len() < 8 {
        return Err(format!("报文长度不足 8 字节: {}", frame.len()));
    }
    if frame[0] != PAYLOAD_HEADER[0] || frame[1] != PAYLOAD_HEADER[1] {
        return Err(format!("帧头错误: {:02X} {:02X}", frame[0], frame[1]));
    }
    let direction_code = frame[2];
    let payload_id = frame[3];
    let data_len = u16::from_le_bytes([frame[4], frame[5]]) as usize;
    let seq_num = frame[6];

    let expected_len = 8 + data_len;
    if frame.len() < expected_len {
        return Err(format!(
            "报文长度不匹配: 声明数据长度为 {}, 整帧需要 {}, 实际提供 {}",
            data_len, expected_len, frame.len()
        ));
    }

    let payload_slice = &frame[7..7 + data_len];
    let received_checksum = frame[7 + data_len];
    let calculated = calculate_checksum(&frame[..7 + data_len]);

    if received_checksum != calculated {
        return Err(format!(
            "和校验失败: 收到 0x{:02X}, 计算得到 0x{:02X}",
            received_checksum, calculated
        ));
    }

    Ok(PayloadOuterFrame {
        direction_code,
        payload_id,
        seq_num,
        data: payload_slice.to_vec(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pack_and_unpack_payload_frame() {
        let raw_data = vec![0x01, 0x03, 0x09, 0x0A, 0xF0];
        let packed = pack_payload_frame(CODE_DOWNLINK, PAYLOAD_ID_BUS_SENSORS, 12, &raw_data);
        assert_eq!(packed.len(), 8 + raw_data.len());
        assert_eq!(packed[0..2], [0xAA, 0x55]);
        assert_eq!(packed[2], CODE_DOWNLINK);
        assert_eq!(packed[3], PAYLOAD_ID_BUS_SENSORS);
        assert_eq!(u16::from_le_bytes([packed[4], packed[5]]), 5);
        assert_eq!(packed[6], 12);
        assert_eq!(&packed[7..12], &raw_data);

        let unpacked = unpack_payload_frame(&packed).expect("应该成功解包");
        assert_eq!(unpacked.direction_code, CODE_DOWNLINK);
        assert_eq!(unpacked.payload_id, PAYLOAD_ID_BUS_SENSORS);
        assert_eq!(unpacked.seq_num, 12);
        assert_eq!(unpacked.data, raw_data);
    }

    #[test]
    fn test_unpack_checksum_error() {
        let mut packed = pack_payload_frame(CODE_UPLINK, PAYLOAD_ID_RELAY, 1, &[0x01, 0x02]);
        let last_idx = packed.len() - 1;
        packed[last_idx] ^= 0xFF; // 破坏校验码
        assert!(unpack_payload_frame(&packed).is_err());
    }
}
