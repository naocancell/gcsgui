<script setup lang="ts">
import { EllipsisHorizontal, LayersOutline } from '@vicons/ionicons5'
import * as Cesium from 'cesium'
import { useMessage } from 'naive-ui'
import { computed, toRaw } from 'vue'
import { useLayerStore } from '@/store/layerManagerStore.ts'
import { removeLayerResources } from '@/utils/map/layerResources'

const props = defineProps<{ lname: string; lid?: string }>()
const layerStore = useLayerStore()
const message = useMessage()

const baseItemOptions = [
  { label: '定位图层', key: 'lookAt' },
  { label: '上移一层', key: 'moveUp' },
  { label: '下移一层', key: 'moveDown' },
  { label: '移至顶层', key: 'moveTop' },
  { label: '移至底层', key: 'moveBottom' },
  { label: '移除图层', key: 'remove' },
]

const currentLayer = computed(() =>
  layerStore.Layers.find(
    (item) => item.lName === props.lname && item.lId === props.lid,
  ),
)
const layerShow = computed(() => currentLayer.value?.show ?? true)
const isKmlLayer = computed(() =>
  /\.(kml|kmz)$/i.test(currentLayer.value?.lName ?? ''),
)
const itemOptions = computed(() =>
  isKmlLayer.value
    ? [{ label: '导出坐标', key: 'exportCoordinates' }, ...baseItemOptions]
    : baseItemOptions,
)

function getEntities(layer: any): Cesium.Entity[] {
  return (layer?.entity ?? []) as Cesium.Entity[]
}

async function getDataSource(layer: any): Promise<any | undefined> {
  if (!layer?.dataSource) return undefined
  return Promise.resolve(layer.dataSource)
}

