/*
 * @Description: 在三维场景中绘制“我的位置”标记（图标 + 地址标签）
 */
import {
  Cartesian2,
  Cartesian3,
  Color,
  CustomDataSource,
  Entity,
  HeightReference,
  HorizontalOrigin,
  LabelStyle,
  VerticalOrigin,
} from 'cesium'
import type { Viewer } from 'cesium'
import { getMapAssetsFile } from '@/utils/getAssets'
import type { MyLocation } from './myLocation'

const DATA_SOURCE_NAME = 'MyLocation'
const MARKER_ENTITY_ID = 'my-location'
const ACCURACY_COLOR = Color.fromCssColorString('#1f6feb')

function ensureDataSource(viewer: Viewer): CustomDataSource {
  const existing = viewer.dataSources.getByName(DATA_SOURCE_NAME)[0] as
    | CustomDataSource
    | undefined
  if (existing) return existing

  const dataSource = new CustomDataSource(DATA_SOURCE_NAME)
  viewer.dataSources.add(dataSource)
  return dataSource
}

/** 绘制（或刷新）“我的位置”标记 */
export function showMyLocationMarker(
  viewer: Viewer,
  location: MyLocation,
): boolean {
  if (!viewer || viewer.isDestroyed()) return false

  const dataSource = ensureDataSource(viewer)
  dataSource.entities.removeAll()

  const position = Cartesian3.fromDegrees(
    location.longitude,
    location.latitude,
    0,
  )
  const label = location.address ? `我的位置 · ${location.address}` : '我的位置'

  dataSource.entities.add(
    new Entity({
      id: MARKER_ENTITY_ID,
      name: '我的位置',
      position,
      billboard: {
        image: getMapAssetsFile('my-location.svg'),
        width: 36,
        height: 36,
        verticalOrigin: VerticalOrigin.CENTER,
        horizontalOrigin: HorizontalOrigin.CENTER,
        heightReference: HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: label,
        font: 'bold 14px sans-serif',
        fillColor: Color.WHITE,
        outlineColor: Color.BLACK,
        outlineWidth: 3,
        style: LabelStyle.FILL_AND_OUTLINE,
        showBackground: true,
        backgroundColor: ACCURACY_COLOR.withAlpha(0.85),
        backgroundPadding: new Cartesian2(6, 3),
        pixelOffset: new Cartesian2(24, 0),
        verticalOrigin: VerticalOrigin.CENTER,
        horizontalOrigin: HorizontalOrigin.LEFT,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    }),
  )

  viewer.scene.requestRender()
  return true
}

/** 飞行到“我的位置”，高度按定位精度自适应 */
export function flyToMyLocation(
  viewer: Viewer,
  location: MyLocation,
  duration = 1.5,
): void {
  if (!viewer || viewer.isDestroyed()) return

  const accuracy = location.accuracy ?? 0
  const height = Math.min(Math.max(accuracy * 12, 1500), 20000)
  viewer.camera.flyTo({
    destination: Cartesian3.fromDegrees(
      location.longitude,
      location.latitude,
      height,
    ),
    duration,
  })
}

/** 清除“我的位置”标记 */
export function clearMyLocationMarker(viewer: Viewer): void {
  if (!viewer || viewer.isDestroyed()) return
  viewer.dataSources.getByName(DATA_SOURCE_NAME).forEach((dataSource) => {
    viewer.dataSources.remove(dataSource, true)
  })
}
