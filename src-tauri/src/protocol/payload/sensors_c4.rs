//! 0xC4 1-3 总线挂载 7 种设备解析（RS-485 Modbus RTU）
//!
//! 设备ID映射：
//! - 0x01: 100V 升压模块
//! - 0x02: 温度采集模块 1
//! - 0x03: 温度采集模块 2
//! - 0x04: 电压采集模块
//! - 0x05: 电流采集模块 1
//! - 0x06: 电流采集模块 2
//! - 0x07: 温湿度气压传感器

use super::relay_c3::calculate_modbus_crc16;
use serde::{Deserialize, Serialize};

/// 验证 Modbus CRC（兼容高字节在前或低字节在前）
pub fn verify_modbus_crc(data: &[u8], expected_crch: u8, expected_crcl: u8) -> bool {
    let (h, l) = calculate_modbus_crc16(data);
    (expected_crch == h && expected_crcl == l) || (expected_crch == l && expected_crcl == h)
}

/// 100V 升压模块 (ID: 0x01)
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoostModuleData {
    pub input_voltage: f32,  // 输入电压 (V, 分辨率 0.01V)
    pub input_current: f32,  // 输入电流 (A, 分辨率 0.01A)
    pub output_voltage: f32, // 输出电压 (V, 分辨率 0.01V)
    pub output_current: f32, // 输出电流 (A, 分辨率 0.01A)
    pub temperature: f32,    // 温度 (℃, 接收值 - 40)
}

/// 温度采集模块 (ID: 0x02 / 0x03)
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TempSensorGroupData {
    pub inner_wing_const: f32, // 内机翼常加热膜采温 (℃)
    pub mid_wing_const: f32,   // 中机翼常加热膜采温 (℃)
    pub outer_wing_const: f32, // 外机翼常加热膜采温 (℃)
    pub inner_wing_heat: f32,  // 内机翼加热膜采温 (℃)
    pub mid_wing_heat: f32,    // 中机翼加热膜采温 (℃)
    pub outer_wing_heat: f32,  // 外机翼加热膜采温 (℃)
    pub battery_a: f32,        // 电池1/3采温 (℃)
    pub battery_b: f32,        // 电池2/4采温 (℃)
    pub vertical_tail: f32,    // 垂尾加热膜采温 (℃)
    pub horizontal_tail: f32,  // 平尾加热膜采温 (℃)
}

/// 电压采集模块 (ID: 0x04)
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoltageSensorData {
    pub right_inner_wing: f32,
    pub right_mid_wing: f32,
    pub right_outer_wing: f32,
    pub right_vertical_tail: f32,
    pub right_horizontal_tail: f32,
    pub left_inner_wing: f32,
    pub left_mid_wing: f32,
    pub left_outer_wing: f32,
    pub left_vertical_tail: f32,
    pub left_horizontal_tail: f32,
    pub wing_const_heat: f32,
    pub v100_input: f32,
    pub battery_input: f32,
    pub rectifier1_input: f32,
    pub rectifier1_post_relay: f32,
    pub regulator1_output: f32,
    pub regulator2_output: f32,
    pub atmosphere_heat: f32,
    pub cloud_drop_heat: f32,
    pub step_down_module: f32,
    pub rectifier3: f32,
    pub v48_boost_module: f32,
}

/// 电流采集模块 1 (ID: 0x05)
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrentSensorGroup1Data {
    pub left_vertical_tail: f32,
    pub left_horizontal_tail: f32,
    pub left_inner_wing: f32,
    pub left_mid_wing: f32,
    pub left_outer_wing: f32,
    pub wing_const_heat: f32,
}

/// 电流采集模块 2 (ID: 0x06)
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrentSensorGroup2Data {
    pub right_horizontal_tail: f32,
    pub right_vertical_tail: f32,
    pub right_inner_wing: f32,
    pub right_mid_wing: f32,
    pub right_outer_wing: f32,
    pub low_voltage_supply: f32,
}

/// 温湿度气压传感器 (ID: 0x07)
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentSensorData {
    pub temperature: f32, // 温度 (℃)
    pub humidity: f32,    // 湿度 (%RH)
    pub pressure: f32,    // 气压 (kPa)
}

/// 0xC4 总线设备解析结果枚举
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "camelCase")]
pub enum Bus0xC4DeviceData {
    BoostModule(BoostModuleData),
    TempSensor1(TempSensorGroupData),
    TempSensor2(TempSensorGroupData),
    VoltageSensor(VoltageSensorData),
    CurrentSensor1(CurrentSensorGroup1Data),
    CurrentSensor2(CurrentSensorGroup2Data),
    EnvironmentSensor(EnvironmentSensorData),
}

