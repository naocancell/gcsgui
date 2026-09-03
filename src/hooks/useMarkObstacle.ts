import * as Cesium from 'cesium'
import { invoke } from '@tauri-apps/api/core'
import { resolveObstacleModelUri } from '@/utils/model/modelCache'

const obstacleSize: Record<string, number> = {
    lowPowerPole:0.8,
    highPowerPole:1.5,
    highPowerTower:0.03,
    signalTower:35,
    radarStation:30,
    waterTower:5,
    house:0.003,
}

// Labels are rendered by one shared hover entity instead of one label per obstacle.
const ENABLE_PER_ENTITY_LABEL = false

/**
 * 根据基准点、磁方位、距离、磁偏角，计算目标点经纬度
 *
 * @param baseLon 基准点经度
 * @param baseLat 基准点纬度
 * @param magneticAzimuth 相对于基准点的磁方位角，单位：度
 * @param distance 距离，单位：米
 * @param magVar 磁偏角，单位：度，东偏为正，西偏为负
 */
function getLonLatByMagneticBearingDistance(
    baseLon: number,
    baseLat: number,
    magneticAzimuth: number,
    distance: number,
    magVar: number
) {

    // 1. 磁方位转真方位
    //  VAR 0.32° W，则 magVar = -0.32
    const trueAzimuth =
        magneticAzimuth + magVar

    // 2. 转弧度
    const trueAzimuthRad =
        Cesium.Math.toRadians(trueAzimuth)

    // 3. 方位角 + 距离 转 ENU 坐标
    // ENU:
    // x = East
    // y = North
    // z = Up
    const east =
        distance * Math.sin(trueAzimuthRad)

    const north =
        distance * Math.cos(trueAzimuthRad)

    const up = 0

    const localENU =
        new Cesium.Cartesian3(
            east,
            north,
            up
        )

    // 4. 基准点世界坐标
    const origin =
        Cesium.Cartesian3.fromDegrees(
            baseLon,
            baseLat,
            0
        )

    // 5. 建立基准点 ENU 坐标系
    const enuMatrix =
        Cesium.Transforms.eastNorthUpToFixedFrame(
            origin
        )

    // 6. ENU 转 Cesium 世界坐标
    const worldPosition =
        Cesium.Matrix4.multiplyByPoint(
            enuMatrix,
            localENU,
            new Cesium.Cartesian3()
        )

    // 7. 世界坐标转经纬度
    const cartographic =
        Cesium.Cartographic.fromCartesian(
            worldPosition
        )


    return {
        longitude:
            Cesium.Math.toDegrees(
                cartographic.longitude
            ),

        latitude:
            Cesium.Math.toDegrees(
                cartographic.latitude
            )
    }
}

