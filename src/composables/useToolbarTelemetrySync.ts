/**
 * 文件描述：工具条遥测同步与碰撞检测 Composable
 */
import { ref, watch } from 'vue'
import { Cartesian3, Cartographic } from 'cesium'
import { useStaticStore } from '@/store/staticStore'
import { useUavStore } from '@/store/uavStore'
import { useLayerStore } from '@/store/layerManagerStore'
import { useRouteStore } from '@/store/RouteStore'
import {
  ByDirectionAndLen,
  getDistance,
  getElevation,
} from '@/utils/map/geocomputation'
import { checkAltitudeWarning } from '@/utils/map/altitudeWarning'
import {
  dataProcess_fromQT,
  dataProcess_fromQT_route,
} from '@/core/gis/websocketProtocol'
import { useMessage } from 'naive-ui'

export function useToolbarTelemetrySync(
  emit?: (event: 'resizeMap', height: number) => void,
  collisionDetectionRef?: { value: any },
) {
  const message = useMessage()
  const store = useStaticStore()
  const uavStore = useUavStore()
  const lStore = useLayerStore()
  const routeStore = useRouteStore()

  const altitudeWarningResult = ref<any>(null)
  const showDetection = ref(false)
  const groundHeight = ref(-1)
  const detectDivHeight = ref(25)
  const hasPlane = ref(false)

  let frameCount = 0
  let lastPos: Cartesian3 | undefined = undefined

  function shutDownDetec() {
    if (lStore.openDetect) {
      emit?.('resizeMap', -1)
    } else {
      emit?.('resizeMap', detectDivHeight.value)
    }
    showDetection.value = !showDetection.value
    lStore.openDetect = !lStore.openDetect
  }

  function handleTelemetryFrame(newVal: any) {
    if (!newVal) {
      lStore.validYCData = false
      return
    }

    let terrainAlt = 0
    if (window.viewer?.scene?.globe) {
      const carto = Cartographic.fromDegrees(
        newVal.longitude,
        newVal.latitude,
      )
      terrainAlt = window.viewer.scene.globe.getHeight(carto) ?? 0
    }

    const ycData = {
      uavId: String(newVal.uavId),
      uavType: newVal.uavSeries,
      heading: newVal.headingAngle,
      pitch: newVal.pitchAngle,
      lon: newVal.longitude,
      lat: newVal.latitude,
      alt: Number(newVal.relativeAltitude) + terrainAlt,
      groundSpeed: newVal.groundSpeed * 3.6,
    }

    lStore.navi.currentRouteID = newVal.currentRouteId
    lStore.navi.nextRouteID = newVal.nextRouteId
    lStore.navi.nextPoint = newVal.nextPoint
    lStore.navi.distonext = newVal.distanceNext

    // 高度预警检查
    let matchedRoute = routeStore.flyRoute.find(
      (r) => r.code === newVal.currentRouteId,
    )
    if (!matchedRoute) {
      matchedRoute = lStore.navi.airlines.find(
        (r) => r.code === newVal.currentRouteId,
      )
    }
    lStore.navi.activeDesignRoute = matchedRoute ?? null

    altitudeWarningResult.value = checkAltitudeWarning(
      ycData.alt,
      matchedRoute ?? null,
      newVal.nextPoint,
      newVal.distanceNext,
    )

    if (window.measureViewer) {
      window.measureViewer.updateDynamicData(ycData)
      lStore.validYCData = true
      if (!hasPlane.value) {
        window.measureViewer.addAirplaneEntity(
          store.models.fp98,
          ycData.uavId + ycData.uavType,
        )
        hasPlane.value = true
      }
    }

    frameCount++
    if (
      frameCount > 50 &&
      lStore.openDetect &&
      !store.networkStatus.offlineMode
    ) {
      emit?.('resizeMap', detectDivHeight.value)
      showDetection.value = true
      frameCount = 0
      const currentPos = Cartesian3.fromDegrees(
        ycData.lon,
        ycData.lat,
        ycData.alt,
      )
      groundHeight.value =
        ycData.alt - getElevation(window.viewer, currentPos)
      if (lastPos === undefined) {
        lastPos = currentPos
      }
      const dis = getDistance(currentPos, lastPos) * 1000
      lastPos = currentPos
      collisionDetectionRef?.value?.drawDetection(
        ycData.alt,
        dis,
        ycData.alt - groundHeight.value,
      )
      const max_dis = 5000
      const detectPos = ByDirectionAndLen(currentPos, ycData.heading, max_dis)
      collisionDetectionRef?.value?.drawTerrain(
        ycData.alt,
        currentPos,
        detectPos,
        max_dis,
      )
    }
  }

  watch(() => uavStore.uavInfo, handleTelemetryFrame)

  async function connectWebSocket() {
    if (store.webskt.ws) {
      try {
        store.webskt.ws.close()
      } catch (err) {
        console.error('关闭旧 WebSocket 连接失败:', err)
      }
    }
    store.webskt.ws = new WebSocket(
      'ws://' +
        store.webskt.ws_config.address +
        ':' +
        store.webskt.ws_config.port,
    )
    store.webskt.ws.onopen = function () {
      message.success(
        'WebSocket已连接\n url:' +
          'ws://' +
          store.webskt.ws_config.address +
          ':' +
          store.webskt.ws_config.port,
      )
      store.webskt.ws.send('hello QT!')
    }

    store.webskt.ws.onmessage = (event: MessageEvent) => {
      const sktData = JSON.parse(event.data)
      frameCount++
      if (sktData.type === 0) {
        const ycData = dataProcess_fromQT(sktData)
        if (ycData != null) {
          window.measureViewer?.updateDynamicData(ycData)
          lStore.validYCData = true
          if (!hasPlane.value) {
            window.measureViewer?.addAirplaneEntity(
              store.models.fp98,
              ycData.uavId + ycData.uavType,
            )
            hasPlane.value = true
          }
          if (
            frameCount > 50 &&
            lStore.openDetect &&
            !store.networkStatus.offlineMode
          ) {
            emit?.('resizeMap', detectDivHeight.value)
            showDetection.value = true
            frameCount = 0
            const currentPos = Cartesian3.fromDegrees(
              ycData.lon,
              ycData.lat,
              ycData.alt,
            )
            groundHeight.value =
              ycData.alt - getElevation(window.viewer, currentPos)
            if (lastPos === undefined) {
              lastPos = currentPos
            }
            const dis = getDistance(currentPos, lastPos) * 1000
            lastPos = currentPos
            collisionDetectionRef?.value?.drawDetection(
              ycData.alt,
              dis,
              ycData.alt - groundHeight.value,
            )
            const max_dis = 5000
            const detectPos = ByDirectionAndLen(currentPos, ycData.heading, max_dis)
            collisionDetectionRef?.value?.drawTerrain(
              ycData.alt,
              currentPos,
              detectPos,
              max_dis,
            )
          }
        } else {
          lStore.validYCData = false
        }
      }
      if (sktData.type === 1) {
        const routeData = dataProcess_fromQT_route(sktData)
        if (routeData != null) {
          lStore.navi.airlines.push(routeData)
          lStore.navi.currentRouteID = routeData.code
          window.measureViewer?.showAirLine(routeData)
        }
      }
    }
  }

  function closeWS() {
    if (store.webskt.ws) {
      store.webskt.ws.close()
    }
  }

  return {
    altitudeWarningResult,
    showDetection,
    groundHeight,
    detectDivHeight,
    hasPlane,
    shutDownDetec,
    handleTelemetryFrame,
    connectWebSocket,
    closeWS,
  }
}
