<script setup lang="ts">
import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  CustomDataSource,
  Entity,
  HeightReference,
  LabelStyle,
  Math as CesiumMath,
  sampleTerrainMostDetailed,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  VerticalOrigin,
  Viewer,
} from 'cesium'
import {
  computed,
  markRaw,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
} from 'vue'
import { useMessage } from 'naive-ui'
import { getMapAssetsFile } from '@/utils/getAssets'
import { isExclusiveMapPicking } from '@/utils/map/mapPicking'
import { CloseOutline } from '@vicons/ionicons5'

type MarkerPoint = {
  id: string
  name: string
  longitude: number
  latitude: number
  height: number
  entity: Entity
}

type DraftPoint = {
  name: string
  longitude: number | null
  latitude: number | null
  height: number | null
}

const showPanel = ref(false)
const picking = ref(false)
const picked = ref(false)
const saving = ref(false)
const importing = ref(false)
const exporting = ref(false)
const points = ref<MarkerPoint[]>([])
const selectedIds = ref<string[]>([])
const activePointId = ref<string | null>(null)
const terrainLoading = ref(false)
const message = useMessage()
const panelRef = ref<HTMLElement | { $el?: HTMLElement } | null>(null)
const panelPosition = reactive({ x: 0, y: 72 })
const panelPositionInitialized = ref(false)
const dragging = ref(false)
let dragOffset = { x: 0, y: 0 }

const draft = reactive<DraftPoint>({
  name: '',
  longitude: null,
  latitude: null,
  height: null,
})

// 地图点击后先显示一个不带名称的草稿图标，确认添加后再替换为正式标记点
const draftEntityId = 'marker-point-draft'
let draftEntity: Entity | undefined
let pickHandler: ScreenSpaceEventHandler | undefined
let moveTimer: ReturnType<typeof setTimeout> | undefined
let terrainRequestId = 0

type SaveFilePickerHandle = {
  createWritable: () => Promise<{
    write: (content: string) => Promise<void>
    close: () => Promise<void>
  }>
}

type SaveFilePicker = (options?: {
  suggestedName?: string
  types?: Array<{
    description?: string
    accept: Record<string, string[]>
  }>
}) => Promise<SaveFilePickerHandle>

const selectedPoints = computed(() =>
  points.value.filter((point) => selectedIds.value.includes(point.id)),
)
const allPointsSelected = computed(
  () =>
    points.value.length > 0 && selectedIds.value.length === points.value.length,
)

function getViewer(): Viewer | undefined {
  const viewer = window.viewer
  return viewer && !viewer.isDestroyed() ? viewer : undefined
}

function getMarkerLayer(viewer: Viewer) {
  const existing = viewer.dataSources.getByName('Marker')[0]
  if (existing) return existing

  const layer = new CustomDataSource('Marker')
  viewer.dataSources.add(layer)
  return layer
}

function getPanelElement() {
  const value = panelRef.value
  if (!value) return null
  return value instanceof HTMLElement ? value : (value.$el ?? null)
}

function clampPanelPosition(x: number, y: number) {
  const element = getPanelElement()
  const width = element?.offsetWidth ?? 620
  const height = element?.offsetHeight ?? 520
  panelPosition.x = Math.max(0, Math.min(x, window.innerWidth - width))
  panelPosition.y = Math.max(0, Math.min(y, window.innerHeight - height))
}

function initializePanelPosition() {
  if (panelPositionInitialized.value) return
  panelPosition.x = Math.max(16, window.innerWidth - 640)
  panelPosition.y = 72
  panelPositionInitialized.value = true
}

function handleDragMove(event: PointerEvent) {
  if (!dragging.value) return
  clampPanelPosition(event.clientX - dragOffset.x, event.clientY - dragOffset.y)
}

function stopDragging() {
  dragging.value = false
  window.removeEventListener('pointermove', handleDragMove)
  window.removeEventListener('pointerup', stopDragging)
}

