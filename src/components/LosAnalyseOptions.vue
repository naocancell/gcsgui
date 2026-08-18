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
import type {
  LosViewPoint,
  RouteLosAnalyseParams,
} from '@/types/routeLineOfSight'
import { cartesian2ToCartesian3 } from '@/utils/map/coordinate'

type ViewPointIndex = 0 | 1

type EditableViewPoint = LosViewPoint & {
  useRelativeHeight: boolean
  appliedWaypointIndex: number | null
}

type LosAnalyseForm = Omit<
  RouteLosAnalyseParams,
  'isDualViewPointMode' | 'viewPoints'
>

const COORDINATE_PRECISION = 8
const COORDINATE_STEP = 10 ** -COORDINATE_PRECISION

function roundCoordinate(value: number) {
  return Number(value.toFixed(COORDINATE_PRECISION))
}

const props = defineProps<{
  show?: boolean
}>()
const emit = defineEmits<{
  //开始、结束地图选点时候控制是否开启模态框
  (event: 'update:show', show: boolean): void
  (event: 'startLosAnalyse', params: RouteLosAnalyseParams): void
  (event: 'cancelLosAnalyse'): void
}>()
const message = useMessage()
const routeStore = useRouteStore()
const formRef = ref<FormInst | null>(null)
const routeWaypoints = ref<AirlinePoint[]>([])
const selectedWaypointIndex = ref<number | null>(null)
const isDualViewPointMode = ref(false)
const activeViewPointIndex = ref<ViewPointIndex>(0)
const terrainHeightLoading = ref(false)
const viewPoints = ref<[EditableViewPoint, EditableViewPoint]>([
  {
    longitude: 110.093484,
    latitude: 22.395758,
    altitude: 100,
    useRelativeHeight: true,
    appliedWaypointIndex: null,
  },
  {
    longitude: 110.093484,
    latitude: 22.395758,
    altitude: 100,
    useRelativeHeight: true,
    appliedWaypointIndex: null,
  },
])
const losAnalyseForm = ref<LosAnalyseForm>({
  routeInterval: 500,
  losInterval: 200,
  isCalculateRefractionCorrection: true,
})
const activeViewPoint = computed(
  () => viewPoints.value[activeViewPointIndex.value],
)
const enabledViewPointIndexes = computed<ViewPointIndex[]>(() =>
  isDualViewPointMode.value ? [0, 1] : [0],
)
const waypointOptions = computed(() =>
  routeWaypoints.value.map((point, index) => ({
    label: `航点 ${point.nPt || index + 1}（${Number(point.alt)} m）`,
    value: index,
  })),
)

let pointPickHandler: ScreenSpaceEventHandler | null = null
let pointPickCanvas: HTMLCanvasElement | null = null
let previousCursor = ''
let reopeningAfterMapPick = false

function getViewPointLabel(index: ViewPointIndex) {
  return isDualViewPointMode.value ? `视点${index + 1}` : '视点'
}

function isSelectedWaypointApplied(index: ViewPointIndex) {
  return (
    selectedWaypointIndex.value !== null &&
    selectedWaypointIndex.value === viewPoints.value[index].appliedWaypointIndex
  )
}

function setDualViewPointMode(checked: boolean) {
  isDualViewPointMode.value = checked
  if (!checked) activeViewPointIndex.value = 0
}

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

function startMapPointPick(viewPointIndex: ViewPointIndex) {
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

        const viewPoint = viewPoints.value[viewPointIndex]
        viewPoint.longitude = roundCoordinate(longitude)
        viewPoint.latitude = roundCoordinate(latitude)
        if (!viewPoint.useRelativeHeight) {
          viewPoint.altitude = Math.max(-2000, Number(height.toFixed(2)))
        }
        viewPoint.appliedWaypointIndex = null
        activeViewPointIndex.value = viewPointIndex

        finishMapPointPick(true)
        message.success(`${getViewPointLabel(viewPointIndex)}位置已更新`)
      },
      ScreenSpaceEventType.LEFT_CLICK,
    )
    pointPickHandler.setInputAction(
      cancelMapPointPick,
      ScreenSpaceEventType.RIGHT_CLICK,
    )
    window.addEventListener('keydown', handleMapPointPickKeydown)
    emit('update:show', false)
    message.info(
      `请在地图上单击选择${getViewPointLabel(
        viewPointIndex,
      )}，按 Esc 或右键取消`,
    )
  } catch (error) {
    console.error('启动地图选点失败:', error)
    finishMapPointPick(true)
    message.error('启动地图选点失败')
  }
}

