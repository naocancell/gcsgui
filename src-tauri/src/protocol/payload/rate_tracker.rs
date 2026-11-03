//! AA55 任管载荷外层及 0xC4 总线子设备帧频统计器
//!
//! 采用基于真实到达时间跨度的多点滑动窗口平滑算法，
//! 彻底消除 1Hz 等低频信号因传输抖动在固定 1 秒窗口边界引发的 1/0 与 1/2 跳变。

use serde::{Deserialize, Serialize};
use std::collections::VecDeque;

use super::outer::*;

/// 0xC4 1-3总线挂载 7 种设备的细分帧频 (Hz)
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct C4DeviceRates {
    pub boost_module: f32,       // 0x01: 100V 升压模块
    pub temp_sensor1: f32,       // 0x02: 温度采集模块 1
    pub temp_sensor2: f32,       // 0x03: 温度采集模块 2
    pub voltage_sensor: f32,     // 0x04: 电压采集模块
    pub current_sensor1: f32,    // 0x05: 电流采集模块 1
    pub current_sensor2: f32,    // 0x06: 电流采集模块 2
    pub environment_sensor: f32, // 0x07: 温湿度气压传感器
}

/// AA55 任管载荷各分类实时帧频快照 (Hz)
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PayloadFrameRates {
    pub total: f32,                // AA55 综合总帧频
    pub atmosphere: f32,           // 0xC0: 人影大气数据测量
    pub flare: f32,                // 0xC1: 人影焰条
    pub cloud_drop: f32,           // 0xC2: 人影云滴探测
    pub relay: f32,                // 0xC3: 继电器控制器
    pub bus_sensors: f32,          // 0xC4: 1-3总线传感器设备
    pub icing: f32,                // 0xC5: 结冰传感器
    pub deice: f32,                // 0xC6: 电防冰控制器
    pub c4_devices: C4DeviceRates, // 0xC4 内部 7 种子设备细分
}

/// 单个维度的滑动窗口时间戳平滑计算器
#[derive(Debug, Default, Clone)]
struct SlidingWindowRate {
    timestamps: VecDeque<u64>,
}

impl SlidingWindowRate {
    /// 统计滑动窗口（毫秒）：2500ms 窗口足以平滑覆盖带有微小抖动的低频数据流
    const WINDOW_MS: u64 = 2500;
    /// 停发/断数超时判定门限（毫秒）：超过 2000ms 未收到新帧判定为断数归零
    const IDLE_TIMEOUT_MS: u64 = 2000;

    fn record(&mut self, now_ms: u64) {
        self.timestamps.push_back(now_ms);
        self.evict_stale(now_ms);
    }

    fn evict_stale(&mut self, now_ms: u64) {
        while let Some(&front) = self.timestamps.front() {
            if now_ms.saturating_sub(front) > Self::WINDOW_MS {
                self.timestamps.pop_front();
            } else {
                break;
            }
        }
    }

    fn rate_hz(&mut self, now_ms: u64) -> f32 {
        self.evict_stale(now_ms);

        let latest = match self.timestamps.back() {
            Some(&t) => t,
            None => return 0.0,
        };

        // 超过超时门限无新帧到达，立即清空归零
        let idle = now_ms.saturating_sub(latest);
        if idle > Self::IDLE_TIMEOUT_MS {
            self.timestamps.clear();
            return 0.0;
        }

        let n = self.timestamps.len();
        if n < 2 {
            // 刚收到 1 帧时预估为 1.0Hz，超过 1.5s 无第二帧则归零
            return if idle <= 1500 { 1.0 } else { 0.0 };
        }

        let oldest = *self.timestamps.front().unwrap();
        let span_ms = latest.saturating_sub(oldest);
        if span_ms == 0 {
            return (n as f32).min(50.0);
        }

        // 真实频率：(n - 1) 个采样间隔 / 跨越时间秒数
        let mut rate = ((n - 1) as f32 * 1000.0) / (span_ms as f32);

        // 如果距离最新一帧的等待时间明显超过平均间隔，按当前累计时间平滑下调
        let avg_interval_ms = (span_ms as f32) / ((n - 1) as f32);
        if (idle as f32) > avg_interval_ms * 1.2 {
            let extended_span = now_ms.saturating_sub(oldest) as f32;
            rate = ((n - 1) as f32 * 1000.0) / extended_span;
        }

        (rate * 10.0).round() / 10.0
    }
}

/// AA55 帧频追踪统计器
#[derive(Debug, Default, Clone)]
pub struct PayloadRateTracker {
    total: SlidingWindowRate,
    atmosphere: SlidingWindowRate,
    flare: SlidingWindowRate,
    cloud_drop: SlidingWindowRate,
    relay: SlidingWindowRate,
    bus_sensors: SlidingWindowRate,
    icing: SlidingWindowRate,
    deice: SlidingWindowRate,
    // 0xC4 子设备 (0x01 ~ 0x07)
    boost_module: SlidingWindowRate,
    temp_sensor1: SlidingWindowRate,
    temp_sensor2: SlidingWindowRate,
    voltage_sensor: SlidingWindowRate,
    current_sensor1: SlidingWindowRate,
    current_sensor2: SlidingWindowRate,
    environment_sensor: SlidingWindowRate,
}