function startDragging(event: PointerEvent) {
  if ((event.target as HTMLElement)?.closest('button')) return
  initializePanelPosition()
  const rect = getPanelElement()?.getBoundingClientRect()
  if (!rect) return
  dragging.value = true
  dragOffset = { x: event.clientX - rect.left, y: event.clientY - rect.top }
  window.addEventListener('pointermove', handleDragMove)
  window.addEventListener('pointerup', stopDragging)
  event.preventDefault()
}

function resetDraft() {
  removeDraftEntity()
  terrainRequestId += 1
  terrainLoading.value = false
  draft.name = ''
  draft.longitude = null
  draft.latitude = null
  draft.height = null
  picked.value = false
}

function removeDraftEntity() {
  const viewer = getViewer()
  if (draftEntity && viewer) {
    viewer.dataSources.getByName('Marker')[0]?.entities.remove(draftEntity)
    viewer.scene.requestRender()
  }
  draftEntity = undefined
}

function setCursor(crosshair: boolean) {
  const viewer = getViewer()
  if (viewer) viewer.scene.canvas.style.cursor = crosshair ? 'crosshair' : ''
}

function pickGroundPoint(position: Cartesian2) {
  const viewer = getViewer()
  if (!viewer) return undefined

  const ray = viewer.camera.getPickRay(position)
  if (!ray) return undefined

  return (
    viewer.scene.globe.pick(ray, viewer.scene) ||
    viewer.camera.pickEllipsoid(position, viewer.scene.globe.ellipsoid)
  )
}

async function sampleHeight(
  longitude: number,
  latitude: number,
  fallback?: number,
  updateDraftValue = true,
) {
  const viewer = getViewer()
  if (!viewer) return fallback ?? 0

  const requestId = ++terrainRequestId
  terrainLoading.value = true
  const cartographic = Cartographic.fromDegrees(longitude, latitude)
  const globeHeight = viewer.scene.globe.getHeight(cartographic)
  const defaultHeight = Number.isFinite(globeHeight)
    ? Number(globeHeight)
    : (fallback ?? 0)
  try {
    const result = await sampleTerrainMostDetailed(viewer.terrainProvider, [
      cartographic,
    ])
    const height = Number(result[0]?.height)
    if (
      updateDraftValue &&
      requestId === terrainRequestId &&
      Number.isFinite(height)
    ) {
      draft.height = height
    }
    return Number.isFinite(height) ? height : defaultHeight
  } catch {
    if (updateDraftValue && requestId === terrainRequestId) {
      draft.height = defaultHeight
    }
    return defaultHeight
  } finally {
    if (requestId === terrainRequestId) terrainLoading.value = false
  }
}

async function updateDraftFromCartesian(
  cartesian: Cartesian3,
  showPreview = false,
) {
  const cartographic = Cartographic.fromCartesian(cartesian)
  const longitude = CesiumMath.toDegrees(cartographic.longitude)
  const latitude = CesiumMath.toDegrees(cartographic.latitude)
  const fallbackHeight = Number.isFinite(cartographic.height)
    ? cartographic.height
    : 0

  draft.longitude = Number(longitude.toFixed(8))
  draft.latitude = Number(latitude.toFixed(8))
  draft.height = fallbackHeight
  if (showPreview) updateDraftEntity()
  await sampleHeight(longitude, latitude, fallbackHeight)
  if (showPreview) updateDraftEntity()
}

function updateDraftEntity() {
  const viewer = getViewer()
  if (
    !viewer ||
    draft.longitude === null ||
    draft.latitude === null ||
    !Number.isFinite(draft.longitude) ||
    !Number.isFinite(draft.latitude)
  ) {
    removeDraftEntity()
    return
  }

  const position = Cartesian3.fromDegrees(
    draft.longitude,
    draft.latitude,
    Number.isFinite(draft.height) ? Number(draft.height) : 0,
  )
  if (!draftEntity) {
    draftEntity = createMarkerEntity(
      {
        id: 'draft',
        name: '',
        longitude: draft.longitude,
        latitude: draft.latitude,
        height: Number.isFinite(draft.height) ? Number(draft.height) : 0,
      },
      { entityId: draftEntityId, showLabel: false },
    )
    getMarkerLayer(viewer).entities.add(draftEntity)
  } else {
    draftEntity.position = position
  }
  viewer.scene.requestRender()
}

