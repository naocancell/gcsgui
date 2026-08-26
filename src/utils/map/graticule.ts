import * as Cesium from 'cesium'

type GraticuleState = {
  source: Cesium.CustomDataSource
  removeCameraListener: () => void
  timer?: ReturnType<typeof setTimeout>
  visible: boolean
  gridKey?: string
}

const states = new WeakMap<Cesium.Viewer, GraticuleState>()

const spacingLevels = [0.1, 0.2, 0.5, 1, 2, 5]

function chooseSpacing(height: number) {
  const target = Math.max(0.1, height / 150000)
  return spacingLevels.reduce((closest, value) =>
    Math.abs(value - target) < Math.abs(closest - target) ? value : closest,
  )
}

function gridPrecision(spacing: number) {
  return spacing >= 1 ? 0 : 1
}

function snapGridValue(value: number, spacing: number) {
  const precision = gridPrecision(spacing)
  return Number((Math.round(value / spacing) * spacing).toFixed(precision))
}

function buildGridValues(min: number, max: number, spacing: number) {
  const precision = gridPrecision(spacing)
  const firstIndex = Math.ceil(min / spacing - 1e-9)
  const lastIndex = Math.floor(max / spacing + 1e-9)
  const values: number[] = []
  for (let index = firstIndex; index <= lastIndex; index += 1) {
    // 按整数索引生成网格，避免浮点累加导致坐标漂移。
    values.push(Number((index * spacing).toFixed(precision)))
  }
  return values
}

/** 将视图范围扩展到相邻网格线，坐标统一从整数索引计算。 */
function snapBounds(min: number, max: number, spacing: number) {
  const precision = gridPrecision(spacing)
  const firstIndex = Math.floor(min / spacing + 1e-9)
  const lastIndex = Math.ceil(max / spacing - 1e-9)
  return {
    min: Number((firstIndex * spacing).toFixed(precision)),
    max: Number((lastIndex * spacing).toFixed(precision)),
  }
}

function formatCoordinate(
  value: number,
  isLongitude: boolean,
  spacing: number,
) {
  const rounded = Math.abs(value).toFixed(gridPrecision(spacing))
  if (isLongitude) return `${rounded}\u00b0${value < 0 ? 'W' : 'E'}`
  return `${rounded}\u00b0${value < 0 ? 'S' : 'N'}`
}

function addCoordinateLabel(
  source: Cesium.CustomDataSource,
  longitude: number,
  latitude: number,
  spacing: number,
) {
  source.entities.add({
    position: Cesium.Cartesian3.fromDegrees(longitude, latitude, 0),
    label: {
      text: `${formatCoordinate(longitude, true, spacing)} / ${formatCoordinate(latitude, false, spacing)}`,
      font: '700 18px sans-serif',
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      showBackground: false,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      // 标签始终压在地形上方；这里只标注视图中心附近，不会暴露背面的整套标签。
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      pixelOffset: new Cesium.Cartesian2(6, -6),
    },
  })
}

function nearestGridValue(values: number[], target: number) {
  return values.reduce((nearest, value) =>
    Math.abs(value - target) < Math.abs(nearest - target) ? value : nearest,
  )
}

