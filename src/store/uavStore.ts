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
      isFp95Running.value = false
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
 
  //后端推送 UAVInfo[] 时调用
  function updateUavInfoList(list: UAVInfo[]) {
    //临时的map
    const map = new Map<string, UAVInfo>();
    for (const item of list) {
      const key = `${item.uavSeries}:${item.uavId}`;
      map.set(key, item);
    }
    uavInfoMap.value = map;
  }

  //后端推送 FP95Frame94Sub1[] 时调用
  function updateFp95List(list: FP95Frame94Sub1[]) {
    const map = new Map<string, FP95Frame94Sub1>();
    for (const item of list) {
      map.set(item.sAddress, item);
    }
    fp95Map.value = map;
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
    fp95Map
  }
})