function handleMouseMove(event: ScreenSpaceEventHandler.MotionEvent) {
  if (moveTimer) clearTimeout(moveTimer)
  moveTimer = setTimeout(() => {
    moveTimer = undefined
    const cartesian = pickGroundPoint(event.endPosition)
    if (cartesian) void updateDraftFromCartesian(cartesian)
  }, 100)
}

function handleMapClick(event: ScreenSpaceEventHandler.PositionedEvent) {
  if (isExclusiveMapPicking()) return
  const cartesian = pickGroundPoint(event.position)
  if (!cartesian) {
    message.warning('无法获取该位置的地面坐标')
    return
  }

  picked.value = true
  stopPicking()
  // 先用点击位置立即显示图标，精细地形高度返回后再校正它的高度。
  void updateDraftFromCartesian(cartesian, true)
}

function startPicking() {
  const viewer = getViewer()
  if (!viewer) {
    message.warning('地图尚未初始化')
    return
  }

  stopPicking()
  pickHandler = new ScreenSpaceEventHandler(viewer.scene.canvas)
  pickHandler.setInputAction(handleMouseMove, ScreenSpaceEventType.MOUSE_MOVE)
  pickHandler.setInputAction(handleMapClick, ScreenSpaceEventType.LEFT_CLICK)
  picking.value = true
  setCursor(true)
}

function stopPicking() {
  if (pickHandler && !pickHandler.isDestroyed()) pickHandler.destroy()
  pickHandler = undefined
  picking.value = false
  setCursor(false)
  if (moveTimer) {
    clearTimeout(moveTimer)
    moveTimer = undefined
  }
}

function createMarkerEntity(
  point: Omit<MarkerPoint, 'entity'>,
  options: { entityId?: string; showLabel?: boolean } = {},
) {
  const position = Cartesian3.fromDegrees(
    point.longitude,
    point.latitude,
    point.height,
  )
  const showLabel = options.showLabel ?? true
  return markRaw(
    new Entity({
      id: options.entityId ?? `marker-point-${point.id}`,
      name: showLabel ? point.name : undefined,
      position,
      billboard: {
        image: getMapAssetsFile('marker.svg'),
        width: 32,
        height: 32,
        heightReference: HeightReference.NONE,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: showLabel
        ? {
            text: point.name,
            font: 'bold 14px sans-serif',
            fillColor: Color.WHITE,
            outlineColor: Color.BLACK,
            outlineWidth: 3,
            style: LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cartesian2(22, -8),
            verticalOrigin: VerticalOrigin.BOTTOM,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          }
        : undefined,
      properties: {
        markerPointId: point.id,
      },
    }),
  )
}

function validateDraft() {
  if (!draft.name.trim()) {
    message.warning('请输入标记点名称')
    return false
  }
  if (
    draft.longitude === null ||
    !Number.isFinite(draft.longitude) ||
    draft.longitude < -180 ||
    draft.longitude > 180
  ) {
    message.warning('请输入有效的经度（-180 至 180）')
    return false
  }
  if (
    draft.latitude === null ||
    !Number.isFinite(draft.latitude) ||
    draft.latitude < -90 ||
    draft.latitude > 90
  ) {
    message.warning('请输入有效的纬度（-90 至 90）')
    return false
  }
  return true
}

async function addPoint() {
  if (!validateDraft()) return
  const viewer = getViewer()
  if (!viewer) {
    message.warning('地图尚未初始化')
    return
  }

  saving.value = true
  try {
    let height = Number(draft.height)
    if (!Number.isFinite(height)) {
      height = await sampleHeight(draft.longitude!, draft.latitude!)
    }
    if (!Number.isFinite(height)) height = 0

    const pointData = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: draft.name.trim(),
      longitude: draft.longitude!,
      latitude: draft.latitude!,
      height,
    }
    const entity = createMarkerEntity(pointData)
    removeDraftEntity()
    getMarkerLayer(viewer).entities.add(entity)
    points.value.push({ ...pointData, entity })
    activePointId.value = pointData.id
    selectedIds.value = [pointData.id]
    viewer.scene.requestRender()
    message.success(`已添加标记点“${pointData.name}”`)
    resetDraft()
    startPicking()
  } finally {
    saving.value = false
  }
}

