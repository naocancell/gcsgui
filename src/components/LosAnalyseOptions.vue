<script setup lang="ts">
import { CheckmarkCircleOutline, LocationOutline } from '@vicons/ionicons5'
import {
  Cartographic,
  Math as CesiumMath,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  sampleTerrain,
} from 'cesium'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { type FormInst, type FormRules, useMessage } from 'naive-ui'
import { useRouteStore } from '@/store/RouteStore'
import type { AirlinePoint } from '@/types/entityoptions'
import { cartesian2ToCartesian3 } from '@/utils/map/coordinate'

type LosAnalyseParams = {
  viewPointLon: number
  viewPointLat: number
  viewPointAlt: number
  routeInterval: number
  losInterval: number
  isCalculateRefractionCorrection: boolean
}

const props = defineProps<{
  show?: boolean
}>()
const emit = defineEmits<{
  //开始、结束地图选点时候控制是否开启模态框
  (event: 'update:show', show: boolean): void
  (event: 'startLosAnalyse', params: LosAnalyseParams): void
  (event: 'cancelLosAnalyse'): void
}>()
const message = useMessage()
const routeStore = useRouteStore()
const formRef = ref<FormInst | null>(null)
const routeWaypoints = ref<AirlinePoint[]>([])
const selectedWaypointIndex = ref<number | null>(null)
const appliedWaypointIndex = ref<number | null>(null)
const useRelativeViewPointHeight = ref(false)
const terrainHeightLoading = ref(false)
const isSelectedWaypointApplied = computed(
  () =>
    selectedWaypointIndex.value !== null &&
    selectedWaypointIndex.value === appliedWaypointIndex.value,
)
const waypointOptions = computed(() =>
  routeWaypoints.value.map((point, index) => ({
    label: `航点 ${point.nPt || index + 1}（${Number(point.alt)} m）`,
    value: index,
  })),
)
const losAnalyseParams = ref<LosAnalyseParams>({
  viewPointLon: 110.093484,
  viewPointLat: 22.395758,
  viewPointAlt: 1800,
  routeInterval: 500,
  losInterval: 200,
  isCalculateRefractionCorrection: true,
})
let pointPickHandler: ScreenSpaceEventHandler | null = null
let pointPickCanvas: HTMLCanvasElement | null = null
let previousCursor = ''
let reopeningAfterMapPick = false

function finishMapPointPick(reopenParams: boolean) {
  if (pointPickHandler && !pointPickHandler.isDestroyed()) {
    pointPickHandler.destroy()
  }
  pointPickHandler = null

  if (pointPickCanvas) {
    pointPickCanvas.style.cursor = previousCursor
  }
  pointPickCanvas = null
  previousCursor = ''
  window.removeEventListener('keydown', handleMapPointPickKeydown)

  if (routeStore.routeActionMode === 'losPointPicking') {
    routeStore.endRouteAction()
  }

  if (reopenParams) {
    reopeningAfterMapPick = !props.show
    emit('update:show', true)
  }
}

function cancelMapPointPick() {
  finishMapPointPick(true)
  message.info('已取消地图选点')
}

function handleMapPointPickKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return

  event.preventDefault()
  cancelMapPointPick()
}

