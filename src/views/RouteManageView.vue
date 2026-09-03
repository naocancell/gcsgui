<!--
  文件描述：航线管理视图容器 (RouteManage View Container)
-->
<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue'
import {
  NConfigProvider,
  NLayout,
  NLayoutHeader,
  NLayoutContent,
  NSpace,
  NPopover,
  NButton,
  NIcon,
  NDivider,
  NButtonGroup,
  darkTheme,
  useMessage,
  useDialog,
} from 'naive-ui'
import {
  FolderOpenOutline,
  DownloadOutline,
} from '@vicons/ionicons5'
import { ArrowRight } from '@vicons/carbon'
import { useStaticStore } from '@/store/staticStore'
import { useRouteStore } from '@/store/RouteStore'
import RouteManageViewer from '@/core/gis/RouteManageViewer'
import { formatNoFlyZoneConflictMessage } from '@/utils/map/noFlyZoneService'
import type { Airline } from '@/types/entityoptions'

// 引入拆解的 Composables
import { useRouteEditor } from '@/composables/useRouteEditor'
import { useRouteProfileChart } from '@/composables/useRouteProfileChart'
import { useRouteWeatherChart } from '@/composables/useRouteWeatherChart'
import { useRouteFileIO } from '@/composables/useRouteFileIO'

// 引入拆解的子组件
import RouteListPanel from '@/components/route/RouteListPanel.vue'
import RouteWaypointTable from '@/components/route/RouteWaypointTable.vue'
import RouteProfilePanel from '@/components/route/RouteProfilePanel.vue'
import RouteWeatherPanel from '@/components/route/RouteWeatherPanel.vue'

declare global {
  interface Window {
    viewer: any
    routeManageViewer?: any
    pendingSelectedRouteId?: string | number | null
  }
}

const sStore = useStaticStore()
const routeStore = useRouteStore()
const uiMsg = useMessage()
const dialog = useDialog()

const activeTab = ref<'detail' | 'profile' | 'weather'>('detail')

// 1. 航线编辑器 Composable
const {
  isRouteEditing,
  routeDirty,
  selectedRouteCode,
  selectedRoute,
  showPtList,
  routesListRef,
  hasSelectedRoute,
  canEditSelectedRoute,
  isRouteActionIdle,
  isRouteDrawing,
  rememberValidRoute,
  flyToRoute,
  selectAndShowRoute,
  checkRoute,
  selectRouteById,
  handleRouteCreatedAndSelect,
  startEditSelectedRoute,
  saveRouteEdit,
  cancelRouteEdit,
  handlePtSelect,
  onRoutePointInputChanged,
  onRouteMetaChanged,
  handleRouteCloseChanged,
  sendRouteToQT,
  delRoute,
  toggleRouteVisibility,
  blockRouteManageWhenDrawing,
} = useRouteEditor({
  onRouteChanged: () => {
    scheduleProfileRefresh(activeTab.value === 'profile')
  },
  onRouteSelected: (route: Airline) => {
    if (activeTab.value === 'profile') {
      nextTick(() => drawRouteProfile(route))
    }
    if (activeTab.value === 'weather') {
      nextTick(() => refreshWeatherOfCurrentPoint())
    }
  },
  onClearCache: (routeCode: string | number) => {
    clearRouteProfileCache(routeCode)
  },
})

// 2. 地形剖面图表 Composable
const {
  profileInterval,
  drawRouteProfile,
  redrawRouteProfile,
  handleProfileIntervalChanged,
  scheduleProfileRefresh,
  cancelPendingProfileSampling,
  clearRouteProfileCache,
  resizeProfileChart,
} = useRouteProfileChart(() => selectedRoute.value)

// 3. 气象预报图表 Composable
const {
  routePtNumber,
  selectedLevel,
  levelOptions,
  nowTime,
  refreshWeatherOfCurrentPoint,
  prevPtWeather,
  nextPtWeather,
  levelChanged,
  resizeWeatherChart,
} = useRouteWeatherChart(() => selectedRoute.value)

// 4. 文件 IO Composable
const { importRoute, exportRoute } = useRouteFileIO(
  isRouteActionIdle,
  (newRoute: Airline) => {
    selectAndShowRoute(newRoute, { flyTo: true, refreshWeather: true })
  },
)