function focusPoint(point: MarkerPoint) {
  const viewer = getViewer()
  if (!viewer) return
  activePointId.value = point.id
  viewer.camera.flyTo({
    destination: Cartesian3.fromDegrees(
      point.longitude,
      point.latitude,
      Math.max(point.height + 800, 1000),
    ),
    orientation: {
      heading: 0,
      pitch: -CesiumMath.PI_OVER_TWO,
      roll: 0,
    },
    duration: 1.2,
  })
}

function removePoint(point: MarkerPoint) {
  const viewer = getViewer()
  const layer = viewer?.dataSources.getByName('Marker')[0]
  layer?.entities.remove(point.entity)
  points.value = points.value.filter((item) => item.id !== point.id)
  selectedIds.value = selectedIds.value.filter((id) => id !== point.id)
  if (activePointId.value === point.id) activePointId.value = null
  viewer?.scene.requestRender()
}

function deleteSelected() {
  const ids = new Set(selectedIds.value)
  const removing = points.value.filter((point) => ids.has(point.id))
  if (removing.length === 0) {
    message.warning('请先选择要删除的标记点')
    return
  }
  removing.forEach(removePoint)
  message.success(`已删除 ${removing.length} 个标记点`)
}

function selectAllPoints() {
  selectedIds.value = points.value.map((point) => point.id)
}

function clearPointSelection() {
  selectedIds.value = []
}

function buildExportContent(items: MarkerPoint[]) {
  const lines = [
    '标记点名称\t经度\t纬度\t地形高度(米)',
    ...items.map((point) =>
      [
        point.name,
        point.longitude.toFixed(8),
        point.latitude.toFixed(8),
        point.height.toFixed(2),
      ].join('\t'),
    ),
  ]
  return `\uFEFF${lines.join('\r\n')}\r\n`
}

async function exportPoints(items: MarkerPoint[]) {
  if (items.length === 0) {
    message.warning('没有可导出的标记点')
    return
  }

  const content = buildExportContent(items)
  exporting.value = true
  try {
    const saveFilePicker = (
      window as Window & { showSaveFilePicker?: SaveFilePicker }
    ).showSaveFilePicker
    if (saveFilePicker) {
      const handle = await saveFilePicker({
        suggestedName: `标记点_${new Date().toISOString().slice(0, 10)}.txt`,
        types: [
          {
            description: '文本文件',
            accept: { 'text/plain': ['.txt'] },
          },
        ],
      })
      const writable = await handle.createWritable()
      await writable.write(content)
      await writable.close()
    } else {
      const blob = new Blob([content], {
        type: 'text/plain;charset=utf-8',
      })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `标记点_${new Date().toISOString().slice(0, 10)}.txt`
      anchor.click()
      URL.revokeObjectURL(url)
    }
    message.success(`已导出 ${items.length} 个标记点`)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return
    message.error(
      `导出标记点失败：${error instanceof Error ? error.message : String(error)}`,
    )
  } finally {
    exporting.value = false
  }
}

function parseImportedPoints(content: string) {
  const rows = content
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const imported: Array<{
    name: string
    longitude: number
    latitude: number
    height: number | null
  }> = []
  rows.forEach((line, index) => {
    if (index === 0 && /标记点名称|经度|longitude/i.test(line)) return
    const columns = line
      .split(line.includes('\t') ? '\t' : ',')
      .map((item) => item.trim())
    if (columns.length < 3) return
    const [name, longitudeText, latitudeText, heightText] = columns
    const longitude = Number(longitudeText)
    const latitude = Number(latitudeText)
    const height =
      heightText === undefined || heightText === '' ? null : Number(heightText)
    if (
      !name ||
      !Number.isFinite(longitude) ||
      !Number.isFinite(latitude) ||
      longitude < -180 ||
      longitude > 180 ||
      latitude < -90 ||
      latitude > 90 ||
      (height !== null && !Number.isFinite(height))
    ) {
      return
    }
    imported.push({ name, longitude, latitude, height })
  })
  return imported
}

