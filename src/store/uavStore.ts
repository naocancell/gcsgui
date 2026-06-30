import { defineStore } from 'pinia'
import { ref,shallowRef } from 'vue'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import type {UAVInfo, FP95Frame94Sub1,FP95EventPayload } from '@/types/entityoptions'//引入类型

// 协议解包类型枚举
const enum Protocol {
  FP95 = "FP95",
  FP981C = "FP981C",
  UAVInfo = "UAVInfo"
}

export const useUavStore = defineStore('uav', () => {
  const uavInfo = ref<UAVInfo | null>(null)
  
  // UAVInfo 通道参数
  const udpIp = ref('226.0.1.9')
  const udpPort = ref(8999)
  const udpTargetPort = ref(9001)
  const udpInterface = ref('0.0.0.0')
  const isServiceRunning = ref(false)

  // FP95 通道参数 (默认 0.0.0.0:0)
  const fp95Ip = ref('226.0.1.9')
  const fp95Port = ref(8999)
  const fp95Interface = ref('0.0.0.0')
  const isFp95Running = ref(false)

  const networkInterfaces = ref<{ name: string; ip: string }[]>([])

  let unlisten: UnlistenFn | null = null
  let fp95Unlisten: UnlistenFn | null = null

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

  // 启动 UAVInfo 接收服务
  async function startUavService() {
    try {
      const status = await invoke<string>('start_udp_listener', {
        ip: udpIp.value,
        port: udpPort.value,
        interfaceIp: udpInterface.value,
        protocol: Protocol.UAVInfo,
      })
      console.log(status)
      isServiceRunning.value = true
      await startListening()
    } catch (err) {
      console.error('启动 UAVInfo UDP 后台接收失败', err)
      throw err
    }
  }

  // 停止 UAVInfo 接收服务
  async function stopUavService() {
    try {
      const status = await invoke<string>('stop_udp_listener', {
        ip: udpIp.value,
        port: udpPort.value,
      })
      console.log(status)
      stopListening()
      isServiceRunning.value = false
       uavInfoMap.value = new Map()   // 清空真正渲染用的数据
       //关闭定时器
      if (uavWatchdog) {
        clearTimeout(uavWatchdog)
        uavWatchdog = null
      }
      uavInfo.value = null
    } catch (err) {
      console.error('停止 UAVInfo UDP 后台接收失败', err)
      throw err
    }
  }

  // 启动 FP95 接收服务
  async function startFp95Service() {
    try {
      const status = await invoke<string>('start_udp_listener', {
        ip: fp95Ip.value,
        port: fp95Port.value,
        interfaceIp: fp95Interface.value,
        protocol: Protocol.FP95,
      })
      console.log(status)
      isFp95Running.value = true
      await startFp95Listening()//启动服务时候开启数据监听
    } catch (err) {
      console.error('启动 FP95 UDP 后台接收失败', err)
      throw err
    }
  }

  // 停止 FP95 接收服务
  async function stopFp95Service() {
    try {
      const status = await invoke<string>('stop_udp_listener', {
        ip: fp95Ip.value,
        port: fp95Port.value,
      })
      console.log(status)
      stopFp95Listening()//停止监听
            //计时器
      isFp95Running.value = false
       if (fp95Watchdog) {
      clearTimeout(fp95Watchdog)
      fp95Watchdog = null
    }
      fp95Map.value = new Map()      // 清空残留的 FP95 飞机
    } catch (err) {
      console.error('停止 FP95 UDP 后台接收失败', err)
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
  //  uavInfo无人机数据的map（key 是飞机id 唯一标识）
  const uavInfoMap = shallowRef<Map<string, UAVInfo>>(new Map());
   //  fp95无人机数据的数组
  const fp95Map = shallowRef<Map<string, FP95Frame94Sub1>>(new Map());
 
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
        altitude: 1200,
        relativeAltitude: 300,
        groundSpeed: 25,
        groundSpeedDirection: 90,
        verticalSpeed: 0.5,
        airspeed: 28,
        trueAirspeed: 30,
        pitchAngle: 3,
        rollAngle: 0,
        headingAngle: 90,
        currentRouteId: 1,
        nextRouteId: 1,
        nextPoint: 2,
        distanceNext: 5000,
      },
      {
        uavSeries: '981C',
        uavId: 2,
        longitude: 109.5119,
        latitude: 18.2528,
        altitude: 1500,
        relativeAltitude: 500,
        groundSpeed: 30,
        groundSpeedDirection: 45,
        verticalSpeed: -0.2,
        airspeed: 32,
        trueAirspeed: 35,
        pitchAngle: 2,
        rollAngle: 5,
        headingAngle: 45,
        currentRouteId: 2,
        nextRouteId: 2,
        nextPoint: 3,
        distanceNext: 8000,
      },
    ]

    updateUavInfoList(mockUavList)
    isServiceRunning.value = true

    mockUavTimer = setInterval(() => {
      mockUavList[0].longitude += 0.0008
      mockUavList[0].latitude += 0.0002
      mockUavList[0].headingAngle = 90
      mockUavList[0].groundSpeedDirection = 90
      mockUavList[0].rollAngle = 3
      mockUavList[0].distanceNext = Math.max(0, mockUavList[0].distanceNext - 25)

      mockUavList[1].longitude += 0.0005
      mockUavList[1].latitude += 0.0005
      mockUavList[1].headingAngle = 45
      mockUavList[1].groundSpeedDirection = 45
      mockUavList[1].rollAngle = -4
      mockUavList[1].distanceNext = Math.max(0, mockUavList[1].distanceNext - 30)

      if (mockUavList[0].longitude > 111.2) {
        mockUavList[0].longitude = 110.3312
        mockUavList[0].latitude = 20.0311
        mockUavList[0].distanceNext = 5000
      }

      if (mockUavList[1].longitude > 110.5 || mockUavList[1].latitude > 19.2) {
        mockUavList[1].longitude = 109.5119
        mockUavList[1].latitude = 18.2528
        mockUavList[1].distanceNext = 8000
      }

      updateUavInfoList(mockUavList.map((item) => ({ ...item })))
    }, 1000)

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
    udpIp,
    udpPort,
    udpTargetPort,
    udpInterface,
    isServiceRunning,
    fp95Ip,
    fp95Port,
    fp95Interface,
    isFp95Running,
    networkInterfaces,
    startUavService,
    stopUavService,
    startFp95Service,
    stopFp95Service,
    fetchNetworkInterfaces,
    //uavInfo更新方法和数据
    updateUavInfoList,
    uavInfoMap,
    //fp95更新方法和数据
    updateFp95List,
    fp95Map,
    //模拟
    toggleMockUavInfoService
  }
})
