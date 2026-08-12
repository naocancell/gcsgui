type ManagedLayer = {
  dataSource?: unknown
  imageLayer?: unknown
  entity?: unknown[]
}

export async function removeLayerResources(viewer: any, layer: ManagedLayer) {
  const dataSource = await Promise.resolve(layer.dataSource)
  if (dataSource && viewer.dataSources.contains(dataSource)) {
    viewer.dataSources.remove(dataSource, true)
  }

  if (layer.imageLayer && viewer.imageryLayers.contains(layer.imageLayer)) {
    viewer.imageryLayers.remove(layer.imageLayer, true)
  }

  for (const entity of layer.entity ?? []) {
    if (entity) viewer.entities.remove(entity)
  }
}