function startMapPointPick() {
  if (routeStore.routeActionMode === 'drawing') {
    message.warning('请先结束当前航线绘制')
    return
  }
  if (routeStore.routeActionMode === 'editing') {
    message.warning('请先结束当前航线编辑')
    return
  }
  if (routeStore.routeActionMode === 'losPointPicking') return

  const viewer = window.viewer

  if (!viewer) {
    message.error('地图尚未初始化')
    return
  }
  if (!routeStore.startLosPointPicking()) {
    message.warning('当前地图正在执行其他操作')
    return
  }

  try {
    pointPickCanvas = viewer.scene.canvas
    previousCursor = pointPickCanvas.style.cursor
    pointPickCanvas.style.cursor = 'crosshair'
    pointPickHandler = new ScreenSpaceEventHandler(pointPickCanvas)

    pointPickHandler.setInputAction(
      (event: ScreenSpaceEventHandler.PositionedEvent) => {
        const position = cartesian2ToCartesian3(viewer, event.position)

        if (!position) {
          message.warning('未选中有效的地图位置，请重新选择')
          return
        }

        const cartographic = Cartographic.fromCartesian(position)
        const longitude = CesiumMath.toDegrees(cartographic.longitude)
        const latitude = CesiumMath.toDegrees(cartographic.latitude)
        const height = cartographic.height

        if (
          !Number.isFinite(longitude) ||
          !Number.isFinite(latitude) ||
          !Number.isFinite(height)
        ) {
          message.warning('无法获取该位置的坐标，请重新选择')
          return
        }

        losAnalyseParams.value.viewPointLon = Number(longitude.toFixed(6))
        losAnalyseParams.value.viewPointLat = Number(latitude.toFixed(6))
        if (!useRelativeViewPointHeight.value) {
          losAnalyseParams.value.viewPointAlt = Math.max(
            -2000,
            Number(height.toFixed(2)),
          )
        }
        appliedWaypointIndex.value = null

        finishMapPointPick(true)
        message.success('视点位置已更新')
      },
      ScreenSpaceEventType.LEFT_CLICK,
    )
    pointPickHandler.setInputAction(
      cancelMapPointPick,
      ScreenSpaceEventType.RIGHT_CLICK,
    )
    window.addEventListener('keydown', handleMapPointPickKeydown)
    emit('update:show', false)
    message.info('请在地图上单击选择视点，按 Esc 或右键取消')
  } catch (error) {
    console.error('启动地图选点失败:', error)
    finishMapPointPick(true)
    message.error('启动地图选点失败')
  }
}

//传递参数
const rules = computed<FormRules>(() => ({
  viewPointLon: {
    type: 'number',
    required: true,
    min: -180,
    max: 180,
    message: '经度范围为 -180° 至 180°',
    trigger: ['input', 'blur'],
  },
  viewPointLat: {
    type: 'number',
    required: true,
    min: -90,
    max: 90,
    message: '纬度范围为 -90° 至 90°',
    trigger: ['input', 'blur'],
  },
  viewPointAlt: {
    type: 'number',
    required: true,
    min: useRelativeViewPointHeight.value ? 0 : -2000,
    max: 100000,
    message: useRelativeViewPointHeight.value
      ? '视点离地高度范围为 0 至 100000 m'
      : '视点海拔高度范围为 -2000 至 100000 m',
    trigger: ['input', 'blur'],
  },
  routeInterval: {
    type: 'number',
    required: true,
    min: 10,
    max: 1000000,
    message: '航线采样间距范围为 10 至 10000 m',
    trigger: ['input', 'blur'],
  },
  losInterval: {
    type: 'number',
    required: true,
    min: 10,
    max: 10000,
    message: '视线采样间距范围为 10 至 10000 m',
    trigger: ['input', 'blur'],
  },
}))

let terrainHeightCache:
  | { longitude: number; latitude: number; height: number }
  | undefined

async function getLevel11TerrainHeight() {
  const viewer = window.viewer
  if (!viewer) {
    throw new Error('地图尚未初始化')
  }

  const longitude = Number(losAnalyseParams.value.viewPointLon)
  const latitude = Number(losAnalyseParams.value.viewPointLat)
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    throw new Error('视点经纬度无效')
  }

  if (
    terrainHeightCache?.longitude === longitude &&
    terrainHeightCache.latitude === latitude
  ) {
    return terrainHeightCache.height
  }

  const [terrainPosition] = await sampleTerrain(viewer.terrainProvider, 11, [
    Cartographic.fromDegrees(longitude, latitude),
  ])
  const terrainHeight = Number(terrainPosition?.height)
  if (!Number.isFinite(terrainHeight)) {
    throw new Error('无法获取视点位置的地形高度')
  }

  terrainHeightCache = {
    longitude,
    latitude,
    height: terrainHeight,
  }
  return terrainHeight
}

