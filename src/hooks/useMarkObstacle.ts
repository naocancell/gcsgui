import * as Cesium from 'cesium'

const obstacleIcons = {
    lowPowerPole:'/img/低压电杆.png',
    highPowerPole:'/img/高压电杆.png',
    highPowerTower:'/img/高压电塔.png',
    signalTower:'/img/信号塔.png',
    radarStation:'/img/雷达站.png',
    waterTower:'/img/水塔.png',
    house:'/img/房子.png'
}

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

export function useMarkObstacle() {
    // 保存所有障碍物实体
    const obstacleEntities: Cesium.Entity[] = []

    // 当前障碍物图层是否显示
    let obstacleVisible = true

    // 添加单个障碍物
    function addObstacle(obstacle,longitude,latitude){
        //真北极
        const obstacleEntity = window.viewer.entities.add({
            position:
                Cesium.Cartesian3.fromDegrees(
                    longitude,
                    latitude
                ),
            // 新添加的障碍物要跟随当前显示状态
            show: obstacleVisible,
            billboard:{
                image:
                    obstacleIcons[obstacle.type],
                width:
                    80,
                height:
                    80,
                verticalOrigin:
                    Cesium.VerticalOrigin.BOTTOM,

                heightReference:
                    Cesium.HeightReference.CLAMP_TO_GROUND,

                // 不要缩太小
                scaleByDistance:
                    new Cesium.NearFarScalar(

                        1000,
                        1.0,
                        30000,
                        0.6
                    ),
                distanceDisplayCondition:
                    new Cesium.DistanceDisplayCondition(
                        0,
                        30000
                    ),
                // 防止被地形遮挡
                disableDepthTestDistance:
                    Number.POSITIVE_INFINITY

            },

            label:{
                text:
                    `${obstacle.name}\n海拔高度:${obstacle.height || '-'}m`,
                font:
                    "bold 16px sans-serif",
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
                        -75
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
                        30000,
                        0.8
                    ),
                distanceDisplayCondition:
                    new Cesium.DistanceDisplayCondition(
                        0,
                        30000
                    )
            }
        })

         // 保存实体，后面统一控制显示隐藏
        obstacleEntities.push(obstacleEntity)

        return obstacleEntity
    }
    // 添加全部障碍物
    function addAllObstacles(): void {
        let longitude 
        let latitude 
        //磁偏角
        let magVar 
    
        const fileInput = document.createElement('input')

        fileInput.type = 'file'
        fileInput.accept = '.json,application/json'
        fileInput.multiple = false

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

                    parsedData.forEach(
                        (item: any, index: number) => {
                            if(index === 0){
                                longitude = Number(item.baseLon)
                                latitude = Number(item.baseLat)
                                magVar = Number(item.magVar)
                                return   
                            }
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
                                    position.latitude
                                )
                            } catch (error) {
                                console.error(
                                    `第 ${index + 1} 条数据加载失败：`,
                                    error,
                                    item
                                )
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

        fileInput.click()
    }

     // 设置所有障碍物是否显示
    function setObstaclesVisible(visible: boolean): void {
        obstacleVisible = visible

        obstacleEntities.forEach((entity) => {
            entity.show = visible
        })
    }

    // 切换显示 / 隐藏
    function toggleObstaclesVisible(): void {
        setObstaclesVisible(!obstacleVisible)
    }

    return {
        addObstacle,
        addAllObstacles,
        toggleObstaclesVisible,
    }
}