function createMarkObstacleManager() {
    // 保存所有障碍物实体
    const obstacleEntities: Cesium.Entity[] = []

    // 当前障碍物图层是否显示
    let obstacleVisible = false
    let obstaclesLoaded = false

    let hoverObstacleEntity: Cesium.Entity | undefined = undefined //记录的悬浮的障碍物
    let hoverHandler: Cesium.ScreenSpaceEventHandler | undefined = undefined //处理事件
    let hoverLabelEntity: Cesium.Entity | undefined = undefined

    function ensureHoverLabel(): Cesium.Entity {
        if (hoverLabelEntity && !window.viewer.entities.contains(hoverLabelEntity)) {
            hoverLabelEntity = undefined
        }
        if (hoverLabelEntity) return hoverLabelEntity

        hoverLabelEntity = window.viewer.entities.add({
            show: false,
            position: Cesium.Cartesian3.ZERO,
            label: {
                show: false,
                text: '',
                font: 'bold 13px sans-serif',
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                fillColor: Cesium.Color.WHITE,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 1,
                showBackground: true,
                backgroundColor: Cesium.Color.BLACK.withAlpha(0.6),
                backgroundPadding: new Cesium.Cartesian2(8, 4),
                horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                pixelOffset: new Cesium.Cartesian2(0, -45),
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
                scaleByDistance: new Cesium.NearFarScalar(1000, 1.0, 20000, 0.8),
                distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 20000),
            },
        })
        return hoverLabelEntity
    }

    function hideHoverLabel(): void {
        if (!hoverLabelEntity) return
        hoverLabelEntity.show = false
        if (hoverLabelEntity.label) {
            ;(hoverLabelEntity.label as any).show = false
        }
    }

    function enableObstacleHover(): void {
        if (hoverHandler && !hoverHandler.isDestroyed()) {
            return
        }

        hoverHandler = new Cesium.ScreenSpaceEventHandler(
            window.viewer.scene.canvas
        )

        hoverHandler.setInputAction(
            (movement) => {
                const picked =
                    window.viewer.scene.pick(
                        movement.endPosition
                    )

                const entity =
                    picked ? picked.id : undefined
                //悬浮的是障碍物
                if (
                    entity &&
                    entity._entityType === 'obstacle' &&
                    obstacleVisible
                ) { //hoverObstacleEntity是上一个悬浮的障碍物
                    if (hoverObstacleEntity !== entity) {
                        hoverObstacleEntity = entity
                        const obstacle = (entity as any)._obstacleData
                        const labelEntity = ensureHoverLabel()
                        labelEntity.position = entity.position
                        labelEntity.show = true
                        if (labelEntity.label) {
                            ;(labelEntity.label as any).text = `${obstacle?.airportName ? `${obstacle.airportName} · ` : ''}${obstacle?.name ?? '障碍物'}\n海拔高度:${obstacle?.height || '-'}m`
                            ;(labelEntity.label as any).show = true
                        }
                    }

                    ;(window.viewer as any)._element.style.cursor = 'pointer'
                } else { //不是障碍物
                    hideHoverLabel()
                    hoverObstacleEntity = undefined
                    ;(window.viewer as any)._element.style.cursor = 'default'
                }

                window.viewer.scene.requestRender()
            },
            Cesium.ScreenSpaceEventType.MOUSE_MOVE
        )
    }

    // 添加单个障碍物
    function addObstacle(obstacle, longitude, latitude, modelUri: string | null = null) {
        
        const obstacleEntity = window.viewer.entities.add({
            position:
                Cesium.Cartesian3.fromDegrees(
                    longitude,
                    latitude
                ),
            // 新添加的障碍物要跟随当前显示状态
            show: obstacleVisible,
            //modelUri是否存在
            ...(modelUri
                ? {
                    model: {
                        uri: modelUri,
                        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                        scale: obstacleSize[obstacle.type] ?? 1,
                        distanceDisplayCondition:
                            new Cesium.DistanceDisplayCondition(0, 30000),
                        silhouetteColor: Cesium.Color.CYAN.withAlpha(1.0),
                        silhouetteSize: 3
                    }
                }
                : {
                    box: {
                        dimensions: Cesium.Cartesian3.fromArray(
                             [10, 10, 40],
                        ),
                        material: Cesium.Color.RED.withAlpha(0.85),
                        outline: true,
                        outlineColor: Cesium.Color.WHITE,
                        outlineWidth: 1,
                        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                        distanceDisplayCondition:
                            new Cesium.DistanceDisplayCondition(0, 30000),
                    }
                }),
            // billboard:{
            //     image:
            //         modelUri,
            //     width:
            //         50,
            //     height:
            //         50,
            //     verticalOrigin:
            //         Cesium.VerticalOrigin.BOTTOM,

            //     heightReference:
            //         Cesium.HeightReference.CLAMP_TO_GROUND,

            //     // 不要缩太小
            //     scaleByDistance:
            //         new Cesium.NearFarScalar(

            //             1000,
            //             1.5,
            //             20000,
            //             0.1
            //         ),
            //     distanceDisplayCondition:
            //         new Cesium.DistanceDisplayCondition(
            //             0,
            //             20000
            //         ),
            //     // 防止被地形遮挡
            //     disableDepthTestDistance:
            //         Number.POSITIVE_INFINITY

            // },

            ...(ENABLE_PER_ENTITY_LABEL ? { label: {
                show: false,
                text:
                    `${obstacle.airportName ? `${obstacle.airportName} · ` : ''}${obstacle.name}\n海拔高度:${obstacle.height || '-'}m`,
                font:
                    "bold 13px sans-serif",
                style:
                    Cesium.LabelStyle.FILL_AND_OUTLINE,

                fillColor:
                    new Cesium.Color(
                                    1.0,
                                    1.0,
                                    1.0,
                                    1.0
                                ),
                outlineColor:
                    Cesium.Color.BLACK,

                outlineWidth:
                    1,

                showBackground:true,
                backgroundColor:
                    Cesium.Color.BLACK.withAlpha(0.6),
                backgroundPadding:
                    new Cesium.Cartesian2(
                        8,
                        4
                    ),
                horizontalOrigin:
                    Cesium.HorizontalOrigin.CENTER,


                verticalOrigin:
                    Cesium.VerticalOrigin.BOTTOM,
                /*
                 * 
                 * 根据图标高度设置
                 * 不使用障碍物高度
                 */
                pixelOffset:
                    new Cesium.Cartesian2(
                        0,
                        -45
                    ),

                /*
                 * 和图标保持同一空间基准
                 */
                heightReference:
                    Cesium.HeightReference.CLAMP_TO_GROUND,
                disableDepthTestDistance:
                    Number.POSITIVE_INFINITY,
                /*
                 * 文字不要缩得太厉害
                 */
                scaleByDistance:
                    new Cesium.NearFarScalar(
                        1000,
                        1.0,
                        20000,
                        0.8
                    ),
                distanceDisplayCondition:
                    new Cesium.DistanceDisplayCondition(
                        0,
                        20000
                    )
            } } : {})
        })
        //自己设置一个type属性，方便后面判断
        ;(obstacleEntity as any)._entityType = 'obstacle'
        ;(obstacleEntity as any)._obstacleData = obstacle

         // 保存实体，后面统一控制显示隐藏
        obstacleEntities.push(obstacleEntity)

        enableObstacleHover()

        return obstacleEntity
    }

    async function resolveModelUris(items: any[]): Promise<Map<string, string | null>> {
        //用于记录障碍物类型有哪些（不重复）
        const obstacleTypes = new Set<string>()
         // 提取所有不同的障碍物类型（去重）
        items.forEach((item) => {
            if (typeof item?.type === 'string') obstacleTypes.add(item.type)
        })
        // 创建最终返回的 Map
        const modelUris = new Map<string, string | null>()
        //传递一个异步的Promise数组 对每个类型并发发起请求
        await Promise.all(
            //对每个类型都进行异步处理
            Array.from(obstacleTypes).map(async (obstacleType) => {
                try {
                    modelUris.set(
                        obstacleType,
                        await resolveObstacleModelUri(obstacleType)
                    )
                } catch (error) {
                    console.error(`模型加载失败: ${obstacleType}`, error)
                    modelUris.set(obstacleType, null)
                }
            })
        )
        return modelUris
    }

    // 添加全部障碍物
    function addAllObstaclesFromFile(): void {
        // 每次进入加载流程都恢复为显示状态，随后新增的实体也会继承该状态。
        setObstaclesVisible(true)

        let longitude 
        let latitude 
        //磁偏角
        let magVar 
        let type//json文件类型
    
        const fileInput = document.createElement('input')

        fileInput.type = 'file'
        fileInput.accept = '.json,application/json'
        fileInput.multiple = false
        //用户点击打开文件后执行
        fileInput.addEventListener(
            'change',
            async () => {
                const file = fileInput.files?.[0]

                if (!file) {
                    fileInput.remove()
                    return
                }

                try {
                    const text = await file.text()
                    const parsedData: unknown = JSON.parse(text)

                    if (!Array.isArray(parsedData)) {
                        throw new Error(
                            'JSON 文件的顶层数据必须是数组'
                        )
                    }

                    const modelUris = await resolveModelUris(parsedData.slice(1))

                    parsedData.forEach(
                        (item: any, index: number) => {
                            if(index === 0){
                                type = item.type
                                if (type === "relative_bearing") {
                                    longitude = Number(item.baseLon)
                                    latitude = Number(item.baseLat)
                                    magVar = Number(item.magVar)
                                }
                                return   
                            }
                            if (type === "relative_bearing") {
                               try {
                                    if (
                                        typeof item !== 'object' ||
                                        item === null
                                    ) {
                                        throw new Error(
                                            '障碍物数据必须是对象'
                                        )
                                    }

                                    const obstacle = item as any

                                    const magneticAzimuth =
                                        Number(
                                            obstacle.magneticAzimuth
                                        )

                                    const distance =
                                        Number(obstacle.distance)

                                    if (
                                        !Number.isFinite(
                                            magneticAzimuth
                                        )
                                    ) {
                                        throw new Error(
                                            'magneticAzimuth 不是有效数字'
                                        )
                                    }

                                    if (
                                        !Number.isFinite(distance) ||
                                        distance < 0
                                    ) {
                                        throw new Error(
                                            'distance 不是有效的非负数字'
                                        )
                                    }

                                    const position =
                                        getLonLatByMagneticBearingDistance(
                                            longitude,
                                            latitude,
                                            magneticAzimuth,
                                            distance,
                                            magVar
                                        )

                                    addObstacle(
                                        obstacle,
                                        position.longitude,
                                        position.latitude,
                                        modelUris.get(obstacle.type) ?? null
                                    )
                               } catch (error) {
                                console.error(
                                    `第 ${index + 1} 条数据加载失败：`,
                                    error,
                                    item
                                )
                               }
                            }
                            if(type === "absolute_coord"){
                                try {
                                if (
                                    typeof item !== 'object' ||
                                    item === null
                                ) {
                                    throw new Error(
                                        '障碍物数据必须是对象'
                                    )
                                }

                                const obstacle = item as any

                                const longitude =
                                    Number(
                                        obstacle.longitude
                                    )

                                const latitude =
                                    Number(obstacle.latitude)

                                if (
                                    !Number.isFinite(
                                        longitude
                                    )
                                ) {
                                    throw new Error(
                                        'longitude 不是有效数字'
                                    )
                                }

                                if (
                                    !Number.isFinite(latitude) ||
                                    latitude < 0
                                ) {
                                    throw new Error(
                                        'distance 不是有效的非负数字'
                                    )
                                }                   
                                addObstacle(
                                    obstacle,
                                    longitude,
                                    latitude,
                                    modelUris.get(obstacle.type) ?? null
                                )
                               } catch (error) {
                                console.error(
                                    `第 ${index + 1} 条数据加载失败：`,
                                    error,
                                    item
                                )
                               }
                                
                            }
                            
                        }
                    )
                } catch (error) {
                    console.error(
                        '读取本地 JSON 文件失败：',
                        error
                    )

                    window.alert(
                        error instanceof Error
                            ? `文件加载失败：${error.message}`
                            : '文件加载失败'
                    )
                } finally {
                    fileInput.remove()
                }
            },
            {
                once: true
            }
        )
        fileInput.click()//点击打开文件选择窗口
    }

    function clearObstacles(): void {
        window.viewer.entities.suspendEvents()
        try {
            obstacleEntities.forEach((entity) => window.viewer.entities.remove(entity))
        } finally {
            window.viewer.entities.resumeEvents()
        }
        obstacleEntities.length = 0
        obstacleVisible = false
        obstaclesLoaded = false
        hoverObstacleEntity = undefined
        hideHoverLabel()
    }

    type ObstacleDataset = { data: unknown; airport?: { name?: string } }
    // 根据一次加载的多个机场障碍物数据，批量渲染到 Cesium 场景中
    // datasets 的结构：
    // [
    //   { data: [metadata, obstacle1, obstacle2, ...], airport: { name: 'A机场' } },
    //   { data: [metadata, obstacle1, obstacle2, ...], airport: { name: 'B机场' } },
    // ]
    // 一个机场对应一份数据数组，多机场时由外层数组统一管理
    async function renderDatasets(datasets: ObstacleDataset[]): Promise<number> {
        // 基础校验：至少传入一个机场数据，且每个机场数据都必须是数组且非空
        if (datasets.length === 0) throw new Error('没有可加载的机场障碍物数据')
        const parsed = datasets.map((dataset) => dataset.data)
        if (parsed.some((data) => !Array.isArray(data) || data.length === 0)) {
            throw new Error('障碍物数据为空或顶层数据不是数组')
        }

        // 清掉当前地图上已经存在的旧障碍物，避免多机场切换时堆叠重复实体
        clearObstacles()

        // 预先解析所有障碍物类型对应的 3D 模型 URI，避免每条数据都重复请求模型
        // 这里通过 flatMap 把所有机场的 items 展平成一个数组，再去重 求模型
        const modelUris = await resolveModelUris(parsed.flatMap((data) => (data as any[]).slice(1)))

        // 记录本次成功添加了多少个障碍物实体
        let loadedCount = 0

        // 记录已处理条数，用于按批次 suspend/resume Cesium 事件，减少渲染压力。
        let processedCount = 0
        const batchSize = 200
        // 定义一个函数
        // 作用：让浏览器在一帧中插入一次渲染，避免一次性加入大量实体导致卡顿。
        // 停止阻塞主线程 让出16ms
        const yieldToFrame = () =>
            // 创建一个promise
            new Promise<void>((resolve) => {
                //在浏览器下一次刷新屏幕之前（防止在一半过程中），请执行这个函数
                window.requestAnimationFrame(() => resolve())
            })

        // 外层循环：按机场逐个处理
        for (let datasetIndex = 0; datasetIndex < parsed.length; datasetIndex += 1) {
            const parsedData = parsed[datasetIndex] as any[]

            // metadata 位于数组第 0 项，{ type: 'relative_bearing', baseLon, baseLat, magVar }
            const metadata = parsedData[0] as any
            const type = metadata?.type

            // 该机场名称，用于在 hover label 中展示“机场名 · 障碍物名”
            const airportName = datasets[datasetIndex].airport?.name

            // 真实障碍物数据从第 1 项开始；metadata 之后所有 item 都是障碍物对象。
            const items = parsedData.slice(1)

            // 内层循环：按机场中的每一条障碍物逐条转换坐标并加入 Cesium
            for (let index = 0; index < items.length; index += 1) {
                // 每批次开始前 suspendEvents，避免 Cesium 在海量实体加入时频繁触发事件。
                // 每调用一次 suspendEvents()，内部计数器就 +1
                // 每调用一次 resumeEvents()，计数器就 -1
                // 当计数器归零时，Cesium 会把之前积压的所有变更，打包成一个唯一的事件一次性发出去
                if (processedCount % batchSize === 0) {
                    window.viewer.entities.suspendEvents()
                }

                const rawItem = items[index]
                try {
                    if (typeof rawItem !== 'object' || rawItem === null) {
                        throw new Error('障碍物数据必须是对象')
                    }

                    let longitude: number
                    let latitude: number

                    //    相对方位模式：
                    //    原始 obstacle 只有 magneticAzimuth + distance，
                    //    需要用基准点经纬度 + 磁偏角转成真实经纬度。
                    if (type === 'relative_bearing') {
                        const baseLon = Number(metadata.baseLon)
                        const baseLat = Number(metadata.baseLat)
                        const magVar = Number(metadata.magVar ?? 0)
                        const magneticAzimuth = Number(rawItem.magneticAzimuth)
                        const distance = Number(rawItem.distance)

                        if (![baseLon, baseLat, magVar, magneticAzimuth, distance].every(Number.isFinite)) {
                            throw new Error('相对方位障碍物坐标参数无效')
                        }
                        if (distance < 0) throw new Error('distance 不能为负数')

                        const position = getLonLatByMagneticBearingDistance(
                            baseLon, baseLat, magneticAzimuth, distance, magVar,
                        )
                        longitude = position.longitude
                        latitude = position.latitude
                    }
                    //  绝对坐标模式：
                    //  obstacle 已经包含 longitude / latitude，直接使用即可。
                    else if (type === 'absolute_coord') {
                        longitude = Number(rawItem.longitude)
                        latitude = Number(rawItem.latitude)
                        if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
                            throw new Error('经纬度不是有效数字')
                        }
                    }
                    //  其他类型直接抛错，避免错误数据污染地图。
                    else {
                        throw new Error(`不支持的障碍物数据类型: ${String(type)}`)
                    }

                    // 给每个障碍物补上机场名称，便于 hover 像素标签显示“机场名 · 障碍物名”。
                    const item = airportName ? { ...rawItem, airportName } : rawItem

                    // 真正创建 Cesium Entity，并注册到 obstacleEntities。
                    addObstacle(
                        item,
                        longitude,
                        latitude,
                        modelUris.get(item.type) ?? null,
                    )
                    loadedCount += 1
                } catch (error) {
                    // 14. 单条数据失败不影响其他数据继续加载，只记录日志。
                    console.error(`第${index + 2}条障碍物数据加载失败：`, error, rawItem)
                }

                // 每处理一条记录，更新计数，并在达到批次大小或最后一条时恢复事件并 yield 一帧
                processedCount += 1
                const isBatchEnd = processedCount % batchSize === 0
                const isLastItem = datasetIndex === parsed.length - 1 && index === items.length - 1
                if (isBatchEnd || isLastItem) {
                    window.viewer.entities.resumeEvents()
                    if (!isLastItem) await yieldToFrame()
                }
            }
        }

        // 所有数据都处理完毕后，如果没有成功加载任何有效障碍物，则抛错，避免误判为成功。
        if (loadedCount === 0) throw new Error('没有可显示的有效障碍物')

        // 只要至少有一条实体成功创建，就标记已加载，并展示障碍物层。
        obstaclesLoaded = true
        setObstaclesVisible(true)
        return loadedCount
    }

    async function renderObstacles(parsedData: unknown): Promise<number> {
        return renderDatasets([{ data: parsedData }])
    }

    //把多个机场列表发给 Tauri 后端
    async function loadAirports(airports: any[]): Promise<{ count: number; results: any[] }> {
        const results = await invoke<any[]>('load_selected_obstacles', { airports })
        // 渲染障碍物数据
        const count = await renderDatasets(
            // 对后端返回的机场数据进行标准化处理
            results.map((result) => ({ data: result.data, airport: result.airport })),
        )
        return { count, results }
    }

     // 设置所有障碍物是否显示
    function setObstaclesVisible(visible: boolean): void {
        obstacleVisible = visible

        obstacleEntities.forEach((entity) => {
            entity.show = visible

            if (entity.label) {
                ;(entity.label as any).show = false
            }
        })

        hoverObstacleEntity = undefined

        window.viewer.scene.requestRender()
    }

    // 切换显示 / 隐藏
    function toggleObstaclesVisible(): boolean | null {
        if (!obstaclesLoaded || obstacleEntities.length === 0) return null

        const visible = !obstacleVisible
        setObstaclesVisible(visible)
        return visible
    }

    /**
     * 彻底销毁障碍物图层资源与事件监听器，避免事件泄露和内存占用
     */
    function destroy(): void {
        if (hoverHandler && !hoverHandler.isDestroyed()) {
            hoverHandler.destroy()
            hoverHandler = undefined
        }
        clearObstacles()
        if (hoverLabelEntity && window.viewer?.entities) {
            window.viewer.entities.remove(hoverLabelEntity)
            hoverLabelEntity = undefined
        }
        if (window.viewer && !window.viewer.isDestroyed?.()) {
            const el = (window.viewer as any)._element
            if (el) el.style.cursor = 'default'
            window.viewer.scene?.requestRender?.()
        }
    }

    return {
        addObstacle,
        loadAirports,
        // 保留文件加载能力，供需要直接导入 JSON 的场景使用。
        addAllObstacles: addAllObstaclesFromFile,
        toggleObstaclesVisible,
        clearObstacles,
        destroy,
    }
}

type MarkObstacleManager = ReturnType<typeof createMarkObstacleManager>

let markObstacleManager: MarkObstacleManager | undefined

export function useMarkObstacle(): MarkObstacleManager {
    if (!markObstacleManager) {
        markObstacleManager = createMarkObstacleManager()
    }
    return markObstacleManager
}
