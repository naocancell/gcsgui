import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { listen, emit, type UnlistenFn } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import type {
  UAVInfo,
  FP95Aggregate,
  FP95EventPayload,
  FP95Frame94Sub1,
  FP95Frame94Sub2,
  FP981CAggregate,
  FP981CEventPayload,
  TransponderSwitchConfig,
  TransponderSwitchReadback,
  TransponderParamConfig,
  TransponderParamReadback,
  WeightBindingConfig,
  WeightReadback,
} from '@/types/entityoptions'
import {
  getFp95FlightSwitchCommand,
  type Fp95AvionicsDevice,
} from '@/utils/plane/fp95AvionicsControl'
import { isValidTransponderTarget } from '@/utils/plane/planeAdapter'
import {
  guidancePosition,
  type SimulatedGuidance,
} from '@/utils/map/simulatedGuidance'
import type { RxHealthSnapshot } from '@/types/linkHealth'
import {
  createDefaultLinkDrafts,
  createLinkDraft,
  fromCommsConfig,
  toCommsConfig,
  validateLinkDrafts,
  type LinkDraft,
  type LinkKind,
  type PersistedCommsConfig,
} from './commsConfig'

export const useUavStore = defineStore('uav', () => {
  const uavInfo = shallowRef<UAVInfo | null>(null)

  const links = ref<LinkDraft[]>(createDefaultLinkDrafts())

  const findLink = (predicate: (link: LinkDraft) => boolean) =>
    links.value.find(predicate)
  const uavInfoLink = computed(() =>
    findLink((link) => link.kind !== 'serial' && link.protocol === 'UAVInfo'),
  )
  const fp95UdpLink = computed(() =>
    findLink((link) => link.kind !== 'serial' && link.protocol === 'FP95'),
  )
  const mainSerialLink = computed(
    () =>
      findLink((link) => link.kind === 'serial' && link.name === '主链路') ??
      findLink((link) => link.kind === 'serial'),
  )
  const subSerialLink = computed(() => {
    const serialLinks = links.value.filter((link) => link.kind === 'serial')
    return (
      serialLinks.find((link) => link.name === '副链路') ??
      serialLinks[1] ??
      serialLinks[0]
    )
  })

  // 保留路由下发使用的兼容名称，真正的配置来源是 links。
  const udpName = computed(() => uavInfoLink.value?.name ?? 'UAVInfo_UDP')
  const isServiceRunning = computed(() => uavInfoLink.value?.enabled ?? false)
  const isFp95Running = computed(() => fp95UdpLink.value?.enabled ?? false)

  // 可用串口号列表
  const availablePorts = ref<string[]>([])

  const networkInterfaces = ref<{ name: string; ip: string }[]>([])
  // 链路健康数据
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
  // 检查当前通信链路列表中，是否存在一个“启用状态 + 协议是 FP95”的链路
  function needsFp95Listening() {
    // some() 是 JavaScript 数组方法  是否有满足条件的链路
    return links.value.some((link) => link.enabled && link.protocol === 'FP95')
  }

  function needsFp981cListening() {
    return links.value.some(
      (link) => link.enabled && link.protocol === 'FP981C',
    )
  }

  function needsUavInfoListening() {
    return links.value.some(
      (link) => link.enabled && link.protocol === 'UAVInfo',
    )
  }

  function needsHealthListening() {
    return links.value.some((link) => link.enabled)
  }

  // 监听 uav-info-event 事件
  async function startListening() {
    if (!needsUavInfoListening()) return
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
      const candidateUnlisten = await listen<FP95EventPayload>(
        'fp95-event',
        (event) => {
          //将接收到的数据给飞机的store   更新数据
          if (
            lifecycleGeneration === fp95ListenerGeneration &&
            needsFp95Listening()
          ) {
            updateFp95Aggregate(event.payload)
          }
        },
      )
      if (
        lifecycleGeneration === fp95ListenerGeneration &&
        needsFp95Listening()
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
      const candidateUnlisten = await listen<FP981CEventPayload>(
        'fp981c-event',
        (event) => {
          if (
            lifecycleGeneration === fp981cLifecycleGeneration &&
            needsFp981cListening()
          ) {
            updateFp981cList(event.payload)
          }
        },
      )
      if (
        lifecycleGeneration === fp981cLifecycleGeneration &&
        needsFp981cListening()
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
  //让当前窗口安全地订阅 Rust 后端发送的无人机健康状态数据，并保证不会重复监听、不会并发启动
  //后端发来的最新健康数据，原封不动地赋值给前端的响应式变量 rxHealth。
  async function startHealthListening(lifecycleGeneration: number) {
    // 健康监听已经存在，就不要再次启动，直接退出这个函数
    if (healthUnlisten) return
    //正在启动 防止再次启动
    if (healthListenPromise) {
      await healthListenPromise
      if (!healthUnlisten && needsHealthListening()) {
        await startHealthListening(healthListenerGeneration)
      }
      return
    }
    //创建异步函数 并立即执行
    const pending = (async () => {
      // 暂存的取消监听句柄
      const candidateUnlisten = await listen<RxHealthSnapshot>(
        'link-health-event',
        (event) => {
          if (
            //lifecycleGeneration内部  healthListenerGeneration全局
            lifecycleGeneration === healthListenerGeneration &&
            needsHealthListening()
          ) {
            rxHealth.value = event.payload
          }
        },
      )
      if (
        lifecycleGeneration === healthListenerGeneration &&
        needsHealthListening()
      ) {
        //保存取消链路健康监听句柄到全局
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
    clearTransponderState()
  }

  //自动识别并关闭当前配置下不再需要的协议监听服务，同时清理残留状态数据，
  // 并通过递增版本号防止过时的异步数据返回后污染界面
  function deactivateUnusedProtocolListeners() {
    if (!needsFp95Listening()) {
      //版本控制 防止异步旧数据返回
      fp95ListenerGeneration += 1
      stopFp95Listening()
      clearFp95State()
    }
    if (!needsFp981cListening()) {
      fp981cLifecycleGeneration += 1
      stopFp981cListening()
      fp981cMap.value = new Map()
    }
    //有激活的链路就需要 链路健康状态”的监听
    if (!needsHealthListening()) {
      healthListenerGeneration += 1
      stopHealthListening()
      rxHealth.value = { links: [], aircraft: [] }
    }
  }

  async function syncProtocolListeners() {
    //检查不用的服务 停止前端监听服务 残留状态数据
    deactivateUnusedProtocolListeners()
    //开启需要的前端监听服务
    if (needsUavInfoListening()) {
      await startListening()
    } else {
      stopListening()
    }
    if (needsFp95Listening()) {
      await startFp95Listening(fp95ListenerGeneration)
    }
    if (needsFp981cListening()) {
      await startFp981cListening(fp981cLifecycleGeneration)
    }
    if (needsHealthListening()) {
      //开启健康链路监听
      await startHealthListening(healthListenerGeneration)
    }
  }

  async function setLegacyLinkEnabled(
    link: LinkDraft | undefined,
    enabled: boolean,
    errorMessage: string,
  ) {
    if (!link) return
    const previous = link.enabled
    link.enabled = enabled
    try {
      const status = await saveCommsConfig()
      console.log(status)
    } catch (err) {
      link.enabled = previous
      deactivateUnusedProtocolListeners()
      console.error(errorMessage, err)
      throw err
    }
  }

  // 保留旧调用方的服务控制函数，配置本身由动态 links 列表维护。
  async function startUavService() {
    await setLegacyLinkEnabled(
      uavInfoLink.value,
      true,
      '启动并保存 UAVInfo UDP 后台接收失败',
    )
  }

  async function stopUavService() {
    await setLegacyLinkEnabled(
      uavInfoLink.value,
      false,
      '停止并保存 UAVInfo UDP 后台接收失败',
    )
    stopListening()
    uavInfoMap.value = new Map()
    if (uavWatchdog) {
      clearTimeout(uavWatchdog)
      uavWatchdog = null
    }
    uavInfo.value = null
  }

  async function startFp95Service() {
    if (isFp95Running.value) return
    const lifecycleGeneration = ++fp95ServiceGeneration
    try {
      await setLegacyLinkEnabled(
        fp95UdpLink.value,
        true,
        '启动并保存 FP95 UDP 后台接收失败',
      )
      if (lifecycleGeneration !== fp95ServiceGeneration || !isFp95Running.value)
        return
    } catch (err) {
      if (lifecycleGeneration === fp95ServiceGeneration) {
        deactivateUnusedProtocolListeners()
      }
      throw err
    }
  }

  async function stopFp95Service() {
    fp95ServiceGeneration += 1
    await setLegacyLinkEnabled(
      fp95UdpLink.value,
      false,
      '停止并保存 FP95 UDP 后台接收失败',
    )
    clearFp95State()
  }

  // 监听串口热插拔事件并主动获取初始串口列表
  async function startPortsMonitoring() {
    const fillEmptySerialPorts = () => {
      const firstPort = availablePorts.value[0]
      if (!firstPort) return
      links.value
        .filter((link) => link.kind === 'serial' && !link.portName)
        .forEach((link) => {
          link.portName = firstPort
        })
    }

    try {
      const ports = await invoke<string[]>('get_available_ports')
      if (ports && Array.isArray(ports)) {
        availablePorts.value = ports
        fillEmptySerialPorts()
      }
    } catch (err) {
      console.error('主动拉取串口列表失败:', err)
    }

    if (portsUnlisten) return
    portsUnlisten = await listen<string[]>('ports-changed', (event) => {
      availablePorts.value = event.payload
      // 如果当前未选中串口，或者选中串口不再列表中且列表不为空，可选第一个默认填充
      fillEmptySerialPorts()
    })
    console.log('前端已挂载串口热插拔监测服务并完成初始拉取')
  }

  async function startMainSerialService() {
    await setLegacyLinkEnabled(
      mainSerialLink.value,
      true,
      '启动并保存主链路串口接收失败',
    )
  }

  async function stopMainSerialService() {
    await setLegacyLinkEnabled(
      mainSerialLink.value,
      false,
      '停止并保存主链路串口接收失败',
    )
  }

  async function startSubSerialService() {
    await setLegacyLinkEnabled(
      subSerialLink.value,
      true,
      '启动并保存副链路串口接收失败',
    )
  }

  async function stopSubSerialService() {
    await setLegacyLinkEnabled(
      subSerialLink.value,
      false,
      '停止并保存副链路串口接收失败',
    )
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

  function addLink(kind: LinkKind = 'udp-multicast') {
    const prefix = kind === 'serial' ? '串口链路' : 'UDP链路'
    let index = links.value.length + 1
    while (links.value.some((link) => link.name === `${prefix}${index}`)) {
      index += 1
    }
    const link = createLinkDraft(kind, index)
    links.value.push(link)
    return link
  }

  function removeLink(id: string) {
    const index = links.value.findIndex((link) => link.id === id)
    if (index >= 0) links.value.splice(index, 1)
  }

  function updateLinkKind(link: LinkDraft, kind: LinkKind) {
    link.kind = kind
    if (kind === 'serial' && link.protocol === 'UAVInfo') {
      link.protocol = 'FP981C'
    }
    if (kind === 'udp-multicast' && !link.ip) {
      link.ip = '226.0.1.9'
    }
    if (kind === 'udp-unicast' && !link.ip) {
      link.ip = '127.0.0.1'
    }
  }

  async function loadCommsConfig() {
    try {
      //读取本地配置文件comms.js文件
      const config = await invoke<PersistedCommsConfig>('get_comms_config')
      console.log('读取到本地通信配置:', config)
      if (config?.udp?.length || config?.serial?.length) {
        // 读取并整理这个配置文件 输一个链路描述数组
        links.value = fromCommsConfig(config)
      } else {
        links.value = createDefaultLinkDrafts()
      }
      // 统一启停各类协议监听服务，使实际运行的监听状态与业务需求保持同步
      await syncProtocolListeners()
      return config
    } catch (err) {
      console.error('从文件读取配置失败', err)
      throw err
    }
  }

  async function saveCommsConfig() {
    try {
      const validationError = validateLinkDrafts(links.value)
      if (validationError) throw new Error(validationError)

      const config = toCommsConfig(links.value)
      const res = await invoke<string>('save_comms_config', { config })
      await syncProtocolListeners()
      await emit('comms-config-changed')
      // 保存配置并启动链路后，同步上行配置上下文（设置机号）
      const aircraftId = currentFp95AircraftId() ?? 0
      try {
        await invoke('configure_uplink', {
          context: {
            destination: 0x02,
            source: 0x01,
            aircraftId,
            dataSource: 0xaa,
          },
        })
      } catch (err) {
        console.warn('同步上行上下文失败:', err)
      }
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
  // fp95 94帧子帧2防除冰控制器响应式数据
  const fp95Deice = computed<FP95Frame94Sub2 | null>(
    () => fp95Aggregate.value?.frame94?.Sub2 ?? null,
  )
  const fp981cMap = shallowRef<Map<string, FP981CAggregate>>(new Map())
  // 应答机目标池（key = sAddress，value = { data, lastSeen }）
  const transponderMap = shallowRef<Map<string, FP95Frame94Sub1>>(new Map())
  const transponderSeen = new Map<string, number>()
  const transponderFrame94Sequence = new Map<number, number>()
  const transponderFrame94Fingerprint = new Map<number, string>()
  const TRANSPONDER_TIMEOUT = 10_000
  let transponderEvictionTimer: ReturnType<typeof setTimeout> | null = null

  function clearTransponderState() {
    if (transponderEvictionTimer) {
      clearTimeout(transponderEvictionTimer)
      transponderEvictionTimer = null
    }
    transponderMap.value = new Map()
    transponderSeen.clear()
    transponderFrame94Sequence.clear()
    transponderFrame94Fingerprint.clear()
  }

  function evictExpiredTransponderTargets(now: number) {
    const next = new Map(transponderMap.value)
    for (const [addr, lastSeen] of transponderSeen) {
      if (now - lastSeen >= TRANSPONDER_TIMEOUT) {
        next.delete(addr)
        transponderSeen.delete(addr)
      }
    }
    if (next.size !== transponderMap.value.size) {
      transponderMap.value = next
    }
  }

  function scheduleTransponderEviction() {
    if (transponderEvictionTimer) {
      clearTimeout(transponderEvictionTimer)
      transponderEvictionTimer = null
    }

    let nextExpiry = Number.POSITIVE_INFINITY
    for (const lastSeen of transponderSeen.values()) {
      nextExpiry = Math.min(nextExpiry, lastSeen + TRANSPONDER_TIMEOUT)
    }
    if (!Number.isFinite(nextExpiry)) return

    transponderEvictionTimer = setTimeout(
      () => {
        transponderEvictionTimer = null
        evictExpiredTransponderTargets(Date.now())
        scheduleTransponderEviction()
      },
      Math.max(0, nextExpiry - Date.now()),
    )
  }

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

  function updateFp95Aggregate(value: FP95EventPayload) {
    const prevFrame94 = fp95Aggregate.value?.frame94
    const nextFrame94 = value.frame94
      ? {
          ...(prevFrame94 || {}),
          ...value.frame94,
          Sub1: value.frame94.Sub1 ?? prevFrame94?.Sub1 ?? null,
          Sub2: value.frame94.Sub2 ?? prevFrame94?.Sub2 ?? null,
        }
      : prevFrame94

    fp95Aggregate.value = {
      ...value,
      frame94: nextFrame94,
    }
    if (fp95Watchdog) clearTimeout(fp95Watchdog)
    fp95Watchdog = setTimeout(() => {
      fp95Aggregate.value = null
      fp95Watchdog = null
    }, FP95_TIMEOUT)

    const now = Date.now()
    // 仅在后端确认收到一帧新的 94/子帧1 时刷新目标时间。
    const sub1 = value.frame94?.Sub1
    if (sub1) {
      const frame94Sequence = value.frame94Sequence
      const hasSequence =
        typeof frame94Sequence === 'number' && Number.isFinite(frame94Sequence)
      const fingerprint = JSON.stringify(sub1) ?? ''
      const hasNewFrame94 = hasSequence
        ? transponderFrame94Sequence.get(value.uavId) !== frame94Sequence
        : transponderFrame94Fingerprint.get(value.uavId) !== fingerprint

      if (
        hasNewFrame94 &&
        typeof frame94Sequence === 'number' &&
        Number.isFinite(frame94Sequence)
      ) {
        transponderFrame94Sequence.set(value.uavId, frame94Sequence)
      }
      if (hasNewFrame94 && !hasSequence) {
        transponderFrame94Fingerprint.set(value.uavId, fingerprint)
      }
      if (hasNewFrame94 && isValidTransponderTarget(sub1)) {
        const next = new Map(transponderMap.value)
        next.set(sub1.sAddress, sub1)
        transponderSeen.set(sub1.sAddress, now)
        transponderMap.value = next
      }
    }
    evictExpiredTransponderTargets(now)
    scheduleTransponderEviction()
  }

  async function controlFp95AvionicsSwitch(
    device: Fp95AvionicsDevice,
    enabled: boolean,
  ) {
    const aggregate = fp95Aggregate.value
    const aircraftId = aggregate?.uavId ?? currentFp95AircraftId() ?? 0

    await invoke('submit_flight_switch_command', {
      aircraftId,
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
    // return fp95Aggregate.value?.uavId ?? 255
    return 255
  }

  async function runTransponderOperation<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
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
  // 查询应答机（空地）状态
  async function queryTransponderSwitches() {
    const aircraftId = currentFp95AircraftId()
    return runTransponderOperation(async () => {
      const res = await invoke<TransponderSwitchReadback>(
        'query_transponder_switches',
        { aircraftId },
      )
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
      sModeAddr: [...config.sModeAddr],
    }
  }

  async function queryTransponderParams() {
    const aircraftId = currentFp95AircraftId()
    return runTransponderOperation(async () => {
      const res = await invoke<TransponderParamReadback>(
        'query_air_traffic_params',
        { aircraftId },
      )
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
      const res = await invoke<WeightReadback>('query_weight_params', {
        aircraftId,
      })
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
  const simulatedGuidance = new Map<string, SimulatedGuidance>()
  const simulatedGuidancePaused = new Set<string>()

  function setSimulatedGuidance(key: string, guidance: SimulatedGuidance) {
    if (!isMock.value || !uavInfoMap.value.has(key)) return false
    simulatedGuidancePaused.delete(key)
    simulatedGuidance.set(key, guidance)
    return true
  }

  function pauseSimulatedPlane(key: string) {
    if (!isMock.value || !uavInfoMap.value.has(key)) return false
    simulatedGuidancePaused.add(key)
    return true
  }

  function resumeSimulatedPlane(key: string) {
    simulatedGuidancePaused.delete(key)
  }

  function clearSimulatedGuidance(key?: string) {
    if (key) simulatedGuidance.delete(key)
    else simulatedGuidance.clear()
  }

  function getSimulatedGuidance(key: string) {
    return simulatedGuidance.get(key) ?? null
  }

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
        pitchAngle: 0,
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
        longitude: 109.51,
        latitude: 18.25,
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
      {
        uavSeries: '981C',
        uavId: 3,
        longitude: 116.3912757,
        latitude: 39.906217,
        altitude: 500,
        relativeAltitude: 500,
        groundSpeed: 200,
        groundSpeedDirection: 45,
        verticalSpeed: -0.2,
        airspeed: 200,
        trueAirspeed: 200,
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

    mockUavTimer = setInterval(() => {
      const now = Date.now()
      mockUavList.forEach((item, index) => {
        const key = `${item.uavSeries}:${item.uavId}`
        const guidance = simulatedGuidance.get(key)
        if (guidance) {
          const previousAltitude = item.altitude
          const position = guidancePosition(guidance, now)
          if (position) {
            item.longitude = position.lon
            item.latitude = position.lat
            item.headingAngle = position.heading
            item.groundSpeedDirection = position.heading
            item.altitude = position.altitude
            // Keep the terrain clearance offset while changing the MSL altitude.
            item.relativeAltitude += position.altitude - previousAltitude
            item.verticalSpeed = position.verticalSpeed
          }
          return
        }

        if (simulatedGuidancePaused.has(key)) return

        if (index === 0) {
          item.longitude += 0.00008
          item.latitude += 0.00002
          item.groundSpeedDirection = 76
          item.headingAngle = 76
          item.distanceNext = Math.max(0, item.distanceNext - 25)
        } else if (index === 1) {
          item.longitude += 0.000015
          item.latitude += 0.000015
          item.groundSpeedDirection = 45
          item.headingAngle = 45
          item.distanceNext = Math.max(0, item.distanceNext - 30)
        } else if (index === 2) {
          item.longitude += 0.000015
          item.latitude += 0.000015
          item.groundSpeedDirection = 38
          item.headingAngle = 38
          item.distanceNext = Math.max(0, item.distanceNext - 30)
        }
      })

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
    simulatedGuidance.clear()
    simulatedGuidancePaused.clear()
    if (uavWatchdog) {
      clearTimeout(uavWatchdog)
      uavWatchdog = null
    }
    uavInfoMap.value = new Map()
    console.log('已停止 UAVInfo 模拟数据服务')
  }

  return {
    uavInfo,
    links,
    addLink,
    removeLink,
    updateLinkKind,
    udpName,
    isServiceRunning,
    isFp95Running,
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
    fp95Deice,
    controlFp95AvionicsSwitch,
    updateFp981cList,
    fp981cMap,
    transponderMap,
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
    isMock,
    toggleMockUavInfoService,
    setSimulatedGuidance,
    pauseSimulatedPlane,
    resumeSimulatedPlane,
    clearSimulatedGuidance,
    getSimulatedGuidance,
    syncProtocolListeners,
    startListening,
    stopListening,
    startFp95Listening,
    startFp981cListening,
  }
})
