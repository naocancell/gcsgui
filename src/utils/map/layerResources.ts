import { toRaw } from 'vue'

type ManagedLayer = {
  dataSource?: unknown
  imageLayer?: unknown
  entity?: unknown[]
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
}
