//! 0xC4 1-3 总线挂载 7 种设备解析（RS-485 Modbus RTU，115200）
//!
//! 依据《FP-95防除冰航电系统通信协议》1.1 / 1.2，设备 ID（暂定）：
//! - 0x01: 100V 升压模块（读 `01 03 00 00 00 01`，反馈 9 字节数据）
//! - 0x02: 温度采集模块 1（左侧，读 `02 03 00 28 00 10`，16 路 i16 × 0.1℃）
//! - 0x03: 温度采集模块 2（右侧，读 `03 03 00 28 00 10`）
//! - 0x04: 电压采集模块（读 `04 03 00 00 00 18`，24 路 u16，量程 100V → × 0.01V）
//! - 0x05: 电流采集模块 1（读 `05 03 00 08 00 08`，8 路 u16，量程 50A → × 0.005A）
//! - 0x06: 电流采集模块 2（读 `06 03 00 08 00 08`）
//! - 0x07: 温湿度气压传感器（读 `07 03 00 64 00 06`，3 个 f32，按协议示例为大端字节序）
//!
//! 采集位置见协议表 2（温度）、表 3（电压）、表 5（电流），"空" 通道不解析。
//! CRC 兼容低字节在前 / 高字节在前（升压模块示例为高字节在前，其余为低字节在前）。

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