function redraw(viewer: Cesium.Viewer, state: GraticuleState) {
  if (!state.visible || viewer.isDestroyed()) return

  const camera = viewer.camera
  const cameraCartographic =
    viewer.scene.globe.ellipsoid.cartesianToCartographic(camera.position) ??
    new Cesium.Cartographic(0, 0, 1000000)
  const centerCartesian = camera.pickEllipsoid(
    new Cesium.Cartesian2(
      viewer.canvas.clientWidth / 2,
      viewer.canvas.clientHeight / 2,
    ),
    viewer.scene.globe.ellipsoid,
  )
  const cartographic = centerCartesian
    ? (viewer.scene.globe.ellipsoid.cartesianToCartographic(centerCartesian) ??
      cameraCartographic)
    : cameraCartographic
  const height = Math.max(1, cameraCartographic.height)
  const farView = height >= 5_500_000
  const spacing = chooseSpacing(height)
  const spanLat = Math.min(80, Math.max(spacing * 8, height / 85000))
  const spanLon = Math.min(180, Math.max(spacing * 10, spanLat * 1.6))
  const centerLon = Cesium.Math.toDegrees(cartographic.longitude)
  const centerLat = Cesium.Math.toDegrees(cartographic.latitude)
  // 先限制合法经纬度范围，再扩展到网格边界；经纬方向共用同一个间隔。
  const rawMinLon = Math.max(-180, centerLon - spanLon)
  const rawMaxLon = Math.min(180, centerLon + spanLon)
  const rawMinLat = Math.max(-85, centerLat - spanLat)
  const rawMaxLat = Math.min(85, centerLat + spanLat)
  const lonBounds = snapBounds(rawMinLon, rawMaxLon, spacing)
  const latBounds = snapBounds(rawMinLat, rawMaxLat, spacing)
  // 远景要同时覆盖经度接缝两侧，先生成完整经度网格，再按地平线裁掉背面。
  const minLon = farView ? -180 : Math.max(-180, lonBounds.min)
  const maxLon = farView ? 180 : Math.min(180, lonBounds.max)
  const minLat = Math.max(-85, latBounds.min)
  const maxLat = Math.min(85, latBounds.max)

  const gridKey = [
    spacing,
    farView ? 'far' : 'near',
    minLon,
    maxLon,
    minLat,
    maxLat,
    snapGridValue(centerLon, spacing),
    snapGridValue(centerLat, spacing),
  ].join('|')
  if (state.gridKey === gridKey) return
  state.gridKey = gridKey

  state.source.entities.removeAll()
  const baseMaterial =
    Cesium.Color.fromCssColorString('#7dd3fc').withAlpha(0.78)
  const ellipsoid = viewer.scene.globe.ellipsoid
  const cameraRadius = ellipsoid.maximumRadius + cameraCartographic.height
  const lineRadius = ellipsoid.maximumRadius + (farView ? 10000 : 0)
  const horizonCosine = Math.min(1, lineRadius / cameraRadius)
  const addLine = (positions: Cesium.Cartesian3[]) => {
    const linePositions = farView
      ? positions.map((position) => {
          const coordinate =
            viewer.scene.globe.ellipsoid.cartesianToCartographic(position)
          return coordinate
            ? Cesium.Cartesian3.fromRadians(
                coordinate.longitude,
                coordinate.latitude,
                10000,
                ellipsoid,
              )
            : position
        })
      : positions
    state.source.entities.add({
      polyline: {
        positions: linePositions,
        width: 1.5,
        material: baseMaterial,
        // GEODESIC 会让东西向线的纬度发生变化，这里用 RHUMB 保持经纬度恒定。
        arcType: Cesium.ArcType.RHUMB,
        // 远景地平线附近的贴地长线容易被裁掉，抬高一点保持可见。
        clampToGround: !farView,
      },
    })
  }

  const addLatitudeLine = (latitude: number) => {
    // 远景按地平线计算纬线可见段，同时保留左右两侧并隐藏背面。
    if (farView) {
      const latitudeRadians = Cesium.Math.toRadians(latitude)
      const cameraLatitudeRadians = Cesium.Math.toRadians(centerLat)
      const sinLatitude = Math.sin(latitudeRadians)
      const cosLatitude = Math.cos(latitudeRadians)
      const sinCameraLatitude = Math.sin(cameraLatitudeRadians)
      const cosCameraLatitude = Math.cos(cameraLatitudeRadians)
      const constantPart = sinLatitude * sinCameraLatitude
      const longitudePart = cosLatitude * cosCameraLatitude

      if (Math.abs(longitudePart) > 1e-9) {
        const threshold = (horizonCosine - constantPart) / longitudePart
        if (threshold >= 1) return
        const halfWidth = threshold <= -1 ? Math.PI : Math.acos(threshold)
        if (halfWidth >= Math.PI - 1e-6) {
          addLine(
            Cesium.Cartesian3.fromDegreesArray(
              maxLon - minLon >= 359.9
                ? [minLon, latitude, 0, latitude, maxLon, latitude]
                : [minLon, latitude, maxLon, latitude],
            ),
          )
          return
        }
        const centerLongitude = Cesium.Math.toRadians(centerLon)
        for (let wrap = -1; wrap <= 1; wrap += 1) {
          const segmentStart = Math.max(
            Cesium.Math.toRadians(minLon),
            centerLongitude - halfWidth + wrap * Cesium.Math.TWO_PI,
          )
          const segmentEnd = Math.min(
            Cesium.Math.toRadians(maxLon),
            centerLongitude + halfWidth + wrap * Cesium.Math.TWO_PI,
          )
          if (segmentEnd - segmentStart <= 1e-6) continue
          addLine(
            Cesium.Cartesian3.fromRadiansArray([
              segmentStart,
              latitudeRadians,
              segmentEnd,
              latitudeRadians,
            ]),
          )
        }
      }
      return
    }
    if (maxLon - minLon >= 359.9) {
      addLine(
        Cesium.Cartesian3.fromDegreesArray([
          minLon,
          latitude,
          0,
          latitude,
          maxLon,
          latitude,
        ]),
      )
      return
    }
    addLine(
      Cesium.Cartesian3.fromDegreesArray([minLon, latitude, maxLon, latitude]),
    )
  }

  const longitudeValues = buildGridValues(minLon, maxLon, spacing)
  for (const value of longitudeValues) {
    addLine(Cesium.Cartesian3.fromDegreesArray([value, minLat, value, maxLat]))
  }

  const latitudeValues = buildGridValues(minLat, maxLat, spacing)
  for (const value of latitudeValues) {
    addLatitudeLine(value)
  }

  // 标签只放在视图中部的中心交点及相邻四个交点，避免遮挡地图。
  const centerLonGrid = nearestGridValue(
    longitudeValues,
    snapGridValue(centerLon, spacing),
  )
  const centerLatGrid = nearestGridValue(
    latitudeValues,
    snapGridValue(centerLat, spacing),
  )
  const labelPoints = [
    [centerLonGrid, centerLatGrid],
    [centerLonGrid - spacing, centerLatGrid],
    [centerLonGrid + spacing, centerLatGrid],
    [centerLonGrid, centerLatGrid - spacing],
    [centerLonGrid, centerLatGrid + spacing],
  ] as const
  const longitudeSet = new Set(longitudeValues)
  const latitudeSet = new Set(latitudeValues)
  labelPoints.forEach(([longitude, latitude]) => {
    if (longitudeSet.has(longitude) && latitudeSet.has(latitude)) {
      addCoordinateLabel(state.source, longitude, latitude, spacing)
    }
  })
  viewer.scene.requestRender()
}

