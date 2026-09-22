pub mod ice_c5;
pub mod outer;
pub mod relay_c3;
pub mod sensors_c4;

pub use ice_c5::*;
pub use outer::*;
pub use relay_c3::*;
pub use sensors_c4::*;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 任管载荷全状态聚合模型（按无人机或全局维护）
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MissionPayloadAggregate {
    pub uav_id: u8,
    pub relay: Option<RelayStatus>,
    pub boost_module: Option<BoostModuleData>,
    pub temp_sensor1: Option<TempSensorGroupData>,
    pub temp_sensor2: Option<TempSensorGroupData>,
    pub voltage_sensor: Option<VoltageSensorData>,
    pub current_sensor1: Option<CurrentSensorGroup1Data>,
    pub current_sensor2: Option<CurrentSensorGroup2Data>,
    pub environment_sensor: Option<EnvironmentSensorData>,
    pub icing_sensor: Option<IcingSensorData>,
    pub last_updated_ms: u64,
}

impl MissionPayloadAggregate {
    pub fn new(uav_id: u8) -> Self {
        Self {
            uav_id,
            ..Default::default()
        }
    }
}

/// 针对各载荷 ID 的流式分包重组与解析器
///
/// 协议指出：各载荷数据轮流下传，且下传的数据可能不是完整包数据。
/// 本重组器按载荷 ID 独立维护重组缓冲区，防止轮流下发时数据包交叉污染。
#[derive(Debug, Default)]
pub struct PayloadStreamReassembler {
    buffers: HashMap<u8, Vec<u8>>,
}

impl PayloadStreamReassembler {
    pub fn new() -> Self {
        Self {
            buffers: HashMap::new(),
        }
    }

    /// 喂入一帧外层解包后的有效载荷数据，并尝试产出更新
    pub fn feed_payload(
        &mut self,
        payload_id: u8,
        chunk: &[u8],
        aggregate: &mut MissionPayloadAggregate,
        now_ms: u64,
    ) {
        let buf = self.buffers.entry(payload_id).or_default();
        buf.extend_from_slice(chunk);

        // 缓冲区防溢出保护 (最大 4KB)
        if buf.len() > 4096 {
            buf.clear();
            return;
        }

        match payload_id {
            PAYLOAD_ID_RELAY => {
                // 0xC3 继电器：读线圈反馈 7 字节，写线圈反馈 8 字节
                while buf.len() >= 7 {
                    if buf[0] != RELAY_DEVICE_ID {
                        buf.remove(0);
                        continue;
                    }
                    let fc = buf[1];
                    let needed_len = if fc == FC_READ_COILS {
                        7
                    } else if fc == FC_WRITE_COILS {
                        8
                    } else {
                        buf.remove(0);
                        continue;
                    };

                    if buf.len() < needed_len {
                        break;
                    }

                    let frame = buf[..needed_len].to_vec();
                    if let Ok(Some(status)) = parse_relay_response(&frame) {
                        aggregate.relay = Some(status);
                        aggregate.last_updated_ms = now_ms;
                        buf.drain(..needed_len);
                    } else if parse_relay_response(&frame).is_ok() {
                        // 写线圈确认，消费掉
                        buf.drain(..needed_len);
                    } else {
                        // 校验失败，滑动 1 字节
                        buf.remove(0);
                    }
                }
            }
            PAYLOAD_ID_BUS_SENSORS => {
                // 0xC4 1-3总线设备：设备ID 0x01~0x07，功能码 0x03
                while buf.len() >= 5 {
                    let dev_id = buf[0];
                    let fc = buf[1];
                    if !(1..=7).contains(&dev_id) || fc != 0x03 {
                        buf.remove(0);
                        continue;
                    }
                    let needed_len = match dev_id {
                        0x01 => 14,
                        0x02 | 0x03 => 37,
                        0x04 => 53,
                        0x05 | 0x06 => 21,
                        0x07 => 17,
                        _ => 0,
                    };
                    if needed_len == 0 {
                        buf.remove(0);
                        continue;
                    }
                    if buf.len() < needed_len {
                        break;
                    }

                    let frame = buf[..needed_len].to_vec();
                    match parse_bus_0xc4_frame(&frame) {
                        Ok(data) => {
                            match data {
                                Bus0xC4DeviceData::BoostModule(d) => {
                                    aggregate.boost_module = Some(d)
                                }
                                Bus0xC4DeviceData::TempSensor1(d) => {
                                    aggregate.temp_sensor1 = Some(d)
                                }
                                Bus0xC4DeviceData::TempSensor2(d) => {
                                    aggregate.temp_sensor2 = Some(d)
                                }
                                Bus0xC4DeviceData::VoltageSensor(d) => {
                                    aggregate.voltage_sensor = Some(d)
                                }
                                Bus0xC4DeviceData::CurrentSensor1(d) => {
                                    aggregate.current_sensor1 = Some(d)
                                }
                                Bus0xC4DeviceData::CurrentSensor2(d) => {
                                    aggregate.current_sensor2 = Some(d)
                                }
                                Bus0xC4DeviceData::EnvironmentSensor(d) => {
                                    aggregate.environment_sensor = Some(d)
                                }
                            }
                            aggregate.last_updated_ms = now_ms;
                            buf.drain(..needed_len);
                        }
                        Err(_) => {
                            buf.remove(0);
                        }
                    }
                }
            }
            PAYLOAD_ID_ICING => {
                // 0xC5 结冰传感器：8 字节定长，0xEB 0x90 开头
                while buf.len() >= 8 {
                    if buf[0] != 0xEB || buf[1] != 0x90 {
                        buf.remove(0);
                        continue;
                    }
                    let frame = buf[..8].to_vec();
                    match parse_icing_frame(&frame) {
                        Ok(data) => {
                            aggregate.icing_sensor = Some(data);
                            aggregate.last_updated_ms = now_ms;
                            buf.drain(..8);
                        }
                        Err(_) => {
                            buf.remove(0);
                        }
                    }
                }
            }
            _ => {
                // 透传载荷 (0xC0, 0xC1, 0xC2 等)，暂不作内层拼包，直接消费
                buf.clear();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_reassembler_split_chunks() {
        let mut reassembler = PayloadStreamReassembler::new();
        let mut agg = MissionPayloadAggregate::new(95);

        // 模拟升压模块数据被切成两个 chunk 下发
        let full_frame = [
            0x01, 0x03, 0x09, 0x0A, 0xF0, 0x03, 0xE8, 0x27, 0x10, 0x01, 0xF4, 0x5A, 0x9A, 0xB4,
        ];
        let chunk1 = &full_frame[..6];
        let chunk2 = &full_frame[6..];

        reassembler.feed_payload(PAYLOAD_ID_BUS_SENSORS, chunk1, &mut agg, 1000);
        assert!(agg.boost_module.is_none(), "半包时不应产生完整数据");

        reassembler.feed_payload(PAYLOAD_ID_BUS_SENSORS, chunk2, &mut agg, 1001);
        assert!(agg.boost_module.is_some(), "拼包后应成功解析升压模块");
        assert_eq!(agg.boost_module.unwrap().input_voltage, 28.0);
    }
}