function switchTab(tab: 'detail' | 'profile' | 'weather') {
  activeTab.value = tab
  if (tab !== 'profile') {
    cancelPendingProfileSampling()
  }

  nextTick(() => {
    if (tab === 'profile') {
      resizeProfileChart()
      if (hasSelectedRoute.value) drawRouteProfile(selectedRoute.value)
    }
    if (tab === 'weather') {
      resizeWeatherChart()
      if (hasSelectedRoute.value) refreshWeatherOfCurrentPoint()
    }
  })
}

function backToHomePage() {
  if (!isRouteEditing.value) {
    sStore.showRouteManage = false
    return
  }

  dialog.warning({
    title: '退出航线编辑',
    content: '当前航线正在编辑，是否保存本次修改？',
    positiveText: '保存',
    negativeText: '不保存',
    closable: true,
    maskClosable: false,
    onPositiveClick: async () => {
      const success = await saveRouteEdit()
      if (!success) return false
      sStore.showRouteManage = false
      return true
    },
    onNegativeClick: () => {
      const success = cancelRouteEdit()
      if (!success) return false
      sStore.showRouteManage = false
      return true
    },
  })
}

onMounted(() => {
  if (!window.routeManageViewer) {
    window.routeManageViewer = new RouteManageViewer(window.viewer)
  }

  const routeManage = window.routeManageViewer

  routeManage.onNoFlyZoneViolation = ({ conflict, action }: any) => {
    uiMsg.warning(formatNoFlyZoneConflictMessage(conflict, action))
  }

  routeStore.flyRoute.forEach((route) => {
    route.isVisible = route.isVisible !== false
    routeManage.setRouteVisibility?.(route.unicode, route.isVisible)
  })

  routeManage.onRouteSelected = (routeId: string, line: Airline) => {
    selectedRouteCode.value = routeId
    selectedRoute.value = line
    rememberValidRoute(line)
    routeDirty.value = false
    if (activeTab.value === 'profile') drawRouteProfile(line)
    if (activeTab.value === 'weather') refreshWeatherOfCurrentPoint()
  }

  routeManage.onRouteChanged = (line: Airline) => {
    selectedRoute.value = line
    routeDirty.value = true
    rememberValidRoute(line)
    scheduleProfileRefresh(activeTab.value === 'profile')
  }

  routeManage.onEditStateChanged = (editing: boolean) => {
    isRouteEditing.value = editing
  }

  window.addEventListener(
    'route-created-and-select',
    handleRouteCreatedAndSelect as EventListener,
  )

  nextTick(() => {
    const routeId =
      window.pendingSelectedRouteId ?? routeManage?.selectedRouteId ?? null
    if (routeId != null) {
      selectRouteById(routeId)
      window.pendingSelectedRouteId = null
    }
  })
})

onBeforeUnmount(() => {
  window.removeEventListener(
    'route-created-and-select',
    handleRouteCreatedAndSelect as EventListener,
  )

  if (window.routeManageViewer) {
    window.routeManageViewer.onRouteSelected = undefined
    window.routeManageViewer.onRouteChanged = undefined
    window.routeManageViewer.onEditStateChanged = undefined
    window.routeManageViewer.onVertexSelected = undefined
    window.routeManageViewer.onNoFlyZoneViolation = undefined
  }
})
</script>