async function importPoints() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.txt,.csv,text/plain,text/csv'
  const content = await new Promise<string | null>((resolve) => {
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) {
        resolve(null)
        return
      }
      const reader = new FileReader()
      reader.onload = () =>
        resolve(typeof reader.result === 'string' ? reader.result : null)
      reader.onerror = () => resolve(null)
      reader.readAsText(file, 'utf-8')
    }
    input.click()
  })
  if (!content) return

  const imported = parseImportedPoints(content)
  if (imported.length === 0) {
    message.warning('文件中没有有效的标记点记录')
    return
  }
  const viewer = getViewer()
  if (!viewer) {
    message.warning('地图尚未初始化')
    return
  }
  importing.value = true
  try {
    const layer = getMarkerLayer(viewer)
    const added: MarkerPoint[] = []
    for (const item of imported) {
      const height =
        item.height ??
        (await sampleHeight(item.longitude, item.latitude, 0, false))
      const pointData = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: item.name,
        longitude: item.longitude,
        latitude: item.latitude,
        height: Number.isFinite(height) ? height : 0,
      }
      const entity = createMarkerEntity(pointData)
      layer.entities.add(entity)
      added.push({ ...pointData, entity })
    }
    points.value.push(...added)
    selectedIds.value = added.map((point) => point.id)
    activePointId.value = added[added.length - 1]?.id ?? null
    viewer.scene.requestRender()
    message.success(`已导入 ${added.length} 个标记点`)
  } finally {
    importing.value = false
  }
}

function exportSelected() {
  const items =
    selectedPoints.value.length > 0 ? selectedPoints.value : points.value
  void exportPoints(items)
}

function handleCoordinateChange() {
  if (
    draft.longitude === null ||
    draft.latitude === null ||
    !Number.isFinite(draft.longitude) ||
    !Number.isFinite(draft.latitude) ||
    draft.longitude < -180 ||
    draft.longitude > 180 ||
    draft.latitude < -90 ||
    draft.latitude > 90
  ) {
    terrainRequestId += 1
    terrainLoading.value = false
    draft.height = null
    removeDraftEntity()
    return
  }
  picked.value = false
  updateDraftEntity()
  void sampleHeight(draft.longitude, draft.latitude).then(() => {
    updateDraftEntity()
  })
}

function open() {
  showPanel.value = true
  resetDraft()
  initializePanelPosition()
  startPicking()
}

function close() {
  stopPicking()
  resetDraft()
  showPanel.value = false
}

defineExpose({ open, close, exportSelected })

function handleWindowResize() {
  if (showPanel.value) clampPanelPosition(panelPosition.x, panelPosition.y)
}

onMounted(() => {
  window.addEventListener('resize', handleWindowResize)
})

onBeforeUnmount(() => {
  stopPicking()
  resetDraft()
  stopDragging()
  window.removeEventListener('resize', handleWindowResize)
})
</script>

