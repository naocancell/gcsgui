<script setup lang="ts">
import { Menu } from '@vicons/ionicons5'
import * as Cesium from 'cesium'
import { computed } from 'vue'
import { useLayerStore } from '@/store/layerManagerStore.ts'
import { removeLayerResources } from '@/utils/map/layerResources'

const props = defineProps<{ lname: string; lid?: string }>()
const layerStore = useLayerStore()

const itemOptions = [
  { label: '移除图层', key: 'remove' },
  { label: '缩放至图层', key: 'lookAt' },
  { label: '移至顶层', key: 'moveTop' },
  { label: '上移一层', key: 'moveUp' },
  { label: '下移一层', key: 'moveDown' },
  { label: '移至底层', key: 'moveBottom' },
]

const currentLayer = computed(() =>
  layerStore.Layers.find(
    (item) => item.lName === props.lname && item.lId === props.lid,
  ),
)
const layerShow = computed(() => currentLayer.value?.show ?? true)

function getEntities(layer: any): Cesium.Entity[] {
  return (layer?.entity ?? []) as Cesium.Entity[]
}

async function getDataSource(layer: any): Promise<any | undefined> {
  if (!layer?.dataSource) return undefined
  return Promise.resolve(layer.dataSource)
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
    case 'remove':
      try {
        await removeLayerResources(window.viewer, layer)
      } catch (error) {
        console.error('移除图层资源失败:', error)
      } finally {
        layerStore.removeLayer(layer.lId)
        window.viewer.scene.requestRender()
      }
      break
    case 'lookAt': {
      const dataSource = await getDataSource(layer)
      if (dataSource && window.viewer.dataSources.contains(dataSource)) {
        await window.viewer.flyTo(dataSource)
      } else {
        flyToEntities(getEntities(layer))
      }
      break
    }
    case 'moveTop': {
      if (layer.imageLayer)
        window.viewer.imageryLayers.raiseToTop(layer.imageLayer)
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
        window.viewer.imageryLayers.lowerToBottom(layer.imageLayer)
      const dataSource = await getDataSource(layer)
      if (dataSource && window.viewer.dataSources.contains(dataSource)) {
        window.viewer.dataSources.lowerToBottom(dataSource)
      }
      layerStore.moveLayerBottom(layer.lId)
      window.viewer.scene.requestRender()
      break
    }
    case 'moveUp': {
      if (layer.imageLayer) window.viewer.imageryLayers.raise(layer.imageLayer)
      const dataSource = await getDataSource(layer)
      if (dataSource && window.viewer.dataSources.contains(dataSource)) {
        window.viewer.dataSources.raise(dataSource)
      }
      layerStore.moveLayerUp(layer.lId)
      window.viewer.scene.requestRender()
      break
    }
    case 'moveDown': {
      if (layer.imageLayer) window.viewer.imageryLayers.lower(layer.imageLayer)
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

  if (layer.imageLayer) layer.imageLayer.show = checked

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
  <n-row class="layer-item-row">
    <n-checkbox
      size="medium"
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
      <n-button tertiary type="success" size="medium">
        <template #icon>
          <n-icon><Menu /></n-icon>
        </template>
      </n-button>
    </n-dropdown>
  </n-row>
</template>

<style scoped>
.layer-item-row {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  width: 100%;
  min-width: 0;
  border-bottom: 1px solid #e7e6e6;
}

.layer-item-checkbox {
  flex: 1 1 auto;
  min-width: 0;
  margin-left: 1rem;
  overflow: hidden;
}

.layer-item-checkbox :deep(.n-checkbox__label) {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.layer-item-actions {
  flex: 0 0 auto;
  flex-shrink: 0;
  margin-left: 0.5rem;
  white-space: nowrap;
}

.layer-item-actions :deep(.n-button) {
  flex: 0 0 auto;
  white-space: nowrap;
}
</style>