function sanitizeFileName(name: string) {
  return name.replace(/[\\/:*?"<>|]/g, '_')
}

function formatCoordinateExport(layerName: string, records: any[]) {
  const lines = [
    `图层：${layerName}`,
    `导出时间：${new Date().toLocaleString()}`,
    '',
  ]
  records.forEach((record, index) => {
    lines.push(`实体 ${index + 1}：${record.entityName || '(未命名)'}`)
    lines.push(`类型：${record.type}`)
    const points =
      record.type === 'point' ? [record.point] : record.points || []
    points.forEach((point: any, pointIndex: number) => {
      lines.push(
        `  点 ${pointIndex + 1}：经度=${Number(point.longitude).toFixed(8)}，纬度=${Number(point.latitude).toFixed(8)}，高度=${Number(point.height ?? 0).toFixed(3)} 米`,
      )
    })
    lines.push('')
  })
  return lines.join('\r\n')
}

async function exportCoordinates(layer: any) {
  const dataSource = await getDataSource(layer)
  const records = dataSource?.__kmlCoordinateExport
  if (!Array.isArray(records) || records.length === 0) {
    message.warning('该图层没有可导出的坐标')
    return
  }

  const fileName = `${sanitizeFileName(layer.lName.replace(/\.(kml|kmz)$/i, ''))}_坐标导出.txt`
  const content = formatCoordinateExport(layer.lName, records)

  // 使用浏览器/ WebView 原生保存对话框，由用户选择保存位置。
  const showSaveFilePicker = (window as any).showSaveFilePicker
  if (typeof showSaveFilePicker === 'function') {
    try {
      const fileHandle = await showSaveFilePicker({
        suggestedName: fileName,
        types: [
          {
            description: '文本文件',
            accept: { 'text/plain': ['.txt'] },
          },
        ],
      })
      const writable = await fileHandle.createWritable()
      await writable.write(content)
      await writable.close()
      message.success('坐标已导出')
    } catch (error) {
      // 用户在保存对话框中点击取消，不提示错误。
      if ((error as DOMException)?.name === 'AbortError') return
      console.error('坐标导出失败:', error)
      message.error('坐标导出失败')
    }
    return
  }

  // 不支持 File System Access API 时，回退为浏览器下载。
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
  message.success('坐标已导出')
}

function flyToEntities(entities: Cesium.Entity[]) {
  if (entities.length === 0) return
  const viewer = window.viewer
  const tmp = new Cesium.BoundingSphere()
  const display = viewer.dataSourceDisplay as any
  let tries = 0

  function tryFly() {
    const spheres: Cesium.BoundingSphere[] = []
    let pending = false

    for (const entity of entities) {
      const state = display.getBoundingSphere(entity, false, tmp)
      if (state === 1) {
        pending = true
        break
      }
      if (state === 0) spheres.push(Cesium.BoundingSphere.clone(tmp))
    }

    if (pending && tries < 60) {
      tries += 1
      viewer.scene.requestRender()
      requestAnimationFrame(tryFly)
      return
    }

    if (spheres.length > 0) {
      const combined = Cesium.BoundingSphere.fromBoundingSpheres(spheres)
      viewer.camera.flyToBoundingSphere(combined, { duration: 1.5 })
    }
  }

  tryFly()
}

async function handleLayerItem(key: string) {
  const layer = currentLayer.value
  if (!layer) return

  switch (key) {
    case 'exportCoordinates':
      await exportCoordinates(layer)
      break
    case 'remove':
      try {
        await removeLayerResources(window.viewer, layer)
        layerStore.removeLayer(layer.lId)
        window.viewer.scene.requestRender()
        message.success(`图层已移除：${layer.lName}`)
      } catch (error) {
        message.error(`图层移除失败：${layer.lName}`)
        console.error('移除图层资源失败:', error)
      }
      break
    case 'lookAt': {
      const dataSource = await getDataSource(layer)
      if (dataSource && window.viewer.dataSources.contains(dataSource)) {
        await window.viewer.flyTo(dataSource)
      } else if (layer.imageLayer) {
        const imageLayer = toRaw(layer.imageLayer)
        const rectangle = imageLayer.imageryProvider?.rectangle
        if (rectangle) {
          window.viewer.camera.flyTo({ destination: rectangle, duration: 1.5 })
        }
      } else if (layer.tileset) {
        await window.viewer.flyTo(toRaw(layer.tileset))
      } else {
        flyToEntities(getEntities(layer))
      }
      break
    }
    case 'moveTop': {
      if (layer.imageLayer)
        window.viewer.imageryLayers.raiseToTop(toRaw(layer.imageLayer))
      // Cesium primitive 没有图层顺序 API，仍然同步管理列表顺序。
      const dataSource = await getDataSource(layer)
      if (dataSource && window.viewer.dataSources.contains(dataSource)) {
        window.viewer.dataSources.raiseToTop(dataSource)
      }
      layerStore.moveLayerTop(layer.lId)
      window.viewer.scene.requestRender()
      break
    }
    case 'moveBottom': {
      if (layer.imageLayer)
        window.viewer.imageryLayers.lowerToBottom(toRaw(layer.imageLayer))
      const dataSource = await getDataSource(layer)
      if (dataSource && window.viewer.dataSources.contains(dataSource)) {
        window.viewer.dataSources.lowerToBottom(dataSource)
      }
      layerStore.moveLayerBottom(layer.lId)
      window.viewer.scene.requestRender()
      break
    }
    case 'moveUp': {
      if (layer.imageLayer)
        window.viewer.imageryLayers.raise(toRaw(layer.imageLayer))
      const dataSource = await getDataSource(layer)
      if (dataSource && window.viewer.dataSources.contains(dataSource)) {
        window.viewer.dataSources.raise(dataSource)
      }
      layerStore.moveLayerUp(layer.lId)
      window.viewer.scene.requestRender()
      break
    }
    case 'moveDown': {
      if (layer.imageLayer)
        window.viewer.imageryLayers.lower(toRaw(layer.imageLayer))
      const dataSource = await getDataSource(layer)
      if (dataSource && window.viewer.dataSources.contains(dataSource)) {
        window.viewer.dataSources.lower(dataSource)
      }
      layerStore.moveLayerDown(layer.lId)
      window.viewer.scene.requestRender()
      break
    }
  }
}

async function onCheck(checked: boolean) {
  const layer = currentLayer.value
  if (!layer) return

  layer.show = checked

  const dataSource = await getDataSource(layer)
  if (dataSource) {
    dataSource.show = checked
    if (checked && window.viewer.dataSources.contains(dataSource)) {
      window.viewer.flyTo(dataSource)
    }
  }

  if (layer.imageLayer) toRaw(layer.imageLayer).show = checked
  if (layer.tileset) {
    const tileset = toRaw(layer.tileset)
    tileset.show = checked
    if (checked) await window.viewer.flyTo(tileset)
  }

  // 不从 viewer.entities 删除实体，只切换 show，避免重新勾选时丢失引用。
  for (const entity of getEntities(layer)) {
    if (checked && !window.viewer.entities.contains(entity)) {
      window.viewer.entities.add(entity)
    }
    entity.show = checked
  }

  window.viewer.scene.requestRender()
}
</script>

<template>
  <div class="layer-item-row">
    <div class="layer-item-icon" aria-hidden="true">
      <n-icon size="16"><LayersOutline /></n-icon>
    </div>
    <n-checkbox
      size="small"
      :label="props.lname"
      class="layer-item-checkbox"
      :checked="layerShow"
      @update:checked="onCheck"
    />
    <n-dropdown
      class="layer-item-actions"
      :options="itemOptions"
      @select="handleLayerItem"
    >
      <n-button quaternary circle size="small" aria-label="图层操作">
        <template #icon>
          <n-icon><EllipsisHorizontal /></n-icon>
        </template>
      </n-button>
    </n-dropdown>
  </div>
</template>

<style scoped>
.layer-item-row {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  width: 100%;
  min-height: 3rem;
  min-width: 0;
  padding: 0.35rem 0.4rem 0.35rem 0.55rem;
  margin-bottom: 0.45rem;
  background: rgb(30 44 60 / 42%);
  border: 1px solid rgb(148 163 184 / 13%);
  border-radius: 9px;
  transition:
    background 0.18s ease,
    border-color 0.18s ease,
    transform 0.18s ease;
}

.layer-item-row:hover {
  background: rgb(45 62 80 / 68%);
  border-color: rgb(125 211 252 / 25%);
  transform: translateY(-1px);
}

.layer-item-icon {
  display: grid;
  flex: 0 0 1.8rem;
  place-items: center;
  width: 1.8rem;
  height: 1.8rem;
  color: #7dd3fc;
  background: rgb(56 189 248 / 12%);
  border: 1px solid rgb(56 189 248 / 16%);
  border-radius: 7px;
}

.layer-item-checkbox {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
}

.layer-item-checkbox :deep(.n-checkbox__box) {
  border-color: rgb(148 163 184 / 42%);
  background: rgb(15 23 42 / 35%);
}

.layer-item-checkbox :deep(.n-checkbox--checked .n-checkbox__box) {
  border-color: #38bdf8;
  background: #0ea5e9;
}

.layer-item-checkbox :deep(.n-checkbox__label) {
  min-width: 0;
  color: #dbe5ef;
  font-size: 0.78rem;
  font-weight: 520;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.layer-item-actions {
  flex: 0 0 auto;
  flex-shrink: 0;
  white-space: nowrap;
}

.layer-item-actions :deep(.n-button) {
  flex: 0 0 auto;
  color: #8ca2b9;
  white-space: nowrap;
}

.layer-item-actions :deep(.n-button:hover) {
  color: #f8fafc;
  background: rgb(148 163 184 / 16%);
}
</style>
