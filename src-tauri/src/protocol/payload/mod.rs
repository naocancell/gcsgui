pub mod ice_c5;
pub mod outer;
pub mod relay_c3;
pub mod sensors_c4;

pub use crate::protocol::fp95::FP95Frame94Sub2;
pub use ice_c5::*;
pub use outer::*;
pub use relay_c3::*;
pub use sensors_c4::*;

use serde::{Deserialize, Serialize};
use bytes::{Buf, BytesMut};
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
    pub deice: Option<FP95Frame94Sub2>,
    pub last_updated_ms: u64,
    /// 各子设备最近一次成功解析的时间（Unix ms），用于单设备掉线判定
    #[serde(default)]
    pub device_updated_ms: PayloadDeviceTimestamps,
}

/// 任管载荷数据在状态池中的机号。
///
/// 任管-载荷外层协议（AA 55）不携带飞机 ID，当前按单机部署固定为 95，
/// 前端 payloadStore 的默认 activeUavId 与此保持一致。
pub const MISSION_PAYLOAD_UAV_ID: u8 = 95;

/// 载荷子设备单独的数据新鲜度时间戳（Unix ms，`None` 表示从未收到）
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PayloadDeviceTimestamps {
    pub relay: Option<u64>,
    pub boost_module: Option<u64>,
    pub temp_sensor1: Option<u64>,
    pub temp_sensor2: Option<u64>,
    pub voltage_sensor: Option<u64>,
    pub current_sensor1: Option<u64>,
    pub current_sensor2: Option<u64>,
    pub environment_sensor: Option<u64>,
    pub icing_sensor: Option<u64>,
    pub deice: Option<u64>,
}

/// 单个载荷子设备超过该时长未更新即视为掉线，清空其数据（与整机死链剔除阈值一致）
pub const PAYLOAD_DEVICE_STALE_MS: u64 = 10_000;

/// 当前 Unix 时间（ms），载荷聚合时间戳统一使用该时钟
pub fn unix_now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn is_stale(updated_ms: Option<u64>, now_ms: u64, timeout_ms: u64) -> bool {
    updated_ms.is_some_and(|t| now_ms.saturating_sub(t) > timeout_ms)
}

impl MissionPayloadAggregate {
    pub fn new(uav_id: u8) -> Self {
        Self {
            uav_id,
            ..Default::default()
        }
    }

    /// 清空超时未更新的子设备数据，避免单个设备掉线后仍显示最后一次的值。
    ///
    /// 返回被清空的子设备数量。时间戳保留，便于前端区分“从未收到”和“已掉线”。
    pub fn prune_stale_devices(&mut self, now_ms: u64, timeout_ms: u64) -> usize {
        let ts = self.device_updated_ms;
        let mut pruned = 0;
        macro_rules! prune {
            ($field:ident) => {
                if self.$field.is_some() && is_stale(ts.$field, now_ms, timeout_ms) {
                    self.$field = None;
                    pruned += 1;
                }
            };
        }
        prune!(relay);
        prune!(boost_module);
        prune!(temp_sensor1);
        prune!(temp_sensor2);
        prune!(voltage_sensor);
        prune!(current_sensor1);
        prune!(current_sensor2);
        prune!(environment_sensor);
        prune!(icing_sensor);
        prune!(deice);
        pruned
    }
}

