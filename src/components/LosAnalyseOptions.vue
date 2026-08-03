<script setup lang="ts">
import { LocationOutline } from '@vicons/ionicons5'
import {
  Cartographic,
  Math as CesiumMath,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
} from 'cesium'
import { onBeforeUnmount, ref, watch } from 'vue'
import { type FormInst, type FormRules, useMessage } from 'naive-ui'
import { useRouteStore } from '@/store/RouteStore'
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
    // 弹窗已经隐藏时，说明这次是地图选点完成或取消后的恢复。
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
        losAnalyseParams.value.viewPointAlt = Math.max(
          -2000,
          Number(height.toFixed(2)),
        )

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
const rules: FormRules = {
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
    min: -2000,
    max: 10000,
    message: '视点高度范围为 0 至 100000 m',
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
}

const done = async () => {
  try {
    await formRef.value?.validate()
    emit('startLosAnalyse', { ...losAnalyseParams.value })
  } catch {
    message.warning('请检查通视分析参数')
  }
}
const cancel = () => {
  emit('cancelLosAnalyse')
}
//默认设置为第一个航点的经纬度高度
watch(
  () => props.show,
  (show) => {
    if (!show) return

    // 地图选点后只恢复弹窗，不用航点 1 覆盖当前视点参数。
    if (reopeningAfterMapPick) {
      reopeningAfterMapPick = false
      return
    }

    const routeManage = window.routeManageViewer
    const routeId = routeManage?.selectedRouteId
    const firstPoint = routeManage?.routesMap?.get(String(routeId))?.line
      ?.points?.[0]

    if (!firstPoint) return

    losAnalyseParams.value.viewPointLon = Number(
      Number(firstPoint.lon).toFixed(6),
    )
    losAnalyseParams.value.viewPointLat = Number(
      Number(firstPoint.lat).toFixed(6),
    )
    losAnalyseParams.value.viewPointAlt = Number(firstPoint.alt)
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
    @update:show="emit('update:show', $event)"
  >
    <template #header>
      <div>航线通视分析参数设置</div>
    </template>
    <div>
      <n-space>
        <n-form
          ref="formRef"
          :model="losAnalyseParams"
          :rules="rules"
          label-placement="left"
          label-width="auto"
          require-mark-placement="right-hanging"
        >
          <!-- 视点经纬度高度设置 -->
          <n-form-item label="视点位置">
            <n-button
              attr-type="button"
              type="primary"
              secondary
              block
              @click="startMapPointPick"
            >
              <template #icon>
                <n-icon><LocationOutline /></n-icon>
              </template>
              地图选点
            </n-button>
          </n-form-item>

          <n-form-item label="视点经度/°" path="viewPointLon">
            <n-input-number
              v-model:value="losAnalyseParams.viewPointLon"
              placeholder="110"
              :min="-180"
              :max="180"
              :step="0.000001"
              :precision="6"
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
            />
          </n-form-item>

          <n-form-item label="视点高度/m" path="viewPointAlt">
            <n-input-number
              v-model:value="losAnalyseParams.viewPointAlt"
              placeholder="1800"
              :step="100"
              :min="-2000"
              :max="100000"
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
      </n-space>
      <n-space justify="center">
        <n-button @click="done" type="primary" size="small">确定</n-button>
        <n-button @click="cancel" type="warning" size="small">取消</n-button>
      </n-space>
    </div>
  </n-modal>
</template>

<style scoped></style>
