<script lang="ts">
import { defineComponent } from 'vue'
import SceneViewer from '@/components/SceneViewer.vue'
import BottomBar from '@/components/BottomBar.vue'
import Toolbar from '@/components/toolbar.vue'
import CollisionDetection from '@/components/CollisionDetection.vue'
import RouteManageView from '@/views/RouteManageView.vue'
import RecorderEntry from '@/components/RecorderEntry.vue'
import ReplayController from '@/components/ReplayController.vue'
import { useMessage } from 'naive-ui'
import { useStaticStore } from '@/store/staticStore'
import { useUavStore } from '@/store/uavStore'
import { listen } from '@tauri-apps/api/event'
import {
  startHomeWindowDataListeners,
  subscribeHomeWindowConfigChanges,
  isTauri,
} from '@/utils/homeWindowData'

export default defineComponent({
  name: 'HomeView',
  components: {
    CollisionDetection,
    Toolbar,
    BottomBar,
    SceneViewer,
    RouteManageView,
    RecorderEntry,
    ReplayController,
  },
  data() {
    return {
      showDetection: false,
      graphHeight: 0,
      message: useMessage(),
      staticStore: useStaticStore(),
      timeId: undefined as ReturnType<typeof setInterval> | undefined,
      msgbox: true,
      configChangedUnlisten: null as (() => void) | null,
      onlineHandler: null as (() => void) | null,
      offlineHandler: null as (() => void) | null,
    }
  },
  mounted() {
    if (!window.navigator.onLine) {
      this.message.warning('无法连接互联网，当前为离线模式')
      this.staticStore.networkStatus.offlineMode = true
    } else {
      this.setNetworkTimer()
    }

    if (isTauri()) {
      const uavStore = useUavStore()
      startHomeWindowDataListeners(uavStore).catch((err) => {
        this.message.error('主窗口数据服务挂载失败: ' + err)
      })
      subscribeHomeWindowConfigChanges(uavStore, (handler) =>
        listen('comms-config-changed', async () => {
          try {
            await handler()
          } catch (err) {
            this.message.error('主窗口数据服务重载失败: ' + err)
          }
        }),
      ).then((unlisten) => {
        this.configChangedUnlisten = unlisten
      }).catch((err) => {
        this.message.error('主窗口通信配置监听挂载失败: ' + err)
      })
    }

    // 网络状态监测
    this.onlineHandler = () => {
      this.message.success('网络已连接')
      this.staticStore.networkStatus.offlineMode = false
      this.setNetworkTimer()
    }
    this.offlineHandler = () => {
      this.message.warning('无法连接互联网，已进入离线模式')
      this.staticStore.networkStatus.offlineMode = true
      // 关闭网络检测定时器
      if (this.timeId) {
        clearInterval(this.timeId)
        this.timeId = undefined
      }
    }
    window.addEventListener('online', this.onlineHandler)
    window.addEventListener('offline', this.offlineHandler)
  },
  beforeUnmount() {
    this.configChangedUnlisten?.()
    this.configChangedUnlisten = null
    if (this.timeId) {
      clearInterval(this.timeId)
      this.timeId = undefined
    }
    if (this.onlineHandler) {
      window.removeEventListener('online', this.onlineHandler)
      this.onlineHandler = null
    }
    if (this.offlineHandler) {
      window.removeEventListener('offline', this.offlineHandler)
      this.offlineHandler = null
    }
  },
  computed: {
    setPageStyle: function () {
      return this.showDetection ? 100 - this.graphHeight : 100
    },
    mapStyle: function () {
      return {
        position: 'relative',
        left: '0px',
        width: '100vw',
        height: this.setPageStyle + 'vh',
      }
    },
  },
  watch: {
  },
  methods: {
    // 显示地形碰撞检测面板，resize地图窗口
    resizeMap(height: number) {
      if (height < 0) this.showDetection = false
      else {
        this.graphHeight = height
        this.showDetection = true
      }
    },
    setNetworkTimer() {
      this.timeId = setInterval(() => {
        // console.log(navigator['connection'].downlink)
        if (navigator['connection'].downlink < 1) {
          this.staticStore.networkStatus.offlineMode = true
          if (this.msgbox) {
            this.message.warning('检测到当前网络环境差，已切换至离线模式')
            this.msgbox = false
          }
        } else {
          this.staticStore.networkStatus.offlineMode = false
          if (!this.msgbox) {
            this.msgbox = true
            this.message.info('已切换至在线模式')
          }
        }
      }, 3000)
    },
  },
})
</script>

<template>
  <div class="home-page-container">
    <div id="map" :style="mapStyle">
      <SceneViewer id="scene-viewer"></SceneViewer>
      <BottomBar></BottomBar>
      <toolbar
        v-show="!staticStore.showRouteManage"
        ref="ToolBar"
        @resizeMap="resizeMap"
      ></toolbar>
      <RecorderEntry v-show="!staticStore.showRouteManage" />
      <ReplayController v-show="!staticStore.showRouteManage" />
    </div>
    <RouteManageView v-if="staticStore.showRouteManage"></RouteManageView>
  </div>
</template>

<style>
@import '@/styles/cesium-compass.css';

.home-page-container {
  position: relative;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
}

#map {
  position: relative;
  width: 100vw;
  height: 100%;
}

#scene-viewer {
  position: absolute;
  width: 100vw;
  height: 100%;
  overflow: hidden;
}
</style>