/// 针对各载荷 ID 的流式分包重组与解析器
///
/// 协议指出：各载荷数据轮流下传，且下传的数据可能不是完整包数据。
/// 本重组器按载荷 ID 独立维护重组缓冲区，防止轮流下发时数据包交叉污染。
#[derive(Debug, Default)]
pub struct PayloadStreamReassembler {
    /// 按载荷 ID 分别缓冲；BytesMut::advance 丢弃头部字节为 O(1)，不搬移剩余数据
    buffers: HashMap<u8, BytesMut>,
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
                        buf.advance(1);
                        continue;
                    }
                    let fc = buf[1];
                    let needed_len = if fc == FC_READ_COILS {
                        7
                    } else if fc == FC_WRITE_COILS {
                        8
                    } else {
                        buf.advance(1);
                        continue;
                    };

                    if buf.len() < needed_len {
                        break;
                    }

                    let frame = buf[..needed_len].to_vec();
                    if let Ok(Some(status)) = parse_relay_response(&frame) {
                        aggregate.relay = Some(status);
                        aggregate.device_updated_ms.relay = Some(now_ms);
                        aggregate.last_updated_ms = now_ms;
                        buf.advance(needed_len);
                    } else if parse_relay_response(&frame).is_ok() {
                        // 写线圈确认，消费掉
                        buf.advance(needed_len);
                    } else {
                        // 校验失败，滑动 1 字节
                        buf.advance(1);
                    }
                }
            }
            PAYLOAD_ID_BUS_SENSORS => {
                // 0xC4 1-3总线设备：设备ID 0x01~0x07，功能码 0x03
                while buf.len() >= 5 {
                    let dev_id = buf[0];
                    let fc = buf[1];
                    if !(1..=7).contains(&dev_id) || fc != 0x03 {
                        buf.advance(1);
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
                        buf.advance(1);
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
                                    aggregate.boost_module = Some(d);
                                    aggregate.device_updated_ms.boost_module = Some(now_ms);
                                }
                                Bus0xC4DeviceData::TempSensor1(d) => {
                                    aggregate.temp_sensor1 = Some(d);
                                    aggregate.device_updated_ms.temp_sensor1 = Some(now_ms);
                                }
                                Bus0xC4DeviceData::TempSensor2(d) => {
                                    aggregate.temp_sensor2 = Some(d);
                                    aggregate.device_updated_ms.temp_sensor2 = Some(now_ms);
                                }
                                Bus0xC4DeviceData::VoltageSensor(d) => {
                                    aggregate.voltage_sensor = Some(d);
                                    aggregate.device_updated_ms.voltage_sensor = Some(now_ms);
                                }
                                Bus0xC4DeviceData::CurrentSensor1(d) => {
                                    aggregate.current_sensor1 = Some(d);
                                    aggregate.device_updated_ms.current_sensor1 = Some(now_ms);
                                }
                                Bus0xC4DeviceData::CurrentSensor2(d) => {
                                    aggregate.current_sensor2 = Some(d);
                                    aggregate.device_updated_ms.current_sensor2 = Some(now_ms);
                                }
                                Bus0xC4DeviceData::EnvironmentSensor(d) => {
                                    aggregate.environment_sensor = Some(d);
                                    aggregate.device_updated_ms.environment_sensor = Some(now_ms);
                                }
                            }
                            aggregate.last_updated_ms = now_ms;
                            buf.advance(needed_len);
                        }
                        Err(_) => {
                            buf.advance(1);
                        }
                    }
                }
            }
            PAYLOAD_ID_ICING => {
                // 0xC5 结冰传感器：8 字节定长，0xEB 0x90 开头
                while buf.len() >= 8 {
                    if buf[0] != 0xEB || buf[1] != 0x90 {
                        buf.advance(1);
                        continue;
                    }
                    let frame = buf[..8].to_vec();
                    match parse_icing_frame(&frame) {
                        Ok(data) => {
                            aggregate.icing_sensor = Some(data);
                            aggregate.device_updated_ms.icing_sensor = Some(now_ms);
                            aggregate.last_updated_ms = now_ms;
                            buf.advance(8);
                        }
                        Err(_) => {
                            buf.advance(1);
                        }
                    }
                }
            }
            PAYLOAD_ID_DEICE => {
                // 0xC6 电防冰控制器：14 字节定长，0xEB 0x90 开头，14字节累加和 MOD 256 = 0
                while buf.len() >= 14 {
                    if buf[0] != 0xEB || buf[1] != 0x90 {
                        buf.advance(1);
                        continue;
                    }
                    let sum: u32 = buf[..14].iter().map(|&b| b as u32).sum();
                    if (sum % 256) != 0 {
                        buf.advance(1);
                        continue;
                    }
                    let frame = &buf[..14];
                    match FP95Frame94Sub2::from_bytes(frame) {
                        Ok(data) => {
                            aggregate.deice = Some(data);
                            aggregate.device_updated_ms.deice = Some(now_ms);
                            aggregate.last_updated_ms = now_ms;
                            buf.advance(14);
                        }
                        Err(_) => {
                            buf.advance(1);
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

    #[test]
    fn test_prune_stale_devices_only_clears_expired_device() {
        let mut reassembler = PayloadStreamReassembler::new();
        let mut agg = MissionPayloadAggregate::new(95);
        let boost_frame = [
            0x01, 0x03, 0x09, 0x0A, 0xF0, 0x03, 0xE8, 0x27, 0x10, 0x01, 0xF4, 0x5A, 0x9A, 0xB4,
        ];
        reassembler.feed_payload(PAYLOAD_ID_BUS_SENSORS, &boost_frame, &mut agg, 1_000);
        assert_eq!(agg.device_updated_ms.boost_module, Some(1_000));

        // 另一个设备在更晚时刻刷新
        agg.relay = Some(RelayStatus::from_u16(0x00FF));
        agg.device_updated_ms.relay = Some(9_000);

        // 未超时：都保留
        assert_eq!(agg.prune_stale_devices(10_000, PAYLOAD_DEVICE_STALE_MS), 0);
        assert!(agg.boost_module.is_some());

        // 升压模块超时被清空，继电器仍新鲜
        assert_eq!(agg.prune_stale_devices(11_001, PAYLOAD_DEVICE_STALE_MS), 1);
        assert!(agg.boost_module.is_none());
        assert!(agg.relay.is_some());
        // 时间戳保留，用于区分“从未收到”和“已掉线”
        assert_eq!(agg.device_updated_ms.boost_module, Some(1_000));
    }

    #[test]
    fn test_reassembler_deice_payload() {
        let mut reassembler = PayloadStreamReassembler::new();
        let mut agg = MissionPayloadAggregate::new(95);

        // 构造一包合法的 14 字节防除冰控制器数据 (恒功率模式 2000W)
        // 0: EB 1: 90 2..3: 07 D0 (2000) 4..5: 07 D0 (2000) 6: 02 (恒功率)
        // 7: 00 8: 00 9: 32 (50 - 45 = 5℃) 10: 8C (140 * 0.2 = 28V) 11: 18 (24 * 0.2 = 4.8A) 12: 01 (帧计数)
        let mut deice_frame = [
            0xEB, 0x90, 0xD0, 0x07, 0xD0, 0x07, 0x02, 0x00, 0x00, 0x32, 0x8C, 0x18, 0x01, 0x00,
        ];
        let sum: u32 = deice_frame[..13].iter().map(|&b| b as u32).sum();
        deice_frame[13] = ((256 - (sum % 256)) % 256) as u8;

        // 分两片传入
        reassembler.feed_payload(PAYLOAD_ID_DEICE, &deice_frame[..8], &mut agg, 2000);
        assert!(agg.deice.is_none(), "半包不应解析");

        reassembler.feed_payload(PAYLOAD_ID_DEICE, &deice_frame[8..], &mut agg, 2001);
        assert!(agg.deice.is_some(), "拼包后应成功解析防冰数据");
        let d = agg.deice.as_ref().unwrap();
        assert_eq!(d.work_mode, 0x02);
        assert_eq!(d.work_mode_desc, "恒功率模式");
        assert_eq!(d.target_power, 2000);
        assert_eq!(d.current_power, 2000);
        assert!(d.checksum_valid);
    }
}
