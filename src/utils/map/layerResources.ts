import { toRaw } from 'vue'

type ManagedLayer = {
  dataSource?: unknown
  imageLayer?: unknown
  entity?: unknown[]
  tileset?: any
  objectUrls?: string[]
}

export async function removeLayerResources(viewer: any, layer: ManagedLayer) {
  const dataSource = toRaw(await Promise.resolve(layer.dataSource))
  if (dataSource && viewer.dataSources.contains(dataSource)) {
    viewer.dataSources.remove(dataSource, true)
  }

  const imageLayer = toRaw(layer.imageLayer)
  if (imageLayer) {
    if (!viewer.imageryLayers.contains(imageLayer)) {
      throw new Error('未在 Cesium 图层集合中找到 WMS 图层')
    }
    const removed = viewer.imageryLayers.remove(imageLayer, true)
    if (!removed) throw new Error('Cesium WMS 图层移除失败')
  }

  for (const entity of layer.entity ?? []) {
    if (entity) viewer.entities.remove(entity)
  }

  const tileset = toRaw(layer.tileset)
  if (tileset) {
    if (viewer.scene?.primitives?.contains?.(tileset)) {
      viewer.scene.primitives.remove(tileset)
    }
    if (typeof tileset.destroy === 'function' && !tileset.isDestroyed?.()) {
      tileset.destroy()
    }
  }

  for (const objectUrl of layer.objectUrls ?? []) {
    if (typeof objectUrl === 'string' && objectUrl.startsWith('blob:')) {
      URL.revokeObjectURL(objectUrl)
    }
  }
}
