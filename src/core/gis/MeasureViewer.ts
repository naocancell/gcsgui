import * as Cesium from 'cesium'
import { Cartesian3 } from 'cesium'
import { markRaw } from 'vue'
import { useStaticStore } from '@/store/staticStore'
import { useLayerStore } from '@/store/layerManagerStore'
import { ByDirectionAndLen } from '@/utils/map/geocomputation'
import type { Airline } from '@/types/entityoptions'

export interface GraphicStyle {
  borderColor: Cesium.Color
  borderWidth: number
  material: Cesium.Color
}

export interface DynamicUavData {
  lon?: number
  lat?: number
  alt?: number
  heading?: number
}

export interface AirportMarker {
  direction: number | string
  distance: number | string
  alt: number | string
}

/**
 * 地图测量与空间分析工具类 (MeasureViewer)
 * 提供距离测量、面积测量、地形剖面分析、KML/GeoJSON/3DTiles/WMS图层加载、空间几何绘制与机场障碍物标定
 */
export class MeasureViewer {
  public viewer: Cesium.Viewer
  public scene: Cesium.Scene
  public isMeasure = false
  public positions: Cesium.Cartesian3[] = []
  public temPositions: Cesium.Cartesian3[] = [] // 距离测量-鼠标移动时产生的临时点
  public vertexEntities: Cesium.Entity[] = [] // 距离测量-节点元素
  public lineEntity?: Cesium.Entity // 距离测量-折线元素
  public lineEntitys: Cesium.Entity[] = [] // 距离测量-折线元素数组
  public totalDistance = 0 // 距离测量-总距离 (km)

  public activeShapePoints: Cesium.Cartesian3[] = [] // 面积测量-多边形顶点
  public polygon?: Cesium.Entity
  public areaEntities: Cesium.Entity[] = [] // 已完成的面积测量多边形和标签
  public measAreaStatus = false // 是否在测量面积

  public analyseGraphs: Cesium.Entity[] = [] // 分析工具的图形容器
  public graphics: Cesium.Entity[] = [] // 图形绘制容器
  public dynamicData: DynamicUavData = {
    lon: undefined,
    lat: undefined,
    alt: undefined,
    heading: undefined,
  }
  public graphicStyle: GraphicStyle = {
    borderColor: Cesium.Color.BLUE,
    borderWidth: 1,
    material: Cesium.Color.GREEN.withAlpha(0.5),
  }

  public barirsCollection: Cesium.Entity[] = [] // 机场障碍物实体集合
  public dataHoverLabelEntity?: Cesium.Entity // 悬浮提示标签实体
  public dataHoverHandler?: Cesium.ScreenSpaceEventHandler // 悬浮提示事件处理器
  public handler?: Cesium.ScreenSpaceEventHandler // 当前交互事件处理器