async function setRelativeHeightMode(checked: boolean) {
  if (checked === useRelativeViewPointHeight.value) return

  terrainHeightLoading.value = true
  try {
    const terrainHeight = await getLevel11TerrainHeight()
    const currentHeight = Number(losAnalyseParams.value.viewPointAlt)
    if (!Number.isFinite(currentHeight)) {
      throw new Error('视点高度无效')
    }

    losAnalyseParams.value.viewPointAlt = checked
      ? Number(Math.max(0, currentHeight - terrainHeight).toFixed(2))
      : Number((currentHeight + terrainHeight).toFixed(2))
    useRelativeViewPointHeight.value = checked
    appliedWaypointIndex.value = null
  } catch (error) {
    console.error('切换视点高度模式失败:', error)
    message.error(error instanceof Error ? error.message : '地形高度查询失败')
  } finally {
    terrainHeightLoading.value = false
  }
}

function clearAppliedWaypoint() {
  appliedWaypointIndex.value = null
}

const done = async () => {
  try {
    await formRef.value?.validate()
  } catch {
    message.warning('请检查通视分析参数')
    return
  }

  let viewPointAlt = losAnalyseParams.value.viewPointAlt
  if (useRelativeViewPointHeight.value) {
    terrainHeightLoading.value = true
    try {
      const terrainHeight = await getLevel11TerrainHeight()
      viewPointAlt = Number((terrainHeight + viewPointAlt).toFixed(2))
    } catch (error) {
      console.error('解析视点相对高度失败:', error)
      message.error(error instanceof Error ? error.message : '地形高度查询失败')
      return
    } finally {
      terrainHeightLoading.value = false
    }
  }

  emit('startLosAnalyse', {
    ...losAnalyseParams.value,
    viewPointAlt,
  })
}
const cancel = () => {
  emit('cancelLosAnalyse')
}
//参数为是否弹出已将某航点设为视点的提示框
function setWaypointAsViewpoint(showMessage = true) {
  const index = selectedWaypointIndex.value
  const point = index === null ? undefined : routeWaypoints.value[index]

  if (!point) {
    message.warning('请先选择一个航点')
    return
  }

  const longitude = Number(point.lon)
  const latitude = Number(point.lat)
  const altitude = Number(point.alt)
  if (
    //检查经纬度和高度是否为有效数字
    !Number.isFinite(longitude) ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(altitude)
  ) {
    message.warning('该航点的坐标或高度无效')
    return
  }

  losAnalyseParams.value.viewPointLon = Number(longitude.toFixed(6))
  losAnalyseParams.value.viewPointLat = Number(latitude.toFixed(6))
  losAnalyseParams.value.viewPointAlt = altitude
  useRelativeViewPointHeight.value = false
  appliedWaypointIndex.value = index

  if (showMessage) {
    message.success(`已将航点 ${point.nPt || index + 1} 设置为视点`)
  }
}

// 打开弹窗时加载当前选中航线，并默认使用第一个航点。
watch(
  //写成箭头函数是侦听某个具体 props 属性
  () => props.show,
  (show) => {
    if (!show) return

    // 地图选点结束后只恢复弹窗，保留刚选取的坐标。
    if (reopeningAfterMapPick) {
      reopeningAfterMapPick = false
      return
    }

    const routeManage = window.routeManageViewer
    const routeId = routeManage?.selectedRouteId
    const points = routeManage?.routesMap?.get(String(routeId))?.line?.points

    routeWaypoints.value = Array.isArray(points) ? points : []
    //第一次默认设置第一个航点为视点
    selectedWaypointIndex.value = routeWaypoints.value.length ? 0 : null
    if (selectedWaypointIndex.value !== null) {
      //第一次设置不弹出提示框:false
      setWaypointAsViewpoint(false)
    }
  },
)
onBeforeUnmount(() => {
  finishMapPointPick(false)
})
</script>

