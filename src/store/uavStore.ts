import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import { listen, emit, type UnlistenFn } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import type {
  UAVInfo,
  FP95Aggregate,
  FP95EventPayload,
  FP981CAggregate,
  FP981CEventPayload,
  TransponderSwitchConfig,
  TransponderSwitchReadback,
  TransponderParamConfig,
  TransponderParamReadback,
  WeightBindingConfig,
  WeightReadback
} from '@/types/entityoptions'
import {
  getFp95FlightSwitchCommand,
  type Fp95AvionicsDevice,
} from '@/utils/plane/fp95AvionicsControl'
import type { RxHealthSnapshot } from '@/types/linkHealth'

// 协议解包类型枚举
const enum Protocol {
  FP95 = "FP95",
  FP981C = "FP981C",
  UAVInfo = "UAVInfo"
}

export type SerialProtocol = Protocol.FP95 | Protocol.FP981C

export const useUavStore = defineStore('uav', () => {
  const uavInfo = ref<UAVInfo | null>(null)
  
  // UAVInfo 通道参数
  const udpName = ref('UAVInfo_UDP')
  const udpIp = ref('226.0.1.9')
  const udpPort = ref(8999)
  const udpTargetPort = ref(9001)
  const udpInterface = ref('0.0.0.0')
  const isServiceRunning = ref(false)

  // FP95 通道参数 (默认 0.0.0.0:0)
  const fp95Name = ref('FP95_UDP')
  const fp95Ip = ref('226.0.1.9')
  const fp95Port = ref(8999)
  const fp95Interface = ref('0.0.0.0')
  const isFp95Running = ref(false)

  // 主链路串口参数 (默认绑定 FP981C)
  const mainSerialName = ref('主链路')
  const mainSerialPort = ref('')
  const mainSerialBaud = ref(115200)
  const mainSerialProtocol = ref<SerialProtocol>(Protocol.FP981C)
  const isMainSerialRunning = ref(false)

  // 副链路串口参数 (默认绑定 FP981C)
  const subSerialName = ref('副链路')
  const subSerialPort = ref('')
  const subSerialBaud = ref(115200)
  const subSerialProtocol = ref<SerialProtocol>(Protocol.FP981C)
  const isSubSerialRunning = ref(false)

  // 可用串口号列表
  const availablePorts = ref<string[]>([])

  const networkInterfaces = ref<{ name: string; ip: string }[]>([])
  const rxHealth = shallowRef<RxHealthSnapshot>({ links: [], aircraft: [] })

  let unlisten: UnlistenFn | null = null
  let fp95Unlisten: UnlistenFn | null = null
  let fp95ListenPromise: Promise<void> | null = null
  let fp95ListenerGeneration = 0
  let fp95ServiceGeneration = 0
  let fp981cUnlisten: UnlistenFn | null = null
  let fp981cListenPromise: Promise<void> | null = null
  let fp981cLifecycleGeneration = 0
  let portsUnlisten: UnlistenFn | null = null
  let healthUnlisten: UnlistenFn | null = null
  let healthListenPromise: Promise<void> | null = null
  let healthListenerGeneration = 0

  function needsFp95Listening() {
    return isFp95Running.value
      || (isMainSerialRunning.value && mainSerialProtocol.value === Protocol.FP95)
      || (isSubSerialRunning.value && subSerialProtocol.value === Protocol.FP95)
  }

  function needsFp981cListening() {
    return (isMainSerialRunning.value && mainSerialProtocol.value === Protocol.FP981C)
      || (isSubSerialRunning.value && subSerialProtocol.value === Protocol.FP981C)
  }

  function needsHealthListening() {
    return isServiceRunning.value
      || isFp95Running.value
      || isMainSerialRunning.value
      || isSubSerialRunning.value
  }

  // 监听 uav-info-event 事件
  async function startListening() {
    if (unlisten) return
    unlisten = await listen<UAVInfo[]>('uav-info-event', (event) => {
     updateUavInfoList(event.payload)
    })
    console.log('前端已挂载 UAVInfo 数据监听服务')
  }

  // 监听 fp95-event 事件
  async function startFp95Listening(lifecycleGeneration: number) {
    if (fp95Unlisten) return
    if (fp95ListenPromise) {
      await fp95ListenPromise
      if (!fp95Unlisten && needsFp95Listening()) {
        await startFp95Listening(fp95ListenerGeneration)
      }
      return
    }

    const pending = (async () => {
      const candidateUnlisten = await listen<FP95EventPayload>("fp95-event", (event) => {
        //将接收到的数据给飞机的store   更新数据
        if (
          lifecycleGeneration === fp95ListenerGeneration
          && needsFp95Listening()
        ) {
          updateFp95Aggregate(event.payload)
        }
      })
      if (
        lifecycleGeneration === fp95ListenerGeneration
        && needsFp95Listening()
      ) {
        fp95Unlisten = candidateUnlisten
        console.log('前端已挂载 FP95 数据监听服务')
      } else {
        candidateUnlisten()
      }
    })()
    fp95ListenPromise = pending
    try {
      await pending
    } finally {
      if (fp95ListenPromise === pending) fp95ListenPromise = null
    }
  }

  async function startFp981cListening(lifecycleGeneration: number) {
    if (fp981cUnlisten) return
    if (fp981cListenPromise) {
      await fp981cListenPromise
      if (!fp981cUnlisten && needsFp981cListening()) {
        await startFp981cListening(fp981cLifecycleGeneration)
      }
      return
    }

    const pending = (async () => {
      const candidateUnlisten = await listen<FP981CEventPayload>("fp981c-event", (event) => {
        if (
          lifecycleGeneration === fp981cLifecycleGeneration
          && needsFp981cListening()
        ) {
          updateFp981cList(event.payload)
        }
      })
      if (
        lifecycleGeneration === fp981cLifecycleGeneration
        && needsFp981cListening()
      ) {
        fp981cUnlisten = candidateUnlisten
        console.log('前端已挂载 FP981C 数据监听服务')
      } else {
        candidateUnlisten()
      }
    })()
    fp981cListenPromise = pending
    try {
      await pending
    } finally {
      if (fp981cListenPromise === pending) fp981cListenPromise = null
    }
  }

  async function startHealthListening(lifecycleGeneration: number) {
    if (healthUnlisten) return
    if (healthListenPromise) {
      await healthListenPromise
      if (!healthUnlisten && needsHealthListening()) {
        await startHealthListening(healthListenerGeneration)
      }
      return
    }

    const pending = (async () => {
      const candidateUnlisten = await listen<RxHealthSnapshot>(
        'link-health-event',
        (event) => {
          if (
            lifecycleGeneration === healthListenerGeneration
            && needsHealthListening()
          ) {
            rxHealth.value = event.payload
          }
        },
      )
      if (
        lifecycleGeneration === healthListenerGeneration
        && needsHealthListening()
      ) {
        healthUnlisten = candidateUnlisten
        console.log('前端已挂载链路健康监听服务')
      } else {
        candidateUnlisten()
      }
    })()
    healthListenPromise = pending
    try {
      await pending
    } finally {
      if (healthListenPromise === pending) healthListenPromise = null
    }
  }
  // 停止监听 uav-info-event 事件
  function stopListening() {
    if (unlisten) {
      unlisten()
      unlisten = null
      console.log('前端已取消挂载 UAVInfo 数据监听服务')
    }
  }

  function stopFp95Listening() {
    if (fp95Unlisten) {
      fp95Unlisten()
      fp95Unlisten = null
      console.log('前端已取消挂载 FP95 数据监听服务')
    }
  }

  function stopFp981cListening() {
    if (fp981cUnlisten) {
      fp981cUnlisten()
      fp981cUnlisten = null
      console.log('前端已取消挂载 FP981C 数据监听服务')
    }
  }

  function stopHealthListening() {
    if (healthUnlisten) {
      healthUnlisten()
      healthUnlisten = null
      console.log('前端已取消挂载链路健康监听服务')
    }
  }

  function clearFp95State() {
    if (fp95Watchdog) {
      clearTimeout(fp95Watchdog)
      fp95Watchdog = null
    }
    fp95Aggregate.value = null
  }

  function deactivateUnusedProtocolListeners() {
    if (!needsFp95Listening()) {
      fp95ListenerGeneration += 1
      stopFp95Listening()
      clearFp95State()
    }
    if (!needsFp981cListening()) {
      fp981cLifecycleGeneration += 1
      stopFp981cListening()
      fp981cMap.value = new Map()
    }
    if (!needsHealthListening()) {
      healthListenerGeneration += 1
      stopHealthListening()
      rxHealth.value = { links: [], aircraft: [] }
    }
  }

  async function syncProtocolListeners() {
    deactivateUnusedProtocolListeners()
    if (needsFp95Listening()) {
      await startFp95Listening(fp95ListenerGeneration)
    }
    if (needsFp981cListening()) {
      await startFp981cListening(fp981cLifecycleGeneration)
    }
    if (needsHealthListening()) {
      await startHealthListening(healthListenerGeneration)
    }
  }

  // 启动 UAVInfo 接收服务
  async function startUavService() {
    try {
      isServiceRunning.value = true
      const status = await saveCommsConfig()
      console.log(status)
      await startListening()
    } catch (err) {
      isServiceRunning.value = false
      deactivateUnusedProtocolListeners()
      console.error('启动并保存 UAVInfo UDP 后台接收失败', err)
      throw err
    }
  }

  // 停止 UAVInfo 接收服务
  async function stopUavService() {
    try {
      isServiceRunning.value = false
      const status = await saveCommsConfig()
      console.log(status)
      stopListening()
      uavInfoMap.value = new Map()   // 清空真正渲染用的数据
      //关闭定时器
      if (uavWatchdog) {
        clearTimeout(uavWatchdog)
        uavWatchdog = null
      }
      uavInfo.value = null
    } catch (err) {
      console.error('停止并保存 UAVInfo UDP 后台接收失败', err)
      throw err
    }
  }

  // 启动 FP95 接收服务
  async function startFp95Service() {
    if (isFp95Running.value) return
    const lifecycleGeneration = ++fp95ServiceGeneration
    try {
      isFp95Running.value = true
      const status = await saveCommsConfig()
      console.log(status)
      if (
        lifecycleGeneration !== fp95ServiceGeneration
        || !isFp95Running.value
      ) return
    } catch (err) {
      if (lifecycleGeneration === fp95ServiceGeneration) {
        isFp95Running.value = false
        deactivateUnusedProtocolListeners()
      }
      console.error('启动并保存 FP95 UDP 后台接收失败', err)
      throw err
    }
  }

  // 停止 FP95 接收服务
  async function stopFp95Service() {
    fp95ServiceGeneration += 1
    isFp95Running.value = false
    deactivateUnusedProtocolListeners()

    try {
      const status = await saveCommsConfig()
      console.log(status)
    } catch (err) {
      console.error('停止并保存 FP95 UDP 后台接收失败', err)
      throw err
    }
  }

  // 监听串口热插拔事件并主动获取初始串口列表
  async function startPortsMonitoring() {
    try {
      const ports = await invoke<string[]>('get_available_ports')
      if (ports && Array.isArray(ports)) {
        availablePorts.value = ports
        if (!mainSerialPort.value && availablePorts.value.length > 0) {
          mainSerialPort.value = availablePorts.value[0]
        }
        if (!subSerialPort.value && availablePorts.value.length > 0) {
          subSerialPort.value = availablePorts.value[0]
        }
      }
    } catch (err) {
      console.error('主动拉取串口列表失败:', err)
    }

    if (portsUnlisten) return
    portsUnlisten = await listen<string[]>('ports-changed', (event) => {
      availablePorts.value = event.payload
      // 如果当前未选中串口，或者选中串口不再列表中且列表不为空，可选第一个默认填充
      if (!mainSerialPort.value && availablePorts.value.length > 0) {
        mainSerialPort.value = availablePorts.value[0]
      }
      if (!subSerialPort.value && availablePorts.value.length > 0) {
        subSerialPort.value = availablePorts.value[0]
      }
    })
    console.log('前端已挂载串口热插拔监测服务并完成初始拉取')
  }

  // 启动主链路接收服务
  async function startMainSerialService() {
    try {
      isMainSerialRunning.value = true
      const status = await saveCommsConfig()
      console.log(status)
    } catch (err) {
      isMainSerialRunning.value = false
      deactivateUnusedProtocolListeners()
      console.error('启动并保存主链路串口接收失败', err)
      throw err
    }
  }

  // 停止主链路接收服务
  async function stopMainSerialService() {
    try {
      isMainSerialRunning.value = false
      deactivateUnusedProtocolListeners()
      const status = await saveCommsConfig()
      console.log(status)
    } catch (err) {
      console.error('停止并保存主链路串口接收失败', err)
      throw err
    }
  }

  // 启动副链路接收服务
  async function startSubSerialService() {
    try {
      isSubSerialRunning.value = true
      const status = await saveCommsConfig()
      console.log(status)
    } catch (err) {
      isSubSerialRunning.value = false
      deactivateUnusedProtocolListeners()
      console.error('启动并保存副链路串口接收失败', err)
      throw err
    }
  }

  // 停止副链路接收服务
  async function stopSubSerialService() {
    try {
      isSubSerialRunning.value = false
      deactivateUnusedProtocolListeners()
      const status = await saveCommsConfig()
      console.log(status)
    } catch (err) {
      console.error('停止并保存副链路串口接收失败', err)
      throw err
    }
  }

  async function fetchNetworkInterfaces() {
    try {
      const list = await invoke<{ name: string; ip: string }[]>(
        'get_network_interfaces',
      )
      networkInterfaces.value = list
    } catch (err) {
      console.error('获取网卡列表失败', err)
      throw err
    }
  }

  // 从文件读取通信配置
  async function loadCommsConfig() {
    try {
      const config = await invoke<any>('get_comms_config')
      console.log('读取到本地通信配置:', config)
      if (config && Array.isArray(config.udp)) {
        for (const item of config.udp) {
          if (item.name === udpName.value || item.protocol === Protocol.UAVInfo) {
            if (item.ip) udpIp.value = item.ip
            if (item.port) udpPort.value = item.port
            if (item.interface_ip) udpInterface.value = item.interface_ip
            if (item.enabled !== undefined) isServiceRunning.value = item.enabled
          } else if (item.name === fp95Name.value || item.protocol === Protocol.FP95) {
            if (item.ip) fp95Ip.value = item.ip
            if (item.port) fp95Port.value = item.port
            if (item.interface_ip) fp95Interface.value = item.interface_ip
            if (item.enabled !== undefined) isFp95Running.value = item.enabled
          }
        }
      }
      if (config && Array.isArray(config.serial)) {
        for (const item of config.serial) {
          if (item.name === mainSerialName.value || item.name === '主链路') {
            if (item.port_name) mainSerialPort.value = item.port_name
            if (item.baud_rate) mainSerialBaud.value = item.baud_rate
            if (item.protocol === Protocol.FP95 || item.protocol === Protocol.FP981C) {
              mainSerialProtocol.value = item.protocol
            }
            if (item.enabled !== undefined) isMainSerialRunning.value = item.enabled
          } else if (item.name === subSerialName.value || item.name === '副链路') {
            if (item.port_name) subSerialPort.value = item.port_name
            if (item.baud_rate) subSerialBaud.value = item.baud_rate
            if (item.protocol === Protocol.FP95 || item.protocol === Protocol.FP981C) {
              subSerialProtocol.value = item.protocol
            }
            if (item.enabled !== undefined) isSubSerialRunning.value = item.enabled
          }
        }
      }
      await syncProtocolListeners()
      return config
    } catch (err) {
      console.error('从文件读取配置失败', err)
      throw err
    }
  }

  // 保存通信配置到文件并应用热重载
  async function saveCommsConfig() {
    try {
      const config = {
        udp: [
          {
            name: udpName.value,
            ip: udpIp.value,
            port: udpPort.value,
            interface_ip: udpInterface.value,
            protocol: Protocol.UAVInfo,
            enabled: isServiceRunning.value,
            auto_connect: true
          },
          {
            name: fp95Name.value,
            ip: fp95Ip.value,
            port: fp95Port.value,
            interface_ip: fp95Interface.value,
            protocol: Protocol.FP95,
            enabled: isFp95Running.value,
            auto_connect: true
          }
        ],
        serial: [
          {
            name: mainSerialName.value,
            port_name: mainSerialPort.value,
            baud_rate: mainSerialBaud.value,
            data_bits: 8,
            stop_bits: 1,
            parity: 'none',
            protocol: mainSerialProtocol.value,
            enabled: isMainSerialRunning.value,
            auto_connect: true
          },
          {
            name: subSerialName.value,
            port_name: subSerialPort.value,
            baud_rate: subSerialBaud.value,
            data_bits: 8,
            stop_bits: 1,
            parity: 'none',
            protocol: subSerialProtocol.value,
            enabled: isSubSerialRunning.value,
            auto_connect: true
          }
        ]
      }
      const res = await invoke<string>('save_comms_config', { config })
      await syncProtocolListeners()
      await emit('comms-config-changed')
      console.log('保存配置成功:', res)
      return res
    } catch (err) {
      console.error('保存通信配置失败', err)
      throw err
    }
  }

  // uavInfo无人机数据的map（key 是飞机id 唯一标识）
  const uavInfoMap = shallowRef<Map<string, UAVInfo>>(new Map())
  // fp95 单机聚合数据
  const fp95Aggregate = shallowRef<FP95Aggregate | null>(null)
  const fp981cMap = shallowRef<Map<string, FP981CAggregate>>(new Map())

  let uavWatchdog: ReturnType<typeof setTimeout> | null = null
  const UAV_TIMEOUT = 1000

  function updateUavInfoList(list: UAVInfo[]) {
    const map = new Map<string, UAVInfo>()
    for (const item of list) {
      const key = `${item.uavSeries}:${item.uavId}`
      map.set(key, item)
    }
    uavInfoMap.value = map
    if (uavWatchdog) clearTimeout(uavWatchdog)
    uavWatchdog = setTimeout(() => {
      uavInfoMap.value = new Map()
      uavWatchdog = null
    }, UAV_TIMEOUT)
  }

  let fp95Watchdog: ReturnType<typeof setTimeout> | null = null
  const FP95_TIMEOUT = 1000

  function updateFp95Aggregate(value: FP95Aggregate) {
    fp95Aggregate.value = value
    if (fp95Watchdog) clearTimeout(fp95Watchdog)
    fp95Watchdog = setTimeout(() => {
      fp95Aggregate.value = null
      fp95Watchdog = null
    }, FP95_TIMEOUT)
  }

  async function controlFp95AvionicsSwitch(
    device: Fp95AvionicsDevice,
    enabled: boolean,
  ) {
    const aggregate = fp95Aggregate.value
    if (!aggregate?.frame84) {
      throw new Error('暂无 FP95 航电开关遥测')
    }

    await invoke('submit_flight_switch_command', {
      aircraftId: aggregate.uavId,
      command: getFp95FlightSwitchCommand(device, enabled),
    })
  }

  // ==================== 应答机设置响应式数据与方法 ====================
  const transponderSwitchConfig = ref<TransponderSwitchConfig>({
    airGroundState: 0,
    df11osc: 0,
    spiState: 0,
    modeSwitch: 0,
    baroAltitudeSwitch: 0,
    adsbOutSwitch: 0,
    adsbInSwitch: 0,
  })

  const transponderSwitchReadback = ref<TransponderSwitchReadback>({
    airGroundState: '',
    df11osc: '',
    spiState: '',
    modeSwitch: '',
    baroAltitudeSwitch: '',
    adsbOutSwitch: '',
    adsbInSwitch: '',
  })

  const transponderParamConfig = ref<TransponderParamConfig>({
    aCode: [0, 0, 0, 0],
    sModeAddr: ['0x00', '0x00', '0x01'],
    aircraftCategory: 'A类',
    adsbEmitterType: '无ADS-B发射器类型信息',
    flightNumber: '',
  })

  const transponderParamReadback = ref<TransponderParamReadback>({
    aCode: '',
    sModeAddr: '',
    aircraftCategoryInfo: '',
    flightNumber: '',
  })

  const weightBindingConfig = ref<WeightBindingConfig>({
    emptyUavWeight: 0,
    emptyUavC: 0,
    loadWeight: 0,
    loadC: 0,
    oilTotal: 0,
    oilType: 4,
  })

  const weightReadback = ref<WeightReadback>({
    emptyUavWeight: 0,
    emptyUavC: 0,
    loadWeight: 0,
    loadC: 0,
    oilTotal: 0,
    oilType: 4,
  })

  const transponderOperationPending = ref(false)

  function currentFp95AircraftId() {
    const aircraftId = fp95Aggregate.value?.uavId
    if (aircraftId === undefined) {
      throw new Error('暂无 FP95 飞机遥测')
    }
    return aircraftId
  }

  async function runTransponderOperation<T>(operation: () => Promise<T>): Promise<T> {
    if (transponderOperationPending.value) {
      throw new Error('已有应答机或航管参数指令正在等待回报')
    }
    transponderOperationPending.value = true
    try {
      return await operation()
    } finally {
      transponderOperationPending.value = false
    }
  }

  async function bindTransponderSwitches(config: TransponderSwitchConfig) {
    const aircraftId = currentFp95AircraftId()
    await runTransponderOperation(async () => {
      await invoke('bind_transponder_switches', { aircraftId, config })
    })
    transponderSwitchConfig.value = { ...config }
  }

  async function queryTransponderSwitches() {
    const aircraftId = currentFp95AircraftId()
    return runTransponderOperation(async () => {
      const res = await invoke<TransponderSwitchReadback>('query_transponder_switches', { aircraftId })
      transponderSwitchReadback.value = res
      return res
    })
  }

  async function bindTransponderParams(config: TransponderParamConfig) {
    const aircraftId = currentFp95AircraftId()
    await runTransponderOperation(async () => {
      await invoke('bind_air_traffic_params', { aircraftId, config })
    })
    transponderParamConfig.value = {
      ...config,
      aCode: [...config.aCode],
      sModeAddr: [...config.sModeAddr]
    }
  }

  async function queryTransponderParams() {
    const aircraftId = currentFp95AircraftId()
    return runTransponderOperation(async () => {
      const res = await invoke<TransponderParamReadback>('query_air_traffic_params', { aircraftId })
      transponderParamReadback.value = res
      return res
    })
  }

  async function bindWeightParams(config: WeightBindingConfig) {
    const aircraftId = currentFp95AircraftId()
    await runTransponderOperation(async () => {
      await invoke('bind_weight_params', { aircraftId, config })
    })
    weightBindingConfig.value = { ...config }
  }

  async function queryWeightParams() {
    const aircraftId = currentFp95AircraftId()
    return runTransponderOperation(async () => {
      const res = await invoke<WeightReadback>('query_weight_params', { aircraftId })
      weightReadback.value = res
      weightBindingConfig.value = { ...res }
      return res
    })
  }

  function updateFp981cList(list: FP981CAggregate[]) {
    const map = new Map<string, FP981CAggregate>()
    for (const item of list) {
      if (!item.c2) continue
      map.set(String(item.uav_id), item)
    }
    fp981cMap.value = map
  }

  const isMock = ref(false)
  let mockUavTimer: ReturnType<typeof setInterval> | null = null

  function toggleMockUavInfoService() {
    if (isMock.value) stopMockUavInfoService()
    else startMockUavInfoService()
  }

  function startMockUavInfoService() {
    if (mockUavTimer) return
    isMock.value = true
    const mockUavList: UAVInfo[] = [
      {
        uavSeries: '981A',
        uavId: 1,
        longitude: 110.3312,
        latitude: 20.0311,
        altitude: 500,
        relativeAltitude: 300,
        groundSpeed: 25,
        groundSpeedDirection: 70,
        verticalSpeed: 0.5,
        airspeed: 28,
        trueAirspeed: 30,
        pitchAngle: 20,
        rollAngle: 0,
        headingAngle: 75,
        currentRouteId: 1,
        nextRouteId: 1,
        nextPoint: 2,
        distanceNext: 5000,
      },
      {
        uavSeries: '981C',
        uavId: 2,
        longitude: 109.5100,
        latitude: 18.2500,
        altitude: 500,
        relativeAltitude: 500,
        groundSpeed: 30,
        groundSpeedDirection: 45,
        verticalSpeed: -0.2,
        airspeed: 32,
        trueAirspeed: 35,
        pitchAngle: 0,
        rollAngle: 0,
        headingAngle: 43.7,
        currentRouteId: 2,
        nextRouteId: 2,
        nextPoint: 3,
        distanceNext: 8000,
      },
    ]

    updateUavInfoList(mockUavList)
    isServiceRunning.value = true

    mockUavTimer = setInterval(() => {
      mockUavList[0].longitude += 0.00008
      mockUavList[0].latitude += 0.00002
      mockUavList[0].groundSpeedDirection = 90
      mockUavList[0].distanceNext = Math.max(0, mockUavList[0].distanceNext - 25)

      mockUavList[1].longitude += 0.000015
      mockUavList[1].latitude += 0.000015
      mockUavList[1].groundSpeedDirection = 45
      mockUavList[1].distanceNext = Math.max(0, mockUavList[1].distanceNext - 30)

      updateUavInfoList(mockUavList.map((item) => ({ ...item })))
    }, 20)
    console.log('已启动 UAVInfo 模拟数据服务')
  }

  function stopMockUavInfoService() {
    if (mockUavTimer) {
      clearInterval(mockUavTimer)
      mockUavTimer = null
    }
    isMock.value = false
    isServiceRunning.value = false
    if (uavWatchdog) {
      clearTimeout(uavWatchdog)
      uavWatchdog = null
    }
    uavInfoMap.value = new Map()
    console.log('已停止 UAVInfo 模拟数据服务')
  }

  return {
    uavInfo,
    udpName,
    udpIp,
    udpPort,
    udpTargetPort,
    udpInterface,
    isServiceRunning,
    fp95Name,
    fp95Ip,
    fp95Port,
    fp95Interface,
    isFp95Running,
    mainSerialName,
    mainSerialPort,
    mainSerialBaud,
    mainSerialProtocol,
    isMainSerialRunning,
    subSerialName,
    subSerialPort,
    subSerialBaud,
    subSerialProtocol,
    isSubSerialRunning,
    availablePorts,
    networkInterfaces,
    rxHealth,
    startUavService,
    stopUavService,
    startFp95Service,
    stopFp95Service,
    startMainSerialService,
    stopMainSerialService,
    startSubSerialService,
    stopSubSerialService,
    startPortsMonitoring,
    fetchNetworkInterfaces,
    loadCommsConfig,
    saveCommsConfig,
    updateUavInfoList,
    uavInfoMap,
    updateFp95Aggregate,
    fp95Aggregate,
    controlFp95AvionicsSwitch,
    updateFp981cList,
    fp981cMap,
    transponderSwitchConfig,
    transponderSwitchReadback,
    transponderParamConfig,
    transponderParamReadback,
    transponderOperationPending,
    bindTransponderSwitches,
    queryTransponderSwitches,
    bindTransponderParams,
    queryTransponderParams,
    weightBindingConfig,
    weightReadback,
    bindWeightParams,
    queryWeightParams,
    toggleMockUavInfoService,
    syncProtocolListeners,
    startListening,
    stopListening,
    startFp95Listening,
    startFp981cListening
  }
})
