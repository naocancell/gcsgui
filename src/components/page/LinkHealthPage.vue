<template>
  <div class="linkhealth-page-wrapper">
    <LinkHealthPanel
      :standalone="true"
      @minimize="handleWindowMinimize"
      @close="handleWindowClose"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue'
import LinkHealthPanel from '@/components/LinkHealthPanel.vue'
import { useUavStore } from '@/store/uavStore'
import { useStaticStore } from '@/store/staticOptions.js'
import { useMessage } from 'naive-ui'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import {
  hideLinkHealthWindow,
  preserveLinkHealthWindowOnClose,
} from '@/utils/linkHealthWindow'

const uavStore = useUavStore()
const staticStore = useStaticStore()
const message = useMessage()

let networkHandlerOnline: (() => void) | null = null
let networkHandlerOffline: (() => void) | null = null
let configChangedUnlisten: UnlistenFn | null = null
let closeRequestedUnlisten: UnlistenFn | null = null

const linkHealthWindow = getCurrentWindow()

async function handleWindowMinimize() {
  await linkHealthWindow.minimize()
}

async function handleWindowClose() {
  await hideLinkHealthWindow(linkHealthWindow)
}

onMounted(async () => {
  closeRequestedUnlisten = await linkHealthWindow.onCloseRequested(async (event) => {
    await preserveLinkHealthWindowOnClose(event, linkHealthWindow)
  })

  // 检查离线状态
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
    // 跨窗口热同步：当主窗口点击启动或保存服务配置后，窗口实时重载监听
    configChangedUnlisten = await listen('comms-config-changed', async () => {
      await uavStore.loadCommsConfig()
      await uavStore.startListening()
      await uavStore.syncProtocolListeners()
    })

    // 初始加载通信配置并同步后端全部监听服务
    await uavStore.loadCommsConfig()
    await uavStore.startPortsMonitoring()
    await uavStore.startListening()
    await uavStore.syncProtocolListeners()
  } catch (err) {
    message.error('链路状态窗口数据服务挂载失败: ' + err)
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
.linkhealth-page-wrapper {
  width: 100vw;
  height: 100vh;
  min-height: 100vh;
  background: #181818;
  overflow: hidden;
  display: flex;
  box-sizing: border-box;
}
</style>