  constructor(viewer: Cesium.Viewer) {
    this.viewer = viewer
    this.scene = viewer.scene

    // 初始化数据悬浮标签
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
        pixelOffset: new Cesium.Cartesian2(18, -24),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    })

    this.dataHoverHandler = new Cesium.ScreenSpaceEventHandler(
      this.viewer.scene.canvas,
    )
    this.dataHoverHandler.setInputAction(
      (movement: any) => this._updateDataHoverLabel(movement.endPosition),
      Cesium.ScreenSpaceEventType.MOUSE_MOVE,
    )
  }

  /**
   * 隐藏数据悬浮标签
   */
  private _hideDataHoverLabel(): void {
    if (this.dataHoverLabelEntity?.label) {
      this.dataHoverLabelEntity.label.show = new Cesium.ConstantProperty(false)
    }
  }

  /**
   * 更新数据悬浮标签的位置与文字
   * @param screenPosition 鼠标屏幕坐标
   */
  private _updateDataHoverLabel(screenPosition?: Cesium.Cartesian2): void {
    if (!screenPosition || !this.viewer.scene) {
      this._hideDataHoverLabel()
      return
    }

    const picked = this.viewer.scene.pick(screenPosition)
    let entity = picked?.id || picked?.primitive?.id
    if (entity === this.dataHoverLabelEntity) {
      const underlying = (this.viewer.scene.drillPick?.(screenPosition) || [])
        .map((item: any) => item?.id || item?.primitive?.id)
        .find((candidate: any) => candidate?.__dataHoverName)
      entity = underlying
    }
    const name = entity?.__dataHoverName
    if (!name || entity.__dataHoverGeometry === 'point') {
      this._hideDataHoverLabel()
      return
    }

    let position: Cesium.Cartesian3 | undefined
    try {
      if (this.viewer.scene.pickPositionSupported) {
        position = this.viewer.scene.pickPosition(screenPosition)
      }
    } catch (_error) {
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

    if (this.dataHoverLabelEntity && this.dataHoverLabelEntity.label) {
      this.dataHoverLabelEntity.position = new Cesium.ConstantPositionProperty(position)
      this.dataHoverLabelEntity.label.text = new Cesium.ConstantProperty(name)
      this.dataHoverLabelEntity.label.show = new Cesium.ConstantProperty(true)
      this.viewer.scene.requestRender()
    }
  }

  /**
   * 开启地形剖面分析绘制
   */
  public profileAnalyse(): void {
    // 解绑之前的鼠标事件
    if (this.handler) this.unRegisterEvents()
    let count = 0
    const profilePts: Cesium.Cartesian3[] = [] // 点集合
    let line: Cesium.Entity | undefined
    let movePoint: Cesium.Cartesian3 | undefined

    this.handler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas)

    // 绑定鼠标左击事件
    this.handler.setInputAction((e: any) => {
      let position = this.viewer.scene.pickPosition(e.position)
      if (!position) {
        const ellipsoid = this.viewer.scene.globe.ellipsoid
        position = this.viewer.scene.camera.pickEllipsoid(e.position, ellipsoid)
      }
      if (!position) return
      count++
      profilePts.push(position)
      const nodeEntity = this._createPointEntity(position, count.toString())
      this.viewer.entities.add(nodeEntity)
      this.analyseGraphs.push(nodeEntity)
      if (!line) {
        line = this.viewer.entities.add({
          polyline: {
            positions: new Cesium.CallbackProperty(() => {
              return movePoint ? profilePts.concat(movePoint) : profilePts
            }, false),
            width: 2,
            material: Cesium.Color.RED,
            clampToGround: true,
          },
        })
        this.analyseGraphs.push(line)
      }
      this.viewer.scene.requestRender()
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

    // 绑定鼠标移动事件
    this.handler.setInputAction((e: any) => {
      let position = this.viewer.scene.pickPosition(e.endPosition)
      if (!position) {
        const ellipsoid = this.viewer.scene.globe.ellipsoid
        position = this.viewer.scene.camera.pickEllipsoid(e.endPosition, ellipsoid)
      }
      if (!position) return
      movePoint = position
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE)

    // 绑定鼠标右击事件，结束剖面分析线绘制
    this.handler.setInputAction(() => {
      this.unRegisterEvents()
    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK)
  }

  /**
   * 清除地形剖面分析实体
   */
  public clearProfileEntities(): void {
    this.analyseGraphs.forEach((item) => {
      this.viewer.entities.remove(item)
    })
    this.analyseGraphs = []
    this.viewer.scene.requestRender()
  }

  /**
   * 更新无人机动态遥测数据
   * @param data 包含经纬度、高度、航向的数据
   */
  public updateDynamicData(data: DynamicUavData): void {
    this.dynamicData = { ...this.dynamicData, ...data }
    this.viewer.scene.requestRender()
  }

  /**
   * 添加航线探测点
   * @param position 坐标点
   */
  public addPointEntity(position: Cesium.Cartesian3): void {
    const pEntity = this.viewer.entities.add({
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
    } as any)
    this.vertexEntities.push(pEntity)
  }

  /**
   * 加载并解析 KML 文件
   * @param kml_file File 对象
   * @returns 加载后的 Cesium.KmlDataSource
   */
  public addKml(kml_file: File): Promise<Cesium.KmlDataSource> {
    const kmlDataPromise = Cesium.KmlDataSource.load(kml_file, {
      camera: this.viewer.scene.camera,
      canvas: this.viewer.scene.canvas,
      screenOverlayContainer: this.viewer.container as HTMLElement,
      clampToGround: true,
    })

    return kmlDataPromise
      .then((dataSource) => {
        const time = this.viewer.clock.currentTime.clone()

        function cartesianToLngLatHeight(cartesian: Cesium.Cartesian3) {
          const cartographic = Cesium.Cartographic.fromCartesian(cartesian)
          return {
            longitude: Cesium.Math.toDegrees(cartographic.longitude),
            latitude: Cesium.Math.toDegrees(cartographic.latitude),
            height: cartographic.height,
          }
        }

        const pinSvg = `
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="48" viewBox="0 0 32 48">
            <path d="M16 0C7.2 0 0 7.2 0 16c0 12 16 32 16 32s16-20 16-32C32 7.2 24.8 0 16 0z" fill="#ff3333"/>
            <circle cx="16" cy="16" r="7" fill="white"/>
          </svg>
        `
        const pinImage =
          'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(pinSvg)

        function addPin(position: Cesium.Cartesian3, name: string, properties: any = {}) {
          return dataSource.entities.add({
            name,
            position,
            billboard: {
              image: pinImage,
              width: 24,
              height: 36,
              verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            },
            properties,
          })
        }

        function getGeometryName(entity: any) {
          if (entity.name) return entity.name
          if (entity.parent && entity.parent.name) return entity.parent.name
          return undefined
        }

        this.viewer.dataSources.add(dataSource)
        this.viewer.flyTo(dataSource)

        const layerStore = useLayerStore()
        layerStore.addLayer(
          kml_file.name,
          markRaw(dataSource),
          undefined,
          undefined,
          true,
        )

        const result: any[] = []
        const originalEntities = [...dataSource.entities.values]

        function styleKmlLabel(entity: any, labelText: string = entity.name || '') {
          if (!entity.label) return
          entity.label.show = new Cesium.ConstantProperty(true)
          entity.label.text = new Cesium.ConstantProperty(labelText)
          entity.label.font = new Cesium.ConstantProperty(
            'bold 16px "Microsoft YaHei", "PingFang SC", sans-serif',
          )
          entity.label.fillColor = new Cesium.ConstantProperty(
            Cesium.Color.fromCssColorString('#ffffff'),
          )
          entity.label.outlineColor = new Cesium.ConstantProperty(
            Cesium.Color.fromCssColorString('#222222'),
          )
          entity.label.outlineWidth = new Cesium.ConstantProperty(3)
          entity.label.style = new Cesium.ConstantProperty(
            Cesium.LabelStyle.FILL_AND_OUTLINE,
          )
          entity.label.pixelOffset = new Cesium.ConstantProperty(
            new Cesium.Cartesian2(0, -42),
          )
          entity.label.horizontalOrigin = new Cesium.ConstantProperty(
            Cesium.HorizontalOrigin.CENTER,
          )
          entity.label.verticalOrigin = new Cesium.ConstantProperty(
            Cesium.VerticalOrigin.BOTTOM,
          )
          entity.label.disableDepthTestDistance = new Cesium.ConstantProperty(
            Number.POSITIVE_INFINITY,
          )
          entity.label.showBackground = new Cesium.ConstantProperty(true)
          entity.label.backgroundColor = new Cesium.ConstantProperty(
            Cesium.Color.fromCssColorString('rgba(0, 0, 0, 0.45)'),
          )
          entity.label.backgroundPadding = new Cesium.ConstantProperty(
            new Cesium.Cartesian2(8, 5),
          )
        }

        originalEntities.forEach((entity: any) => {
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
            entity.label.show = new Cesium.ConstantProperty(false)
          }
        })

        originalEntities.forEach((entity: any) => {
          const isPoint =
            !!entity.position &&
            !entity.polyline &&
            !entity.polygon &&
            !entity.rectangle &&
            !entity.ellipse &&
            !entity.corridor

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

          if (entity.polyline && entity.polyline.positions) {
            const positions = entity.polyline.positions.getValue(time)
            if (positions && positions.length > 1) {
              const geometryName = getGeometryName(entity)
              result.push({
                entityName: geometryName,
                type: 'polyline',
                points: positions.map((pos: Cesium.Cartesian3) =>
                  cartesianToLngLatHeight(pos),
                ),
              })
              if (geometryName) {
                entity.__dataHoverName = geometryName
                entity.__dataHoverGeometry = 'polyline'
              }
            }
          }

          if (entity.polygon && entity.polygon.hierarchy) {
            const hierarchy = entity.polygon.hierarchy.getValue(time)
            if (
              hierarchy &&
              hierarchy.positions &&
              hierarchy.positions.length > 2
            ) {
              const geometryName = getGeometryName(entity)
              result.push({
                entityName: geometryName,
                type: 'polygon',
                points: hierarchy.positions.map((pos: Cesium.Cartesian3) =>
                  cartesianToLngLatHeight(pos),
                ),
              })
              if (geometryName) {
                entity.__dataHoverName = geometryName
                entity.__dataHoverGeometry = 'polygon'
              }
            }
          }
        })

        ;(dataSource as any).__kmlCoordinateExport = result
        this.viewer.scene.requestRender()
        return dataSource
      })
      .catch((error) => {
        console.error('KML 加载失败：', error)
        throw error
      })
  }

  /**
   * 加载并解析 GeoJSON 文件
   * @param js_file GeoJSON File 对象
   * @returns 加载后的 Cesium.GeoJsonDataSource
   */
  public addJson(js_file: File): Promise<Cesium.GeoJsonDataSource> {
    const url = URL.createObjectURL(js_file)
    const groundHeightReference = Cesium.HeightReference.CLAMP_TO_GROUND
    const dataGeo = Cesium.GeoJsonDataSource.load(url, {
      clampToGround: true,
    })

    const loadResult = dataGeo
      .then((dataSource) => {
        this.viewer.dataSources.add(dataSource)
        this.viewer.flyTo(dataSource)

        const layerStore = useLayerStore()
        layerStore.addLayer(
          js_file.name,
          markRaw(dataSource),
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

        const getEntityName = (entity: any) => {
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

        const styleKmlLabel = (label: any, text: string) => {
          label.show = true
          label.text = text
          label.font = 'bold 16px "Microsoft YaHei", "PingFang SC", sans-serif'
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

        const markHoverEntity = (entity: any, name: string, geometryType: string) => {
          if (!entity || !name) return
          entity.__dataHoverName = name
          entity.__dataHoverGeometry = geometryType
          if (entity.label) entity.label.show = false
        }

        const originalEntities = [...dataSource.entities.values]
        originalEntities.forEach((entity: any) => {
          const entityName = getEntityName(entity)

          if (entity.point) {
            entity.point.heightReference = groundHeightReference
            entity.point.disableDepthTestDistance = Number.POSITIVE_INFINITY
          }

          if (entity.billboard) {
            entity.billboard.image = pinImage
            entity.billboard.width = 24
            entity.billboard.height = 36
            entity.billboard.heightReference = groundHeightReference
            entity.billboard.verticalOrigin = Cesium.VerticalOrigin.BOTTOM
            entity.billboard.disableDepthTestDistance = Number.POSITIVE_INFINITY
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
   * 加载 Cesium 3D Tiles 图层
   * @param url 3D Tiles 根 json 地址或 Blob URL
   * @param name 图层显示名称
   * @param objectUrls 本地资源生成的 Blob URL 列表
   */
  public async add3DTiles(
    url: string,
    name = '3D Tiles',
    objectUrls: string[] = [],
  ): Promise<Cesium.Cesium3DTileset> {
    if (!url) throw new Error('未提供 3D Tiles tileset.json 地址')

    let tileset: Cesium.Cesium3DTileset | undefined
    try {
      if ((Cesium.Cesium3DTileset as any).fromUrl) {
        tileset = await (Cesium.Cesium3DTileset as any).fromUrl(url, {
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
        if ((tileset as any).readyPromise) await (tileset as any).readyPromise
      }

      if (tileset) {
        this.viewer.scene.primitives.add(tileset)
        await this.viewer.flyTo(tileset)
        const layerStore = useLayerStore()
        layerStore.addLayer(
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
      }
      throw new Error('创建 3D Tiles 实例失败')
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

  /**
   * 添加 WMS 影像图层
   * @param url 服务地址
   * @param layers 图层名称
   * @param bounds 空间范围
   */
  public async AddWMSLayer(
    url: string,
    layers: string,
    bounds?: { west: number; south: number; east: number; north: number },
  ): Promise<Cesium.ImageryLayer> {
    const rectangle = bounds
      ? Cesium.Rectangle.fromDegrees(
          bounds.west,
          bounds.south,
          bounds.east,
          bounds.north,
        )
      : undefined
    const wmsProvider = new Cesium.WebMapServiceImageryProvider({
      url: url,
      layers: layers,
      rectangle: rectangle,
      enablePickFeatures: true,
      defaultAlpha: 0,
      parameters: {
        service: 'WMS',
        version: '1.1.1',
        request: 'GetMap',
        format: 'image/png',
        styles: '',
        transparent: true,
      },
    })
    const imageLayer = new Cesium.ImageryLayer(wmsProvider, {
      alpha: 0.6,
    })
    const previewRequest = wmsProvider.requestImage(0, 0, 0)
    if (!previewRequest) {
      throw new Error('WMS 图层请求暂时无法调度')
    }
    await previewRequest
    this.viewer.imageryLayers.add(imageLayer)
    const layerStore = useLayerStore()
    layerStore.addLayer(
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
   * Cesium 实体导出 GeoJSON 格式
   * @param entity Cesium 实体
   * @returns GeoJSON 特征集合对象
   */
  public entity2Geojson(entity: any): any {
    const geoJson: any = {
      type: 'FeatureCollection',
      features: [],
    }

    if (entity.point && entity.position) {
      const point = {
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
      const polyline: any = {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: [],
        },
      }

      const Cartesian3Arr: Cesium.Cartesian3[] = entity.polyline.positions.getValue(
        Cesium.JulianDate.now(),
      )
      if (Array.isArray(Cartesian3Arr)) {
        Cartesian3Arr.forEach((p) => {
          const cartographic = this.scene.globe.ellipsoid.cartesianToCartographic(p)
          polyline.geometry.coordinates.push([
            Cesium.Math.toDegrees(cartographic.longitude),
            Cesium.Math.toDegrees(cartographic.latitude),
          ])
        })
      }
      geoJson.features.push(polyline)
    }

    if (entity.polygon?.hierarchy) {
      const polygon: any = {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Polygon',
          coordinates: [],
        },
      }
      const coords: number[][] = []
      const hierarchy = entity.polygon.hierarchy.getValue(Cesium.JulianDate.now())
      const Cartesian3Arr: Cesium.Cartesian3[] = hierarchy?.positions
      if (Array.isArray(Cartesian3Arr) && Cartesian3Arr.length > 0) {
        Cartesian3Arr.forEach((p) => {
          const cartographic = this.scene.globe.ellipsoid.cartesianToCartographic(p)
          coords.push([
            Cesium.Math.toDegrees(cartographic.longitude),
            Cesium.Math.toDegrees(cartographic.latitude),
          ])
        })
        const end = this.scene.globe.ellipsoid.cartesianToCartographic(Cartesian3Arr[0])
        coords.push([
          Cesium.Math.toDegrees(end.longitude),
          Cesium.Math.toDegrees(end.latitude),
        ])
        polygon.geometry.coordinates.push(coords)
        geoJson.features.push(polygon)
      }
    }

    if (entity.rectangle?.coordinates) {
      const rectangle: any = {
        type: 'Feature',
        properties: {
          'stroke-width': entity.rectangle?.outlineWidth,
          stroke: entity.rectangle?.outlineColor?.toCssColorString?.(),
          fill: entity.rectangle?.material?.toCssColorString?.(),
          'fill-opacity': entity.rectangle?.material?.alpha,
        },
        geometry: {
          type: 'Polygon',
          coordinates: [[]],
        },
      }

      const coords: number[][] = []
      const cesium_Rec = entity.rectangle.coordinates
      const west_north = Cesium.Cartesian3.fromRadians(cesium_Rec.west, cesium_Rec.north)
      const east_north = Cesium.Cartesian3.fromRadians(cesium_Rec.east, cesium_Rec.north)
      const east_south = Cesium.Cartesian3.fromRadians(cesium_Rec.east, cesium_Rec.south)
      const west_south = Cesium.Cartesian3.fromRadians(cesium_Rec.west, cesium_Rec.south)
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
   * 在地图上显示航线与航点
   * @param line Airline 航线对象
   */
  public showAirLine(line: Airline): Cesium.Entity | undefined {
    const existing = this.viewer.entities.getById('航线' + line.code + '-' + line.name)
    if (existing) {
      return existing
    }

    const degreesArr: Cesium.Cartesian3[] = []
    for (let i = 0; i < line.points.length; i++) {
      const coord = Cesium.Cartesian3.fromDegrees(
        line.points[i].lon,
        line.points[i].lat,
        line.points[i].alt,
      )
      degreesArr.push(coord)
    }
    if (line.isClose && line.points.length > 0) {
      degreesArr.push(
        Cesium.Cartesian3.fromDegrees(
          line.points[0].lon,
          line.points[0].lat,
          line.points[0].alt,
        ),
      )
    }

    const airlineEntity = new Cesium.Entity({
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
      const vertexEntity = new Cesium.Entity({
        id: line.code + '-航点' + index,
        position: pt,
        point: {
          color: Cesium.Color.FUCHSIA,
          pixelSize: 6,
          outlineColor: Cesium.Color.RED,
          outlineWidth: 2,
          disableDepthTestDistance: 99000000,
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
  public showDesignRoute3D(line: Airline): void {
    const idPrefix = 'designRoute3D-' + line.code
    if (this.viewer.entities.getById(idPrefix + '-wall')) {
      return
    }

    const positions: Cesium.Cartesian3[] = []
    const minimumHeights: number[] = []
    const maximumHeights: number[] = []
    const groundPositions: Cesium.Cartesian3[] = []

    for (let i = 0; i < line.points.length; i++) {
      const pt = line.points[i]
      positions.push(Cesium.Cartesian3.fromDegrees(pt.lon, pt.lat, pt.alt))
      groundPositions.push(Cesium.Cartesian3.fromDegrees(pt.lon, pt.lat, 0))
      minimumHeights.push(0)
      maximumHeights.push(pt.alt)
    }
    if (line.isClose && line.points.length > 0) {
      const first = line.points[0]
      positions.push(Cesium.Cartesian3.fromDegrees(first.lon, first.lat, first.alt))
      groundPositions.push(Cesium.Cartesian3.fromDegrees(first.lon, first.lat, 0))
      minimumHeights.push(0)
      maximumHeights.push(first.alt)
    }

    // 1. 墙体幕帘
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

    // 2. 航线本体
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
  public clearDesignRoute3D(routeCode: number | string): void {
    const idPrefix = 'designRoute3D-' + routeCode
    this.viewer.entities.removeById(idPrefix + '-wall')
    this.viewer.entities.removeById(idPrefix + '-line')
    this.viewer.entities.removeById(idPrefix + '-ground')

    const toRemove: Cesium.Entity[] = []
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

  /**
   * 添加无人机三维模型实体
   * @param modelPath 模型文件路径
   * @param StrUavTypeID 无人机类型与标识
   */
  public addAirplaneEntity(modelPath: string, StrUavTypeID: string): Cesium.Entity {
    this.viewer.scene.globe.depthTestAgainstTerrain = false
    const staticStore = useStaticStore()
    if (staticStore?.uav) {
      staticStore.uav.ModelIDinMap = 'ID: ' + StrUavTypeID
    }

    const existingEntity = this.viewer.entities.getById('ID: ' + StrUavTypeID)
    if (existingEntity) {
      this.viewer.trackedEntity = existingEntity
      return existingEntity
    }

    const entity = this.viewer.entities.add({
      name: StrUavTypeID,
      id: 'ID: ' + StrUavTypeID,
      position: new Cesium.CallbackProperty(() => {
        return Cesium.Cartesian3.fromDegrees(
          this.dynamicData.lon ?? 0,
          this.dynamicData.lat ?? 0,
          this.dynamicData.alt ?? 0,
        )
      }, false),
      orientation: new Cesium.CallbackProperty(() => {
        return Cesium.Transforms.headingPitchRollQuaternion(
          Cesium.Cartesian3.fromDegrees(
            this.dynamicData.lon ?? 0,
            this.dynamicData.lat ?? 0,
            this.dynamicData.alt ?? 0,
          ),
          new Cesium.HeadingPitchRoll(
            Cesium.Math.toRadians((this.dynamicData.heading ?? 0) - 0),
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
        color: Cesium.Color.fromAlpha(Cesium.Color.RED, 1.0),
        colorBlendMode: Cesium.ColorBlendMode.MIX,
        colorBlendAmount: 0.8,
      },
    })
    this.viewer.trackedEntity = entity
    return entity
  }

  /**
   * 取消相机视角锁定跟踪
   */
  public setNoTrack(): void {
    this.viewer.trackedEntity = undefined
    this.viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY)
  }

  /**
   * 停止面积测量交互
   */
  public stopAreaMeasure(): void {
    if (!this.measAreaStatus) return
    if (this.handler) {
      this.handler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK)
      this.handler.removeInputAction(Cesium.ScreenSpaceEventType.MOUSE_MOVE)
      this.handler.removeInputAction(Cesium.ScreenSpaceEventType.RIGHT_CLICK)
    }
    this.measAreaStatus = false
    const container = this.viewer.container as HTMLElement
    if (container) container.style.cursor = 'default'
    this.viewer.enableCursorStyle = true
  }

  /**
   * 清空面积测量实体
   */
  public clearAreaEntity(): void {
    this.stopAreaMeasure()

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

  /**
   * 激活面积测量
   */
  public activateAreaMeasure(): void {
    this.stopAreaMeasure()
    if (this.polygon && !this.areaEntities.includes(this.polygon)) {
      this.viewer.entities.remove(this.polygon)
    }
    this.activeShapePoints = []
    this.polygon = undefined

    this.viewer.scene.globe.depthTestAgainstTerrain = true
    this.handler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas)
    this.measAreaStatus = true
    const container = this.viewer.container as HTMLElement
    if (container) container.style.cursor = 'crosshair'
    this.viewer.enableCursorStyle = true

    const areaPoints: Cesium.Cartesian3[] = []
    const getRenderableAreaPoints = () => {
      const points: Cesium.Cartesian3[] = []
      const minimumSpacing = 0.05

      areaPoints.forEach((point) => {
        if (
          point &&
          (points.length === 0 ||
            Cesium.Cartesian3.distance(points[points.length - 1], point) > minimumSpacing)
        ) {
          points.push(point)
        }
      })

      if (
        points.length > 2 &&
        Cesium.Cartesian3.distance(points[0], points[points.length - 1]) <= minimumSpacing
      ) {
        points.pop()
      }

      return points
    }

    // 鼠标左键--确定选中点
    this.handler.setInputAction((event: any) => {
      const ray = this.viewer.camera.getPickRay(event.position)
      if (!ray) return
      const earthPosition = this.viewer.scene.globe.pick(ray, this.viewer.scene)
      if (!earthPosition) return

      if (areaPoints.length === 0) {
        areaPoints.push(earthPosition)
        const linePoints = new Cesium.CallbackProperty(() => {
          return areaPoints.concat([areaPoints[0]])
        }, false)
        const dynamicPositions = new Cesium.CallbackProperty(() => {
          const points = getRenderableAreaPoints()
          return points.length >= 3
            ? new Cesium.PolygonHierarchy(points)
            : undefined
        }, false)

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
        ;(this.polygon as any).GeoType = 'Polygon'
        this.viewer.entities.add(this.polygon)
      }
      this.viewer.scene.requestRender()
      areaPoints.push(earthPosition)
      this.activeShapePoints = areaPoints
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

    // 鼠标移动--实时绘制多边形
    this.handler.setInputAction((movement: any) => {
      const ray = this.viewer.camera.getPickRay(movement.endPosition)
      if (!ray) return
      const newPosition = this.viewer.scene.globe.pick(ray, this.viewer.scene)
      if (!newPosition) return

      if (Cesium.defined(this.polygon)) {
        areaPoints.pop()
        areaPoints.push(newPosition)
      }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE)

    // 鼠标右键--结束绘制
    this.handler.setInputAction(() => {
      if (!this.polygon) return

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
      if (this.polygon.polyline) {
        this.polygon.polyline.positions = new Cesium.ConstantProperty(closedPoints)
      }
      if (this.polygon.polygon) {
        this.polygon.polygon.hierarchy = new Cesium.ConstantProperty(
          new Cesium.PolygonHierarchy(finalPoints),
        )
        this.polygon.polygon.heightReference = new Cesium.ConstantProperty(
          Cesium.HeightReference.CLAMP_TO_GROUND,
        )
        this.polygon.polygon.classificationType = new Cesium.ConstantProperty(
          Cesium.ClassificationType.TERRAIN,
        )
      }
      ;(this.polygon as any).pottingPoint = finalPoints

      const polygonParts = this._splitSelfIntersectingArea(finalPoints)
      const resultEntities: Cesium.Entity[] = [this.polygon]

      if (polygonParts.length > 1) {
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

  private _showResultArea(polygonParts: Cesium.Cartesian3[][] = [(this.polygon as any)?.pottingPoint]): Cesium.Entity | undefined {
    const area = polygonParts.reduce(
      (sum, points) => sum + this._getPolygonAreaSquareMeters(points),
      0,
    )
    const text = '面积：' + this._formatPolygonArea(area)
    const centerPoint = this._getCenterOfGravityPoint((this.polygon as any)?.pottingPoint || polygonParts[0])
    return this._addLabel(centerPoint, text)
  }

  private _splitSelfIntersectingArea(points: Cesium.Cartesian3[]): Cesium.Cartesian3[][] {
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
          ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / denominator
        const u =
          ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / denominator
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

  public _Angle(p1: Cesium.Cartesian3, p2: Cesium.Cartesian3, p3: Cesium.Cartesian3): number {
    let angle = this._Bearing(p2, p1) - this._Bearing(p2, p3)
    if (angle < 0) {
      angle += 360
    }
    return angle
  }

  public _Bearing(from: Cesium.Cartesian3, to: Cesium.Cartesian3): number {
    const fromCarto = Cesium.Cartographic.fromCartesian(from)
    const toCarto = Cesium.Cartographic.fromCartesian(to)

    const lat1 = fromCarto.latitude
    const lon1 = fromCarto.longitude
    const lat2 = toCarto.latitude
    const lon2 = toCarto.longitude
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

  public distance(point1: Cesium.Cartesian3, point2: Cesium.Cartesian3): number {
    const point1cartographic = Cesium.Cartographic.fromCartesian(point1)
    const point2cartographic = Cesium.Cartographic.fromCartesian(point2)
    const geodesic = new Cesium.EllipsoidGeodesic()
    geodesic.setEndPoints(point1cartographic, point2cartographic)
    let s = geodesic.surfaceDistance
    s = Math.sqrt(
      Math.pow(s, 2) +
        Math.pow(point2cartographic.height - point1cartographic.height, 2),
    )
    return s
  }

  public getPolygonArea(points: Cesium.Cartesian3[]): string {
    if (points.length < 3) return '0.0000 平方米'
    return this._formatPolygonArea(this._getPolygonAreaSquareMeters(points))
  }

  public _getPolygonAreaSquareMeters(points: Cesium.Cartesian3[]): number {
    if (points.length < 3) return 0

    const p0 = points[0]
    const sumCross = new Cesium.Cartesian3()
    for (let i = 1; i < points.length - 1; i++) {
      const v1 = Cesium.Cartesian3.subtract(points[i], p0, new Cesium.Cartesian3())
      const v2 = Cesium.Cartesian3.subtract(points[i + 1], p0, new Cesium.Cartesian3())
      const cross = Cesium.Cartesian3.cross(v1, v2, new Cesium.Cartesian3())
      Cesium.Cartesian3.add(sumCross, cross, sumCross)
    }
    return Cesium.Cartesian3.magnitude(sumCross) / 2.0
  }

  public _formatPolygonArea(area: number): string {
    if (area < 1000000) {
      return Math.abs(area).toFixed(4) + ' 平方米'
    } else {
      return Math.abs(area / 1000000.0).toFixed(4) + ' 平方公里'
    }
  }

  public _getCenterOfGravityPoint(mPoints: Cesium.Cartesian3[]): Cesium.Cartesian3 {
    if (!mPoints || mPoints.length === 0) return Cesium.Cartesian3.ZERO
    let centerPoint = mPoints[0]
    for (let i = 1; i < mPoints.length; i++) {
      centerPoint = Cesium.Cartesian3.midpoint(
        centerPoint,
        mPoints[i],
        new Cesium.Cartesian3(),
      )
    }
    const carto = Cesium.Cartographic.fromCartesian(centerPoint)
    if (carto) {
      centerPoint = Cesium.Cartesian3.fromRadians(
        carto.longitude,
        carto.latitude,
        10.0,
      )
    }
    return centerPoint
  }

  public _addLabel(centerPoint: Cesium.Cartesian3, text: string): Cesium.Entity | undefined {
    if (!centerPoint) return undefined
    return this.viewer.entities.add(
      new Cesium.Entity({
        name: 'area label',
        position: centerPoint,
        label: {
          text: text,
          font: '2.5rem sans-serif',
          fillColor: Cesium.Color.WHITE,
          style: Cesium.LabelStyle.FILL,
          eyeOffset: new Cesium.Cartesian3(0, 0, -10),
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

  /**
   * 激活距离测量功能
   */
  public activate(): void {
    this.handler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas)
    this.viewer.scene.globe.depthTestAgainstTerrain = true

    this.isMeasure = true
    this.totalDistance = 0
    const container = this.viewer.container as HTMLElement
    if (container) container.style.cursor = 'crosshair'
    this.viewer.enableCursorStyle = true
    this.temPositions = []
    this.positions = []

    this.registerEvents()
  }

  /**
   * 禁用距离测量
   */
  public deactivate(): void {
    if (!this.isMeasure) return
    this.unRegisterEvents()
    const container = this.viewer.container as HTMLElement
    if (container) container.style.cursor = 'default'
    this.viewer.enableCursorStyle = true
    this.isMeasure = false
    if (this.lineEntity) {
      this.lineEntitys.push(this.lineEntity)
    }
  }

  /**
   * 清空距离测量实体
   */
  public clearDisEntity(): void {
    this.lineEntitys.forEach((item) => {
      this.viewer.entities.remove(item)
    })
    this.vertexEntities.forEach((item) => {
      this.viewer.entities.remove(item)
    })

    this.positions = []
    this.temPositions = []
    this.vertexEntities = []
    this.lineEntity = undefined
    this.lineEntitys = []
    this.totalDistance = 0
  }

  public createLineEntity(): void {
    this.lineEntity = this.viewer.entities.add({
      polyline: {
        positions: new Cesium.CallbackProperty(() => {
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

  public createVertex(): void {
    const lastPos = this.positions[this.positions.length - 1]
    const vertexEntity = new Cesium.Entity({
      id: 'MeasureDistanceVertex' + lastPos.toString(),
      position: lastPos,
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

  public createStartEntity(): void {
    const vertexEntity = this.viewer.entities.add({
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
    } as any)
    this.vertexEntities.push(vertexEntity)
  }

  public createEndEntity(): void {
    const vertexEntity = this.viewer.entities.add({
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
    } as any)
    this.vertexEntities.push(vertexEntity)
  }

  public registerEvents(): void {
    this.leftClickEvent()
    this.rightClickEvent()
    this.mouseMoveEvent()
  }

  public leftClickEvent(): void {
    this.handler?.setInputAction((e: any) => {
      let position = this.viewer.scene.pickPosition(e.position)
      if (!position) {
        const ellipsoid = this.viewer.scene.globe.ellipsoid
        position = this.viewer.scene.camera.pickEllipsoid(e.position, ellipsoid)
      }
      if (!position) return
      this.positions.push(position)
      if (this.positions.length === 1) {
        this.createLineEntity()
        this.createStartEntity()
        return
      }
      this.createVertex()
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)
  }

  public mouseMoveEvent(): void {
    this.handler?.setInputAction((e: any) => {
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

  public handleMoveEvent(position: Cesium.Cartesian3): void {
    if (this.positions.length < 1) return
    this.temPositions = this.positions.concat(position)
  }

  public rightClickEvent(): void {
    this.handler?.setInputAction(() => {
      if (!this.isMeasure || this.positions.length < 1) {
        this.deactivate()
        this.clearDisEntity()
      } else {
        this.createEndEntity()
        if (this.lineEntity) {
          this.lineEntity.polyline = new Cesium.PolylineGraphics({
            positions: this.positions,
            width: 2,
            material: Cesium.Color.YELLOW,
            depthFailMaterial: Cesium.Color.YELLOW,
          })
        }
        this.deactivate()
      }
    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK)
  }

  public unRegisterEvents(): void {
    if (this.handler) {
      this.handler.removeInputAction(Cesium.ScreenSpaceEventType.RIGHT_CLICK)
      this.handler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK)
      this.handler.removeInputAction(Cesium.ScreenSpaceEventType.MOUSE_MOVE)
    }
  }

  public spaceDistance(positions: Cesium.Cartesian3[]): string {
    const l = positions.length
    if (l < 2) return '0.000'
    const point1cartographic = Cesium.Cartographic.fromCartesian(positions[l - 1])
    const point2cartographic = Cesium.Cartographic.fromCartesian(positions[l - 2])
    const geodesic = new Cesium.EllipsoidGeodesic()
    geodesic.setEndPoints(point1cartographic, point2cartographic)
    this.totalDistance += geodesic.surfaceDistance / 1000
    return (geodesic.surfaceDistance / 1000).toFixed(3)
  }

  public clearDraw(): boolean {
    if (this.graphics.length < 1) return true

    this._stopDraw()

    this.graphics.forEach((graphic) => {
      this.viewer.entities.remove(graphic)
    })
    this.graphics = []
    this.viewer.scene.requestRender()
    return true
  }

  /**
   * 开启几何图形实时绘制
   * @param key 绘制类型 ('polygon' | 'rec' | 'circle')
   */
  public drawGraphics(key: 'polygon' | 'rec' | 'circle'): void {
    this.viewer.scene.globe.depthTestAgainstTerrain = true
    if (this.handler) {
      this.handler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK)
      this.handler.removeInputAction(Cesium.ScreenSpaceEventType.MOUSE_MOVE)
      this.handler.removeInputAction(Cesium.ScreenSpaceEventType.RIGHT_CLICK)
    }
    this.handler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas)
    const container = this.viewer.container as HTMLElement
    if (container) container.style.cursor = 'crosshair'
    this.viewer.enableCursorStyle = true

    if (key === 'polygon') {
      this._drawPolygon()
    } else if (key === 'rec') {
      this._drawRec()
    } else if (key === 'circle') {
      this._drawCircle()
    }
  }

  private _stopDraw(): void {
    this.viewer.scene.globe.depthTestAgainstTerrain = false
    if (this.handler) {
      this.handler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK)
      this.handler.removeInputAction(Cesium.ScreenSpaceEventType.MOUSE_MOVE)
      this.handler.removeInputAction(Cesium.ScreenSpaceEventType.RIGHT_CLICK)
    }
    const container = this.viewer.container as HTMLElement
    if (container) container.style.cursor = 'default'
    this.viewer.enableCursorStyle = true
  }

  private _drawPolygon(): void {
    let aPolygon: Cesium.Entity | undefined
    const drawPolygonPts: Cesium.Cartesian3[] = []

    const pickPoint = (position: Cesium.Cartesian2) => {
      const ray = this.viewer.camera.getPickRay(position)
      if (!ray) return undefined
      let cartesian = this.viewer.scene.globe.pick(ray, this.viewer.scene)
      if (!cartesian) {
        cartesian = this.viewer.camera.pickEllipsoid(
          position,
          this.viewer.scene.globe.ellipsoid,
        )
      }
      return cartesian
    }

    this.handler?.setInputAction((event: any) => {
      const earthPosition = pickPoint(event.position)
      if (!earthPosition) return

      if (drawPolygonPts.length === 0) {
        drawPolygonPts.push(earthPosition)
        aPolygon = this.viewer.entities.add({
          name: 'draw polygon',
        })
      }

      this.viewer.scene.requestRender()
      drawPolygonPts.push(earthPosition)

      if (aPolygon && !aPolygon.polyline && drawPolygonPts.length >= 2) {
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

    this.handler?.setInputAction((movement: any) => {
      const newPosition = pickPoint(movement.endPosition)
      if (!newPosition) return

      if (Cesium.defined(aPolygon)) {
        drawPolygonPts.pop()
        drawPolygonPts.push(newPosition)

        if (drawPolygonPts.length >= 3 && aPolygon && !aPolygon.polygon) {
          const p0 = drawPolygonPts[0]
          const p1 = drawPolygonPts[1]
          const p2 = drawPolygonPts[2]
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

    this.handler?.setInputAction(() => {
      if (!aPolygon) return
      drawPolygonPts.pop()

      if (drawPolygonPts.length < 3) {
        this.viewer.entities.remove(aPolygon)
        this._stopDraw()
        return
      }

      drawPolygonPts.push(drawPolygonPts[0])
      if (aPolygon.polyline) {
        aPolygon.polyline.positions = new Cesium.ConstantProperty(drawPolygonPts)
      }
      if (aPolygon.polygon) {
        aPolygon.polygon.hierarchy = new Cesium.ConstantProperty(
          new Cesium.PolygonHierarchy(drawPolygonPts),
        )
        aPolygon.polygon.heightReference = new Cesium.ConstantProperty(
          Cesium.HeightReference.CLAMP_TO_GROUND,
        )
      }
      this.graphics.push(aPolygon)
      this._stopDraw()
    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK)
  }

  private _drawRec(): void {
    let aPolygon: Cesium.Entity | undefined
    let westSouthEastNorth: number[] = []
    let lat1: number | undefined
    let lng1: number | undefined
    let lat: number | undefined
    let lng: number | undefined

    const pickPoint = (position: Cesium.Cartesian2) => {
      const ray = this.viewer.camera.getPickRay(position)
      if (!ray) return undefined
      let cartesian = this.viewer.scene.globe.pick(ray, this.viewer.scene)
      if (!cartesian) {
        cartesian = this.viewer.camera.pickEllipsoid(
          position,
          this.viewer.scene.globe.ellipsoid,
        )
      }
      return cartesian
    }

    this.handler?.setInputAction((event: any) => {
      if (aPolygon) return

      const cartesian = pickPoint(event.position)
      if (!cartesian) return

      const cartographic = Cesium.Cartographic.fromCartesian(
        cartesian,
        this.viewer.scene.globe.ellipsoid,
        new Cesium.Cartographic(),
      )
      lng1 = Cesium.Math.toDegrees(cartographic.longitude)
      lat1 = Cesium.Math.toDegrees(cartographic.latitude)
      westSouthEastNorth = []

      aPolygon = this.viewer.entities.add({
        name: 'rectangle',
      })
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

    this.handler?.setInputAction((move: any) => {
      if (lng1 !== undefined && lat1 !== undefined) {
        const cartesian = pickPoint(move.endPosition)
        if (!cartesian) return

        const cartographic = Cesium.Cartographic.fromCartesian(
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

        if (aPolygon && !aPolygon.polygon) {
          aPolygon.polygon = new Cesium.PolygonGraphics({
            hierarchy: new Cesium.CallbackProperty(() => {
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
            positions: new Cesium.CallbackProperty(() => {
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

    this.handler?.setInputAction(() => {
      if (aPolygon && aPolygon.polygon) {
        aPolygon.polygon.hierarchy = new Cesium.ConstantProperty(
          new Cesium.PolygonHierarchy(
            Cesium.Cartesian3.fromDegreesArray(
              westSouthEastNorth,
              Cesium.Ellipsoid.WGS84,
            ),
          ),
        )
        aPolygon.polygon.heightReference = new Cesium.ConstantProperty(
          Cesium.HeightReference.CLAMP_TO_GROUND,
        )
        if (aPolygon.polyline) {
          aPolygon.polyline.positions = new Cesium.ConstantProperty(
            Cesium.Cartesian3.fromDegreesArray(
              westSouthEastNorth,
              Cesium.Ellipsoid.WGS84,
              undefined,
            ),
          )
          aPolygon.polyline.clampToGround = new Cesium.ConstantProperty(true)
        }

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

  private _drawCircle(): void {
    let centerPoint: Cesium.Cartesian3 | null = null
    let radius = 0.01
    let aPolygon: Cesium.Entity | undefined
    let borderEntity: Cesium.Entity | undefined

    const pickPoint = (position: Cesium.Cartesian2) => {
      const ray = this.viewer.camera.getPickRay(position)
      if (!ray) return undefined
      let cartesian = this.viewer.scene.globe.pick(ray, this.viewer.scene)
      if (!cartesian) {
        cartesian = this.viewer.camera.pickEllipsoid(
          position,
          this.viewer.scene.globe.ellipsoid,
        )
      }
      return cartesian
    }

    this.handler?.setInputAction((event: any) => {
      if (centerPoint === null) {
        centerPoint = pickPoint(event.position) || null
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

    this.handler?.setInputAction((move: any) => {
      if (centerPoint) {
        const cartesian2 = pickPoint(move.endPosition)
        if (!cartesian2) return
        radius = Cesium.Cartesian3.distance(centerPoint, cartesian2)

        if (!aPolygon && radius > 0) {
          aPolygon = this.viewer.entities.add({
            position: centerPoint,
            name: 'draw circle',
            ellipse: {
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              material: this.graphicStyle.material,
              outline: false,
              fill: true,
              semiMajorAxis: new Cesium.CallbackProperty(() => radius, false),
              semiMinorAxis: new Cesium.CallbackProperty(() => radius, false),
            },
          })
          const circlePositions = new Cesium.CallbackProperty(() => {
            if (!centerPoint || radius <= 0) return []
            const perimeter = (Cesium as any).EllipseGeometryLibrary.computeEllipsePositions(
              {
                center: centerPoint,
                semiMajorAxis: radius,
                semiMinorAxis: radius,
                rotation: 0,
                granularity: Cesium.Math.RADIANS_PER_DEGREE,
              },
              false,
              true,
            ).outerPositions
            const positions = Cesium.Cartesian3.unpackArray(perimeter)
            if (positions.length > 0) {
              positions.push(Cesium.Cartesian3.clone(positions[0]))
            }
            return positions
          }, false)

          borderEntity = this.viewer.entities.add({
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

    this.handler?.setInputAction(() => {
      if (centerPoint !== null && radius > 0) {
        if (aPolygon && aPolygon.ellipse) {
          aPolygon.ellipse.semiMajorAxis = new Cesium.ConstantProperty(radius)
          aPolygon.ellipse.semiMinorAxis = new Cesium.ConstantProperty(radius)
          aPolygon.ellipse.heightReference = new Cesium.ConstantProperty(
            Cesium.HeightReference.CLAMP_TO_GROUND,
          )
        }
        this.viewer.scene.requestRender()
        if (aPolygon) this.graphics.push(aPolygon)
        if (borderEntity) this.graphics.push(borderEntity)
        this._stopDraw()
      } else {
        if (aPolygon) this.viewer.entities.remove(aPolygon)
        if (borderEntity) this.viewer.entities.remove(borderEntity)
        this._stopDraw()
      }
    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK)
  }

  private _createPointEntity(position: Cesium.Cartesian3, label = ''): Cesium.Entity {
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

  /**
   * 根据基准点和方位距离添加机场障碍物三维实体
   * @param DatumPt 基准点坐标
   * @param markers 障碍物方位距离列表
   * @returns 基准点 Cartesian3 坐标
   */
  public addEntitiesByDirectionAndLen(DatumPt: { lon: number | string; lat: number | string }, markers: AirportMarker[]): Cesium.Cartesian3 {
    const datumCar = Cesium.Cartesian3.fromDegrees(
      Number(DatumPt.lon),
      Number(DatumPt.lat),
    )
    markers.forEach((marker) => {
      const pt = ByDirectionAndLen(
        datumCar,
        Number(marker.direction),
        Number(marker.distance),
      )

      const entity = new Cesium.Entity({
        position: pt,
        box: {
          dimensions: new Cesium.Cartesian3(20, 30, Number(marker.alt)),
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

  /**
   * 彻底销毁 MeasureViewer 实例，注销所有事件监听与实体，释放内存
   */
  public destroy(): void {
    // 1. 销毁悬浮提示处理器与实体
    if (this.dataHoverHandler && !this.dataHoverHandler.isDestroyed()) {
      this.dataHoverHandler.destroy()
    }
    this.dataHoverHandler = undefined

    if (this.dataHoverLabelEntity && !this.viewer.isDestroyed()) {
      this.viewer.entities.remove(this.dataHoverLabelEntity)
    }
    this.dataHoverLabelEntity = undefined

    // 2. 销毁交互绘制事件处理器
    if (this.handler && !this.handler.isDestroyed()) {
      this.handler.destroy()
    }
    this.handler = undefined

    // 3. 清理各类测量与绘制实体
    this.clearDisEntity()
    this.clearAreaEntity()
    this.clearDraw()
    this.clearProfileEntities()

    // 4. 清理障碍物实体
    this.barirsCollection.forEach((entity) => {
      if (!this.viewer.isDestroyed()) {
        this.viewer.entities.remove(entity)
      }
    })
    this.barirsCollection = []

    // 5. 恢复鼠标与地形状态
    const container = this.viewer?.container as HTMLElement
    if (container) {
      container.style.cursor = 'default'
    }
    if (this.viewer && !this.viewer.isDestroyed()) {
      this.viewer.enableCursorStyle = true
      this.viewer.scene.requestRender()
    }
  }
}

export default MeasureViewer
