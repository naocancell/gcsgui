import { defineStore } from 'pinia'
import { ref,shallowRef } from 'vue'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import type {UAVInfo, FP95Frame94Sub1,FP95EventPayload, FP981CAggregate, FP981CEventPayload } from '@/types/entityoptions'//引入类型

// 协议解包类型枚举
const enum Protocol {
  FP95 = "FP95",
  FP981C = "FP981C",
  UAVInfo = "UAVInfo"
}

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
  const isMainSerialRunning = ref(false)

  // 副链路串口参数 (默认绑定 FP981C)
  const subSerialName = ref('副链路')
  const subSerialPort = ref('')
  const subSerialBaud = ref(115200)
  const isSubSerialRunning = ref(false)

  // 可用串口号列表
  const availablePorts = ref<string[]>([])

  const networkInterfaces = ref<{ name: string; ip: string }[]>([])

  let unlisten: UnlistenFn | null = null
  let fp95Unlisten: UnlistenFn | null = null
  let fp981cUnlisten: UnlistenFn | null = null
  let portsUnlisten: UnlistenFn | null = null

  // 监听 uav-info-event 事件
  async function startListening() {
    if (unlisten) return
    unlisten = await listen<UAVInfo[]>('uav-info-event', (event) => {
     updateUavInfoList(event.payload)
    })
    console.log('前端已挂载 UAVInfo 数据监听服务')
  }

  // 监听 fp95-event 事件
  async function startFp95Listening() {
    if (fp95Unlisten) return

    fp95Unlisten = await listen<FP95EventPayload>("fp95-event", (event: any) => {
      //将接收到的数据给飞机的store   更新数据
      updateFp95List(event.payload)
    })
    console.log('前端已挂载 FP95 数据监听服务')
  }

  async function startFp981cListening() {
    if (fp981cUnlisten) return

    fp981cUnlisten = await listen<FP981CEventPayload>("fp981c-event", (event) => {
      updateFp981cList(event.payload)
    })
    console.log('前端已挂载 FP981C 数据监听服务')
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

  // 启动 UAVInfo 接收服务
  async function startUavService() {
    try {
      isServiceRunning.value = true
      const status = await saveCommsConfig()
      console.log(status)
      await startListening()
    } catch (err) {
      isServiceRunning.value = false
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
    try {
      isFp95Running.value = true
      const status = await saveCommsConfig()
      console.log(status)
      await startFp95Listening()//启动服务时候开启数据监听
    } catch (err) {
      isFp95Running.value = false
      console.error('启动并保存 FP95 UDP 后台接收失败', err)
      throw err
    }
  }

  // 停止 FP95 接收服务
  async function stopFp95Service() {
    try {
      isFp95Running.value = false
      const status = await saveCommsConfig()
      console.log(status)
      stopFp95Listening()//停止监听
      //计时器
      if (fp95Watchdog) {
        clearTimeout(fp95Watchdog)
        fp95Watchdog = null
      }
      fp95Map.value = new Map()      // 清空残留的 FP95 飞机
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
      await startFp981cListening()
    } catch (err) {
      isMainSerialRunning.value = false
      console.error('启动并保存主链路串口接收失败', err)
      throw err
    }
  }

  // 停止主链路接收服务
  async function stopMainSerialService() {
    try {
      isMainSerialRunning.value = false
      const status = await saveCommsConfig()
      console.log(status)
      if (!isSubSerialRunning.value) {
        stopFp981cListening()
        fp981cMap.value = new Map()
      }
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
      await startFp981cListening()
    } catch (err) {
      isSubSerialRunning.value = false
      console.error('启动并保存副链路串口接收失败', err)
      throw err
    }
  }

  // 停止副链路接收服务
  async function stopSubSerialService() {
    try {
      isSubSerialRunning.value = false
      const status = await saveCommsConfig()
      console.log(status)
      if (!isMainSerialRunning.value) {
        stopFp981cListening()
        fp981cMap.value = new Map()
      }
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
          } else if (item.name === fp95Name.value || item.protocol === Protocol.FP95) {
            if (item.ip) fp95Ip.value = item.ip
            if (item.port) fp95Port.value = item.port
            if (item.interface_ip) fp95Interface.value = item.interface_ip
          }
        }
      }
      if (config && Array.isArray(config.serial)) {
        for (const item of config.serial) {
          if (item.name === mainSerialName.value || item.name === '主链路') {
            if (item.port_name) mainSerialPort.value = item.port_name
            if (item.baud_rate) mainSerialBaud.value = item.baud_rate
            if (item.enabled !== undefined) isMainSerialRunning.value = item.enabled
          } else if (item.name === subSerialName.value || item.name === '副链路') {
            if (item.port_name) subSerialPort.value = item.port_name
            if (item.baud_rate) subSerialBaud.value = item.baud_rate
            if (item.enabled !== undefined) isSubSerialRunning.value = item.enabled
          }
        }
      }
      if (isMainSerialRunning.value || isSubSerialRunning.value) {
        await startFp981cListening()
      }
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
            protocol: Protocol.FP981C,
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
            protocol: Protocol.FP981C,
            enabled: isSubSerialRunning.value,
            auto_connect: true
          }
        ]
      }
      const res = await invoke<string>('save_comms_config', { config })
      console.log('保存配置成功:', res)
      return res
    } catch (err) {
      console.error('保存通信配置失败', err)
      throw err
    }
  }
  //  uavInfo无人机数据的map（key 是飞机id 唯一标识）
  const uavInfoMap = shallowRef<Map<string, UAVInfo>>(new Map());
   //  fp95无人机数据的数组
  const fp95Map = shallowRef<Map<string, FP95Frame94Sub1>>(new Map());
  const fp981cMap = shallowRef<Map<string, FP981CAggregate>>(new Map());
 
  let uavWatchdog: ReturnType<typeof setTimeout> | null = null
  const UAV_TIMEOUT = 1000   // 定时器的 1000ms
  //后端推送 UAVInfo[] 时调用
  function updateUavInfoList(list: UAVInfo[]) {
    //临时的map
    const map = new Map<string, UAVInfo>();
    for (const item of list) {
      const key = `${item.uavSeries}:${item.uavId}`;
      map.set(key, item);
    }
    uavInfoMap.value = map;
    if (uavWatchdog) clearTimeout(uavWatchdog)
    uavWatchdog = setTimeout(() => {
      uavInfoMap.value = new Map()
      uavWatchdog = null
    }, UAV_TIMEOUT)
  }

  // FP95 看门狗：超过这个时间没收到新帧就认为 FP95 停了
  let fp95Watchdog: ReturnType<typeof setTimeout> | null = null
  const FP95_TIMEOUT = 1000

  //后端推送 FP95Frame94Sub1[] 时调用
  function updateFp95List(list: FP95Frame94Sub1[]) {
    const map = new Map<string, FP95Frame94Sub1>();
    for (const item of list) {
      map.set(item.sAddress, item);
    }
    fp95Map.value = map;
     // 每收到一帧就重置看门狗
    if (fp95Watchdog) clearTimeout(fp95Watchdog)
    fp95Watchdog = setTimeout(() => {
      fp95Map.value = new Map()   // 超时无新数据，从源头清掉残帧
      fp95Watchdog = null
    }, FP95_TIMEOUT)
  }

  function updateFp981cList(list: FP981CAggregate[]) {
    const map = new Map<string, FP981CAggregate>();
    for (const item of list) {
      if (!item.c2) {
        continue
      }
      map.set(String(item.uav_id), item);
    }
    fp981cMap.value = map;
  }
 // 模拟数据服务
  const isMock = ref(false)
  let mockUavTimer: ReturnType<typeof setInterval> | null = null

  // 第一次点开启，第二次点停止
  function toggleMockUavInfoService() {
    if (isMock.value) {
      stopMockUavInfoService()
    } else {
      startMockUavInfoService()
    }
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

    // 清掉看门狗并清空数据，让模拟飞机立即消失
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
    isMainSerialRunning,
    subSerialName,
    subSerialPort,
    subSerialBaud,
    isSubSerialRunning,
    availablePorts,
    networkInterfaces,
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
    //uavInfo更新方法和数据
    updateUavInfoList,
    uavInfoMap,
    //fp95更新方法和数据
    updateFp95List,
    fp95Map,
    updateFp981cList,
    fp981cMap,
    //模拟
    toggleMockUavInfoService
  }
})
