// 场景相机相关操作
import { Viewer, Cartesian3, Math } from 'cesium'
/**
 * 将三维球定位到默认起始位置
 * @param viewer :Viewer对象
 */
function flyToDefault(viewer: Viewer) {
  viewer.camera.flyTo({
    destination: Cartesian3.fromDegrees(107.4191777, 37.855152, 15000),
    orientation: {
      heading: Math.toRadians(0),
      pitch: Math.toRadians(-90),
      roll: Math.toRadians(0),
    },
    complete: function callback() {
      // 定位完成之后的回调函数
    },
  })
}
export { flyToDefault }