/// 温度采集模块 (ID: 0x02 左侧 / 0x03 右侧)，字段后为协议表 2 的 IO 口编号
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TempSensorGroupData {
    pub inner_wing_const: f32, // IO1  内机翼常加热膜采温 (℃)
    pub mid_wing_const: f32,   // IO2  中机翼常加热膜采温 (℃)
    pub outer_wing_const: f32, // IO5  外机翼常加热膜采温 (℃)
    pub inner_wing_heat: f32,  // IO6  内机翼加热膜采温 (℃)
    pub mid_wing_heat: f32,    // IO7  中机翼加热膜采温 (℃)
    pub outer_wing_heat: f32,  // IO8  外机翼加热膜采温 (℃)
    pub battery_a: f32,        // IO11 电池1（模块1）/电池3（模块2）采温 (℃)
    pub battery_b: f32,        // IO12 电池2（模块1）/电池4（模块2）采温 (℃)
    pub vertical_tail: f32,    // IO13 垂尾加热膜采温 (℃)
    pub horizontal_tail: f32,  // IO14 平尾加热膜采温 (℃)
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
            // IO 口 n（1~16）位于数据区第 n 个寄存器，有符号数 × 0.1℃
            let parse_temp = |io: usize| -> f32 {
                let offset = 3 + (io - 1) * 2;
                (i16::from_be_bytes([data[offset], data[offset + 1]]) as f32) * 0.1
            };
            let group = TempSensorGroupData {
                inner_wing_const: parse_temp(1),
                mid_wing_const: parse_temp(2),
                outer_wing_const: parse_temp(5),
                inner_wing_heat: parse_temp(6),
                mid_wing_heat: parse_temp(7),
                outer_wing_heat: parse_temp(8),
                battery_a: parse_temp(11),
                battery_b: parse_temp(12),
                vertical_tail: parse_temp(13),
                horizontal_tail: parse_temp(14),
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

    /// 协议示例温度数据区：-10、-20……-80, 80、70……10 ℃
    const TEMP_EXAMPLE_DATA: [u8; 32] = [
        0xFF, 0x9C, 0xFF, 0x38, 0xFE, 0xD4, 0xFE, 0x70, 0xFE, 0x0C, 0xFD, 0xA8, 0xFD, 0x44, 0xFC,
        0xE0, 0x03, 0x20, 0x02, 0xBC, 0x02, 0x58, 0x01, 0xF4, 0x01, 0x90, 0x01, 0x2C, 0x00, 0xC8,
        0x00, 0x64,
    ];

    fn frame_with(head: &[u8], data: &[u8], crc: [u8; 2]) -> Vec<u8> {
        let mut f = head.to_vec();
        f.extend_from_slice(data);
        f.extend_from_slice(&crc);
        f
    }

    #[test]
    fn test_temp_sensor_example() {
        // 协议示例：02 03 20 … 00 64 C3 E0（温度采集 1，左侧）
        let raw = frame_with(&[0x02, 0x03, 0x20], &TEMP_EXAMPLE_DATA, [0xC3, 0xE0]);
        let Bus0xC4DeviceData::TempSensor1(d) = parse_bus_0xc4_frame(&raw).expect("解析温度模块1")
        else {
            panic!("类型不匹配");
        };
        // IO1/2/5/6/7/8/11/12/13/14 = -10/-20/-50/-60/-70/-80/60/50/40/30
        let expect = [
            (d.inner_wing_const, -10.0),
            (d.mid_wing_const, -20.0),
            (d.outer_wing_const, -50.0),
            (d.inner_wing_heat, -60.0),
            (d.mid_wing_heat, -70.0),
            (d.outer_wing_heat, -80.0),
            (d.battery_a, 60.0),
            (d.battery_b, 50.0),
            (d.vertical_tail, 40.0),
            (d.horizontal_tail, 30.0),
        ];
        for (got, want) in expect {
            assert!((got - want).abs() < 0.01, "{got} != {want}");
        }

        // 协议示例：03 03 20 … 00 64 EF 20（温度采集 2，右侧）
        let raw2 = frame_with(&[0x03, 0x03, 0x20], &TEMP_EXAMPLE_DATA, [0xEF, 0x20]);
        assert!(matches!(
            parse_bus_0xc4_frame(&raw2),
            Ok(Bus0xC4DeviceData::TempSensor2(_))
        ));
    }

    #[test]
    fn test_voltage_sensor_example() {
        // 协议示例：04 03 30 03 E8 … 0C E4 F4 7B，电压分别为 10、11……33V
        let mut data = Vec::new();
        for v in 10u16..=33 {
            data.extend_from_slice(&(v * 100).to_be_bytes());
        }
        let raw = frame_with(&[0x04, 0x03, 0x30], &data, [0xF4, 0x7B]);
        let Bus0xC4DeviceData::VoltageSensor(d) = parse_bus_0xc4_frame(&raw).expect("解析电压模块")
        else {
            panic!("类型不匹配");
        };
        assert!((d.right_inner_wing - 10.0).abs() < 0.01); // IO1
        assert!((d.left_horizontal_tail - 19.0).abs() < 0.01); // IO10
        assert!((d.v100_input - 21.0).abs() < 0.01); // IO12
        assert!((d.battery_input - 22.0).abs() < 0.01); // IO13
        assert!((d.v48_boost_module - 31.0).abs() < 0.01); // IO22
    }

    #[test]
    fn test_current_sensor_examples() {
        // 协议示例：05/06 03 10 03 E8 … 06 A4，电流分别为 5、5.5……8.5A
        let mut data = Vec::new();
        for i in 0u16..8 {
            data.extend_from_slice(&(1000 + i * 100).to_be_bytes());
        }
        let raw1 = frame_with(&[0x05, 0x03, 0x10], &data, [0xF5, 0xFA]);
        let Bus0xC4DeviceData::CurrentSensor1(c1) = parse_bus_0xc4_frame(&raw1).expect("电流1")
        else {
            panic!("类型不匹配");
        };
        assert!((c1.left_vertical_tail - 5.0).abs() < 0.001); // IO1
        assert!((c1.wing_const_heat - 7.5).abs() < 0.001); // IO6

        let raw2 = frame_with(&[0x06, 0x03, 0x10], &data, [0xB1, 0xBE]);
        let Bus0xC4DeviceData::CurrentSensor2(c2) = parse_bus_0xc4_frame(&raw2).expect("电流2")
        else {
            panic!("类型不匹配");
        };
        assert!((c2.right_horizontal_tail - 5.0).abs() < 0.001); // IO1
        assert!((c2.right_vertical_tail - 5.5).abs() < 0.001); // IO2
        assert!((c2.low_voltage_supply - 7.5).abs() < 0.001); // IO6
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