const rules: FormRules = {
  routeInterval: {
    type: 'number',
    required: true,
    min: 10,
    max: 1000000,
    message: '航线采样间距范围为 10 至 1000000 m',
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
}

const terrainHeightCache = new Map<string, number>()

async function getLevel13TerrainHeight(viewPointIndex: ViewPointIndex) {
  const viewer = window.viewer
  if (!viewer) throw new Error('地图尚未初始化')

  const viewPoint = viewPoints.value[viewPointIndex]
  const longitude = Number(viewPoint.longitude)
  const latitude = Number(viewPoint.latitude)
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    throw new Error(`${getViewPointLabel(viewPointIndex)}经纬度无效`)
  }

  const cacheKey = `${longitude}/${latitude}`
  const cachedHeight = terrainHeightCache.get(cacheKey)
  if (cachedHeight !== undefined) return cachedHeight

  const [terrainPosition] = await sampleTerrain(viewer.terrainProvider, 13, [
    Cartographic.fromDegrees(longitude, latitude),
  ])
  const terrainHeight = Number(terrainPosition?.height)
  if (!Number.isFinite(terrainHeight)) {
    throw new Error(
      `无法获取${getViewPointLabel(viewPointIndex)}位置的地形高度`,
    )
  }

  terrainHeightCache.set(cacheKey, terrainHeight)
  return terrainHeight
}

async function setRelativeHeightMode(
  viewPointIndex: ViewPointIndex,
  checked: boolean,
) {
  const viewPoint = viewPoints.value[viewPointIndex]
  if (checked === viewPoint.useRelativeHeight) return

  terrainHeightLoading.value = true
  try {
    const terrainHeight = await getLevel13TerrainHeight(viewPointIndex)
    const currentHeight = Number(viewPoint.altitude)
    if (!Number.isFinite(currentHeight)) {
      throw new Error(`${getViewPointLabel(viewPointIndex)}高度无效`)
    }

    viewPoint.altitude = checked
      ? Number(Math.max(0, currentHeight - terrainHeight).toFixed(2))
      : Number((currentHeight + terrainHeight).toFixed(2))
    viewPoint.useRelativeHeight = checked
    viewPoint.appliedWaypointIndex = null
  } catch (error) {
    console.error('切换视点高度模式失败:', error)
    message.error(error instanceof Error ? error.message : '地形高度查询失败')
  } finally {
    terrainHeightLoading.value = false
  }
}

function clearAppliedWaypoint(viewPointIndex: ViewPointIndex) {
  viewPoints.value[viewPointIndex].appliedWaypointIndex = null
}

function validateViewPoint(viewPointIndex: ViewPointIndex) {
  const viewPoint = viewPoints.value[viewPointIndex]
  return (
    Number.isFinite(Number(viewPoint.longitude)) &&
    Number(viewPoint.longitude) >= -180 &&
    Number(viewPoint.longitude) <= 180 &&
    Number.isFinite(Number(viewPoint.latitude)) &&
    Number(viewPoint.latitude) >= -90 &&
    Number(viewPoint.latitude) <= 90 &&
    Number.isFinite(Number(viewPoint.altitude)) &&
    Number(viewPoint.altitude) >= (viewPoint.useRelativeHeight ? 0 : -2000) &&
    Number(viewPoint.altitude) <= 100000
  )
}

const done = async () => {
  try {
    await formRef.value?.validate()
  } catch {
    message.warning('请检查通视分析参数')
    return
  }

  const invalidViewPoint = enabledViewPointIndexes.value.find(
    (index) => !validateViewPoint(index),
  )
  if (invalidViewPoint !== undefined) {
    activeViewPointIndex.value = invalidViewPoint
    message.warning(`请检查${getViewPointLabel(invalidViewPoint)}参数`)
    return
  }

  terrainHeightLoading.value = true
  try {
    const resolvedViewPoints = await Promise.all(
      enabledViewPointIndexes.value.map(
        async (index): Promise<LosViewPoint> => {
          const viewPoint = viewPoints.value[index]
          const terrainHeight = viewPoint.useRelativeHeight
            ? await getLevel13TerrainHeight(index)
            : 0
          return {
            longitude: roundCoordinate(Number(viewPoint.longitude)),
            latitude: roundCoordinate(Number(viewPoint.latitude)),
            altitude: Number((viewPoint.altitude + terrainHeight).toFixed(2)),
          }
        },
      ),
    )

    emit('startLosAnalyse', {
      ...losAnalyseForm.value,
      isDualViewPointMode: isDualViewPointMode.value,
      viewPoints: resolvedViewPoints,
    })
  } catch (error) {
    console.error('解析视点高度失败:', error)
    message.error(error instanceof Error ? error.message : '地形高度查询失败')
  } finally {
    terrainHeightLoading.value = false
  }
}

