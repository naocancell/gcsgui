<template>
  <div class="telemetry-page-wrapper">
    <UavTelemetryPanel
      :standalone="true"
      @minimize="handleWindowMinimize"
      @close="handleWindowClose"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue'
import UavTelemetryPanel from '@/components/UavTelemetryPanel.vue'
import { useUavStore } from '@/store/uavStore'
import { useStaticStore } from '@/store/staticOptions.js'
import { useMessage } from 'naive-ui'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import {
  hideTelemetryWindow,
  preserveTelemetryWindowOnClose,
} from '@/utils/telemetryWindow'

const uavStore = useUavStore()
const staticStore = useStaticStore()
const message = useMessage()

let networkHandlerOnline: (() => void) | null = null
let networkHandlerOffline: (() => void) | null = null
let configChangedUnlisten: UnlistenFn | null = null
let closeRequestedUnlisten: UnlistenFn | null = null
//获取当前窗口
const telemetryWindow = getCurrentWindow()
//最小
async function handleWindowMinimize() {
  await telemetryWindow.minimize()
}
//关闭
async function handleWindowClose() {
  await hideTelemetryWindow(telemetryWindow)
}

onMounted(async () => {
   //窗口关闭监听 执行回调
  closeRequestedUnlisten = await telemetryWindow.onCloseRequested(async (event) => {
    // ts中自定义函数  阻止关闭 隐藏窗口到后台
    await preserveTelemetryWindowOnClose(event, telemetryWindow)
  })

   // navigator：浏览器环境信息对象 检查离线状态
  if (!window.navigator.onLine) {
    staticStore.networkStatus.offlineMode = true
  }
  networkHandlerOnline = () => {
    staticStore.networkStatus.offlineMode = false
  }
  networkHandlerOffline = () => {
    staticStore.networkStatus.offlineMode = true
  }
  window.addEventListener('online', networkHandlerOnline)
  window.addEventListener('offline', networkHandlerOffline)

  try {
    // 跨窗口热同步：当主窗口点击启动或保存服务配置后，航电窗口实时重载监听
    configChangedUnlisten = await listen('comms-config-changed', async () => {
      await uavStore.loadCommsConfig()
      await uavStore.startListening()//重复了
      await uavStore.syncProtocolListeners()//重复了
    })

    // 初始加载通信配置并同步后端全部监听服务
    await uavStore.loadCommsConfig()//读取通信配置（已经开启全部监听、并监听链路健康）
    await uavStore.startPortsMonitoring()// 监听串口热插拔事件并主动获取初始串口列表
    await uavStore.startListening()//这里重复了
    await uavStore.syncProtocolListeners()//重复了
  } catch (err) {
    message.error('航电窗口数据服务挂载失败: ' + err)
  }
})

onBeforeUnmount(() => {
  if (networkHandlerOnline) window.removeEventListener('online', networkHandlerOnline)
  if (networkHandlerOffline) window.removeEventListener('offline', networkHandlerOffline)
  if (configChangedUnlisten) configChangedUnlisten()
  if (closeRequestedUnlisten) closeRequestedUnlisten()
})
</script>

<style scoped>
.telemetry-page-wrapper {
  width: 100vw;
  height: 100vh;
  min-height: 100vh;
  background: #181818;
  overflow: hidden;
  display: flex;
  box-sizing: border-box;
}
</style>
