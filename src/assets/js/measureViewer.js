import * as Cesium from 'cesium'
import { Cartesian3 } from 'cesium'
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
  addKml(kml_file) {
    let kmlDataPromise = Cesium.KmlDataSource.load(kml_file, {
      camera: this.viewer.scene.camera,
      canvas: this.viewer.scene.canvas,
      screenOverlayContainer: this.viewer.container,
      clampToGround: true,
    })
    console.log(kmlDataPromise)
    kmlDataPromise.then((dataSource) => {
      // console.log(dataSource);
      this.viewer.dataSources.add(dataSource)
      this.viewer.flyTo(dataSource)
      useLayerStore().addLayer(
        kml_file.name,
        kmlDataPromise,
        undefined,
        undefined,
        true,
      )
    })
  }

  addJson(js_file) {
    // 加载geojson数据
    let dataGeo = Cesium.GeoJsonDataSource.load(
      js_file,
      //设置样式
      {
        stroke: Cesium.Color.RED,
        fill: Cesium.Color.SKYBLUE.withAlpha(0.5),
        strokeWidth: 4,
      },
    )
    // viewer.dataSources.add(dataGeo);//可直接进行添加数据
    //dataGeo Promise对象加载完毕后执行
    dataGeo.then((dataSources) => {
      console.log(dataSources)
      this.viewer.dataSources.add(dataSources)
      useLayerStore().addLayer(
        js_file.name,
        dataGeo,
        undefined,
        undefined,
        true,
      )

      // 获取datasources中的实体
      let entities = dataSources.entities.values
      //获取每一个实体
      // entities.forEach((entity, i) => {
      //     //设置随机颜色
      //     entity.polygon.material = new Cesium.ColorMaterialProperty(
      //         Cesium.Color.fromRandom({
      //             alpha: 1,
      //         })
      //     );
      //     entity.polygon.outline = false;
      //     //随机高度（5个级别）
      //     let randomNum = parseInt(Math.random() * 5);
      //     //挤出高度
      //     entity.polygon.extrudedHeight = 100000 * randomNum;
      // });
    })
  }