function scheduleRedraw(viewer: Cesium.Viewer, state: GraticuleState) {
  if (state.timer) return
  state.timer = setTimeout(() => {
    state.timer = undefined
    redraw(viewer, state)
  }, 100)
}

export function setGraticuleVisible(viewer: Cesium.Viewer, visible: boolean) {
  if (!viewer || viewer.isDestroyed()) return
  let state = states.get(viewer)
  if (!state) {
    const source = new Cesium.CustomDataSource('graticule')
    const listener = () => {
      if (state) scheduleRedraw(viewer, state)
    }
    viewer.camera.changed.addEventListener(listener)
    state = {
      source,
      visible,
      removeCameraListener: () =>
        viewer.camera.changed.removeEventListener(listener),
    }
    states.set(viewer, state)
    void viewer.dataSources.add(source)
  }
  state.visible = visible
  state.source.show = visible
  if (visible) redraw(viewer, state)
  else {
    state.gridKey = undefined
    state.source.entities.removeAll()
    viewer.scene.requestRender()
  }
}

export function clearGraticule(viewer?: Cesium.Viewer) {
  if (!viewer) return
  const state = states.get(viewer)
  if (!state) return
  if (state.timer) clearTimeout(state.timer)
  state.removeCameraListener()
  if (!viewer.isDestroyed() && viewer.dataSources.contains(state.source)) {
    viewer.dataSources.remove(state.source, true)
  }
  states.delete(viewer)
}
