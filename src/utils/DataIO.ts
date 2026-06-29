/**
 文件描述：数据输入输出工具。文件写入必须通过后端实现。
 创建时间：2024/4/11 13:33
 创建人：Zhaipeixiu
 */
import { Viewer, GeoJsonDataSource, Color, KmlDataSource } from 'cesium'

export const inputGeoJson = (viewer: Viewer) => {
  viewer.dataSources.add(
    GeoJsonDataSource.load('/js.json', {
      stroke: Color.WHITE, //轮廓颜色，注意：颜色必须大写
      strokeWidth: 5,
      fill: Color.BLUE.withAlpha(0.3), //填充颜色，透明度
    }),
  )
}

export const inputKML = (viewer: Viewer) => {
  let kmlUrl = './Assets/gdpPerCapita2008.kmz'
  let kmlDataPromise = KmlDataSource.load(kmlUrl)
  console.log(kmlDataPromise)
  kmlDataPromise.then(function (dataSource) {
    console.log(dataSource)
    viewer.dataSources.add(dataSource)
  })
}