//添加WMS图层函数
  AddWMSLayer(url) {
    //
    let wmsProvider = new Cesium.WebMapServiceImageryProvider({
      url: url, //baseurl + workspace + '/wms',
      enablePickFeatures: true,//开启拾取功能
      defaultAlpha: 0,          //设置透明度
      parameters: {
        service: 'WMS',          //服务类型
        version: '1.1.1',        //版本
        request: 'GetMap',       //请求类型  
        format: 'image/png8',    //图片格式
        styles: '',               //样式
        transparent: true,        //透明
      },
    })
    let imageLayer = new Cesium.ImageryLayer(wmsProvider, {
      alpha: 0.6,
    })
    this.viewer.imageryLayers.add(imageLayer)//添加图层到v
    useLayerStore().addLayer(url, undefined, imageLayer, undefined, true)
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
    //清除多边形
    this.viewer.entities.removeById('4399')
    this.viewer.entities.removeById('4390')
    this.polygon = undefined
    this.activeShapePoints = []
  }

  activateAreaMeasure() {
    this.clearAreaEntity()
    this.handler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas)
    this.viewer.scene.globe.depthTestAgainstTerrain = true
    // 清除可能会用到的监听事件
    if (this.handler) {
      this.handler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK)
      this.handler.removeInputAction(Cesium.ScreenSpaceEventType.MOUSE_MOVE)
      this.handler.removeInputAction(Cesium.ScreenSpaceEventType.RIGHT_CLICK)
    }
    this.handler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas)
    this.measAreaStatus = true
    this.viewer._element.style.cursor = 'crosshair'
    this.viewer.enableCursorStyle = true

    //鼠标左键--确定选中点
    this.handler.setInputAction((event) => {
      let ray = this.viewer.camera.getPickRay(event.position)
      let earthPosition = this.viewer.scene.globe.pick(ray, this.viewer.scene)
      //鼠标开始点击多边形的第一个点
      if (this.activeShapePoints.length === 0) {
        //将第一个左击的点添加到多边形顶点集合中
        this.activeShapePoints.push(earthPosition)
        //多边形的坐标采用回调的形式
        //边线顶点
        let linePoints = new Cesium.CallbackProperty(() => {
          return this.activeShapePoints.concat([this.activeShapePoints[0]])
        }, false)
        //多边形顶点
        let dynamicPositions = new Cesium.CallbackProperty(() => {
          return new Cesium.PolygonHierarchy(this.activeShapePoints)
        }, false)
        //添加一个多边形
        this.polygon = new Cesium.Entity({
          name: 'area polygon',
          id: '4399',
          polyline: {
            positions: linePoints,
            width: 1,
            material: Cesium.Color.RED.withAlpha(0.8),
            heightReference: Cesium.HeightReference.NONE,
            clampToGround: true,
          },
          polygon: {
            hierarchy: dynamicPositions,
            material: Cesium.Color.ORANGERED.withAlpha(0.8),
            heightReference: Cesium.HeightReference.NONE,
            // outlineColor: Cesium.Color.RED.withAlpha(0.7),
            // height: 0
          },
        })
        this.polygon.GeoType = 'Polygon'
        this.viewer.entities.add(this.polygon)
      }
      this.viewer.scene.requestRender()
      //将鼠标点击的点添加到多边形顶点集合中
      this.activeShapePoints.push(earthPosition)
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

    //鼠标移动--实时绘制多边形
    this.handler.setInputAction((movement) => {
      //获取鼠标所在的位置
      const ray = this.viewer.camera.getPickRay(movement.endPosition)
      const newPosition = this.viewer.scene.globe.pick(ray, this.viewer.scene)
      //已经定义了polygon
      if (Cesium.defined(this.polygon)) {
        //删除多边形顶点中最新的一个点
        this.activeShapePoints.pop()
        //将最新获取到的点添加到多边形顶点集合中
        this.activeShapePoints.push(newPosition)
      }
      if (this.activeShapePoints.length === 3) {
        this.polygon.polygon.heightReference =
          Cesium.HeightReference.CLAMP_TO_GROUND
      }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE)

    //鼠标右键--结束绘制
    this.handler.setInputAction((event) => {
      //删除最后一个点（重复添加的点）
      this.activeShapePoints.pop()
      this.polygon.pottingPoint = this.activeShapePoints
      this._showResultArea()
      this.stopAreaMeasure()
    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK)
  }

  _showResultArea() {
    let text = '面积：' + this.getPolygonArea(this.polygon.pottingPoint)
    let centerPoint = this._getCenterOfGravityPoint(this.polygon.pottingPoint)
    this._addLabel(centerPoint, text)
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
    let res = 0
    if (points.length < 3) return "0.0000 平方米";

    // 使用叉乘计算多边形投影面积（更准确且支持凹多边形）
    let p0 = points[0];
    let sumCross = new Cesium.Cartesian3();
    for (let i = 1; i < points.length - 1; i++) {
      let v1 = Cesium.Cartesian3.subtract(points[i], p0, new Cesium.Cartesian3());
      let v2 = Cesium.Cartesian3.subtract(points[i + 1], p0, new Cesium.Cartesian3());
      let cross = Cesium.Cartesian3.cross(v1, v2, new Cesium.Cartesian3());
      Cesium.Cartesian3.add(sumCross, cross, sumCross);
    }
    res = Cesium.Cartesian3.magnitude(sumCross) / 2.0;

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
    this.viewer.entities.removeById('4390');
    return this.viewer.entities.add(
      new Cesium.Entity({
        name: 'area label',
        id: '4390',
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
        eyeOffset: new Cesium.Cartesian3(0, 0, 30),
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        scale: 0.4,
        showBackground: true,
        backgroundColor: new Cesium.Color(0.165, 0.165, 0.165, 0.99),
        backgroundPadding: new Cesium.Cartesian2(10, 10),
        disableDepthTestDistance: 99000000,
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
    let radius = 0.0
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
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

    this.handler.setInputAction((move) => {
      if (centerPoint) {
        let cartesian2 = pickPoint(move.endPosition)
        if (!cartesian2) return
        radius = Cesium.Cartesian3.distance(centerPoint, cartesian2)
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