<template>
  <n-card
    v-if="showPanel"
    ref="panelRef"
    class="marker-points-panel"
    size="small"
    :bordered="false"
    :style="{ left: `${panelPosition.x}px`, top: `${panelPosition.y}px` }"
  >
    <template #header>
      <div class="marker-panel-header" @pointerdown="startDragging">
        <span>标记点</span>
        <n-button
          quaternary
          circle
          size="small"
          aria-label="关闭标记点面板"
          @pointerdown.stop
          @click="close"
        >
          <template #icon>
            <n-icon><CloseOutline /></n-icon>
          </template>
        </n-button>
      </div>
    </template>

    <div class="marker-panel-body">
      <section class="marker-list-section">
        <div class="marker-section-title">
          <span>已添加点（{{ points.length }}）</span>
          <n-space size="small">
            <n-button
              text
              size="tiny"
              :disabled="points.length === 0 || allPointsSelected"
              @click="selectAllPoints"
            >
              全选
            </n-button>
            <n-button
              text
              size="tiny"
              :disabled="selectedIds.length === 0"
              @click="clearPointSelection"
            >
              取消全选
            </n-button>
          </n-space>
        </div>
        <div class="marker-list-scrollbar">
          <n-empty v-if="points.length === 0" description="暂无标记点" />
          <div
            v-for="point in points"
            :key="point.id"
            class="marker-list-item"
            :class="{ active: activePointId === point.id }"
            @click="focusPoint(point)"
          >
            <n-checkbox
              :checked="selectedIds.includes(point.id)"
              @click.stop
              @update:checked="
                (checked) => {
                  selectedIds = checked
                    ? [...selectedIds, point.id]
                    : selectedIds.filter((id) => id !== point.id)
                }
              "
            />
            <div class="marker-list-content">
              <strong>{{ point.name }}</strong>
              <span>
                {{ point.longitude.toFixed(6) }},
                {{ point.latitude.toFixed(6) }}
              </span>
            </div>
            <n-button
              text
              type="error"
              size="tiny"
              @click.stop="removePoint(point)"
            >
              删除
            </n-button>
          </div>
        </div>
      </section>

      <section class="marker-editor-section">
        <div class="marker-section-title">添加标记点</div>
        <div class="marker-pick-status" :class="{ picked }">
          {{
            picking
              ? '请在地图上移动并点击选择位置'
              : picked
                ? '已选择地图位置'
                : '可输入坐标或重新选点'
          }}
        </div>
        <n-form label-placement="top" size="small">
          <n-form-item label="标记点名称">
            <n-input v-model:value="draft.name" placeholder="请输入名称" />
          </n-form-item>
          <div class="marker-coordinate-grid">
            <n-form-item label="经度">
              <n-input-number
                v-model:value="draft.longitude"
                :min="-180"
                :max="180"
                :precision="8"
                :show-button="false"
                placeholder="经度"
                @update:value="handleCoordinateChange"
              />
            </n-form-item>
            <n-form-item label="纬度">
              <n-input-number
                v-model:value="draft.latitude"
                :min="-90"
                :max="90"
                :precision="8"
                :show-button="false"
                placeholder="纬度"
                @update:value="handleCoordinateChange"
              />
            </n-form-item>
          </div>
          <n-form-item label="地形高度（米）">
            <n-input-number
              v-model:value="draft.height"
              :show-button="false"
              :loading="terrainLoading"
              disabled
              placeholder="等待地形高度"
            />
          </n-form-item>
        </n-form>
        <n-space justify="end">
          <n-button size="small" @click="startPicking">重新选点</n-button>
          <n-button
            type="primary"
            size="small"
            :loading="saving"
            @click="addPoint"
          >
            添加
          </n-button>
        </n-space>
      </section>
    </div>
    <n-space justify="end" size="small" class="marker-panel-actions">
      <n-button size="small" :loading="importing" @click="importPoints">
        导入 TXT
      </n-button>
      <n-button
        size="small"
        type="error"
        :disabled="selectedIds.length === 0"
        @click="deleteSelected"
      >
        删除选中
      </n-button>
      <n-button
        size="small"
        type="primary"
        :disabled="points.length === 0"
        :loading="exporting"
        @click="exportSelected"
      >
        导出 TXT
      </n-button>
    </n-space>
  </n-card>
</template>

<style scoped>
.marker-points-panel {
  position: fixed;
  z-index: 1000;
  width: min(620px, calc(100vw - 2rem));
  max-height: calc(100vh - 6rem);
  overflow: hidden;
  color: #1f2937;
  background: #fff;
  border: 1px solid #d9e1ea;
  border-radius: 6px;
  box-shadow: 0 16px 40px rgb(15 23 42 / 18%);
}