const cancel = () => {
  emit('cancelLosAnalyse')
}

async function applyWaypointToViewPoint(
  viewPointIndex: ViewPointIndex,
  waypointIndex: number,
  showMessage: boolean,
) {
  const point = routeWaypoints.value[waypointIndex]
  if (!point) return false

  const longitude = Number(point.lon)
  const latitude = Number(point.lat)
  const altitude = Number(point.alt)
  if (
    !Number.isFinite(longitude) ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(altitude)
  ) {
    if (showMessage) message.warning('该航点的坐标或高度无效')
    return false
  }

  const useRelativeHeight = viewPoints.value[viewPointIndex].useRelativeHeight
  viewPoints.value[viewPointIndex] = {
    longitude: roundCoordinate(longitude),
    latitude: roundCoordinate(latitude),
    altitude,
    useRelativeHeight: false,
    appliedWaypointIndex: waypointIndex,
  }

  if (useRelativeHeight) {
    const terrainHeight = await getLevel13TerrainHeight(viewPointIndex)
    viewPoints.value[viewPointIndex].altitude = Number(
      Math.max(0, altitude - terrainHeight).toFixed(2),
    )
    viewPoints.value[viewPointIndex].useRelativeHeight = true
  }
  activeViewPointIndex.value = viewPointIndex

  if (showMessage) {
    message.success(
      `已将航点 ${point.nPt || waypointIndex + 1} 设置为${getViewPointLabel(
        viewPointIndex,
      )}`,
    )
  }
  return true
}

async function setWaypointAsViewpoint(viewPointIndex: ViewPointIndex) {
  const waypointIndex = selectedWaypointIndex.value
  if (waypointIndex === null) {
    message.warning('请先选择一个航点')
    return
  }

  terrainHeightLoading.value = true
  try {
    await applyWaypointToViewPoint(viewPointIndex, waypointIndex, true)
  } catch (error) {
    console.error('设置航点为视点失败:', error)
    message.error(error instanceof Error ? error.message : '地形高度查询失败')
  } finally {
    terrainHeightLoading.value = false
  }
}

