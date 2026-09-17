<template>
  <div class="deice-page-wrapper">
    <DeicePanel
      :standalone="true"
      :maximized="maximized"
      @minimize="handleWindowMinimize"
      @maximize="handleWindowMaximize"
      @close="handleWindowClose"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
import DeicePanel from '@/components/DeicePanel.vue'
import { useUavStore } from '@/store/uavStore'
import { useStaticStore } from '@/store/staticStore'
import { useMessage } from 'naive-ui'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import {
  hideDeiceWindow,
  preserveDeiceWindowOnClose,
} from '@/utils/deiceWindow'
import { isTauri } from '@/utils/homeWindowData'

const uavStore = useUavStore()
const staticStore = useStaticStore()
const message = useMessage()

let networkHandlerOnline: (() => void) | null = null
let networkHandlerOffline: (() => void) | null = null
let configChangedUnlisten: UnlistenFn | null = null
let closeRequestedUnlisten: UnlistenFn | null = null
let resizedUnlisten: UnlistenFn | null = null

const deiceWindow = getCurrentWindow()
const maximized = ref(false)

async function syncMaximized() {
  if (!isTauri()) return
  try {
    maximized.value = await deiceWindow.isMaximized()
  } catch {
    // 兼容纯浏览器与测试环境
  }
}

async function handleWindowMinimize() {
  if (isTauri()) {
    try {
      await deiceWindow.minimize()
    } catch {
      // 降级处理
    }
  }
}

async function handleWindowMaximize() {
  if (isTauri()) {
    try {
      await deiceWindow.toggleMaximize()
      await syncMaximized()
    } catch {
      // 降级处理
    }
  } else {
    maximized.value = !maximized.value
  }
}

async function handleWindowClose() {
  if (isTauri()) {
    try {
      await hideDeiceWindow(deiceWindow)
    } catch {
      // 降级处理
    }
  } else if (typeof window !== 'undefined' && window.history.length > 1) {
    window.history.back()
  }
}

let isMounted = false

onMounted(async () => {
  isMounted = true
  if (isTauri()) {
    try {
      const unlistenClose = await deiceWindow.onCloseRequested(async (event) => {
        await preserveDeiceWindowOnClose(event, deiceWindow)
      })
      if (!isMounted) {
        unlistenClose()
        return
      }
      closeRequestedUnlisten = unlistenClose

      const unlistenResize = await deiceWindow.onResized(() => {
        void syncMaximized()
      })
      if (!isMounted) {
        unlistenResize()
        return
      }
      resizedUnlisten = unlistenResize

      await syncMaximized()
    } catch {
      // 非桌面容器静默跳过
    }
  }

  // 检查网络离线状态
  if (typeof window !== 'undefined' && window.navigator && !window.navigator.onLine) {
    staticStore.networkStatus.offlineMode = true
  }
  networkHandlerOnline = () => {
    staticStore.networkStatus.offlineMode = false
  }
  networkHandlerOffline = () => {
    staticStore.networkStatus.offlineMode = true
  }
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('online', networkHandlerOnline)
    window.addEventListener('offline', networkHandlerOffline)
  }

  if (isTauri()) {
    try {
      // 跨窗口热同步：当主窗口点击启动或保存服务配置后，防除冰窗口实时重载监听
      const unlistenConfig = await listen('comms-config-changed', async () => {
        await uavStore.loadCommsConfig()
        await uavStore.startListening()
        await uavStore.syncProtocolListeners()
      })
      if (!isMounted) {
        unlistenConfig()
        return
      }
      configChangedUnlisten = unlistenConfig

      // 初始加载通信配置并同步后端全部监听服务
      await uavStore.loadCommsConfig()
      await uavStore.startPortsMonitoring()
      await uavStore.startListening()
      await uavStore.syncProtocolListeners()
    } catch (err) {
      if (message) {
        message.error('防除冰窗口数据服务挂载失败: ' + err)
      }
    }
  }
})

onBeforeUnmount(() => {
  isMounted = false
  if (networkHandlerOnline && typeof window !== 'undefined' && window.removeEventListener) {
    window.removeEventListener('online', networkHandlerOnline)
  }
  if (networkHandlerOffline && typeof window !== 'undefined' && window.removeEventListener) {
    window.removeEventListener('offline', networkHandlerOffline)
  }
  if (configChangedUnlisten) configChangedUnlisten()
  if (closeRequestedUnlisten) closeRequestedUnlisten()
  if (resizedUnlisten) resizedUnlisten()
})
</script>

<style scoped>
.deice-page-wrapper {
  width: 100vw;
  height: 100vh;
  min-height: 100vh;
  background: #181818;
  overflow: hidden;
  display: flex;
  box-sizing: border-box;
}
</style>