<template>
  <n-config-provider :theme="darkTheme">
    <div class="route-manage-overlay">
      <div
        id="right"
        @pointerdown.capture="blockRouteManageWhenDrawing"
        @click.capture="blockRouteManageWhenDrawing"
        @keydown.capture="blockRouteManageWhenDrawing"
        @change.capture="blockRouteManageWhenDrawing"
        @wheel.capture="blockRouteManageWhenDrawing"
      >
        <n-layout class="route-manage-layout">
          <n-layout-header :bordered="true">
            <n-space justify="space-between" align="center">
              <n-space>
                <n-popover trigger="hover">
                  <template #trigger>
                    <n-button
                      quaternary
                      type="success"
                      size="large"
                      @click="importRoute"
                    >
                      <template #icon>
                        <n-icon><FolderOpenOutline /></n-icon>
                      </template>
                    </n-button>
                  </template>
                  导入航线
                </n-popover>

                <n-popover trigger="hover">
                  <template #trigger>
                    <n-button
                      data-route-manage-close="true"
                      quaternary
                      type="success"
                      size="large"
                      @click="exportRoute(selectedRoute)"
                    >
                      <template #icon>
                        <n-icon><DownloadOutline /></n-icon>
                      </template>
                    </n-button>
                  </template>
                  导出航线
                </n-popover>
              </n-space>

              <n-space>
                <n-popover trigger="hover">
                  <template #trigger>
                    <n-button
                      quaternary
                      type="success"
                      size="large"
                      @click="backToHomePage"
                    >
                      <template #icon>
                        <n-icon><ArrowRight /></n-icon>
                      </template>
                    </n-button>
                  </template>
                  返回
                </n-popover>
              </n-space>
            </n-space>
          </n-layout-header>

          <n-layout-content
            class="route-manage-content"
            content-style="height: 100%; padding: 0; display: flex; flex-direction: column; overflow: hidden;"
          >
            <!-- 航线列表及基本信息面板 -->
            <RouteListPanel
              :routes-list="routesListRef"
              :selected-route-code="selectedRouteCode"
              :selected-route="selectedRoute"
              :has-selected-route="hasSelectedRoute"
              @select-route="checkRoute"
              @fly-to-route="flyToRoute"
              @toggle-visibility="toggleRouteVisibility"
              @send-to-qt="sendRouteToQT"
              @delete-route="delRoute"
              @meta-changed="onRouteMetaChanged"
              @close-changed="handleRouteCloseChanged"
            />

            <n-divider class="section-divider" />

            <n-space justify="center" class="route-tabs">
              <n-button-group>
                <n-button
                  size="small"
                  :type="activeTab === 'detail' ? 'primary' : 'default'"
                  @click="switchTab('detail')"
                >
                  航线详情
                </n-button>
                <n-button
                  size="small"
                  :type="activeTab === 'profile' ? 'primary' : 'default'"
                  @click="switchTab('profile')"
                >
                  地形剖面
                </n-button>
                <n-button
                  size="small"
                  :type="activeTab === 'weather' ? 'primary' : 'default'"
                  @click="switchTab('weather')"
                >
                  气象信息
                </n-button>
              </n-button-group>
            </n-space>

            <n-divider class="section-divider" />

            <!-- 航线详情表格 -->
            <RouteWaypointTable
              v-show="activeTab === 'detail'"
              :selected-route="selectedRoute"
              :show-pt-list="showPtList"
              :is-drawing="isRouteDrawing()"
              :is-editing="isRouteEditing"
              :can-edit="canEditSelectedRoute"
              :has-selected-route="hasSelectedRoute"
              @pt-select="handlePtSelect"
              @point-changed="onRoutePointInputChanged"
              @start-edit="startEditSelectedRoute"
              @save-edit="saveRouteEdit"
              @cancel-edit="cancelRouteEdit"
            />

            <!-- 地形剖面面板 -->
            <RouteProfilePanel
              v-show="activeTab === 'profile'"
              v-model:interval="profileInterval"
              :has-selected-route="hasSelectedRoute"
              @update:interval="handleProfileIntervalChanged"
              @redraw="redrawRouteProfile"
            />

            <!-- 气象信息面板 -->
            <RouteWeatherPanel
              v-show="activeTab === 'weather' && hasSelectedRoute"
              :has-selected-route="hasSelectedRoute"
              :route-pt-number="routePtNumber"
              :total-points="selectedRoute.points ? selectedRoute.points.length : 0"
              :now-time="nowTime"
              :level-options="levelOptions"
              :selected-level="selectedLevel"
              @prev-pt="prevPtWeather"
              @next-pt="nextPtWeather"
              @level-changed="levelChanged"
            />
          </n-layout-content>
        </n-layout>
      </div>
    </div>
  </n-config-provider>
</template>

<style scoped>
.route-manage-overlay {
  display: flex;
  justify-content: flex-end;
  position: absolute;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  pointer-events: none;
  z-index: 10;
}

#right {
  width: clamp(360px, 26vw, 480px);
  max-width: 100vw;
  height: 100vh;
  pointer-events: auto;
  background: rgba(16, 16, 20, 0.75);
  backdrop-filter: blur(6px);
}

#right :deep(.n-layout),
#right :deep(.n-layout-scroll-container),
#right :deep(.n-layout-content),
#right :deep(.n-layout-header) {
  background: transparent !important;
}

.route-manage-layout {
  height: 100%;
}

.route-manage-content {
  height: calc(100% - 61px);
}

#right :deep(.route-manage-content > .n-layout-scroll-container) {
  overflow: hidden;
}

.section-divider {
  flex: none;
  margin: 0.2rem -0.5rem;
}

.route-tabs {
  flex: none;
  margin: 0.3rem 0;
}

@media (max-width: 600px) {
  #right {
    width: 100vw;
  }
}
</style>