/// 解析 0xC4 总线上的设备响应帧
pub fn parse_bus_0xc4_frame(data: &[u8]) -> Result<Bus0xC4DeviceData, String> {
    if data.len() < 5 {
        return Err(format!("0xC4 报文过短: {}", data.len()));
    }
    let dev_id = data[0];
    let fc = data[1];
    if fc != 0x03 {
        return Err(format!("0xC4 非 0x03 查询功能码: 0x{:02X}", fc));
    }

    match dev_id {
        0x01 => {
            // 升压模块: 01 03 09 + 9字节数据 + 2字节CRC = 14字节
            if data.len() < 14 {
                return Err(format!("升压模块报文长度不足 14: {}", data.len()));
            }
            if !verify_modbus_crc(&data[0..12], data[12], data[13]) {
                return Err("升压模块 CRC 校验失败".to_string());
            }
            let vin = u16::from_be_bytes([data[3], data[4]]) as f32 * 0.01;
            let iin = u16::from_be_bytes([data[5], data[6]]) as f32 * 0.01;
            let vout = u16::from_be_bytes([data[7], data[8]]) as f32 * 0.01;
            let iout = u16::from_be_bytes([data[9], data[10]]) as f32 * 0.01;
            let temp = (data[11] as i16 - 40) as f32;
            Ok(Bus0xC4DeviceData::BoostModule(BoostModuleData {
                input_voltage: vin,
                input_current: iin,
                output_voltage: vout,
                output_current: iout,
                temperature: temp,
            }))
        }
        0x02 | 0x03 => {
            // 温度采集1/2: 02/03 03 20 + 32字节数据 + 2字节CRC = 37字节
            if data.len() < 37 {
                return Err(format!("温度采集报文长度不足 37: {}", data.len()));
            }
            if !verify_modbus_crc(&data[0..35], data[35], data[36]) {
                return Err("温度采集 CRC 校验失败".to_string());
            }
            let parse_temp = |offset: usize| -> f32 {
                (i16::from_be_bytes([data[offset], data[offset + 1]]) as f32) * 0.1
            };
            let group = TempSensorGroupData {
                inner_wing_const: parse_temp(3),
                mid_wing_const: parse_temp(5),
                outer_wing_const: parse_temp(11),
                inner_wing_heat: parse_temp(13),
                mid_wing_heat: parse_temp(15),
                outer_wing_heat: parse_temp(17),
                battery_a: parse_temp(23),
                battery_b: parse_temp(25),
                vertical_tail: parse_temp(27),
                horizontal_tail: parse_temp(29),
            };
            if dev_id == 0x02 {
                Ok(Bus0xC4DeviceData::TempSensor1(group))
            } else {
                Ok(Bus0xC4DeviceData::TempSensor2(group))
            }
        }
        0x04 => {
            // 电压采集: 04 03 30 + 48字节数据 + 2字节CRC = 53字节
            if data.len() < 53 {
                return Err(format!("电压采集报文长度不足 53: {}", data.len()));
            }
            if !verify_modbus_crc(&data[0..51], data[51], data[52]) {
                return Err("电压采集 CRC 校验失败".to_string());
            }
            let parse_volt = |idx: usize| -> f32 {
                let offset = 3 + idx * 2;
                (u16::from_be_bytes([data[offset], data[offset + 1]]) as f32) * 0.01
            };
            Ok(Bus0xC4DeviceData::VoltageSensor(VoltageSensorData {
                right_inner_wing: parse_volt(0),
                right_mid_wing: parse_volt(1),
                right_outer_wing: parse_volt(2),
                right_vertical_tail: parse_volt(3),
                right_horizontal_tail: parse_volt(4),
                left_inner_wing: parse_volt(5),
                left_mid_wing: parse_volt(6),
                left_outer_wing: parse_volt(7),
                left_vertical_tail: parse_volt(8),
                left_horizontal_tail: parse_volt(9),
                wing_const_heat: parse_volt(10),
                v100_input: parse_volt(11),
                battery_input: parse_volt(12),
                rectifier1_input: parse_volt(13),
                rectifier1_post_relay: parse_volt(14),
                regulator1_output: parse_volt(15),
                regulator2_output: parse_volt(16),
                atmosphere_heat: parse_volt(17),
                cloud_drop_heat: parse_volt(18),
                step_down_module: parse_volt(19),
                rectifier3: parse_volt(20),
                v48_boost_module: parse_volt(21),
            }))
        }
        0x05 => {
            // 电流采集1: 05 03 10 + 16字节数据 + 2字节CRC = 21字节
            if data.len() < 21 {
                return Err(format!("电流采集1报文长度不足 21: {}", data.len()));
            }
            if !verify_modbus_crc(&data[0..19], data[19], data[20]) {
                return Err("电流采集1 CRC 校验失败".to_string());
            }
            let parse_curr = |idx: usize| -> f32 {
                let offset = 3 + idx * 2;
                (u16::from_be_bytes([data[offset], data[offset + 1]]) as f32) * 0.005
            };
            Ok(Bus0xC4DeviceData::CurrentSensor1(
                CurrentSensorGroup1Data {
                    left_vertical_tail: parse_curr(0),
                    left_horizontal_tail: parse_curr(1),
                    left_inner_wing: parse_curr(2),
                    left_mid_wing: parse_curr(3),
                    left_outer_wing: parse_curr(4),
                    wing_const_heat: parse_curr(5),
                },
            ))
        }
        0x06 => {
            // 电流采集2: 06 03 10 + 16字节数据 + 2字节CRC = 21字节
            if data.len() < 21 {
                return Err(format!("电流采集2报文长度不足 21: {}", data.len()));
            }
            if !verify_modbus_crc(&data[0..19], data[19], data[20]) {
                return Err("电流采集2 CRC 校验失败".to_string());
            }
            let parse_curr = |idx: usize| -> f32 {
                let offset = 3 + idx * 2;
                (u16::from_be_bytes([data[offset], data[offset + 1]]) as f32) * 0.005
            };
            Ok(Bus0xC4DeviceData::CurrentSensor2(
                CurrentSensorGroup2Data {
                    right_horizontal_tail: parse_curr(0),
                    right_vertical_tail: parse_curr(1),
                    right_inner_wing: parse_curr(2),
                    right_mid_wing: parse_curr(3),
                    right_outer_wing: parse_curr(4),
                    low_voltage_supply: parse_curr(5),
                },
            ))
        }
        0x07 => {
            // 温湿度传感器: 07 03 0C + 12字节数据 + 2字节CRC = 17字节
            if data.len() < 17 {
                return Err(format!("温湿度传感器报文长度不足 17: {}", data.len()));
            }
            if !verify_modbus_crc(&data[0..15], data[15], data[16]) {
                return Err("温湿度传感器 CRC 校验失败".to_string());
            }
            let temp = f32::from_be_bytes([data[3], data[4], data[5], data[6]]);
            let hum = f32::from_be_bytes([data[7], data[8], data[9], data[10]]);
            let pres = f32::from_be_bytes([data[11], data[12], data[13], data[14]]);
            Ok(Bus0xC4DeviceData::EnvironmentSensor(
                EnvironmentSensorData {
                    temperature: temp,
                    humidity: hum,
                    pressure: pres,
                },
            ))
        }
        other => Err(format!("0xC4 未知设备 ID: 0x{:02X}", other)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_boost_module_example() {
        // 文档示例: 01 03 09 0A F0 03 E8 27 10 01 F4 5A 9A B4
        let raw = [
            0x01, 0x03, 0x09, 0x0A, 0xF0, 0x03, 0xE8, 0x27, 0x10, 0x01, 0xF4, 0x5A, 0x9A, 0xB4,
        ];
        let parsed = parse_bus_0xc4_frame(&raw).expect("解析升压模块");
        if let Bus0xC4DeviceData::BoostModule(data) = parsed {
            assert!((data.input_voltage - 28.0).abs() < 0.01);
            assert!((data.input_current - 10.0).abs() < 0.01);
            assert!((data.output_voltage - 100.0).abs() < 0.01);
            assert!((data.output_current - 5.0).abs() < 0.01);
            assert!((data.temperature - 50.0).abs() < 0.01);
        } else {
            panic!("类型不匹配");
        }
    }

    #[test]
    fn test_temp_sensor_example() {
        // 文档示例: 02 03 20 FF 9C FF 38 FE D4 FE 70 FE 0C FD A8 FD 44 FC E0 03 20 02 BC 02 58 01 F4 01 90 01 2C 00 C8 00 64 E0 C3
        let raw = [
            0x02, 0x03, 0x20, 0xFF, 0x9C, 0xFF, 0x38, 0xFE, 0xD4, 0xFE, 0x70, 0xFE, 0x0C, 0xFD,
            0xA8, 0xFD, 0x44, 0xFC, 0xE0, 0x03, 0x20, 0x02, 0xBC, 0x02, 0x58, 0x01, 0xF4, 0x01,
            0x90, 0x01, 0x2C, 0x00, 0xC8, 0x00, 0x64, 0xE0, 0xC3,
        ];
        let parsed = parse_bus_0xc4_frame(&raw).expect("解析温度模块1");
        if let Bus0xC4DeviceData::TempSensor1(data) = parsed {
            // 0xFF9C = -100 -> -10.0℃
            assert!((data.inner_wing_const - (-10.0)).abs() < 0.1);
            // 0xFF38 = -200 -> -20.0℃
            assert!((data.mid_wing_const - (-20.0)).abs() < 0.1);
        } else {
            panic!("类型不匹配");
        }
    }

    #[test]
    fn test_env_sensor_example() {
        // 文档示例: 07 03 0C 41 45 87 E6 41 BB A7 81 42 F6 E9 E0 A8 79
        let raw = [
            0x07, 0x03, 0x0C, 0x41, 0x45, 0x87, 0xE6, 0x41, 0xBB, 0xA7, 0x81, 0x42, 0xF6, 0xE9,
            0xE0, 0xA8, 0x79,
        ];
        let parsed = parse_bus_0xc4_frame(&raw).expect("解析温湿度传感器");
        if let Bus0xC4DeviceData::EnvironmentSensor(data) = parsed {
            assert!((data.temperature - 12.345678).abs() < 0.001);
            assert!((data.humidity - 23.456789).abs() < 0.001);
            assert!((data.pressure - 123.456789).abs() < 0.001);
        } else {
            panic!("类型不匹配");
        }
    }
}
