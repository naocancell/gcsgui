/// 伺服天线转台通信协议实现
/// 对应文档：《伺服天线转台飞机坐标转发功能设计与实现规范.md》

/// 伺服转台坐标帧总长度（固定 32 字节）
pub const SERVO_FRAME_LEN: usize = 32;

/// 计算 16 位无符号累加和校验（Sum16）
///
/// 注意：该协议使用的是对前 30 字节进行的 16 位无符号累加（非 CRC-16 多项式校验）。
pub fn calc_sum16(data: &[u8]) -> u16 {
    let mut sum: u32 = 0;
    for &b in data {
        sum += b as u32;
    }
    (sum & 0xFFFF) as u16
}

/// 组装 32 字节伺服转台飞机坐标报文
///
/// # 参数
/// - `lon`: 飞机经度（度，WGS-84）
/// - `lat`: 飞机纬度（度，WGS-84）
/// - `hb_height`: 海拔高度（米）
/// - `air_height`: 气压高度（米）
/// - `rel_height`: 相对高度（米）
///
/// # 返回
/// 32 字节固定长度二进制数据帧
pub fn pack_servo_frame(
    lon: f64,
    lat: f64,
    hb_height: f32,
    air_height: f32,
    rel_height: f32,
) -> [u8; SERVO_FRAME_LEN] {
    let mut buf = [0u8; SERVO_FRAME_LEN];

    // 0x00 ~ 0x01: 帧同步头 (0xEB, 0x90)
    buf[0] = 0xEB;
    buf[1] = 0x90;

    // 0x02: 目的地址 0x02 (伺服转台)
    buf[2] = 0x02;

    // 0x03: 源地址 0x01 (地面站)
    buf[3] = 0x01;

    // 0x04: 帧识别码 0xC2
    buf[4] = 0xC2;

    // 0x05 ~ 0x08: 经度 (1e7 放大转 int32_t，小端序)
    let lon_raw = (lon * 10_000_000.0).round() as i32;
    buf[5..9].copy_from_slice(&lon_raw.to_le_bytes());

    // 0x09 ~ 0x0C: 纬度 (1e7 放大转 int32_t，小端序)
    let lat_raw = (lat * 10_000_000.0).round() as i32;
    buf[9..13].copy_from_slice(&lat_raw.to_le_bytes());

    // 0x0D ~ 0x0E: 海拔高度 ((米 + 500.0) * 10.0，转 uint16_t，小端序)
    let hb_raw = ((hb_height + 500.0) * 10.0).clamp(0.0, 65535.0).round() as u16;
    buf[13..15].copy_from_slice(&hb_raw.to_le_bytes());

    // 0x0F ~ 0x10: 气压高度 ((米 + 500.0) * 10.0，转 uint16_t，小端序)
    let air_raw = ((air_height + 500.0) * 10.0).clamp(0.0, 65535.0).round() as u16;
    buf[15..17].copy_from_slice(&air_raw.to_le_bytes());

    // 0x11 ~ 0x12: 相对高度 ((米 + 500.0) * 10.0，转 uint16_t，小端序)
    let rel_raw = ((rel_height + 500.0) * 10.0).clamp(0.0, 65535.0).round() as u16;
    buf[17..19].copy_from_slice(&rel_raw.to_le_bytes());

    // 0x13 ~ 0x1D: 预留 11 字节 (buf 初始化全为 0x00)

    // 0x1E ~ 0x1F: 16位累加和校验 (前 30 字节累加和，小端序)
    let checksum = calc_sum16(&buf[..30]);
    buf[30..32].copy_from_slice(&checksum.to_le_bytes());

    buf
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calc_sum16() {
        // 验证累加和测试用例
        let sample = [
            0xEB, 0x90, 0x02, 0x01, 0xC2, 0x79, 0x17, 0x56, 0x45, 0x40, 0x4E, 0xCC, 0x17, 0x06,
            0x42, 0x06, 0x42, 0x06, 0x42, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00,
        ];
        assert_eq!(sample.len(), 30);
        let checksum = calc_sum16(&sample);
        let expected_sum: u32 = sample.iter().map(|&x| x as u32).sum();
        assert_eq!(checksum, (expected_sum & 0xFFFF) as u16);
    }

    #[test]
    fn test_pack_servo_frame_format() {
        let lon = 116.3912345;
        let lat = 39.9078912;
        let hb_height = 1200.5f32;
        let air_height = 1195.0f32;
        let rel_height = 800.0f32;

        let frame = pack_servo_frame(lon, lat, hb_height, air_height, rel_height);
        assert_eq!(frame.len(), 32);

        // 校验同步头和识别码
        assert_eq!(frame[0], 0xEB);
        assert_eq!(frame[1], 0x90);
        assert_eq!(frame[2], 0x02);
        assert_eq!(frame[3], 0x01);
        assert_eq!(frame[4], 0xC2);

        // 校验经纬度还原
        let lon_raw = i32::from_le_bytes(frame[5..9].try_into().unwrap());
        assert_eq!(lon_raw, (lon * 1e7).round() as i32);

        let lat_raw = i32::from_le_bytes(frame[9..13].try_into().unwrap());
        assert_eq!(lat_raw, (lat * 1e7).round() as i32);

        // 校验高度还原
        let hb_raw = u16::from_le_bytes(frame[13..15].try_into().unwrap());
        assert_eq!(hb_raw, ((hb_height + 500.0) * 10.0).round() as u16);

        let air_raw = u16::from_le_bytes(frame[15..17].try_into().unwrap());
        assert_eq!(air_raw, ((air_height + 500.0) * 10.0).round() as u16);

        let rel_raw = u16::from_le_bytes(frame[17..19].try_into().unwrap());
        assert_eq!(rel_raw, ((rel_height + 500.0) * 10.0).round() as u16);

        // 校验保留位
        for b in &frame[19..30] {
            assert_eq!(*b, 0x00);
        }

        // 校验累加和
        let checksum = u16::from_le_bytes(frame[30..32].try_into().unwrap());
        assert_eq!(checksum, calc_sum16(&frame[..30]));
    }
}
