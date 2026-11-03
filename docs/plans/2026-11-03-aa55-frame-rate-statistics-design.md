# AA55 帧频统计与防除冰页面显示设计方案

## 1. 需求与目标
在地面测控站系统中，针对链路混收数据流中的任管载荷帧（帧头 `0xAA 0x55`）实现独立的接收帧频（Hz）统计功能。
统计需要涵盖：
1. **AA55 总帧频**（Hz）。
2. **按外层载荷 ID 划分的帧频**：
   - 0xC0: 人影大气数据测量 (Atmosphere)
   - 0xC1: 人影焰条 (Flare)
   - 0xC2: 人影云滴探测 (CloudDrop)
   - 0xC3: 继电器控制器 (Relay)
   - 0xC4: 1-3总线传感器设备 (BusSensors)
   - 0xC5: 结冰传感器 (Icing)
   - 0xC6: 电防冰控制器 (Deice)
3. **0xC4 内部挂载 7 种子设备的细分帧频**：
   - 0x01: 100V 升压模块 (BoostModule)
   - 0x02: 温度采集模块 1 (TempSensor1)
   - 0x03: 温度采集模块 2 (TempSensor2)
   - 0x04: 电压采集模块 (VoltageSensor)
   - 0x05: 电流采集模块 1 (CurrentSensor1)
   - 0x06: 电流采集模块 2 (CurrentSensor2)
   - 0x07: 温湿压传感器 (EnvironmentSensor)
4. **展示位置**：
   - 防除冰监控大屏页面（`DeicePanel.vue`）顶栏状态区域，以状态徽章（Chip）展示 AA55 综合帧频，悬停/点击弹出 Popover 卡片展示分类及 0xC4 细分帧频明细。

## 2. 后端设计 (Rust)

### 2.1 统计模型与算法
采用 1 秒滑动窗口（Sliding Window）算法，记录最近 1000ms 内各类型接收成功的有效帧数量：
- 单机/全局维护 `PayloadRateTracker`。
- 采用微秒级/毫秒级时间戳双端队列或时间槽，记录每次合法到达时间。在获取快照时剔除超过 1000ms 的旧数据，即时计算出当前精确的瞬时帧频（$Hz = N_{1s}$）。
- 超过 1 秒无新数据时自动衰减归零。

### 2.2 数据模型
```rust
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PayloadFrameRates {
    pub total: f32,
    pub atmosphere: f32,
    pub flare: f32,
    pub cloud_drop: f32,
    pub relay: f32,
    pub bus_sensors: f32,
    pub icing: f32,
    pub deice: f32,
    pub c4_devices: C4DeviceRates,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct C4DeviceRates {
    pub boost_module: f32,
    pub temp_sensor1: f32,
    pub temp_sensor2: f32,
    pub voltage_sensor: f32,
    pub current_sensor1: f32,
    pub current_sensor2: f32,
    pub environment_sensor: f32,
}
```
合入 `MissionPayloadAggregate` 中 `frame_rates: Option<PayloadFrameRates>` 字段。

### 2.3 采样接入点
1. **AA55 外层报文到达**：`link_manager.rs` 中的 `process_payload_frame`。解包 `PayloadOuterFrame` 校验通过后，调用 `tracker.record_outer(outer.payload_id, now_ms)`。
2. **0xC4 内层子设备解析成功**：`mod.rs` 中 `PayloadStreamReassembler::feed_payload`。当 0xC4 Modbus 报文通过 CRC 校验并解析出特定子设备时，调用 `tracker.record_c4(dev_id, now_ms)`。
3. **快照生成**：在合入 `MissionPayloadAggregate` 或定时推送（10Hz）时，生成当前帧频快照。

## 3. 前端设计 (Vue + TS)

### 3.1 Store 与类型定义 (`payloadStore.ts`)
- 在 TS 类型中增加 `PayloadFrameRates` 与 `C4DeviceRates`。
- `usePayloadStore` 提供 `frameRates` 响应式计算属性。

### 3.2 界面展示 (`DeicePanel.vue`)
- 在顶栏 `header-chips` 区域增加 `chip`：
  - 正常接收时显示绿色小圆点/数值，如 `AA55 帧频 8.2 Hz`。
  - 掉线或 0 Hz 时显示为普通中性样式。
  - 结合 `n-popover` 弹出详情列表，两列网格展示：
    - 外层各 ID 实时 Hz
    - 0xC4 总线设备各子设备实时 Hz
