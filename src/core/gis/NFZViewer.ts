import * as Cesium from 'cesium'
import { noFlyZoneService, type NFZRecord } from '@/utils/map/noFlyZoneService'
import { invoke } from '@tauri-apps/api/core'

/**
 * 禁飞区 (NFZ) 3D 地图可视化管理类
 * 负责在 Cesium 球体上展示、渲染与管理禁飞区多边形及地形贴地实体
 */
export class NFZViewer {
  public viewer: Cesium.Viewer | null = null
  public nfzData: any = null
  public dataSource: Cesium.CustomDataSource | null = null
  public isVisible = false
  public entityIdsByAreaId: Map<string, string[]> = new Map()
  public terrainDepthTestBeforeShow = true
  public terrainOcclusionGuardActive = false

  constructor(viewer?: Cesium.Viewer) {
    if (viewer) {
      this.init(viewer)
    }
    this.enforceNoTerrainOcclusion = this.enforceNoTerrainOcclusion.bind(this)
  }

  /**
   * 初始化或重新绑定 Cesium.Viewer 实例
   * @param viewer Cesium 视图实例
   */
  public init(viewer: Cesium.Viewer): void {
    if (this.viewer && this.viewer !== viewer) {
      this.destroy()
    }
    this.viewer = viewer
  }

  /**
   * 判断禁飞区数据是否已加载完成
   * @returns 是否已加载
   */
  public isLoaded(): boolean {
    return noFlyZoneService.isLoaded()
  }

  /**
   * 根据指定源通过 Tauri IPC 加载禁飞区数据
   * @param source 数据源类型 ('local' | 'sync')
   * @returns 禁飞区数据数组
   */
  public async loadNFZData(source: 'local' | 'sync' = 'sync'): Promise<any[]> {
    const command =
      source === 'local' ? 'load_cached_nfz' : 'fetch_and_cache_nfz'
    const data = (await invoke(command)) as any[]
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error('获取禁飞区失败：没有有效数据')
    }

