<template>
  <div class="pod-page-wrapper">
    <PodControlPanel
      :standalone="true"
      @minimize="handleWindowMinimize"
      @close="handleWindowClose"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue'
import PodControlPanel from '@/components/PodControlPanel.vue'
import { useUavStore } from '@/store/uavStore'
import { usePodStore } from '@/store/podStore'
import { useStaticStore } from '@/store/staticStore'
import { useMessage } from 'naive-ui'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import {
  hidePodWindow,
  preservePodWindowOnClose,
} from '@/utils/podWindow'

const uavStore = useUavStore()
const podStore = usePodStore()
const staticStore = useStaticStore()
const message = useMessage()

let networkHandlerOnline: (() => void) | null = null
let networkHandlerOffline: (() => void) | null = null
let configChangedUnlisten: UnlistenFn | null = null
let closeRequestedUnlisten: UnlistenFn | null = null
// 获取当前窗口
const podWindow = getCurrentWindow()
// 最小化
async function handleWindowMinimize() {
  await podWindow.minimize()
}
// 关闭（隐藏保留）
async function handleWindowClose() {
  await podStore.stopAll()
  await hidePodWindow(podWindow)
}

onMounted(async () => {
  // 窗口关闭监听：阻止销毁，隐藏窗口到后台
  closeRequestedUnlisten = await podWindow.onCloseRequested(async (event) => {
    await podStore.stopAll()
    await preservePodWindowOnClose(event, podWindow)
  })

  // 网络状态监测
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
    // 订阅吊舱装订回执（0x28/0x01 → pod-command-acked）
    await podStore.initAckListener()

    // 跨窗口热同步：主窗口保存服务配置后，吊舱窗口实时重载监听
    configChangedUnlisten = await listen('comms-config-changed', async () => {
      await uavStore.loadCommsConfig()
      await uavStore.startListening()
      await uavStore.syncProtocolListeners()
    })

    // 初始加载通信配置并同步后端全部监听服务（获取 FP95 遥测与飞机 ID）
    await uavStore.loadCommsConfig()
    await uavStore.startPortsMonitoring()
    await uavStore.startListening()
    await uavStore.syncProtocolListeners()
  } catch (err) {
    message.error('吊舱窗口数据服务挂载失败: ' + err)
  }
})

onBeforeUnmount(() => {
  if (networkHandlerOnline) window.removeEventListener('online', networkHandlerOnline)
  if (networkHandlerOffline) window.removeEventListener('offline', networkHandlerOffline)
  if (configChangedUnlisten) configChangedUnlisten()
  if (closeRequestedUnlisten) closeRequestedUnlisten()
  podStore.dispose()
})
</script>

<style scoped>
.pod-page-wrapper {
  width: 100vw;
  height: 100vh;
  min-height: 100vh;
  background: #181818;
  overflow: hidden;
  display: flex;
  box-sizing: border-box;
}
</style>
