//! 13所光电吊舱（Z45 指令集）协议编码模块。
//!
//! 模式 B 32 字节飞控上行遥控帧的吊舱装订载荷：
//! - `fcode = 0x70`（Z45 吊舱装订指令）
//! - `DCtype = 0x01`（13所光电吊舱）
//! - 角度量化：0.01°/LSB，小端 INT16
//! - 俯仰范围 -110.00° ~ +50.00°（-11000 ~ +5000）
//! - 方位范围 -180.00° ~ +180.00°（-18000 ~ +18000）

use serde::{Deserialize, Serialize};

/// 吊舱装订指令功能码（写入 32 字节遥控帧 fcode 字段）。
pub const POD_INJECT_CODE: u8 = 0x70;
/// 13所光电吊舱类型标识（写入装订载荷首字节 DCtype）。
pub const POD_DC_TYPE: u8 = 0x01;
/// 数字引导模式指令码。
pub const POD_GUIDE_CODE: u8 = 0x19;

/// 俯仰角物理范围（度）。
pub const POD_PITCH_MIN_DEG: f64 = -110.0;
pub const POD_PITCH_MAX_DEG: f64 = 50.0;
/// 方位角物理范围（度）。
pub const POD_YAW_MIN_DEG: f64 = -180.0;
pub const POD_YAW_MAX_DEG: f64 = 180.0;

/// 吊舱指令发送模式。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PodSendMode {
    /// 单次触发：注入约 100ms 后自动清空复位。
    Single,
    /// 连续/长按：以 100ms 周期（10Hz）持续发送，松开后停止并复位。
    Continuous,
}

/// Z45 指令集请求（前端 → 后端）。
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PodCommandRequest {
    /// 功能指令码（SwitchCmd）。
    pub switch_code: u8,
    /// 发送模式。
    pub mode: PodSendMode,
    /// 俯仰角（度，仅数字引导 0x19 使用，其余指令填 0）。
    pub pitch_deg: f64,
    /// 方位角（度，仅数字引导 0x19 使用，其余指令填 0）。
    pub yaw_deg: f64,
}

fn clamp_scaled(value: f64, min_deg: f64, max_deg: f64, field: &str) -> Result<i16, String> {
    if !value.is_finite() || !(min_deg..=max_deg).contains(&value) {
        return Err(format!(
            "{field} 角度 {value}° 超出协议范围 {min_deg}° ~ {max_deg}°"
        ));
    }
    Ok((value * 100.0).round() as i16)
}

/// 将吊舱指令封装为 15 字节上行装订载荷。
///
/// 载荷布局（对应 `ProtocalDataInject_DC`）：
/// ```text
/// [0]      DCtype      = 0x01
/// [1]      SwitchCmd   功能指令码
/// [2..4]   param1      俯仰控制量（0.01°/LSB，小端）
/// [4..6]   param2      方位控制量（0.01°/LSB，小端）
/// [6..15]  reserve     保留，全 0
/// ```
pub fn encode_pod_injection(request: &PodCommandRequest) -> Result<[u8; 15], String> {
    let pitch = clamp_scaled(
        request.pitch_deg,
        POD_PITCH_MIN_DEG,
        POD_PITCH_MAX_DEG,
        "俯仰",
    )?;
    let yaw = clamp_scaled(request.yaw_deg, POD_YAW_MIN_DEG, POD_YAW_MAX_DEG, "方位")?;

    let mut payload = [0u8; 15];
    payload[0] = POD_DC_TYPE;
    payload[1] = request.switch_code;
    payload[2..4].copy_from_slice(&pitch.to_le_bytes());
    payload[4..6].copy_from_slice(&yaw.to_le_bytes());
    Ok(payload)
}

/// VMC（视频管理计算机）通道控制码合法性校验。
///
/// 范围 0xC0 ~ 0xCD，对应 2M/4M 速率、吊舱通道、拼图、记录、清空与链路输出切换。
pub fn validate_vmc_code(code: u8) -> Result<u8, String> {
    if (0xC0..=0xCD).contains(&code) {
        Ok(code)
    } else {
        Err(format!(
            "VMC 通道控制码 0x{code:02X} 非法，仅允许 0xC0 ~ 0xCD"
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_guide_command_with_little_endian_angles() {
        let request = PodCommandRequest {
            switch_code: POD_GUIDE_CODE,
            mode: PodSendMode::Single,
            pitch_deg: -30.0,
            yaw_deg: 45.5,
        };
        let payload = encode_pod_injection(&request).unwrap();
        assert_eq!(payload[0], 0x01);
        assert_eq!(payload[1], 0x19);
        // -3000 = 0xF448，小端：48 F4
        assert_eq!(&payload[2..4], &[0x48, 0xF4]);
        // 4550 = 0x11C6，小端：C6 11
        assert_eq!(&payload[4..6], &[0xC6, 0x11]);
        assert!(payload[6..15].iter().all(|&b| b == 0));
    }

    #[test]
    fn rejects_out_of_range_pitch() {
        let request = PodCommandRequest {
            switch_code: POD_GUIDE_CODE,
            mode: PodSendMode::Single,
            pitch_deg: 51.0,
            yaw_deg: 0.0,
        };
        assert!(encode_pod_injection(&request).is_err());
    }

    #[test]
    fn rejects_out_of_range_yaw() {
        let request = PodCommandRequest {
            switch_code: POD_GUIDE_CODE,
            mode: PodSendMode::Single,
            pitch_deg: 0.0,
            yaw_deg: -180.5,
        };
        assert!(encode_pod_injection(&request).is_err());
    }

    #[test]
    fn boundary_angles_are_accepted() {
        // 覆盖协议帧范围边界与垂直下视（俯仰向下为负方向：-90°）
        for (pitch, yaw) in [(-110.0, -180.0), (50.0, 180.0), (-90.0, 0.0)] {
            let request = PodCommandRequest {
                switch_code: POD_GUIDE_CODE,
                mode: PodSendMode::Single,
                pitch_deg: pitch,
                yaw_deg: yaw,
            };
            assert!(encode_pod_injection(&request).is_ok());
        }
    }

    #[test]
    fn vmc_code_range_is_enforced() {
        assert!(validate_vmc_code(0xC0).is_ok());
        assert!(validate_vmc_code(0xCD).is_ok());
        assert!(validate_vmc_code(0xCE).is_err());
        assert!(validate_vmc_code(0xBF).is_err());
    }
}
