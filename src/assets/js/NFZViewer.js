import * as Cesium from 'cesium'
import { noFlyZoneService } from '@/utils/map/noFlyZoneService'
//负责在 Cesium 地图上管理禁飞区
export default class NFZViewer {
  constructor(viewer) {
    this.viewer = viewer
    this.nfzData = null
    this.dataSource = null
    this.isVisible = false
    this.entityIdsByAreaId = new Map()
    this.terrainDepthTestBeforeShow = true
    this.terrainOcclusionGuardActive = false
    this.enforceNoTerrainOcclusion = this.enforceNoTerrainOcclusion.bind(this)
  }
  //判断禁飞区数据是否已加载 返回boolean
  isLoaded() {
    return noFlyZoneService.isLoaded()
  }
  //根据json加载禁飞区的数据
  async loadNFZData() {
    if (this.nfzData) return this.nfzData
    //
    const response = await fetch('/dji_flysafe_cn_only.json')
    if (!response.ok) {
      throw new Error(`禁飞区数据加载失败（HTTP ${response.status}）`)
    }

    const data = await response.json()
    if (!Array.isArray(data)) throw new Error('禁飞区数据格式无效')

    this.nfzData = data
    //全量替换禁飞区数据 函数
    
    noFlyZoneService.replaceAreas(data)
    return data
  }

  async ensureDataSource() {
    if (this.dataSource) return this.dataSource

    this.dataSource = new Cesium.CustomDataSource('no-fly-zones')
    this.dataSource.show = this.isVisible
    await this.viewer.dataSources.add(this.dataSource)
    return this.dataSource
  }
//加载禁飞区
  async toggleNFZ(show) {
    if (show) {
      //未加载过禁飞区则加载
      if (!this.isLoaded()) await this.loadNFZData()
      const needsRender = !this.dataSource
      await this.ensureDataSource()
      if (needsRender || this.dataSource.entities.values.length === 0) {
        this.renderNFZ()
      }
    }

    if (this.dataSource) this.dataSource.show = show
    this.isVisible = show
    if (show) {
      this.disableTerrainOcclusion()
    } else {
      this.restoreTerrainOcclusion()
    }
    this.viewer.scene.requestRender()
    return true
  }

  disableTerrainOcclusion() {
    const { globe } = this.viewer.scene

    if (!this.terrainOcclusionGuardActive) {
      this.terrainDepthTestBeforeShow = globe.depthTestAgainstTerrain
      this.viewer.scene.preRender.addEventListener(
        this.enforceNoTerrainOcclusion,
      )
      this.terrainOcclusionGuardActive = true
    }

    globe.depthTestAgainstTerrain = false
  }

  enforceNoTerrainOcclusion() {
    if (!this.isVisible) return
    this.viewer.scene.globe.depthTestAgainstTerrain = false
  }

  restoreTerrainOcclusion() {
    if (!this.terrainOcclusionGuardActive) return

    this.viewer.scene.preRender.removeEventListener(
      this.enforceNoTerrainOcclusion,
    )
    this.viewer.scene.globe.depthTestAgainstTerrain =
      this.terrainDepthTestBeforeShow
    this.terrainOcclusionGuardActive = false
  }

  renderNFZ() {
    if (!this.dataSource) return

    this.dataSource.entities.removeAll()
    this.entityIdsByAreaId.clear()
    noFlyZoneService.getRecords().forEach((record) => {
      this.addRecordEntity(record)
    })
  }

  addRecordEntity(record) {
    if (!this.dataSource) return undefined

    const ring = record.feature.geometry.coordinates[0]
    const degrees = ring.flatMap((coordinate) => [coordinate[0], coordinate[1]])
    const fillColor = Cesium.Color.fromCssColorString(record.color).withAlpha(
      0.36,
    )
    const outlineColor = Cesium.Color.fromCssColorString(
      record.color,
    ).withAlpha(0.95)
    const entityId = `nfz-${record.zoneId}`
    const entity = this.dataSource.entities.add({
      id: entityId,
      name: record.name,
      properties: {
        areaId: record.areaId,
        level: record.level,
      },
      polygon: {
        hierarchy: Cesium.Cartesian3.fromDegreesArray(degrees),
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        perPositionHeight: false,
        material: fillColor,
        outline: true,
        outlineColor,
        classificationType: Cesium.ClassificationType.TERRAIN,
        zIndex: 1000,
      },
    })

    const areaEntityIds = this.entityIdsByAreaId.get(record.areaId) ?? []
    areaEntityIds.push(entityId)
    this.entityIdsByAreaId.set(record.areaId, areaEntityIds)
    return entity
  }

  async addNFZArea(area) {
    await this.ensureDataSource()
    const areaId = String(area.area_id ?? area.id ?? '')
    const existingEntityIds = this.entityIdsByAreaId.get(areaId) ?? []
    existingEntityIds.forEach((entityId) => {
      this.dataSource.entities.removeById(entityId)
    })
    this.entityIdsByAreaId.delete(areaId)

    const records = noFlyZoneService.addArea(area)
    records.forEach((record) => this.addRecordEntity(record))
    this.viewer.scene.requestRender()
    return records.length
  }

  removeNFZArea(areaId) {
    const normalizedAreaId = String(areaId)
    const entityIds = this.entityIdsByAreaId.get(normalizedAreaId) ?? []
    entityIds.forEach((entityId) => {
      this.dataSource?.entities.removeById(entityId)
    })
    this.entityIdsByAreaId.delete(normalizedAreaId)
    noFlyZoneService.removeArea(normalizedAreaId)
    this.viewer.scene.requestRender()
    return entityIds.length
  }

  destroy() {
    this.isVisible = false
    this.restoreTerrainOcclusion()

    if (this.dataSource) {
      this.viewer.dataSources.remove(this.dataSource, true)
    }
    this.dataSource = null
    this.entityIdsByAreaId.clear()
  }
}