    const records = noFlyZoneService.replaceAreas(data)
    if (records.length === 0) {
      throw new Error('获取禁飞区失败：没有有效区域')
    }
    this.nfzData = data
    if (this.dataSource) {
      this.renderNFZ()
    }
    return data
  }

  /**
   * 确保 CustomDataSource 数据源已创建并添加到 Viewer
   * @returns CustomDataSource 实例
   */
  public async ensureDataSource(): Promise<Cesium.CustomDataSource | null> {
    if (this.dataSource) return this.dataSource
    if (!this.viewer) return null

    this.dataSource = new Cesium.CustomDataSource('no-fly-zones')
    this.dataSource.show = this.isVisible
    await this.viewer.dataSources.add(this.dataSource)
    return this.dataSource
  }

  /**
   * 切换禁飞区显示/隐藏状态
   * @param show 是否显示
   * @param source 数据源标识
   * @returns 执行结果
   */
  public async toggleNFZ(
    show: boolean,
    source?: 'local' | 'sync',
  ): Promise<boolean> {
    if (!this.viewer) return false

    if (show) {
      // 未加载过禁飞区则加载
      if (source || !this.isLoaded()) {
        await this.loadNFZData(source)
      }
      const needsRender = !this.dataSource
      await this.ensureDataSource()
      if (needsRender || (this.dataSource && this.dataSource.entities.values.length === 0)) {
        this.renderNFZ()
      }
    }

    if (this.dataSource) {
      this.dataSource.show = show
    }
    this.isVisible = show
    if (show) {
      this.disableTerrainOcclusion()
    } else {
      this.restoreTerrainOcclusion()
    }
    this.viewer.scene.requestRender()
    return true
  }

  /**
   * 禁用地形遮挡以确保禁飞区贴地清晰显示
   */
  public disableTerrainOcclusion(): void {
    if (!this.viewer) return
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

  /**
   * 帧渲染时强制禁用地形遮挡
   */
  public enforceNoTerrainOcclusion(): void {
    if (!this.isVisible || !this.viewer) return
    this.viewer.scene.globe.depthTestAgainstTerrain = false
  }

  /**
   * 恢复地形深度检测配置
   */
  public restoreTerrainOcclusion(): void {
    if (!this.terrainOcclusionGuardActive || !this.viewer) return

    this.viewer.scene.preRender.removeEventListener(
      this.enforceNoTerrainOcclusion,
    )
    this.viewer.scene.globe.depthTestAgainstTerrain =
      this.terrainDepthTestBeforeShow
    this.terrainOcclusionGuardActive = false
  }

  /**
   * 重新渲染所有禁飞区实体
   */
  public renderNFZ(): void {
    if (!this.dataSource) return

    this.dataSource.entities.removeAll()
    this.entityIdsByAreaId.clear()
    const records = noFlyZoneService.getRecords()
    records.forEach((record: NFZRecord) => {
      this.addRecordEntity(record)
    })
  }

  /**
   * 添加单个禁飞区记录对应的 Entity
   * @param record 禁飞区记录
   * @returns 创建的 Cesium.Entity
   */
  public addRecordEntity(record: any): Cesium.Entity | undefined {
    if (!this.dataSource) return undefined

    const ring = record.feature.geometry.coordinates[0]
    const degrees = ring.flatMap((coordinate: [number, number]) => [coordinate[0], coordinate[1]])
    const fillColor = Cesium.Color.fromCssColorString(record.color).withAlpha(0.36)
    const outlineColor = Cesium.Color.fromCssColorString(record.color).withAlpha(0.95)
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

  /**
   * 动态添加新的禁飞区区域
   * @param area 区域数据对象
   * @returns 添加的记录条数
   */
  public async addNFZArea(area: any): Promise<number> {
    await this.ensureDataSource()
    const areaId = String(area.area_id ?? area.id ?? '')
    const existingEntityIds = this.entityIdsByAreaId.get(areaId) ?? []
    if (this.dataSource) {
      existingEntityIds.forEach((entityId) => {
        this.dataSource?.entities.removeById(entityId)
      })
    }
    this.entityIdsByAreaId.delete(areaId)

    const records = noFlyZoneService.addArea(area)
    records.forEach((record: any) => this.addRecordEntity(record))
    if (this.viewer) {
      this.viewer.scene.requestRender()
    }
    return records.length
  }

  /**
   * 移除指定 ID 的禁飞区
   * @param areaId 禁飞区唯一 ID
   * @returns 移除的实体个数
   */
  public removeNFZArea(areaId: string | number): number {
    const normalizedAreaId = String(areaId)
    const entityIds = this.entityIdsByAreaId.get(normalizedAreaId) ?? []
    if (this.dataSource) {
      entityIds.forEach((entityId) => {
        this.dataSource?.entities.removeById(entityId)
      })
    }
    this.entityIdsByAreaId.delete(normalizedAreaId)
    noFlyZoneService.removeArea(normalizedAreaId)
    if (this.viewer) {
      this.viewer.scene.requestRender()
    }
    return entityIds.length
  }

  /**
   * 清空所有禁飞区实体及数据
   */
  public clear(): void {
    if (this.dataSource) {
      this.dataSource.entities.removeAll()
    }
    this.entityIdsByAreaId.clear()
    this.nfzData = null
    if (this.viewer) {
      this.viewer.scene.requestRender()
    }
  }

  /**
   * 完整销毁禁飞区 Viewer 实例并释放资源
   */
  public destroy(): void {
    this.isVisible = false
    this.restoreTerrainOcclusion()

    if (this.dataSource && this.viewer && !this.viewer.isDestroyed()) {
      this.viewer.dataSources.remove(this.dataSource, true)
    }
    this.dataSource = null
    this.entityIdsByAreaId.clear()
    this.nfzData = null
    this.viewer = null
  }
}

export default NFZViewer