<template>
  <n-modal
    :show="props.show"
    :mask-closable="false"
    preset="dialog"
    class="los-options-modal"
    @update:show="emit('update:show', $event)"
  >
    <template #header>
      <div>航线通视分析参数设置</div>
    </template>
    <div class="los-options-content">
      <n-form
        ref="formRef"
        class="los-options-form"
        :model="losAnalyseParams"
        :rules="rules"
        label-placement="left"
        label-width="140"
        require-mark-placement="right-hanging"
      >
        <!-- 视点经纬度高度设置 -->
        <n-form-item label="航点列表">
          <n-input-group class="waypoint-picker">
            <n-select
              v-model:value="selectedWaypointIndex"
              class="waypoint-select"
              :options="waypointOptions"
              :placeholder="
                waypointOptions.length ? '请选择航点' : '当前航线没有航点'
              "
              :disabled="waypointOptions.length === 0 || terrainHeightLoading"
              filterable
            />
            <n-button
              attr-type="button"
              :type="isSelectedWaypointApplied ? 'success' : 'primary'"
              class="waypoint-apply-button"
              :disabled="selectedWaypointIndex === null || terrainHeightLoading"
              @click="setWaypointAsViewpoint()"
            >
              <template #icon>
                <n-icon>
                  <CheckmarkCircleOutline v-if="isSelectedWaypointApplied" />
                  <LocationOutline v-else />
                </n-icon>
              </template>
              {{ isSelectedWaypointApplied ? '已设为视点' : '设为视点' }}
            </n-button>
          </n-input-group>
        </n-form-item>

        <n-form-item label="视点位置">
          <n-button
            attr-type="button"
            type="primary"
            secondary
            block
            :disabled="terrainHeightLoading"
            @click="startMapPointPick"
          >
            <template #icon>
              <n-icon><LocationOutline /></n-icon>
            </template>
            地图选点
          </n-button>
        </n-form-item>

        <n-form-item label="视点高度模式">
          <n-checkbox
            :checked="useRelativeViewPointHeight"
            :disabled="terrainHeightLoading"
            @update:checked="setRelativeHeightMode"
          >
            使用相对高度（离地）
          </n-checkbox>
        </n-form-item>

        <n-form-item label="视点经度/°" path="viewPointLon">
          <n-input-number
            v-model:value="losAnalyseParams.viewPointLon"
            placeholder="110"
            :min="-180"
            :max="180"
            :step="0.000001"
            :precision="6"
            @update:value="clearAppliedWaypoint"
          />
        </n-form-item>

        <n-form-item label="视点纬度/°" path="viewPointLat">
          <n-input-number
            v-model:value="losAnalyseParams.viewPointLat"
            placeholder="23"
            :min="-90"
            :max="90"
            :step="0.000001"
            :precision="6"
            @update:value="clearAppliedWaypoint"
          />
        </n-form-item>

        <n-form-item
          :label="
            useRelativeViewPointHeight ? '视点离地高度/m' : '视点海拔高度/m'
          "
          path="viewPointAlt"
        >
          <n-input-number
            v-model:value="losAnalyseParams.viewPointAlt"
            :placeholder="useRelativeViewPointHeight ? '100' : '1800'"
            :step="100"
            :min="useRelativeViewPointHeight ? 0 : -2000"
            :max="100000"
            :disabled="terrainHeightLoading"
            @update:value="clearAppliedWaypoint"
          />
        </n-form-item>

        <n-form-item label="航线采样间距/m" path="routeInterval">
          <n-input-number
            v-model:value="losAnalyseParams.routeInterval"
            placeholder="500"
            :step="100"
            :min="10"
            :max="1000000"
          />
        </n-form-item>

        <n-form-item label="视线采样间距/m" path="losInterval">
          <n-input-number
            v-model:value="losAnalyseParams.losInterval"
            placeholder="200"
            :step="10"
            :min="10"
            :max="10000"
          />
        </n-form-item>
        <!-- 是否考虑大气折射开关 -->
        <!-- <n-form-item label="大气折射">
            <n-switch v-model:value="losAnalyseParams.isCalculateRefractionCorrection">
              <template #checked>是</template>
              <template #unchecked>否</template>
            </n-switch>
          </n-form-item> -->
      </n-form>
      <n-space class="los-options-actions" justify="center">
        <n-button
          type="primary"
          size="small"
          :loading="terrainHeightLoading"
          @click="done"
        >
          确定
        </n-button>
        <n-button @click="cancel" type="warning" size="small">取消</n-button>
      </n-space>
    </div>
  </n-modal>
</template>

<style scoped>
.los-options-modal {
  width: min(560px, calc(100vw - 32px));
}

.los-options-content,
.los-options-form,
.waypoint-picker {
  width: 100%;
}

.waypoint-select {
  min-width: 0;
  flex: 1;
}

.waypoint-apply-button {
  flex: none;
  min-width: 116px;
}

.los-options-actions {
  margin-top: 4px;
}

.los-options-form :deep(.n-input-number) {
  width: 100%;
}
</style>
