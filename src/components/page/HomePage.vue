<script lang="ts">
import { defineComponent } from 'vue'
import SceneViewer from '@/components/SceneViewer.vue'
import BottomBar from '@/components/BottomBar.vue'
import Toolbar from '@/components/toolbar.vue'
import CollisionDetection from '@/components/CollisionDetection.vue'
import RouteManagePage from '@/components/page/RouteManagePage.vue'
import { useMessage } from 'naive-ui'
import { useStaticStore } from '@/store/staticOptions.js'

export default defineComponent({
  name: 'HomePage',
  components: {
    CollisionDetection,
    Toolbar,
    BottomBar,
    SceneViewer,
    RouteManagePage,
  },
  data() {
    return {
      showDetection: false,
      graphHeight: 0,
      message: useMessage(),
      staticStore: useStaticStore(),
      timeId: undefined,
      msgbox: true,
    }
  },
  mounted() {
    if (!window.navigator.onLine) {
      this.message.warning('无法连接互联网，当前为离线模式')
      this.staticStore.networkStatus.offlineMode = true
    } else {
      this.setNetworkTimer()
    }

    // 网络状态监测
    window.addEventListener('online', () => {
      this.message.success('网络已连接')
      this.staticStore.networkStatus.offlineMode = false
      this.setNetworkTimer()
    })
    window.addEventListener('offline', () => {
      this.message.warning('无法连接互联网，已进入离线模式')
      this.staticStore.networkStatus.offlineMode = true
      // 	关闭网络检测定时器
      this.timeId && clearInterval(this.timeId)
    })
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
    </div>
    <RouteManagePage v-if="staticStore.showRouteManage"></RouteManagePage>
  </div>
</template>

<style>
@import '../../styles/cesium-compass.css';

.home-page-container {
  position: relative;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
}

#map {
  position: relative;
  width: 100vw;
}

#scene-viewer {
  position: absolute;
  width: 100vw;
  height: 100%;
  overflow: hidden;
}
</style>
