import * as Cesium from 'cesium'
import { Cartesian3 } from 'cesium'
import { markRaw } from 'vue'
import { useStaticStore } from '@/store/staticOptions.js'
import { useLayerStore } from '@/store/layerManagerStore.ts'
import { ByDirectionAndLen } from '@/utils/map/geocomputation.ts'
const store = useStaticStore()
let time = new Date()
//地图工具类
export default class MeasureViewer {
  constructor(viewer) {
    this.viewer = viewer
    this.scene = viewer.scene
    this.isMeasure = false
    this.positions = []
    this.temPositions = [] // 距离测量-鼠标移动时产生的临时点
    this.vertexEntities = [] // 距离测量-节点元素
    this.lineEntity = undefined // 距离测量-折线元素
    this.lineEntitys = [] // 距离测量-折线元素数组，每完成一次距离测量，将折线元素加入此数组
    this.totalDistance = 0 // 距离测量-总距离

    this.activeShapePoints = [] //面积测量-多边形顶点
    this.polygon = undefined
    this.areaEntities = [] // 已完成的面积测量多边形和标签
    this.measAreaStatus = false //是否在测量面积

    this.analyseGraphs = [] //分析工具的图形容器
    this.graphics = [] //图形绘制容器
    this.dynamicData = {
      lon: undefined,
      lat: undefined,
      alt: undefined,
      heading: undefined,
    }
    this.graphicStyle = {
      borderColor: Cesium.Color.BLUE,
      borderWidth: 1,
      material: Cesium.Color.GREEN.withAlpha(0.5),
    }

    this.barirsCollection = [] //机场障碍物
    // Data labels for points stay visible. Line/polygon labels are shown only
    // while the pointer is over their source entity.
    this.dataHoverLabelEntity = this.viewer.entities.add({
      id: '__data-hover-label',
      label: {
        show: false,
        font: 'bold 16px "Microsoft YaHei", "PingFang SC", sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        showBackground: true,
        backgroundColor: Cesium.Color.BLACK.withAlpha(0.65),
        backgroundPadding: new Cesium.Cartesian2(8, 5),
        horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        // Keep the label away from the pointer used for drawing/measurement.
        pixelOffset: new Cesium.Cartesian2(18, -24),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    })
    this.dataHoverHandler = new Cesium.ScreenSpaceEventHandler(
      this.viewer.scene.canvas,
    )
    this.dataHoverHandler.setInputAction(
      (movement) => this._updateDataHoverLabel(movement.endPosition),
      Cesium.ScreenSpaceEventType.MOUSE_MOVE,
    )
  }

  _hideDataHoverLabel() {
    if (this.dataHoverLabelEntity?.label) {
      this.dataHoverLabelEntity.label.show = false
    }
  }

  _updateDataHoverLabel(screenPosition) {
    if (!screenPosition || !this.viewer.scene) {
      this._hideDataHoverLabel()
      return
    }

    const picked = this.viewer.scene.pick(screenPosition)
    let entity = picked?.id || picked?.primitive?.id
    if (entity === this.dataHoverLabelEntity) {
      const underlying = (this.viewer.scene.drillPick?.(screenPosition) || [])
        .map((item) => item?.id || item?.primitive?.id)
        .find((candidate) => candidate?.__dataHoverName)
      entity = underlying
    }
    const name = entity?.__dataHoverName
    if (!name || entity.__dataHoverGeometry === 'point') {
      this._hideDataHoverLabel()
      return
    }

    let position
    try {
      if (this.viewer.scene.pickPositionSupported) {
        position = this.viewer.scene.pickPosition(screenPosition)
      }
    } catch (error) {
      position = undefined
    }
    if (!position) {
      position = this.viewer.scene.camera.pickEllipsoid(
        screenPosition,
        this.viewer.scene.globe.ellipsoid,
      )
    }
    if (!position) {
      this._hideDataHoverLabel()
      return
    }

    this.dataHoverLabelEntity.position = position
    this.dataHoverLabelEntity.label.text = name
    this.dataHoverLabelEntity.label.show = true
    this.viewer.scene.requestRender()
  }

  profileAnalyse() {
    //解绑鼠标事件
    if (this.handler) this.unRegisterEvents()
    let count = 0
    let profilePts = [] //点集合
    let line = undefined
    let movePoint = undefined
    this.handler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas)
    // 绑定鼠标左击事件
    this.handler.setInputAction((e) => {
      let position = this.viewer.scene.pickPosition(e.position)
      if (!position) {
        const ellipsoid = this.viewer.scene.globe.ellipsoid
        position = this.viewer.scene.camera.pickEllipsoid(e.position, ellipsoid)
      }
      if (!position) return
      count++
      profilePts.push(position)
      let nodeEntity = this._createPointEntity(position, count.toString())
      this.viewer.entities.add(nodeEntity)
      this.analyseGraphs.push(nodeEntity)
      if (!line) {
        line = this.viewer.entities.add({
          polyline: {
            positions: new Cesium.CallbackProperty((e) => {
              return profilePts.concat(movePoint)
            }, false),
            width: 2,
            material: Cesium.Color.YELLOW,
            clampToGround: true,
          },
        })
        this.analyseGraphs.push(line)
      }
      //通视分析仅支持选择两个点
      if (
        useStaticStore().analysisVars.analysisType === 2 &&
        profilePts.length === 2
      ) {
        this.unRegisterEvents()
        useStaticStore().analysisVars.profilePts = profilePts
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

    this.handler.setInputAction((e) => {
      let position = this.viewer.scene.pickPosition(e.endPosition)
      if (!position) {
        position = this.viewer.scene.camera.pickEllipsoid(
          e.startPosition,
          this.viewer.scene.globe.ellipsoid,
        )
      }
      if (!position) return
      movePoint = position
      this.viewer.scene.requestRender()
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE)

    this.handler.setInputAction((e) => {
      let position = this.viewer.scene.pickPosition(e.position)
      if (!position) {
        const ellipsoid = this.viewer.scene.globe.ellipsoid
        position = this.viewer.scene.camera.pickEllipsoid(e.position, ellipsoid)
      }
      if (!position) return
      count++
      profilePts.push(position)
      let endEntity = this._createPointEntity(position, count.toString())
      this.viewer.entities.add(endEntity)
      this.analyseGraphs.push(endEntity)
      this.unRegisterEvents()
      useStaticStore().analysisVars.profilePts = profilePts
    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK)

    return false
  }

  clearProfileEntities() {
    this.analyseGraphs.forEach((item) => {
      this.viewer.entities.remove(item)
    })
  }

  updateDynamicData(data) {
    this.dynamicData.lon = data.lon
    this.dynamicData.lat = data.lat
    this.dynamicData.alt = data.alt
    this.dynamicData.heading = data.heading
    this.viewer.scene.requestRender()
  }

  addPointEntity(position) {
    let pEntity = this.viewer.entities.add({
      position: position,
      type: 'routeDetectPoint',
      point: {
        show: true,
        pixelSize: 10,
        color: Cesium.Color.ORANGERED,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
        clampToGround: true,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: 99000000,
      },
    })
    this.vertexEntities.push(pEntity)
  }
  //加载kml
  addKml(kml_file) {
    let kmlDataPromise = Cesium.KmlDataSource.load(kml_file, {
      camera: this.viewer.scene.camera,
      canvas: this.viewer.scene.canvas,
      screenOverlayContainer: this.viewer.container,
      clampToGround: true,
    })

    return kmlDataPromise.then((dataSource) => {
      // 使用 Cesium 当前时钟，确保时间序列 KML 与画面中的实体位置一致。
      const time = this.viewer.clock.currentTime.clone()

      // 笛卡尔坐标转经纬高
      function cartesianToLngLatHeight(cartesian) {
        const cartographic = Cesium.Cartographic.fromCartesian(cartesian)

        return {
          longitude: Cesium.Math.toDegrees(cartographic.longitude),
          latitude: Cesium.Math.toDegrees(cartographic.latitude),
          height: cartographic.height,
        }
      }

      // 生成一个简单红色图钉 SVG
      const pinSvg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="48" viewBox="0 0 32 48">
          <path d="M16 0C7.2 0 0 7.2 0 16c0 12 16 32 16 32s16-20 16-32C32 7.2 24.8 0 16 0z" fill="#ff3333"/>
          <circle cx="16" cy="16" r="7" fill="white"/>
        </svg>
      `

      const pinImage =
        'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(pinSvg)

      // 添加图钉
      function addPin(position, name, properties = {}) {
        return dataSource.entities.add({
          name,
          position,
          billboard: {
            image: pinImage,
            width: 24,
            height: 36,

            // 让图钉的底部对准坐标点
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,

            // 图钉一直能看见
            disableDepthTestDistance: Number.POSITIVE_INFINITY,

            // 图钉是否贴地
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            //heightReference: Cesium.HeightReference.NONE
          },
          properties,
        })
      }

      // 线和面只在代表位置显示一个名称，不在每个顶点放置图标。
      // 添加名称 Label（线、面使用）
      function addNameLabel(position, name, properties = {}) {
      if (!position || !name) return

      const labelEntity = dataSource.entities.add({
      id: `kml-label-${properties.sourceEntityId}`,

      name: `${name}`,

      position,

      label: {
        text: new Cesium.ConstantProperty(name),
      },

      properties: {
        sourceType: 'kml-label',
        ...properties,
      },
      })

      styleKmlLabel(labelEntity)

      return labelEntity
      }

      // 获取折线真实长度中心点
      function getPolylineCenter(positions) {
      if (!positions || positions.length === 0) {
        return undefined
      }

      if (positions.length === 1) {
        return positions[0]
      }


      let totalLength = 0
      const segmentLengths = []


      for (let i = 0; i < positions.length - 1; i++) {

        const length =
          Cesium.Cartesian3.distance(
            positions[i],
            positions[i + 1],
          )

        segmentLengths.push(length)
        totalLength += length
      }


      let targetLength = totalLength / 2


      for (let i = 0; i < segmentLengths.length; i++) {

        if (targetLength <= segmentLengths[i]) {

          const ratio =
            targetLength / segmentLengths[i]


          return Cesium.Cartesian3.lerp(
            positions[i],
            positions[i + 1],
            ratio,
            new Cesium.Cartesian3(),
          )
        }


        targetLength -= segmentLengths[i]
      }


      return positions[0]
      }
      function getGeometryName(entity) {

        if (entity.name) {
          return entity.name
        }


        if (entity.parent && entity.parent.name) {
          return entity.parent.name
        }


        return undefined
      }

      console.log('数据源：', dataSource)

      this.viewer.dataSources.add(dataSource)
      this.viewer.flyTo(dataSource)

      // 建议这里存 dataSource，不要存 kmlDataPromise
      useLayerStore().addLayer(
        kml_file.name,
        dataSource,
        undefined,
        undefined,
        true,
      )

      const result = []

      // 先复制一份原始 entities
      // 后面 dataSource.entities.add() 会新增图钉实体
      const originalEntities = [...dataSource.entities.values]

      //修改默认加载kml时候的label样式 
      // 统一修改 KML 原始 label 样式
      function styleKmlLabel(entity, labelText = entity.name || '') {
        if (!entity.label) return

        entity.label.show = new Cesium.ConstantProperty(true)

        // 文字内容，不想改内容可以不写这一行
        entity.label.text = new Cesium.ConstantProperty(labelText)

        // 字体
        entity.label.font = new Cesium.ConstantProperty(
          'bold 16px "Microsoft YaHei", "PingFang SC", sans-serif'
        )

        // 填充色
        entity.label.fillColor = new Cesium.ConstantProperty(
          Cesium.Color.fromCssColorString('#ffffff')
        )

        // 描边色
        entity.label.outlineColor = new Cesium.ConstantProperty(
          Cesium.Color.fromCssColorString('#222222')
        )

        // 描边宽度
        entity.label.outlineWidth = new Cesium.ConstantProperty(3)
        // 填充 + 描边
        entity.label.style = new Cesium.ConstantProperty(
          Cesium.LabelStyle.FILL_AND_OUTLINE
        )
        // 相对图标的位置，往上偏移
        entity.label.pixelOffset = new Cesium.ConstantProperty(
          new Cesium.Cartesian2(0, -42)
        )
        // 水平居中
        entity.label.horizontalOrigin = new Cesium.ConstantProperty(
          Cesium.HorizontalOrigin.CENTER
        )
        // 垂直位置
        entity.label.verticalOrigin = new Cesium.ConstantProperty(
          Cesium.VerticalOrigin.BOTTOM
        )
        // 永远不被地形/建筑遮挡
        entity.label.disableDepthTestDistance = new Cesium.ConstantProperty(
          Number.POSITIVE_INFINITY
        )
        // 可选：背景框
        entity.label.showBackground = new Cesium.ConstantProperty(true)
        entity.label.backgroundColor = new Cesium.ConstantProperty(
          Cesium.Color.fromCssColorString('rgba(0, 0, 0, 0.45)')
        )
        entity.label.backgroundPadding = new Cesium.ConstantProperty(
          new Cesium.Cartesian2(8, 5)
        )
      }

      // 先改原始 KML label
      let polylineIndex = 0
      let polygonIndex = 0

      originalEntities.forEach((entity) => {
        const isPoint =
          !!entity.position &&
          !entity.polyline &&
          !entity.polygon &&
          !entity.rectangle &&
          !entity.ellipse &&
          !entity.corridor
        const entityName = getGeometryName(entity)

        if (isPoint) {
          if (!entity.label && entityName) {
            entity.label = new Cesium.LabelGraphics()
          }
          if (entity.label && entityName) {
            styleKmlLabel(entity, entityName)
          } else if (entity.label) {
            entity.label.show = new Cesium.ConstantProperty(false)
          }
        } else if (entity.label) {
          // Line and polygon names are shown by the shared hover label.
          entity.label.show = new Cesium.ConstantProperty(false)
        }
      })

      originalEntities.forEach((entity) => {
        const isPoint =
          !!entity.position &&
          !entity.polyline &&
          !entity.polygon &&
          !entity.rectangle &&
          !entity.ellipse &&
          !entity.corridor

        // 1. KML 里的 Point
        if (isPoint && entity.position) {
          const position = entity.position.getValue(time)

          if (position) {
            result.push({
              entityName: entity.name,
              type: 'point',
              point: cartesianToLngLatHeight(position),
            })

            addPin(position, `${entity.name || 'point'}-pin`, {
              sourceType: 'point',
              sourceEntityId: entity.id,
            })
          }
        }

        // 2. KML 里的 LineString / Polyline
        if (entity.polyline && entity.polyline.positions) {

          const positions =
            entity.polyline.positions.getValue(time)


          if (positions && positions.length > 1) {


            const geometryName =
              getGeometryName(entity)


            result.push({
              entityName: geometryName,
              type: 'polyline',
              points: positions.map((position) =>
                cartesianToLngLatHeight(position),
              ),
            })


            // 有名字才显示
            if (geometryName) {

              entity.__dataHoverName = geometryName
              entity.__dataHoverGeometry = 'polyline'
            }
          }
        }

        // 3. KML 里的 Polygon
        if (entity.polygon && entity.polygon.hierarchy) {
          const hierarchy =
            entity.polygon.hierarchy.getValue(time)

          if (
            hierarchy &&
            hierarchy.positions &&
            hierarchy.positions.length > 2
          ) {
            const geometryName =
              getGeometryName(entity)
            result.push({
              entityName: geometryName,
              type: 'polygon',
              points: hierarchy.positions.map((position) =>
                cartesianToLngLatHeight(position),
              ),
            })
            if (geometryName) {
              entity.__dataHoverName = geometryName
              entity.__dataHoverGeometry = 'polygon'
            }
          }
        }
      })

      console.log('KML 提取结果：', result)

      // 供图层菜单导出，避免从已经添加的 Pin 实体反向推导而产生重复数据。
      dataSource.__kmlCoordinateExport = result
      this.viewer.scene.requestRender()
      return dataSource
    }).catch((error) => {
      console.error('KML 加载失败：', error)
      throw error
    })
}

  addJson(js_file) {
    const url = URL.createObjectURL(js_file)
    const groundHeightReference = Cesium.HeightReference.CLAMP_TO_GROUND
    const dataGeo = Cesium.GeoJsonDataSource.load(url, {
      clampToGround: true,
    })

    const loadResult = dataGeo
      .then((dataSource) => {
        console.log(dataSource)
        this.viewer.dataSources.add(dataSource)
        this.viewer.flyTo(dataSource)
        useLayerStore().addLayer(
          js_file.name,
          dataGeo,
          undefined,
          undefined,
          true,
        )

        const pinSvg = `
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="48" viewBox="0 0 32 48">
            <path d="M16 0C7.2 0 0 7.2 0 16c0 12 16 32 16 32s16-20 16-32C32 7.2 24.8 0 16 0z" fill="#ff3333"/>
            <circle cx="16" cy="16" r="7" fill="white"/>
          </svg>
        `
        const pinImage =
          'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(pinSvg)
        const currentTime = this.viewer.clock.currentTime

        const getEntityName = (entity) => {
          const directName = entity.name
          if (typeof directName === 'string' && directName.trim()) {
            return directName.trim()
          }

          const parentName = entity.parent?.name
          if (typeof parentName === 'string' && parentName.trim()) {
            return parentName.trim()
          }

          const propertyValues = entity.properties?.getValue(currentTime)
          if (!propertyValues) return undefined

          const nameFields = [
            'name',
            'Name',
            'NAME',
            'title',
            'label',
            '名称',
          ]
          for (const field of nameFields) {
            const value = propertyValues[field]
            if (typeof value === 'string' && value.trim()) {
              return value.trim()
            }
            if (typeof value === 'number') {
              return String(value)
            }
          }

          return undefined
        }

        const styleKmlLabel = (label, text) => {
          label.show = true
          label.text = text
          label.font =
            'bold 16px "Microsoft YaHei", "PingFang SC", sans-serif'
          label.fillColor = Cesium.Color.WHITE
          label.outlineColor = Cesium.Color.fromCssColorString('#222222')
          label.outlineWidth = 3
          label.style = Cesium.LabelStyle.FILL_AND_OUTLINE
          label.pixelOffset = new Cesium.Cartesian2(0, -42)
          label.horizontalOrigin = Cesium.HorizontalOrigin.CENTER
          label.verticalOrigin = Cesium.VerticalOrigin.BOTTOM
          label.heightReference = groundHeightReference
          label.disableDepthTestDistance = Number.POSITIVE_INFINITY
          label.showBackground = true
          label.backgroundColor = Cesium.Color.fromCssColorString(
            'rgba(0, 0, 0, 0.45)',
          )
          label.backgroundPadding = new Cesium.Cartesian2(8, 5)
        }

        const getPolylineCenter = (positions) => {
          if (!positions || positions.length === 0) return undefined
          if (positions.length === 1) return positions[0]

          let totalLength = 0
          const segmentLengths = []
          for (let i = 0; i < positions.length - 1; i++) {
            const length = Cesium.Cartesian3.distance(
              positions[i],
              positions[i + 1],
            )
            segmentLengths.push(length)
            totalLength += length
          }

          let targetLength = totalLength / 2
          for (let i = 0; i < segmentLengths.length; i++) {
            const segmentLength = segmentLengths[i]
            if (targetLength <= segmentLength) {
              return Cesium.Cartesian3.lerp(
                positions[i],
                positions[i + 1],
                targetLength / segmentLength,
                new Cesium.Cartesian3(),
              )
            }
            targetLength -= segmentLength
          }

          return positions[0]
        }

        // The bounding-sphere center can fall outside a concave polygon.
        // Project the polygon to a local tangent plane and choose an interior point instead.
        const isPointInsideRing = (point, ring) => {
          let inside = false
          for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const current = ring[i]
            const previous = ring[j]
            const crossesY =
              current.y > point.y !== previous.y > point.y
            if (crossesY) {
              const intersectionX =
                ((previous.x - current.x) * (point.y - current.y)) /
                  (previous.y - current.y) +
                current.x
              if (point.x < intersectionX) inside = !inside
            }
          }
          return inside
        }

        const getPolygonLabelPosition = (hierarchy) => {
          const positions = hierarchy?.positions
          if (!positions || positions.length < 3) return undefined

          const tangentPlane = Cesium.EllipsoidTangentPlane.fromPoints(
            positions,
          )
          const outerRing = tangentPlane.projectPointsOntoPlane(positions)
          if (!outerRing || outerRing.length < 3) return undefined

          const holes = (hierarchy.holes || [])
            .map((hole) => tangentPlane.projectPointsOntoPlane(hole.positions))
            .filter((ring) => ring && ring.length > 2)

          const getCentroid = (ring) => {
            let areaTwice = 0
            let centroidX = 0
            let centroidY = 0

            for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
              const current = ring[i]
              const previous = ring[j]
              const cross = previous.x * current.y - current.x * previous.y
              areaTwice += cross
              centroidX += (previous.x + current.x) * cross
              centroidY += (previous.y + current.y) * cross
            }

            if (Math.abs(areaTwice) < Cesium.Math.EPSILON10) {
              const average = outerRing.reduce(
                (result, point) => {
                  result.x += point.x
                  result.y += point.y
                  return result
                },
                new Cesium.Cartesian2(),
              )
              return new Cesium.Cartesian2(
                average.x / outerRing.length,
                average.y / outerRing.length,
              )
            }

            return new Cesium.Cartesian2(
              centroidX / (3 * areaTwice),
              centroidY / (3 * areaTwice),
            )
          }

          const isInsidePolygon = (point) =>
            isPointInsideRing(point, outerRing) &&
            !holes.some((hole) => isPointInsideRing(point, hole))

          const centroid = getCentroid(outerRing)
          const candidates = [centroid]

          // These fallbacks handle concave polygons whose area centroid is outside.
          for (let i = 0; i < outerRing.length; i++) {
            const current = outerRing[i]
            const next = outerRing[(i + 1) % outerRing.length]
            candidates.push(
              new Cesium.Cartesian2(
                (current.x + next.x + outerRing[0].x) / 3,
                (current.y + next.y + outerRing[0].y) / 3,
              ),
            )
          }
          candidates.push(
            new Cesium.Cartesian2(
              outerRing.reduce((sum, point) => sum + point.x, 0) /
                outerRing.length,
              outerRing.reduce((sum, point) => sum + point.y, 0) /
                outerRing.length,
            ),
          )

          const interiorPoint = candidates.find(isInsidePolygon)
          if (!interiorPoint) {
            return Cesium.BoundingSphere.fromPoints(positions).center
          }
          return tangentPlane.projectPointOntoEllipsoid(interiorPoint)
        }

        const addNameLabel = (position, name, sourceEntity, geometryType) => {
          if (!position || !name) return undefined

          const labelId = `geojson-label-${geometryType}-${sourceEntity.id}`
          let labelEntity = dataSource.entities.getById(labelId)
          if (!labelEntity) {
            labelEntity = dataSource.entities.add({
              id: labelId,
              name,
              position,
              label: {},
              properties: {
                sourceType: 'geojson-label',
                sourceEntityId: sourceEntity.id,
                geometryType,
              },
            })
          }

          styleKmlLabel(labelEntity.label, name)
          return labelEntity
        }

        const markHoverEntity = (entity, name, geometryType) => {
          if (!entity || !name) return
          entity.__dataHoverName = name
          entity.__dataHoverGeometry = geometryType
          if (entity.label) entity.label.show = false
        }

        const originalEntities = [...dataSource.entities.values]
        originalEntities.forEach((entity) => {
          const entityName = getEntityName(entity)

          if (entity.point) {
            entity.point.heightReference = groundHeightReference
            entity.point.disableDepthTestDistance =
              Number.POSITIVE_INFINITY
          }

          if (entity.billboard) {
            entity.billboard.image = pinImage
            entity.billboard.width = 24
            entity.billboard.height = 36
            entity.billboard.heightReference = groundHeightReference
            entity.billboard.verticalOrigin = Cesium.VerticalOrigin.BOTTOM
            entity.billboard.disableDepthTestDistance =
              Number.POSITIVE_INFINITY
          }

          const isPoint = entity.point || entity.billboard
          if (isPoint && entity.position && entityName) {
            if (!entity.label) {
              entity.label = new Cesium.LabelGraphics()
            }
            styleKmlLabel(entity.label, entityName)
          } else if (!isPoint && entity.label) {
            entity.label.show = false
          }

          if (entity.polyline) {
            entity.polyline.clampToGround = true
            const positions = entity.polyline.positions?.getValue(currentTime)
            if (positions?.length > 1 && entityName) {
              markHoverEntity(entity, entityName, 'polyline')
            }
          }

          if (entity.polygon) {
            entity.polygon.perPositionHeight = false
            entity.polygon.height = undefined
            entity.polygon.heightReference = groundHeightReference
            entity.polygon.extrudedHeight = undefined
            entity.polygon.extrudedHeightReference = groundHeightReference

            const hierarchy = entity.polygon.hierarchy?.getValue(currentTime)
            if (hierarchy?.positions?.length > 2 && entityName) {
              markHoverEntity(entity, entityName, 'polygon')
            }
          }

          if (entity.rectangle) {
            entity.rectangle.height = undefined
            entity.rectangle.heightReference = groundHeightReference
            entity.rectangle.extrudedHeight = undefined

            const rectangle = entity.rectangle.coordinates?.getValue(currentTime)
            if (rectangle && entityName) {
              markHoverEntity(entity, entityName, 'rectangle')
            }
          }

          if (entity.ellipse) {
            entity.ellipse.height = undefined
            entity.ellipse.heightReference = groundHeightReference
            entity.ellipse.extrudedHeight = undefined

            const position = entity.position?.getValue(currentTime)
            if (position && entityName) {
              markHoverEntity(entity, entityName, 'ellipse')
            }
          }

          if (entity.corridor) {
            entity.corridor.height = undefined
            entity.corridor.heightReference = groundHeightReference
            entity.corridor.extrudedHeight = undefined

            const positions = entity.corridor.positions?.getValue(currentTime)
            if (positions?.length && entityName) {
              markHoverEntity(entity, entityName, 'corridor')
            }
          }
        })

        this.viewer.scene.requestRender()
        return dataSource
      })
      .catch((error) => {
        console.error('GeoJSON load failed:', error)
        throw error
      })
      .finally(() => {
        URL.revokeObjectURL(url)
      })

    return loadResult
  }

  /**
   * 加载 Cesium 3D Tiles。url 可以是网络 tileset.json，也可以是已经将
   * 本地目录映射为 Blob URL 的 tileset.json。
   */
  async add3DTiles(url, name = '3D Tiles', objectUrls = []) {
    if (!url) throw new Error('未提供 3D Tiles tileset.json 地址')

    let tileset
    try {
      if (Cesium.Cesium3DTileset?.fromUrl) {
        tileset = await Cesium.Cesium3DTileset.fromUrl(url, {
          // 先加载可见的中等精度瓦片，避免大量白膜同时请求最高细节。
          maximumScreenSpaceError: 32,
          skipLevelOfDetail: true,
          baseScreenSpaceError: 1024,
          skipScreenSpaceErrorFactor: 16,
          skipLevels: 1,
          immediatelyLoadDesiredLevelOfDetail: false,
          loadSiblings: false,
        })
      } else {
        tileset = new Cesium.Cesium3DTileset({ url })
        if (tileset.readyPromise) await tileset.readyPromise
      }

      this.viewer.scene.primitives.add(tileset)
      await this.viewer.flyTo(tileset)
      useLayerStore().addLayer(
        name,
        undefined,
        undefined,
        undefined,
        true,
        markRaw(tileset),
        objectUrls,
      )
      this.viewer.scene.requestRender()
      return tileset
    } catch (error) {
      if (tileset) {
        if (this.viewer.scene.primitives.contains(tileset)) {
          this.viewer.scene.primitives.remove(tileset)
        }
        if (typeof tileset.destroy === 'function' && !tileset.isDestroyed?.()) {
          tileset.destroy()
        }
      }
      objectUrls.forEach((objectUrl) => URL.revokeObjectURL(objectUrl))
      throw error
    }
  }
//添加WMS图层函数
  async AddWMSLayer(url, layers, bounds) {
    //
    const rectangle = bounds
      ? Cesium.Rectangle.fromDegrees(
          bounds.west,
          bounds.south,
          bounds.east,
          bounds.north,
        )
      : undefined
    let wmsProvider = new Cesium.WebMapServiceImageryProvider({
      url: url, //baseurl + workspace + '/wms',
      layers: layers,
      rectangle: rectangle,
      enablePickFeatures: true,//开启拾取功能
      defaultAlpha: 0,          //设置透明度
      parameters: {
        service: 'WMS',          //服务类型
        version: '1.1.1',        //版本
        request: 'GetMap',       //请求类型  
        format: 'image/png',     //图片格式
        styles: '',               //样式
        transparent: true,        //透明
      },
    })
    let imageLayer = new Cesium.ImageryLayer(wmsProvider, {
      alpha: 0.6,
    })
    const previewRequest = wmsProvider.requestImage(0, 0, 0)
    if (!previewRequest) {
      throw new Error('WMS 图层请求暂时无法调度')
    }
    await previewRequest
    this.viewer.imageryLayers.add(imageLayer)//添加图层到v
    useLayerStore().addLayer(
      layers,
      undefined,
      markRaw(imageLayer),
      undefined,
      true,
    )
    if (rectangle) {
      this.viewer.camera.flyTo({ destination: rectangle, duration: 1.5 })
    }
    return imageLayer
  }

  /**
   * Cesium实体导出Geojson，只导出实体中的 polyline polygon rectangle
   * @param entity Cesium实体
   * @return geojson Object
   */
  entity2Geojson(entity) {
    let geoJson = {
      type: 'FeatureCollection',
      features: [],
    }

    if (entity.point && entity.position) {
      let point = {
        type: 'Feature',
        properties: {},
        geometry: {
          coordinates: [entity?.position?.x, entity?.position?.y],
          type: 'Point',
        },
      }
      geoJson.features.push(point)
    }
    if (entity.polyline?.positions) {
      let polyline = {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: [],
        },
      }

      let Cartesian3Arr = entity.polyline?.positions.getValue(
        Cesium.JulianDate.now,
      )
      Cartesian3Arr.forEach((p) => {
        let cartographic = this.scene.globe.ellipsoid.cartesianToCartographic(p)
        polyline.geometry.coordinates.push([
          Cesium.Math.toDegrees(cartographic.longitude),
          Cesium.Math.toDegrees(cartographic.latitude),
        ])
      })
      geoJson.features.push(polyline)
    }

    if (entity.polygon?.hierarchy) {
      let polygon = {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Polygon',
          coordinates: [],
        },
      }
      let coords = [] //polygon的坐标点
      let Cartesian3Arr = entity.polygon?.hierarchy.getValue(
        Cesium.JulianDate.now,
      ).positions
      Cartesian3Arr.forEach((p) => {
        let cartographic = this.scene.globe.ellipsoid.cartesianToCartographic(p)
        coords.push([
          Cesium.Math.toDegrees(cartographic.longitude),
          Cesium.Math.toDegrees(cartographic.latitude),
        ])
      })

      let end = this.scene.globe.ellipsoid.cartesianToCartographic(
        Cartesian3Arr[0],
      )
      coords.push([
        Cesium.Math.toDegrees(end.longitude),
        Cesium.Math.toDegrees(end.latitude),
      ])

      polygon.geometry.coordinates.push(coords)
      geoJson.features.push(polygon)
    }

    if (entity.rectangle?.coordinates) {
      let rectangle = {
        type: 'Feature',
        properties: {
          'stroke-width': entity.rectangle?.outlineWidth,
          stroke: entity.rectangle?.outlineColor.toCssColorString(),
          fill: entity.rectangle?.material.toCssColorString(),
          'fill-opacity': entity.rectangle?.material.alpha,
        },
        geometry: {
          type: 'Polygon',
          coordinates: [[]],
        },
      }

      let coords = [] //rectangle的坐标点
      let cesium_Rec = entity.rectangle?.coordinates
      let west_north, east_north, east_south, west_south
      west_north = Cesium.Cartesian3.fromRadians(
        cesium_Rec.west,
        cesium_Rec.north,
      )
      east_north = Cesium.Cartesian3.fromRadians(
        cesium_Rec.east,
        cesium_Rec.north,
      )
      east_south = Cesium.Cartesian3.fromRadians(
        cesium_Rec.east,
        cesium_Rec.south,
      )
      west_south = Cesium.Cartesian3.fromRadians(
        cesium_Rec.west,
        cesium_Rec.south,
      )
      coords.push([west_north.x, west_north.y])
      coords.push([east_north.x, east_north.y])
      coords.push([east_south.x, east_south.y])
      coords.push([west_south.x, west_south.y])

      rectangle.geometry.coordinates.push(coords)
      geoJson.features.push(rectangle)
    }

    return geoJson
  }

  /**
   * 显示航线
   * @param line Airline
   */
  showAirLine(line) {
    let res = this.viewer.entities.getById('航线' + line.code + '-' + line.name)
    if (res !== undefined) {
      return res
    }

    let degreesArr = []
    for (let i = 0; i < line.points.length; i++) {
      let coord = new Cartesian3.fromDegrees(
        line.points[i].lon,
        line.points[i].lat,
        line.points[i].alt,
      )
      degreesArr.push(coord)
    }
    if (line.isClose)
      degreesArr.push(
        new Cartesian3.fromDegrees(
          line.points[0].lon,
          line.points[0].lat,
          line.points[0].alt,
        ),
      )

    let airlineEntity = new Cesium.Entity({
      name: line.name,
      id: '航线' + line.code + '-' + line.name,
      polyline: {
        positions: degreesArr,
        width: 3,
        material: Cesium.Color.ORANGE,
        clampToGround: false,
      },
    })
    this.viewer.entities.add(airlineEntity)
    degreesArr.forEach((pt, index) => {
      let vertexEntity = new Cesium.Entity({
        id: line.code + '-航点' + index,
        position: pt,
        point: {
          color: Cesium.Color.FUCHSIA,
          pixelSize: 6,
          outlineColor: Cesium.Color.RED,
          outlineWidth: 2,
          disableDepthTestDistance: 99000000,
          // heightReference:Cesium.HeightReference.CLAMP_TO_GROUND,
        },
      })
      this.viewer.entities.add(vertexEntity)
    })
    return airlineEntity
  }

  /**
   * 三维设计航线渲染：墙体幕帘 + 航点高度标签 + 地面投影虚线
   * @param line Airline 航线数据
   */
  showDesignRoute3D(line) {
    const idPrefix = 'designRoute3D-' + line.code
    // 如果已渲染则跳过
    if (this.viewer.entities.getById(idPrefix + '-wall')) {
      return
    }

    let positions = []
    let minimumHeights = []
    let maximumHeights = []
    let groundPositions = [] // 地面投影坐标

    for (let i = 0; i < line.points.length; i++) {
      let pt = line.points[i]
      positions.push(Cesium.Cartesian3.fromDegrees(pt.lon, pt.lat, pt.alt))
      groundPositions.push(Cesium.Cartesian3.fromDegrees(pt.lon, pt.lat, 0))
      minimumHeights.push(0)
      maximumHeights.push(pt.alt)
    }
    // 闭合航线处理
    if (line.isClose && line.points.length > 0) {
      let first = line.points[0]
      positions.push(
        Cesium.Cartesian3.fromDegrees(first.lon, first.lat, first.alt),
      )
      groundPositions.push(
        Cesium.Cartesian3.fromDegrees(first.lon, first.lat, 0),
      )
      minimumHeights.push(0)
      maximumHeights.push(first.alt)
    }

    // 1. 墙体幕帘（从地面到航线高度的半透明蓝色垂直面）
    this.viewer.entities.add({
      id: idPrefix + '-wall',
      name: '设计航线墙体-' + line.name,
      wall: {
        positions: positions,
        minimumHeights: minimumHeights,
        maximumHeights: maximumHeights,
        material: Cesium.Color.DODGERBLUE.withAlpha(0.2),
        outline: true,
        outlineColor: Cesium.Color.DODGERBLUE.withAlpha(0.6),
        outlineWidth: 1,
      },
    })

    // 2. 航线本体（蓝色实线，带高度）
    this.viewer.entities.add({
      id: idPrefix + '-line',
      name: '设计航线-' + line.name,
      polyline: {
        positions: positions,
        width: 4,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.2,
          color: Cesium.Color.DODGERBLUE,
        }),
        clampToGround: false,
      },
    })

    // 3. 地面投影虚线
    this.viewer.entities.add({
      id: idPrefix + '-ground',
      name: '设计航线地面投影-' + line.name,
      polyline: {
        positions: groundPositions,
        width: 2,
        material: new Cesium.PolylineDashMaterialProperty({
          color: Cesium.Color.DODGERBLUE.withAlpha(0.5),
          dashLength: 16,
        }),
        clampToGround: true,
      },
    })

    // 4. 航点高度标签 + 垂直引线
    line.points.forEach((pt, index) => {
      // 航点标签（显示航点号和设计高度）
      this.viewer.entities.add({
        id: idPrefix + '-label-' + index,
        position: Cesium.Cartesian3.fromDegrees(pt.lon, pt.lat, pt.alt),
        point: {
          color: Cesium.Color.DODGERBLUE,
          pixelSize: 8,
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2,
          disableDepthTestDistance: 99000000,
        },
        label: {
          text: 'WP' + (index + 1) + '\n' + Math.round(pt.alt) + 'm',
          font: '2rem sans-serif',
          fillColor: Cesium.Color.WHITE,
          style: Cesium.LabelStyle.FILL,
          scale: 0.45,
          pixelOffset: new Cesium.Cartesian2(0, -20),
          showBackground: true,
          backgroundColor: new Cesium.Color(0.1, 0.3, 0.7, 0.85),
          backgroundPadding: new Cesium.Cartesian2(8, 5),
          disableDepthTestDistance: 99000000,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        },
      })

      // 垂直引线（从航点到地面）
      this.viewer.entities.add({
        id: idPrefix + '-vline-' + index,
        polyline: {
          positions: [
            Cesium.Cartesian3.fromDegrees(pt.lon, pt.lat, 0),
            Cesium.Cartesian3.fromDegrees(pt.lon, pt.lat, pt.alt),
          ],
          width: 1,
          material: new Cesium.PolylineDashMaterialProperty({
            color: Cesium.Color.DODGERBLUE.withAlpha(0.4),
            dashLength: 8,
          }),
        },
      })
    })
  }

  /**
   * 清除三维设计航线渲染
   * @param routeCode 航线编号
   */
  clearDesignRoute3D(routeCode) {
    const idPrefix = 'designRoute3D-' + routeCode
    // 清除墙体、航线、地面投影
    this.viewer.entities.removeById(idPrefix + '-wall')
    this.viewer.entities.removeById(idPrefix + '-line')
    this.viewer.entities.removeById(idPrefix + '-ground')
    // 清除所有航点标签和垂直引线
    let toRemove = []
    this.viewer.entities.values.forEach((entity) => {
      if (entity.id && entity.id.startsWith(idPrefix + '-label-')) {
        toRemove.push(entity)
      }
      if (entity.id && entity.id.startsWith(idPrefix + '-vline-')) {
        toRemove.push(entity)
      }
    })
    toRemove.forEach((e) => this.viewer.entities.remove(e))
  }

  addAirplaneEntity(modelPath, StrUavTypeID) {
    this.viewer.scene.globe.depthTestAgainstTerrain = false
    store.uav.ModelIDinMap = 'ID: ' + StrUavTypeID

    // 检查是否已经存在该 ID 的飞机实体，如果存在则直接复用，避免重复创建
    let existingEntity = this.viewer.entities.getById('ID: ' + StrUavTypeID)
    if (existingEntity) {
      this.viewer.trackedEntity = existingEntity
      return existingEntity
    }

    let entity = this.viewer.entities.add({
      name: StrUavTypeID,
      id: 'ID: ' + StrUavTypeID,
      position: new Cesium.CallbackProperty(() => {
        return new Cesium.Cartesian3.fromDegrees(
          this.dynamicData.lon,
          this.dynamicData.lat,
          this.dynamicData.alt,
        )
      }, false),
      //增加模型航向
      orientation: new Cesium.CallbackProperty(() => {
        return new Cesium.Transforms.headingPitchRollQuaternion(
          new Cesium.Cartesian3.fromDegrees(
            this.dynamicData.lon,
            this.dynamicData.lat,
            this.dynamicData.alt,
          ),
          new Cesium.HeadingPitchRoll(
            Cesium.Math.toRadians(this.dynamicData.heading - 0), // 0：调整该值（不同模型的正方向不同）
            Cesium.Math.toRadians(0),
            Cesium.Math.toRadians(0),
          ),
        )
      }, false),

      model: {
        uri: modelPath,
        scale: 0.001,
        minimumPixelSize: 50,
        maximumScale: 20000,
        runAnimations: true,
        clampAnimations: true,
        color: Cesium.Color.fromAlpha(Cesium.Color.RED, parseFloat(1.0)),
        colorBlendMode: Cesium.ColorBlendMode['MIX'],
        colorBlendAmount: 0.8,
      },
    })
    this.viewer.trackedEntity = entity
  }

  setNoTrack() {
    window.viewer.trackedEntity = null
    window.viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY)
  }

  stopAreaMeasure() {
    if (!this.measAreaStatus) return
    this.handler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK)
    this.handler.removeInputAction(Cesium.ScreenSpaceEventType.MOUSE_MOVE)
    this.handler.removeInputAction(Cesium.ScreenSpaceEventType.RIGHT_CLICK)
    this.measAreaStatus = false
    this.viewer._element.style.cursor = 'default'
    this.viewer.enableCursorStyle = true
  }

  //清空绘制（多边形和label）
  clearAreaEntity() {
    this.stopAreaMeasure()

    // 当前多边形可能尚未完成，因此还没有加入 areaEntities。
    if (this.polygon && !this.areaEntities.includes(this.polygon)) {
      this.viewer.entities.remove(this.polygon)
    }
    this.areaEntities.forEach((entity) => {
      this.viewer.entities.remove(entity)
    })
    this.areaEntities = []
    this.polygon = undefined
    this.activeShapePoints = []
    this.viewer.scene.requestRender()
  }

  activateAreaMeasure() {
    // 重新进入面积测量时，只取消未完成的本次测量，保留之前的结果。
    this.stopAreaMeasure()
    if (this.polygon && !this.areaEntities.includes(this.polygon)) {
      this.viewer.entities.remove(this.polygon)
    }
    this.activeShapePoints = []
    this.polygon = undefined

    this.viewer.scene.globe.depthTestAgainstTerrain = true
    this.handler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas)
    this.measAreaStatus = true
    this.viewer._element.style.cursor = 'crosshair'
    this.viewer.enableCursorStyle = true

    const areaPoints = []
    const getRenderableAreaPoints = () => {
      const points = []
      const minimumSpacing = 0.05

      areaPoints.forEach((point) => {
        if (
          point &&
          (points.length === 0 ||
            Cesium.Cartesian3.distance(points.at(-1), point) > minimumSpacing)
        ) {
          points.push(point)
        }
      })

      if (
        points.length > 2 &&
        Cesium.Cartesian3.distance(points[0], points.at(-1)) <= minimumSpacing
      ) {
        points.pop()
      }

      return points
    }

    //鼠标左键--确定选中点
    this.handler.setInputAction((event) => {
      let ray = this.viewer.camera.getPickRay(event.position)
      let earthPosition = this.viewer.scene.globe.pick(ray, this.viewer.scene)
      if (!earthPosition) return

      //鼠标开始点击多边形的第一个点
      if (areaPoints.length === 0) {
        //将第一个左击的点添加到多边形顶点集合中
        areaPoints.push(earthPosition)
        //多边形的坐标采用回调的形式
        //边线顶点
        let linePoints = new Cesium.CallbackProperty(() => {
          return areaPoints.concat([areaPoints[0]])
        }, false)
        //多边形顶点
        let dynamicPositions = new Cesium.CallbackProperty(() => {
          const points = getRenderableAreaPoints()
          return points.length >= 3
            ? new Cesium.PolygonHierarchy(points)
            : undefined
        }, false)
        //添加一个多边形
        this.polygon = new Cesium.Entity({
          name: 'area polygon',
          polyline: {
            positions: linePoints,
            width: 1,
            material: Cesium.Color.RED.withAlpha(0.8),
            heightReference: Cesium.HeightReference.NONE,
            clampToGround: true,
          },
          polygon: {
            hierarchy: dynamicPositions,
            material: Cesium.Color.ORANGERED.withAlpha(0.65),
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            classificationType: Cesium.ClassificationType.TERRAIN,
            arcType: Cesium.ArcType.GEODESIC,
            zIndex: 10,
          },
        })
        this.polygon.GeoType = 'Polygon'
        this.viewer.entities.add(this.polygon)
      }
      this.viewer.scene.requestRender()
      //将鼠标点击的点添加到多边形顶点集合中
      areaPoints.push(earthPosition)
      this.activeShapePoints = areaPoints
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

    //鼠标移动--实时绘制多边形
    this.handler.setInputAction((movement) => {
      //获取鼠标所在的位置
      const ray = this.viewer.camera.getPickRay(movement.endPosition)
      const newPosition = this.viewer.scene.globe.pick(ray, this.viewer.scene)
      if (!newPosition) return

      //已经定义了polygon
      if (Cesium.defined(this.polygon)) {
        //删除多边形顶点中最新的一个点
        areaPoints.pop()
        //将最新获取到的点添加到多边形顶点集合中
        areaPoints.push(newPosition)
      }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE)

    //鼠标右键--结束绘制
    this.handler.setInputAction(() => {
      if (!this.polygon) return

      //删除最后一个点（重复添加的点）
      areaPoints.pop()
      if (areaPoints.length < 3) {
        this.viewer.entities.remove(this.polygon)
        this.polygon = undefined
        this.activeShapePoints = []
        this.stopAreaMeasure()
        return
      }

      const finalPoints = getRenderableAreaPoints()
      if (finalPoints.length < 3) {
        this.viewer.entities.remove(this.polygon)
        this.polygon = undefined
        this.activeShapePoints = []
        this.stopAreaMeasure()
        return
      }

      const closedPoints = finalPoints.concat([finalPoints[0]])
      this.polygon.polyline.positions = closedPoints
      this.polygon.polygon.hierarchy = new Cesium.PolygonHierarchy(finalPoints)
      this.polygon.polygon.heightReference =
        Cesium.HeightReference.CLAMP_TO_GROUND
      this.polygon.polygon.classificationType =
        Cesium.ClassificationType.TERRAIN
      this.polygon.pottingPoint = finalPoints

      const polygonParts = this._splitSelfIntersectingArea(finalPoints)
      const resultEntities = [this.polygon]

      if (polygonParts.length > 1) {
        // 自相交轮廓不能直接交给 Cesium 三角剖分，保留原边界并用拆分后的简单多边形填充。
        this.polygon.polygon = undefined
        polygonParts.forEach((points) => {
          const fillEntity = this.viewer.entities.add({
            name: 'area polygon fill',
            polygon: {
              hierarchy: new Cesium.PolygonHierarchy(points),
              material: Cesium.Color.ORANGERED.withAlpha(0.65),
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              classificationType: Cesium.ClassificationType.TERRAIN,
              arcType: Cesium.ArcType.GEODESIC,
              zIndex: 10,
            },
          })
          resultEntities.push(fillEntity)
        })
      }

      const label = this._showResultArea(polygonParts)
      this.areaEntities.push(...resultEntities)
      if (label) this.areaEntities.push(label)
      this.activeShapePoints = finalPoints
      this.stopAreaMeasure()
      this.viewer.scene.requestRender()
    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK)
  }

  _showResultArea(polygonParts = [this.polygon.pottingPoint]) {
    const area = polygonParts.reduce(
      (sum, points) => sum + this._getPolygonAreaSquareMeters(points),
      0,
    )
    let text = '面积：' + this._formatPolygonArea(area)
    let centerPoint = this._getCenterOfGravityPoint(this.polygon.pottingPoint)
    return this._addLabel(centerPoint, text)
  }

  _splitSelfIntersectingArea(points) {
    if (points.length < 4) return [points]

    const localToWorld = Cesium.Transforms.eastNorthUpToFixedFrame(points[0])
    const worldToLocal = Cesium.Matrix4.inverse(
      localToWorld,
      new Cesium.Matrix4(),
    )
    const localPoints = points.map((point) =>
      Cesium.Matrix4.multiplyByPoint(
        worldToLocal,
        point,
        new Cesium.Cartesian3(),
      ),
    )
    const epsilon = 1e-8

    for (let i = 0; i < points.length; i++) {
      const iNext = (i + 1) % points.length
      for (let j = i + 1; j < points.length; j++) {
        const jNext = (j + 1) % points.length
        const adjacent =
          i === j || iNext === j || jNext === i || (i === 0 && jNext === 0)
        if (adjacent) continue

        const a = localPoints[i]
        const b = localPoints[iNext]
        const c = localPoints[j]
        const d = localPoints[jNext]
        const denominator =
          (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x)
        if (Math.abs(denominator) <= epsilon) continue

        const t =
          ((c.x - a.x) * (d.y - c.y) -
            (c.y - a.y) * (d.x - c.x)) /
          denominator
        const u =
          ((c.x - a.x) * (b.y - a.y) -
            (c.y - a.y) * (b.x - a.x)) /
          denominator
        if (t <= epsilon || t >= 1 - epsilon || u <= epsilon || u >= 1 - epsilon) {
          continue
        }

        const localIntersection = new Cesium.Cartesian3(
          a.x + t * (b.x - a.x),
          a.y + t * (b.y - a.y),
          0,
        )
        const intersection = Cesium.Matrix4.multiplyByPoint(
          localToWorld,
          localIntersection,
          new Cesium.Cartesian3(),
        )
        const intersectionCartographic =
          Cesium.Cartographic.fromCartesian(intersection)
        const surfaceIntersection = Cesium.Cartesian3.fromRadians(
          intersectionCartographic.longitude,
          intersectionCartographic.latitude,
          0,
        )

        const firstPart = [surfaceIntersection]
        for (let index = iNext; index !== jNext; index = (index + 1) % points.length) {
          firstPart.push(points[index])
        }

        const secondPart = [surfaceIntersection]
        for (let index = jNext; index !== iNext; index = (index + 1) % points.length) {
          secondPart.push(points[index])
        }

        return [firstPart, secondPart]
      }
    }

    return [points]
  }
  /*角度*/
  _Angle(p1, p2, p3) {
    let angle = this._Bearing(p2, p1) - this._Bearing(p2, p3)
    if (angle < 0) {
      angle += 360
    }
    return angle
  }
  /*方向*/
  _Bearing(from, to) {
    from = Cesium.Cartographic.fromCartesian(from)
    to = Cesium.Cartographic.fromCartesian(to)

    let lat1 = from.latitude
    let lon1 = from.longitude
    let lat2 = to.latitude
    let lon2 = to.longitude
    let angle = -Math.atan2(
      Math.sin(lon1 - lon2) * Math.cos(lat2),
      Math.cos(lat1) * Math.sin(lat2) -
        Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon1 - lon2),
    )
    if (angle < 0) {
      angle += Math.PI * 2.0
    }
    return Cesium.Math.toDegrees(angle)
  }

  distance(point1, point2) {
    let point1cartographic = Cesium.Cartographic.fromCartesian(point1)
    let point2cartographic = Cesium.Cartographic.fromCartesian(point2)
    /**根据经纬度计算出距离**/
    let geodesic = new Cesium.EllipsoidGeodesic()
    geodesic.setEndPoints(point1cartographic, point2cartographic)
    let s = geodesic.surfaceDistance
    //返回两点之间的距离
    s = Math.sqrt(
      Math.pow(s, 2) +
        Math.pow(point2cartographic.height - point1cartographic.height, 2),
    )
    return s
  }

  getPolygonArea(points) {
    if (points.length < 3) return "0.0000 平方米";

    return this._formatPolygonArea(this._getPolygonAreaSquareMeters(points))
  }

  _getPolygonAreaSquareMeters(points) {
    if (points.length < 3) return 0

    // 使用叉乘计算多边形投影面积（更准确且支持凹多边形）
    let p0 = points[0];
    let sumCross = new Cesium.Cartesian3();
    for (let i = 1; i < points.length - 1; i++) {
      let v1 = Cesium.Cartesian3.subtract(points[i], p0, new Cesium.Cartesian3());
      let v2 = Cesium.Cartesian3.subtract(points[i + 1], p0, new Cesium.Cartesian3());
      let cross = Cesium.Cartesian3.cross(v1, v2, new Cesium.Cartesian3());
      Cesium.Cartesian3.add(sumCross, cross, sumCross);
    }
    return Cesium.Cartesian3.magnitude(sumCross) / 2.0
  }

  _formatPolygonArea(area) {
    let res = area
    if (res < 1000000) {
      res = Math.abs(res).toFixed(4) + ' 平方米'
    } else {
      res = Math.abs(res / 1000000.0).toFixed(4) + ' 平方公里'
    }
    return res
  }
  _getCenterOfGravityPoint(mPoints) {
    let centerPoint = mPoints[0]
    for (let i = 1; i < mPoints.length; i++) {
      centerPoint = Cesium.Cartesian3.midpoint(
        centerPoint,
        mPoints[i],
        new Cesium.Cartesian3(),
      )
    }
    // 关键修复：将求和得到的地下点重新投影到地表，防止放大时触发地平线剔除(Horizon Culling)导致标签消失
    let carto = Cesium.Cartographic.fromCartesian(centerPoint);
    if (carto) {
      centerPoint = Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, 10.0);
    }
    return centerPoint
  }
  _addLabel(centerPoint, text) {
    if (!centerPoint) return;
    return this.viewer.entities.add(
      new Cesium.Entity({
        name: 'area label',
        position: centerPoint,
        label: {
          text: text,
          font: '2.5rem sans-serif',
          fillColor: Cesium.Color.WHITE,
          style: Cesium.LabelStyle.FILL,
          eyeOffset: new Cesium.Cartesian3(0, 0, -10), // 负Z轴代表向屏幕外（靠近相机）偏移
          horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          scale: 0.4,
          showBackground: true,
          backgroundColor: new Cesium.Color(0.165, 0.165, 0.165, 0.99),
          backgroundPadding: new Cesium.Cartesian2(15, 7),
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      }),
    )
  }

  // -------------------------------------------//
  //激活测距
  activate() {
    this.handler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas)
    this.viewer.scene.globe.depthTestAgainstTerrain = true

    this.isMeasure = true
    this.totalDistance = 0 // 总距离
    //设置鼠标样式
    this.viewer._element.style.cursor = 'crosshair'
    this.viewer.enableCursorStyle = true
    this.temPositions = []
    this.positions = []

    this.registerEvents() //注册鼠标事件
  }

  //禁用测距
  deactivate() {
    if (!this.isMeasure) return
    this.unRegisterEvents()
    this.viewer._element.style.cursor = 'default'
    this.viewer.enableCursorStyle = true
    this.isMeasure = false
    this.lineEntitys.push(this.lineEntity)
  }

  //清空绘制（测距）
  clearDisEntity() {
    //清除折线
    this.lineEntitys.forEach((item) => {
      this.viewer.entities.remove(item)
    })
    //清除节点
    this.vertexEntities.forEach((item) => {
      this.viewer.entities.remove(item)
    })

    this.positions = []
    this.temPositions = [] // 鼠标移动时产生的临时点
    this.vertexEntities = [] // 节点元素
    this.lineEntity = undefined // 距离测量折线元素
    this.lineEntitys = [] // 距离测量折线元素数组，每完成一次距离测量，将折线元素加入此数组
    this.totalDistance = 0 // 总距离
  }

  //创建线对象（测距）
  createLineEntity() {
    this.lineEntity = this.viewer.entities.add({
      polyline: {
        positions: new Cesium.CallbackProperty((e) => {
          return this.temPositions
        }, false),
        width: 2,
        material: Cesium.Color.YELLOW,
        clampToGround: true,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
    })
    this.viewer.scene.requestRender()
  }
  //创建线节点（测距）
  createVertex() {
    let vertexEntity = new Cesium.Entity({
      id: 'MeasureDistanceVertex' + this.positions[this.positions.length - 1],
      position: this.positions[this.positions.length - 1],
      point: {
        color: Cesium.Color.FUCHSIA,
        pixelSize: 6,
        disableDepthTestDistance: 99000000,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
      label: {
        text: this.spaceDistance(this.positions) + 'km',
        font: '2rem sans-serif',
        fillColor: Cesium.Color.WHITE,
        style: Cesium.LabelStyle.FILL,
        pixelOffset: new Cesium.Cartesian2(20, -10),
        eyeOffset: new Cesium.Cartesian3(0, 0, 0),
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        // distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 20000),
        scale: 0.5,
        showBackground: true,
        backgroundColor: new Cesium.Color(0.165, 0.165, 0.165, 0.5),
        backgroundPadding: new Cesium.Cartesian2(10, 10),
        clampToGround: true,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: 99000000,
      },
    })
    this.vertexEntities.push(vertexEntity)
    this.viewer.entities.add(vertexEntity)
  }
  //创建起点（测距）
  createStartEntity() {
    let vertexEntity = this.viewer.entities.add({
      position: this.positions[0],
      type: 'MeasureDistanceVertex',
      point: {
        show: true,
        pixelSize: 10,
        color: Cesium.Color.RED,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 1,
        clampToGround: true,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: 99000000,
      },
    })
    this.vertexEntities.push(vertexEntity)
  }
  //创建终点节点（测距）
  createEndEntity() {
    let vertexEntity = this.viewer.entities.add({
      position: this.positions[this.positions.length - 1],
      type: 'MeasureDistanceVertex',
      label: {
        text: '总距离：' + this.totalDistance.toFixed(3) + 'km',
        font: '2.5rem sans-serif',
        fillColor: Cesium.Color.WHITE,
        style: Cesium.LabelStyle.FILL,
        pixelOffset: new Cesium.Cartesian2(20, -60),
        eyeOffset: new Cesium.Cartesian3(0, 0, 10),
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        scale: 0.4,
        showBackground: true,
        backgroundColor: new Cesium.Color(0.165, 0.165, 0.165, 0.99),
        backgroundPadding: new Cesium.Cartesian2(10, 10),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
      point: {
        pixelSize: 10,
        color: Cesium.Color.RED,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 1,
        clampToGround: true,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: 99000000,
      },
    })
    this.vertexEntities.push(vertexEntity)
  }
  //注册鼠标事件（测距）
  registerEvents() {
    this.leftClickEvent()
    this.rightClickEvent()
    this.mouseMoveEvent()
  }
  //左键点击事件（测距）
  leftClickEvent() {
    //单击鼠标左键画点点击事件
    this.handler.setInputAction((e) => {
      let position = this.viewer.scene.pickPosition(e.position)
      if (!position) {
        const ellipsoid = this.viewer.scene.globe.ellipsoid
        position = this.viewer.scene.camera.pickEllipsoid(e.position, ellipsoid)
      }
      if (!position) return
      this.positions.push(position)
      if (this.positions.length === 1) {
        //首次点击
        this.createLineEntity()
        this.createStartEntity()
        return
      }
      this.createVertex()
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)
  }

  //鼠标移动事件（测距）
  mouseMoveEvent() {
    this.handler.setInputAction((e) => {
      if (!this.isMeasure) return
      let position = this.viewer.scene.pickPosition(e.endPosition)
      if (!position) {
        position = this.viewer.scene.camera.pickEllipsoid(
          e.startPosition,
          this.viewer.scene.globe.ellipsoid,
        )
      }
      if (!position) return
      this.handleMoveEvent(position)
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE)
  }

  //处理鼠标移动（测距）
  handleMoveEvent(position) {
    if (this.positions.length < 1) return
    this.temPositions = this.positions.concat(position)
  }

  //右键事件（测距）
  rightClickEvent() {
    this.handler.setInputAction((e) => {
      if (!this.isMeasure || this.positions.length < 1) {
        this.deactivate()
        this.clearDisEntity()
      } else {
        this.createEndEntity()
        this.lineEntity.polyline = {
          positions: this.positions,
          width: 2,
          material: Cesium.Color.YELLOW,
          depthFailMaterial: Cesium.Color.YELLOW,
        }
        this.deactivate()
      }
    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK)
  }

  //解除鼠标事件（测距）
  unRegisterEvents() {
    this.handler.removeInputAction(Cesium.ScreenSpaceEventType.RIGHT_CLICK)
    this.handler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK)
    this.handler.removeInputAction(Cesium.ScreenSpaceEventType.MOUSE_MOVE)
  }

  /**
   * 计算距离
   * @param positions 长度大于1的Cartesian3数组
   */
  spaceDistance(positions) {
    let l = positions.length
    let point1cartographic = Cesium.Cartographic.fromCartesian(positions[l - 1])
    let point2cartographic = Cesium.Cartographic.fromCartesian(positions[l - 2])
    /**根据经纬度计算出距离**/
    let geodesic = new Cesium.EllipsoidGeodesic()
    geodesic.setEndPoints(point1cartographic, point2cartographic)
    this.totalDistance += geodesic.surfaceDistance / 1000
    return (geodesic.surfaceDistance / 1000).toFixed(3)
  }

  clearDraw() {
    if (this.graphics.length < 1) return true

    this._stopDraw()

    this.graphics.forEach((graphic) => {
      this.viewer.entities.remove(graphic)
    })
    this.graphics = []
    this.viewer.scene.requestRender()
  }
  /**********************   实时图形绘制  ***************************************/
  drawGraphics(key) {
    this.viewer.scene.globe.depthTestAgainstTerrain = true
    // 清除可能会用到的监听事件
    if (this.handler) {
      this.handler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK)
      this.handler.removeInputAction(Cesium.ScreenSpaceEventType.MOUSE_MOVE)
      this.handler.removeInputAction(Cesium.ScreenSpaceEventType.RIGHT_CLICK)
    }
    this.handler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas)
    this.viewer._element.style.cursor = 'crosshair'
    this.viewer.enableCursorStyle = true

    if (key === 'polygon') {
      this._drawPolygon()
    } else if (key === 'rec') {
      this._drawRec()
    } else if (key === 'circle') {
      this._drawCircle()
    }
  }
  _stopDraw() {
    this.viewer.scene.globe.depthTestAgainstTerrain = false
    // 清除可能会用到的监听事件
    this.handler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK)
    this.handler.removeInputAction(Cesium.ScreenSpaceEventType.MOUSE_MOVE)
    this.handler.removeInputAction(Cesium.ScreenSpaceEventType.RIGHT_CLICK)

    this.viewer._element.style.cursor = 'default'
    this.viewer.enableCursorStyle = true
  }
  _drawPolygon() {
    let aPolygon
    let drawPolygonPts = []

    // 辅助拾取地表点函数，优先支持地形起伏
    const pickPoint = (position) => {
      let ray = this.viewer.camera.getPickRay(position)
      let cartesian = this.viewer.scene.globe.pick(ray, this.viewer.scene)
      if (!cartesian) {
        cartesian = this.viewer.camera.pickEllipsoid(
          position,
          this.viewer.scene.globe.ellipsoid,
        )
      }
      return cartesian
    }

    //鼠标左键--确定选中点
    this.handler.setInputAction((event) => {
      let earthPosition = pickPoint(event.position)
      if (!earthPosition) return

      //鼠标开始点击多边形的第一个点
      if (drawPolygonPts.length === 0) {
        //将第一个左击的点添加到多边形顶点集合中
        drawPolygonPts.push(earthPosition)
        //添加一个空的实体
        aPolygon = this.viewer.entities.add({
          name: 'draw polygon',
        })
      }

      this.viewer.scene.requestRender()
      //将鼠标点击的点添加到多边形顶点集合中
      drawPolygonPts.push(earthPosition)

      // 有了两个点及以上就可以画线了
      if (!aPolygon.polyline && drawPolygonPts.length >= 2) {
        aPolygon.polyline = new Cesium.PolylineGraphics({
          positions: new Cesium.CallbackProperty(() => {
            return drawPolygonPts.concat([drawPolygonPts[0]])
          }, false),
          width: this.graphicStyle.borderWidth,
          material: this.graphicStyle.borderColor,
          clampToGround: true,
        })
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

    //鼠标移动--实时绘制多边形
    this.handler.setInputAction((movement) => {
      const newPosition = pickPoint(movement.endPosition)
      if (!newPosition) return

      //已经定义了polygon
      if (Cesium.defined(aPolygon)) {
        //删除多边形顶点中最新的一个点
        drawPolygonPts.pop()
        //将最新获取到的点添加到多边形顶点集合中
        drawPolygonPts.push(newPosition)

        // 当点数达到3个且没有重合时，才初始化多边形实体，避免因为退化几何体导致报错
        if (drawPolygonPts.length >= 3 && !aPolygon.polygon) {
          let p0 = drawPolygonPts[0]
          let p1 = drawPolygonPts[1]
          let p2 = drawPolygonPts[2]
          if (
            Cesium.Cartesian3.distance(p0, p1) > 0.01 &&
            Cesium.Cartesian3.distance(p1, p2) > 0.01 &&
            Cesium.Cartesian3.distance(p0, p2) > 0.01
          ) {
            aPolygon.polygon = new Cesium.PolygonGraphics({
              hierarchy: new Cesium.CallbackProperty(() => {
                return new Cesium.PolygonHierarchy(drawPolygonPts)
              }, false),
              material: this.graphicStyle.material,
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            })
          }
        }

        this.viewer.scene.requestRender()
      }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE)

    //鼠标右键--结束绘制
    this.handler.setInputAction((event) => {
      if (!aPolygon) return
      //删除最后一个点（重复添加的点）
      drawPolygonPts.pop()

      if (drawPolygonPts.length < 3) {
        this.viewer.entities.remove(aPolygon)
        this._stopDraw()
        return
      }

      drawPolygonPts.push(drawPolygonPts[0])
      aPolygon.polyline.positions = drawPolygonPts
      aPolygon.polygon.hierarchy = new Cesium.PolygonHierarchy(drawPolygonPts)
      aPolygon.polygon.heightReference = Cesium.HeightReference.CLAMP_TO_GROUND
      this.graphics.push(aPolygon)
      this._stopDraw()
      // geojson2kml(this.entity2Geojson(aPolygon))
    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK)
  }
  _drawRec() {
    let aPolygon = undefined
    let westSouthEastNorth = []
    let lat1, lng1, lat, lng

    // 辅助拾取地表点函数，优先支持地形起伏
    const pickPoint = (position) => {
      let ray = this.viewer.camera.getPickRay(position)
      let cartesian = this.viewer.scene.globe.pick(ray, this.viewer.scene)
      if (!cartesian) {
        cartesian = this.viewer.camera.pickEllipsoid(
          position,
          this.viewer.scene.globe.ellipsoid,
        )
      }
      return cartesian
    }

    this.handler.setInputAction((event) => {
      // 如果已经开始绘制，则忽略后续的左键点击
      if (aPolygon) return

      let cartesian = pickPoint(event.position)
      if (!cartesian) return

      let cartographic = Cesium.Cartographic.fromCartesian(
        cartesian,
        this.viewer.scene.globe.ellipsoid,
        new Cesium.Cartographic(),
      )
      lng1 = Cesium.Math.toDegrees(cartographic.longitude)
      lat1 = Cesium.Math.toDegrees(cartographic.latitude)
      westSouthEastNorth = []

      if (!aPolygon) {
        aPolygon = this.viewer.entities.add({
          name: 'rectangle',
        })
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

    this.handler.setInputAction((move) => {
      if (lng1 !== undefined && lat1 !== undefined) {
        let cartesian = pickPoint(move.endPosition)
        if (!cartesian) return

        let cartographic = Cesium.Cartographic.fromCartesian(
          cartesian,
          this.viewer.scene.globe.ellipsoid,
          new Cesium.Cartographic(),
        )
        lng = Cesium.Math.toDegrees(cartographic.longitude)
        lat = Cesium.Math.toDegrees(cartographic.latitude)

        if (
          Math.abs(lng - lng1) < 0.000001 ||
          Math.abs(lat - lat1) < 0.000001
        ) {
          return
        }

        westSouthEastNorth = [
          lng1,
          lat1,
          lng1,
          lat,
          lng,
          lat,
          lng,
          lat1,
          lng1,
          lat1,
        ]

        if (!aPolygon.polygon) {
          aPolygon.polygon = new Cesium.PolygonGraphics({
            hierarchy: new Cesium.CallbackProperty(function () {
              if (westSouthEastNorth.length === 0) return undefined
              return new Cesium.PolygonHierarchy(
                Cesium.Cartesian3.fromDegreesArray(
                  westSouthEastNorth,
                  Cesium.Ellipsoid.WGS84,
                ),
              )
            }, false),
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            material: this.graphicStyle.material,
            fill: true,
            show: true,
          })

          aPolygon.polyline = new Cesium.PolylineGraphics({
            positions: new Cesium.CallbackProperty(function () {
              if (westSouthEastNorth.length === 0) return undefined
              return Cesium.Cartesian3.fromDegreesArray(
                westSouthEastNorth,
                Cesium.Ellipsoid.WGS84,
                undefined,
              )
            }, false),
            material: this.graphicStyle.borderColor,
            width: this.graphicStyle.borderWidth,
            clampToGround: true,
            zIndex: 1,
          })
        }

        this.viewer.scene.requestRender()
      }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE)

    this.handler.setInputAction(() => {
      if (aPolygon && aPolygon.polygon) {
        aPolygon.polygon.hierarchy = new Cesium.PolygonHierarchy(
          Cesium.Cartesian3.fromDegreesArray(
            westSouthEastNorth,
            Cesium.Ellipsoid.WGS84,
          ),
        )
        aPolygon.polygon.heightReference =
          Cesium.HeightReference.CLAMP_TO_GROUND
        aPolygon.polyline.positions = Cesium.Cartesian3.fromDegreesArray(
          westSouthEastNorth,
          Cesium.Ellipsoid.WGS84,
          undefined,
        )
        aPolygon.polyline.clampToGround = true

        this.viewer.scene.requestRender()
        this.graphics.push(aPolygon)
        this._stopDraw()
      } else if (aPolygon) {
        this.viewer.entities.remove(aPolygon)
        this._stopDraw()
      } else {
        this._stopDraw()
      }
    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK)
  }
  _drawCircle() {
    /**圆半径 */
    let centerPoint = null
    let radius = 0.01
    let aPolygon = undefined

    // 辅助拾取地表点函数，优先支持地形起伏
    const pickPoint = (position) => {
      let ray = this.viewer.camera.getPickRay(position)
      let cartesian = this.viewer.scene.globe.pick(ray, this.viewer.scene)
      if (!cartesian) {
        cartesian = this.viewer.camera.pickEllipsoid(
          position,
          this.viewer.scene.globe.ellipsoid,
        )
      }
      return cartesian
    }

    this.handler.setInputAction((event) => {
      if (centerPoint == null) {
        centerPoint = pickPoint(event.position)
        if (!centerPoint) return
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

    this.handler.setInputAction((move) => {
      if (centerPoint) {
        let cartesian2 = pickPoint(move.endPosition)
        if (!cartesian2) return
        radius = Cesium.Cartesian3.distance(centerPoint, cartesian2)

        // Cesium 的椭圆半轴必须大于 0，首次点击只记录圆心，等鼠标移动得到有效半径后再创建实体。
        if (!aPolygon && radius > 0) {
          aPolygon = this.viewer.entities.add({
            position: centerPoint,
            name: 'draw circle',
            ellipse: {
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              material: this.graphicStyle.material,
              outline: true,
              outlineColor: this.graphicStyle.borderColor,
              outlineWidth: this.graphicStyle.borderWidth,
              fill: true,
              semiMajorAxis: new Cesium.CallbackProperty(() => {
                return radius
              }, false),
              semiMinorAxis: new Cesium.CallbackProperty(() => {
                return radius
              }, false),
            },
          })
          const circlePositions = new Cesium.CallbackProperty(() => {
          if (!centerPoint || radius <= 0) return []

          const transform = Cesium.Transforms.eastNorthUpToFixedFrame(centerPoint)
          const positions = []
          const segments = 128

          for (let i = 0; i <= segments; i++) {
            const angle = (i / segments) * Cesium.Math.TWO_PI
            const localPoint = new Cesium.Cartesian3(
              radius * Math.cos(angle),
              radius * Math.sin(angle),
              0,
            )

            positions.push(
              Cesium.Matrix4.multiplyByPoint(
                transform,
                localPoint,
                new Cesium.Cartesian3(),
              ),
            )
          }

          return positions
        }, false)

        const borderEntity = this.viewer.entities.add({
          polyline: {
            positions: circlePositions,
            width: this.graphicStyle.borderWidth || 2,
            material: this.graphicStyle.borderColor,
            clampToGround: true,
          },
        })
        }

        this.viewer.scene.requestRender()
      }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE)

    this.handler.setInputAction(() => {
      if (centerPoint !== null && radius > 0) {
        if (aPolygon) {
          aPolygon.ellipse.semiMajorAxis = radius
          aPolygon.ellipse.semiMinorAxis = radius
          aPolygon.ellipse.heightReference =
            Cesium.HeightReference.CLAMP_TO_GROUND
        }
        this.viewer.scene.requestRender()
        this.graphics.push(aPolygon)
        this._stopDraw()
      } else {
        if (aPolygon) {
          this.viewer.entities.remove(aPolygon)
        }
        this._stopDraw()
      }
    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK)
  }
  _createPointEntity(position, label = '') {
    return new Cesium.Entity({
      position: position,
      point: {
        pixelSize: 4,
        color: Cesium.Color.RED,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 1,
        disableDepthTestDistance: 99000000,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
      label: {
        text: label,
        font: '2rem sans-serif',
        fillColor: Cesium.Color.WHITE,
        style: Cesium.LabelStyle.FILL,
        pixelOffset: new Cesium.Cartesian2(20, -10),
        eyeOffset: new Cesium.Cartesian3(0, 0, 0),
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        scale: 0.5,
        clampToGround: true,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: 99000000,
      },
    })
  }

  addEntitiesByDirectionAndLen(DatumPt, markers) {
    let datumCar = Cartesian3.fromDegrees(
      Number(DatumPt.lon),
      Number(DatumPt.lat),
    )
    console.group()
    console.log(markers)
    markers.forEach((marker) => {
      let pt = ByDirectionAndLen(
        datumCar,
        Number(marker.direction),
        Number(marker.distance),
      )

      let entity = new Cesium.Entity({
        position: pt,
        box: {
          dimensions: new Cartesian3(20, 30, Number(marker.alt)),
          material: Cesium.Color.RED,
          outline: true,
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2,
          disableDepthTestDistance: 990000,
        },
      })
      this.barirsCollection.push(entity)
      this.viewer.entities.add(entity)
    })

    return datumCar
  }
}