impl PayloadRateTracker {
    pub fn new() -> Self {
        Self::default()
    }

    /// 记录一帧成功解包的 AA55 外层报文
    pub fn record_outer(&mut self, payload_id: u8, now_ms: u64) {
        self.total.record(now_ms);
        match payload_id {
            PAYLOAD_ID_ATMOSPHERE => self.atmosphere.record(now_ms),
            PAYLOAD_ID_FLARE => self.flare.record(now_ms),
            PAYLOAD_ID_CLOUD_DROP => self.cloud_drop.record(now_ms),
            PAYLOAD_ID_RELAY => self.relay.record(now_ms),
            PAYLOAD_ID_BUS_SENSORS => self.bus_sensors.record(now_ms),
            PAYLOAD_ID_ICING => self.icing.record(now_ms),
            PAYLOAD_ID_DEICE => self.deice.record(now_ms),
            _ => {}
        }
    }

    /// 记录 0xC4 内部成功解析的一个子设备报文
    pub fn record_c4_device(&mut self, device_id: u8, now_ms: u64) {
        match device_id {
            0x01 => self.boost_module.record(now_ms),
            0x02 => self.temp_sensor1.record(now_ms),
            0x03 => self.temp_sensor2.record(now_ms),
            0x04 => self.voltage_sensor.record(now_ms),
            0x05 => self.current_sensor1.record(now_ms),
            0x06 => self.current_sensor2.record(now_ms),
            0x07 => self.environment_sensor.record(now_ms),
            _ => {}
        }
    }

    /// 获取当前即时帧频快照 (Hz)
    pub fn snapshot(&mut self, now_ms: u64) -> PayloadFrameRates {
        PayloadFrameRates {
            total: self.total.rate_hz(now_ms),
            atmosphere: self.atmosphere.rate_hz(now_ms),
            flare: self.flare.rate_hz(now_ms),
            cloud_drop: self.cloud_drop.rate_hz(now_ms),
            relay: self.relay.rate_hz(now_ms),
            bus_sensors: self.bus_sensors.rate_hz(now_ms),
            icing: self.icing.rate_hz(now_ms),
            deice: self.deice.rate_hz(now_ms),
            c4_devices: C4DeviceRates {
                boost_module: self.boost_module.rate_hz(now_ms),
                temp_sensor1: self.temp_sensor1.rate_hz(now_ms),
                temp_sensor2: self.temp_sensor2.rate_hz(now_ms),
                voltage_sensor: self.voltage_sensor.rate_hz(now_ms),
                current_sensor1: self.current_sensor1.rate_hz(now_ms),
                current_sensor2: self.current_sensor2.rate_hz(now_ms),
                environment_sensor: self.environment_sensor.rate_hz(now_ms),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_payload_rate_tracker_sliding_window_and_decay() {
        let mut tracker = PayloadRateTracker::new();

        // 模拟 1Hz 带抖动的电防冰帧（间隔 1020ms, 990ms 等）
        tracker.record_outer(PAYLOAD_ID_DEICE, 0);
        tracker.record_outer(PAYLOAD_ID_DEICE, 1020);
        tracker.record_outer(PAYLOAD_ID_DEICE, 2010);

        // 模拟 0xC4 传感器总线帧
        tracker.record_outer(PAYLOAD_ID_BUS_SENSORS, 500);
        tracker.record_outer(PAYLOAD_ID_BUS_SENSORS, 1500);
        tracker.record_c4_device(0x01, 500);
        tracker.record_c4_device(0x01, 1500);

        // 在各个采样点测试：电防冰稳定在 1.0Hz，绝无 0 或 2 跳变
        let snap1 = tracker.snapshot(1050);
        assert_eq!(snap1.deice, 1.0);

        let snap2 = tracker.snapshot(1500);
        assert_eq!(snap2.deice, 1.0);
        assert_eq!(snap2.bus_sensors, 1.0);
        assert_eq!(snap2.c4_devices.boost_module, 1.0);

        let snap3 = tracker.snapshot(2050);
        assert_eq!(snap3.deice, 1.0);

        // 时间流逝超过超时门限（最后帧为 2010ms，当前 4500ms > 2000ms 门限）：自动归零
        let snap_decay = tracker.snapshot(4500);
        assert_eq!(snap_decay.total, 0.0);
        assert_eq!(snap_decay.deice, 0.0);
        assert_eq!(snap_decay.bus_sensors, 0.0);
        assert_eq!(snap_decay.c4_devices.boost_module, 0.0);
    }
}