.marker-points-panel :deep(.n-card__header) {
  padding: 0.55rem 0.8rem;
  color: #1f2937;
  background: #fff;
  border-bottom: 1px solid #e5e7eb;
}

.marker-points-panel :deep(.n-card__content) {
  color: #1f2937;
  background: #fff;
}

.marker-panel-header,
.marker-section-title,
.marker-list-item {
  display: flex;
  align-items: center;
}

.marker-panel-header,
.marker-section-title {
  justify-content: space-between;
}

.marker-panel-header {
  font-weight: 650;
  cursor: move;
  user-select: none;
}

.marker-panel-body {
  display: grid;
  grid-template-columns: minmax(200px, 0.9fr) minmax(250px, 1.1fr);
  gap: 1rem;
  min-height: 0;
  align-items: start;
}

.marker-list-section,
.marker-editor-section {
  min-width: 0;
}

.marker-list-section {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.marker-editor-section {
  padding-left: 1rem;
  border-left: 1px solid #e5e7eb;
}

.marker-section-title {
  margin-bottom: 0.6rem;
  color: #1f2937;
  font-size: 0.82rem;
  font-weight: 600;
}

.marker-list-scrollbar {
  box-sizing: border-box;
  height: min(310px, 38vh);
  max-height: min(310px, 38vh);
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding-right: 0.2rem;
  scrollbar-color: #b7c2cf transparent;
  scrollbar-width: thin;
}

.marker-list-scrollbar::-webkit-scrollbar {
  width: 8px;
}

.marker-list-scrollbar::-webkit-scrollbar-thumb {
  background: #b7c2cf;
  border-radius: 4px;
}

.marker-list-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}

.marker-list-item {
  gap: 0.4rem;
  min-width: 0;
  padding: 0.45rem 0.35rem;
  border-bottom: 1px solid #e5e7eb;
  cursor: pointer;
}

.marker-list-item.active {
  background: #edf5ff;
}

.marker-list-content {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  gap: 0.1rem;
}

.marker-list-content strong,
.marker-list-content span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.marker-list-content strong {
  color: #111827;
  font-size: 0.78rem;
}

.marker-list-content span {
  color: #6b7280;
  font-size: 0.7rem;
}

.marker-panel-actions {
  padding-top: 0.8rem;
  margin-top: 1rem;
  border-top: 1px solid #e5e7eb;
}

.marker-pick-status {
  margin-bottom: 0.7rem;
  padding: 0.45rem 0.55rem;
  color: #4b5563;
  font-size: 0.72rem;
  background: #f3f4f6;
  border-left: 3px solid #94a3b8;
}

.marker-pick-status.picked {
  color: #166534;
  border-left-color: #22c55e;
}

.marker-editor-section :deep(.n-form-item-label__text),
.marker-editor-section :deep(.n-form-item-label) {
  color: #374151;
}

.marker-editor-section :deep(.n-input__input-el),
.marker-editor-section :deep(.n-input-number .n-input__input-el) {
  color: #111827;
  -webkit-text-fill-color: #111827;
}

.marker-editor-section :deep(.n-input--disabled .n-input__input-el),
.marker-editor-section
  :deep(.n-input-number .n-input--disabled .n-input__input-el) {
  color: #374151;
  -webkit-text-fill-color: #374151;
  opacity: 1;
}

.marker-coordinate-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.6rem;
}

.marker-coordinate-grid :deep(.n-form-item),
.marker-editor-section :deep(.n-form-item) {
  margin-bottom: 0.65rem;
}

.marker-coordinate-grid :deep(.n-input-number),
.marker-editor-section :deep(.n-input) {
  width: 100%;
}

@media (max-width: 700px) {
  .marker-points-panel {
    width: min(620px, calc(100vw - 1.2rem));
  }

  .marker-panel-body {
    grid-template-columns: 1fr;
  }

  .marker-editor-section {
    padding-top: 1rem;
    padding-left: 0;
    margin-top: 1rem;
    border-top: 1px solid #e5e7eb;
    border-left: 0;
  }

  .marker-list-scrollbar {
    height: 180px;
  }
}
</style>