// 打开弹窗时加载当前选中航线。视点1使用首个航点，视点2使用最后一个航点。
watch(
  () => props.show,
  async (show) => {
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
    selectedWaypointIndex.value = routeWaypoints.value.length ? 0 : null
    activeViewPointIndex.value = 0

    if (routeWaypoints.value.length) {
      viewPoints.value.forEach((viewPoint) => {
        viewPoint.useRelativeHeight = true
      })
      terrainHeightLoading.value = true
      try {
        await Promise.all([
          applyWaypointToViewPoint(0, 0, false),
          applyWaypointToViewPoint(1, routeWaypoints.value.length - 1, false),
        ])
      } catch (error) {
        console.error('初始化视点失败:', error)
        message.error(
          error instanceof Error ? error.message : '地形高度查询失败',
        )
      } finally {
        activeViewPointIndex.value = 0
        terrainHeightLoading.value = false
      }
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
        :model="losAnalyseForm"
        :rules="rules"
        label-placement="left"
        label-width="140"
        require-mark-placement="right-hanging"
      >
        <n-form-item label="分析模式">
          <n-checkbox
            :checked="isDualViewPointMode"
            :disabled="terrainHeightLoading"
            @update:checked="setDualViewPointMode"
          >
            开启双视点模式
          </n-checkbox>
        </n-form-item>

        <n-form-item label="航点列表">
          <div class="waypoint-controls">
            <n-select
              v-model:value="selectedWaypointIndex"
              :options="waypointOptions"
              :placeholder="
                waypointOptions.length ? '请选择航点' : '当前航线没有航点'
              "
              :disabled="waypointOptions.length === 0 || terrainHeightLoading"
              filterable
            />
            <n-button-group class="viewpoint-action-group">
              <n-button
                v-for="index in enabledViewPointIndexes"
                :key="index"
                attr-type="button"
                :type="isSelectedWaypointApplied(index) ? 'success' : 'primary'"
                :disabled="
                  selectedWaypointIndex === null || terrainHeightLoading
                "
                @click="setWaypointAsViewpoint(index)"
              >
                <template #icon>
                  <n-icon>
                    <CheckmarkCircleOutline
                      v-if="isSelectedWaypointApplied(index)"
                    />
                    <LocationOutline v-else />
                  </n-icon>
                </template>
                {{
                  isDualViewPointMode
                    ? `设为视点${index + 1}`
                    : isSelectedWaypointApplied(index)
                      ? '已设为视点'
                      : '设为视点'
                }}
              </n-button>
            </n-button-group>
          </div>
        </n-form-item>

        <n-form-item label="视点位置">
          <n-button-group class="viewpoint-action-group map-pick-group">
            <n-button
              v-for="index in enabledViewPointIndexes"
              :key="index"
              attr-type="button"
              type="primary"
              secondary
              :disabled="terrainHeightLoading"
              @click="startMapPointPick(index)"
            >
              <template #icon>
                <n-icon><LocationOutline /></n-icon>
              </template>
              {{ isDualViewPointMode ? `选择视点${index + 1}` : '地图选点' }}
            </n-button>
          </n-button-group>
        </n-form-item>

        <n-form-item v-if="isDualViewPointMode" label="参数编辑">
          <n-radio-group
            v-model:value="activeViewPointIndex"
            class="viewpoint-segment"
            name="active-view-point"
            size="small"
          >
            <n-radio-button :value="0" label="视点1" />
            <n-radio-button :value="1" label="视点2" />
          </n-radio-group>
        </n-form-item>

        <n-form-item :label="isDualViewPointMode ? '高度模式' : '视点高度模式'">
          <n-checkbox
            :checked="activeViewPoint.useRelativeHeight"
            :disabled="terrainHeightLoading"
            @update:checked="
              setRelativeHeightMode(activeViewPointIndex, $event)
            "
          >
            使用相对高度（离地）
          </n-checkbox>
        </n-form-item>

        <n-form-item :label="isDualViewPointMode ? '经度/°' : '视点经度/°'">
          <n-input-number
            v-model:value="activeViewPoint.longitude"
            placeholder="110"
            :min="-180"
            :max="180"
            :step="COORDINATE_STEP"
            :precision="COORDINATE_PRECISION"
            @update:value="clearAppliedWaypoint(activeViewPointIndex)"
          />
        </n-form-item>

        <n-form-item :label="isDualViewPointMode ? '纬度/°' : '视点纬度/°'">
          <n-input-number
            v-model:value="activeViewPoint.latitude"
            placeholder="23"
            :min="-90"
            :max="90"
            :step="COORDINATE_STEP"
            :precision="COORDINATE_PRECISION"
            @update:value="clearAppliedWaypoint(activeViewPointIndex)"
          />
        </n-form-item>

        <n-form-item
          :label="
            activeViewPoint.useRelativeHeight
              ? '离地高度/m'
              : isDualViewPointMode
                ? '海拔高度/m'
                : '视点海拔高度/m'
          "
        >
          <n-input-number
            v-model:value="activeViewPoint.altitude"
            :placeholder="activeViewPoint.useRelativeHeight ? '100' : '1800'"
            :step="100"
            :min="activeViewPoint.useRelativeHeight ? 0 : -2000"
            :max="100000"
            :disabled="terrainHeightLoading"
            @update:value="clearAppliedWaypoint(activeViewPointIndex)"
          />
        </n-form-item>

        <n-form-item label="航线采样间距/m" path="routeInterval">
          <n-input-number
            v-model:value="losAnalyseForm.routeInterval"
            placeholder="500"
            :step="100"
            :min="10"
            :max="1000000"
          />
        </n-form-item>

        <n-form-item label="视线采样间距/m" path="losInterval">
          <n-input-number
            v-model:value="losAnalyseForm.losInterval"
            placeholder="200"
            :step="10"
            :min="10"
            :max="10000"
          />
        </n-form-item>
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
        <n-button type="warning" size="small" @click="cancel">取消</n-button>
      </n-space>
    </div>
  </n-modal>
</template>

<style scoped>
.los-options-modal {
  width: min(620px, calc(100vw - 32px));
}

.los-options-content,
.los-options-form,
.waypoint-controls,
.map-pick-group,
.viewpoint-segment {
  width: 100%;
}

.waypoint-controls {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 8px;
  min-width: 0;
}

.waypoint-controls > .n-select {
  width: 100%;
  min-width: 0;
}

.viewpoint-action-group {
  display: flex;
  width: 100%;
  min-width: 0;
}

.viewpoint-action-group > .n-button {
  min-width: 0;
  flex: 1;
}

.map-pick-group > .n-button {
  width: 50%;
}

.viewpoint-segment :deep(.n-radio-button) {
  width: 50%;
  text-align: center;
}

.los-options-actions {
  margin-top: 4px;
}

.los-options-form :deep(.n-input-number) {
  width: 100%;
}
</style>
