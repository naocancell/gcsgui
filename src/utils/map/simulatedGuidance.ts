import * as Cesium from 'cesium'

export type GuidancePoint = {
  lon: number
  lat: number
  heading: number
}

export type SimulatedGuidance = {
  mode: 'line' | 'orbit' //引导模式
  points: GuidancePoint[] //预生成的航点列表
  progress: number // 当前进度（0 ~ points.length-1 之间的浮点数）
  speed: number // 速度（米/秒）
  lastUpdate: number // 上次更新时间戳（毫秒）
  altitude: number // 目标高度（米）
  currentAltitude: number // 当前高度（米）
  start?: { lon: number; lat: number } // 直线模式：航线起点
  target?: { lon: number; lat: number } // 直线模式：航线终点
  center?: { lon: number; lat: number } // 盘旋模式：圆心
  radiusMeters?: number // 盘旋半径（米）
  laps?: number // 盘旋圈数
}

const WGS84 = Cesium.Ellipsoid.WGS84 //椭球体模型
export const SIMULATED_GUIDANCE_MAX_VERTICAL_SPEED = 5 // 最大垂直爬升/下降速率（米/秒）
// const GRAVITY = 9.80665 // 重力加速度
// const DEFAULT_MAX_BANK_ANGLE = (25 * Math.PI) / 180 // 最大倾斜角（25度）
// const MIN_TURN_RADIUS = 80 // 最小转弯半径（米）
//弧度制经纬度 转换  度制经纬度
function cartographicToDegrees(cartographic: Cesium.Cartographic) {
  return {
    lon: Cesium.Math.toDegrees(
      // 将弧度制经度转换为度制经度，并将其限制在 -180 到 +180 之间
      Cesium.Math.negativePiToPi(cartographic.longitude),
    ),
    lat: Cesium.Math.toDegrees(cartographic.latitude),
  }
}

type LocalFrame = {
  enuToFixed: Cesium.Matrix4
  fixedToEnu: Cesium.Matrix4
}
// 创建一个以指定经纬度为原点的本地 ENU 坐标系 返回两个转换矩阵
function createLocalFrame(originLon: number, originLat: number): LocalFrame {
  //默认就是WGS84椭球体 可以省略第四个参数
  const origin = Cesium.Cartesian3.fromDegrees(originLon, originLat, 0, WGS84)
  //建立一个 本地ENU坐标系 到 世界坐标系 的变换矩阵
  const enuToFixed = Cesium.Transforms.eastNorthUpToFixedFrame(origin, WGS84)
  // enuToFixed的逆矩阵，将世界坐标系下的点转换为本地ENU坐标系下的点
  const fixedToEnu = Cesium.Matrix4.inverseTransformation(
    enuToFixed,
    new Cesium.Matrix4(),
  )
  return { enuToFixed, fixedToEnu }
}

// 将经纬度转换为以原点为基准的 Cesium ENU 局部坐标（x 东、y 北）。
function toLocal(lon: number, lat: number, frame: LocalFrame) {
  const point = Cesium.Cartesian3.fromDegrees(lon, lat, 0, WGS84)
  // 将世界坐标系下的点转换为本地ENU坐标系下的点
  const local = Cesium.Matrix4.multiplyByPoint(
    frame.fixedToEnu,
    point,
    new Cesium.Cartesian3(),
  )
  // 返回局部坐标系下的点的x和y坐标（忽略z坐标 单位是m）
  return {
    x: local.x, //东向偏移，单位米
    y: local.y, //北向偏移，单位米
  }
}
//把局部 ENU 平面坐标（x, y）还原回经纬度坐标
function toGeo(x: number, y: number, frame: LocalFrame) {
  const local = new Cesium.Cartesian3(x, y, 0)
  // 将局部 ENU 坐标转换为世界坐标系下的点
  const fixed = Cesium.Matrix4.multiplyByPoint(
    frame.enuToFixed,
    local,
    new Cesium.Cartesian3(),
  )
  //将世界坐标系下的点投影到椭球上
  const surface = WGS84.scaleToGeodeticSurface(fixed, new Cesium.Cartesian3())
  const cartographic = Cesium.Cartographic.fromCartesian(
    surface ?? fixed,
    WGS84,
  )
  return cartographicToDegrees(cartographic)
}
//返回前面两点之间的最短曲面路径（大地线）对象，基于WGS84椭球体模型
function createGeodesic(
  a: { lon: number; lat: number },
  b: { lon: number; lat: number },
) {
  //Cesium.EllipsoidGeodesic 返回的就是基于 WGS84 椭球体模型计算出的“最短曲面路径”
  return new Cesium.EllipsoidGeodesic(
    Cesium.Cartographic.fromDegrees(a.lon, a.lat),
    Cesium.Cartographic.fromDegrees(b.lon, b.lat),
    WGS84,
  )
}

//基于ENU 计算飞机航向（相对于正北方向）
function headingBetween(
  a: { x: number; y: number },
  b: { x: number; y: number },
) {
  //-π 到 +π 之间转化到 0 到 360 之间
  return ((Math.atan2(b.x - a.x, b.y - a.y) * 180) / Math.PI + 360) % 360
}

//基于经纬度计算飞机航向（相对于正北方向）
function geoHeading(
  a: { lon: number; lat: number },
  b: { lon: number; lat: number },
) {
  //使用WGS84椭球大地线的起始方位角
  const heading = createGeodesic(a, b).startHeading
  return Number.isFinite(heading)
    ? (Cesium.Math.toDegrees(heading) + 360) % 360
    : 0
}
//计算两点之间的WGS84椭球面上的最短距离（米）
function geodesicDistance(
  a: { lon: number; lat: number },
  b: { lon: number; lat: number },
) {
  return createGeodesic(a, b).surfaceDistance ?? 0
}
//在两点之间，按某个比例 fraction，沿着地球表面的最短路径（大地线）插值出一个中间位置。返回插值后的经纬度坐标。
function interpolateGeodesic(
  a: { lon: number; lat: number },
  b: { lon: number; lat: number },
  fraction: number,
) {
  if (fraction <= 0) return { lon: a.lon, lat: a.lat }
  if (fraction >= 1) return { lon: b.lon, lat: b.lat }
  //创建一个 WGS84 椭球体上的大地线对象
  const geodesic = createGeodesic(a, b)
  //如果大地线的表面距离不是有限数值，或者距离小于 1e-6 米，则返回起点 a 的经纬度坐标。
  if (
    !Number.isFinite(geodesic.surfaceDistance) ||
    geodesic.surfaceDistance < 1e-6
  ) {
    return { lon: a.lon, lat: a.lat }
  }
  //按照指定比例插值 返回插值点的经纬度坐标
  const cartographic = geodesic.interpolateUsingFraction(
    fraction,
    new Cesium.Cartographic(),
  )
  return cartographicToDegrees(cartographic)
}

//采样WGS84椭球最短路径上的点：一串经纬度点，用于生成航线
function sampleGeodesic(
  start: { lon: number; lat: number },
  end: { lon: number; lat: number },
  count: number,
) {
  //创建一个 WGS84 椭球体上的大地线对象
  const geodesic = createGeodesic(start, end)
  if (
    !Number.isFinite(geodesic.surfaceDistance) ||
    geodesic.surfaceDistance < 1e-6
  ) {
    return [{ ...start }]
  }
  //采样点数量至少为 1，向下取整
  const sampleCount = Math.max(1, Math.floor(count))
  //创建一个空数组，用于存储采样点的经纬度坐标
  const points: { lon: number; lat: number }[] = []
  //按比例插值采样点，并转换为经纬度坐标
  for (let i = 0; i <= sampleCount; i += 1) {
    const cartographic = geodesic.interpolateUsingFraction(
      i / sampleCount,
      new Cesium.Cartographic(),
    )
    points.push(cartographicToDegrees(cartographic))
  }
  return points
}
//L：向左转的圆弧
//R：向右转的圆弧
//S：直线飞行
type DubinsSegment = 'L' | 'R' | 'S'
type DubinsPath = {
  //路径段的排列 如 types: ['L', 'S', 'L']先左转，再直飞，最后左转。
  types: DubinsSegment[]
  //转弯半径的倍数，表示每段路径的长度。
  //弧长等于半径乘以弧度数（所以记录弧度就可以）
  lengths: number[]
  cost: number //总长度（代价）
}
// 将角度限制在 0 到 2π 之间
//参数 value：弧度值
function mod2pi(value: number) {
  //取余数+2π 再取余数
  return ((value % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
}

// 公式采用的是数学角度制（0° 指向东，且按逆时针增加）
// 在具体的航向计算中，最终会转换成导航角度制（0° 指向北，且按顺时针增加）
/*
  根据起点、终点、起始航向、终止航向以及最小转弯半径，生成所有可能的 Dubins 路径候选，并返回最优路径组合
  @param end: { x, y }：目标点相对于起点的平面坐标）
  @param startAngle：起点航向角（弧度），以正东为 0°，逆时针为正
  @param endAngle：终点航向角（弧度）
  @param radius：最小转弯半径（曲率限制）
  @returns DubinsPath[]：所有可能的 Dubins 路径
*/
function dubinsPaths(
  end: { x: number; y: number },
  startAngle: number,
  endAngle: number,
  radius: number,
): DubinsPath[] {
  // hypot平方根计算目标点到起点的距离
  const distance = Math.hypot(end.x, end.y)
  // 如果距离小于 1e-6，则认为起点和终点重合，直接返回一个长度为 0 的路径
  if (distance < 1e-6) {
    // 计算起点和终点航向角的差值，并将其限制在 0 到 2π 之间
    const headingDelta = mod2pi(endAngle - startAngle)
    //如果差值很小，说明飞机已经朝着正确方向了，直接返回一个长度为 0 的路径
    const shortestDelta = Math.min(headingDelta, 2 * Math.PI - headingDelta)
    return shortestDelta < 1e-6 ? [{ types: ['S'], lengths: [0], cost: 0 }] : []
  }
  //x是E，y是N，atan2返回的是从x轴到点(x,y)的角度，范围是 -π 到 +π
  const direction = Math.atan2(end.y, end.x)
  const d = distance / radius // 将距离归一化为转弯半径的倍数
  const alpha = mod2pi(startAngle - direction) //起点航向角相对于目标点方位角的偏转角
  const beta = mod2pi(endAngle - direction) //终点航向角相对于目标点方位角的偏转角
  const sa = Math.sin(alpha)
  const sb = Math.sin(beta)
  const ca = Math.cos(alpha)
  const cb = Math.cos(beta)
  const cab = Math.cos(alpha - beta)
  //候选路径收集器
  const candidates: DubinsPath[] = []
  //加入候选路径的函数：只接受合法值
  const add = (types: DubinsSegment[], lengths: number[]) => {
    if (lengths.every((length) => Number.isFinite(length) && length >= -1e-8)) {
      const normalized = lengths.map((length) => Math.max(0, length))
      candidates.push({
        types,
        lengths: normalized,
        cost: normalized.reduce((sum, length) => sum + length, 0),
      })
    }
  }
  //枚举六种标准 Dubins 路径结构
  //当p2 >= -1e-9时，说明存在一条合法的路径
  let p2 = 2 + d * d - 2 * cab + 2 * d * (sa - sb)
  if (p2 >= -1e-9) {
    const tmp = Math.atan2(cb - ca, d + sa - sb)
    add(
      ['L', 'S', 'L'],
      [mod2pi(-alpha + tmp), Math.sqrt(Math.max(0, p2)), mod2pi(beta - tmp)],
    )
  }

  p2 = 2 + d * d - 2 * cab - 2 * d * (sa - sb)
  if (p2 >= -1e-9) {
    const tmp = Math.atan2(ca - cb, d - sa + sb)
    add(
      ['R', 'S', 'R'],
      [mod2pi(alpha - tmp), Math.sqrt(Math.max(0, p2)), mod2pi(-beta + tmp)],
    )
  }

  p2 = -2 + d * d + 2 * cab + 2 * d * (sa + sb)
  if (p2 >= -1e-9) {
    const p = Math.sqrt(Math.max(0, p2))
    const tmp = Math.atan2(-ca - cb, d + sa + sb) - Math.atan2(-2, p)
    add(['L', 'S', 'R'], [mod2pi(-alpha + tmp), p, mod2pi(-mod2pi(beta) + tmp)])
  }

  p2 = -2 + d * d + 2 * cab - 2 * d * (sa + sb)
  if (p2 >= -1e-9) {
    const p = Math.sqrt(Math.max(0, p2))
    const tmp = Math.atan2(ca + cb, d - sa - sb) - Math.atan2(2, p)
    add(['R', 'S', 'L'], [mod2pi(alpha - tmp), p, mod2pi(beta - tmp)])
  }

  let tmp = (6 - d * d + 2 * cab + 2 * d * (sa - sb)) / 8
  if (Math.abs(tmp) <= 1 + 1e-9) {
    const p = mod2pi(2 * Math.PI - Math.acos(Math.max(-1, Math.min(1, tmp))))
    const t = mod2pi(alpha - Math.atan2(ca - cb, d - sa + sb) + p / 2)
    add(['R', 'L', 'R'], [t, p, mod2pi(alpha - beta - t + p)])
  }

  tmp = (6 - d * d + 2 * cab + 2 * d * (-sa + sb)) / 8
  if (Math.abs(tmp) <= 1 + 1e-9) {
    const p = mod2pi(2 * Math.PI - Math.acos(Math.max(-1, Math.min(1, tmp))))
    const t = mod2pi(-alpha - Math.atan2(ca - cb, d + sa - sb) + p / 2)
    add(['L', 'R', 'L'], [t, p, mod2pi(beta - alpha - t + p)])
  }
  return candidates
}
// 挑出总长度最短的，作为最终的 Dubins 路径
function dubinsPath(
  end: { x: number; y: number },
  startAngle: number,
  endAngle: number,
  radius: number,
): DubinsPath | null {
  const candidates = dubinsPaths(end, startAngle, endAngle, radius)
  if (!candidates.length) return null
  //遍历返回最优路径（总长度最短的路径）
  return candidates.reduce((best, candidate) =>
    candidate.cost < best.cost ? candidate : best,
  )
}
//获取Dubins 路径的点序列（ENU坐标系下 相对于现在飞机的位置）
function sampleDubinsPath(
  path: DubinsPath,
  startAngle: number,
  radius: number,
  end: { x: number; y: number },
  maxStep = 40, // 采样间隔（米），用于控制采样点的密度，默认值为 40 米
) {
  // 初始化采样点数组，起点为 (0, 0) 航向角为 startAngle
  const points: { x: number; y: number }[] = [{ x: 0, y: 0 }]
  let x = 0
  let y = 0
  let angle = startAngle
  // 遍历路径段，按最大采样间隔进行采样
  for (let index = 0; index < path.types.length; index += 1) {
    const type = path.types[index]
    const length = path.lengths[index] * radius
    // 计算每一段的采样点数量 向上取整
    const steps = Math.max(1, Math.ceil(length / maxStep))
    // 按照采样间隔计算每个采样点的坐标和航向角
    for (let step = 1; step <= steps; step += 1) {
      // 这个采样点在这段中是第几米（累计距离）
      const distance = length * (step / steps)
      // 上一个采样点在这段中是第几米（累计距离）
      const previousDistance = (length * (step - 1)) / steps
      // 转了多少弧度
      const delta = (distance - previousDistance) / radius
      // 根据路径类型计算采样点的坐标和航向角
      if (type === 'S') {
        //如果是直线段，直接沿着当前航向前进
        x += (distance - previousDistance) * Math.cos(angle)
        y += (distance - previousDistance) * Math.sin(angle)
      } else {
        //如果是圆弧段，计算转向方向和下一个采样点的坐标
        const turn = type === 'L' ? 1 : -1 //转向方向，左转是 1，右转是 -1
        const nextAngle = angle + turn * delta //下一个采样点的航向角
        x += radius * (Math.sin(nextAngle) - Math.sin(angle)) * turn
        y += radius * (-Math.cos(nextAngle) + Math.cos(angle)) * turn
        angle = nextAngle
      }
      points.push({ x, y })
    }
  }
  const last = points[points.length - 1]
  if (Math.hypot(last.x - end.x, last.y - end.y) > 0.01) points.push({ ...end })
  return points
}
//返回值是一个点序列（ENU坐标系下 相对于现在飞机的位置）
function sampleDubins(
  end: { x: number; y: number },
  startAngle: number,
  endAngle: number,
  radius: number,
) {
  const path = dubinsPath(end, startAngle, endAngle, radius)
  return path
    ? sampleDubinsPath(path, startAngle, radius, end)
    : [{ x: 0, y: 0 }]
}
// 将局部 ENU 坐标系下的点序列转换为经纬度坐标，并计算每个点的航向角
function finishPoints(
  localPoints: { x: number; y: number }[],
  frame: LocalFrame,
) {
  return localPoints.map((point, index) => {
    const next = localPoints[Math.min(index + 1, localPoints.length - 1)]
    const previous = localPoints[Math.max(0, index - 1)]
    const geo = toGeo(point.x, point.y, frame)
    return { ...geo, heading: (headingBetween(previous, next) + 360) % 360 }
  })
}
// 将经纬度坐标转换为局部 ENU 坐标系下的点序列
function finishGeoPoints(points: { lon: number; lat: number }[]) {
  return points.map((point, index) => {
    const next = points[Math.min(index + 1, points.length - 1)]
    const previous = points[Math.max(0, index - 1)]
    return {
      ...point,
      heading: geoHeading(previous, next),
    }
  })
}
//去除重复的点，避免连续点之间的距离过小，
function dedupeGeoPoints(points: { lon: number; lat: number }[]) {
  const result: { lon: number; lat: number }[] = []
  for (const point of points) {
    const previous = result[result.length - 1]
    if (
      !previous ||
      Math.abs(previous.lon - point.lon) > 1e-9 ||
      Math.abs(previous.lat - point.lat) > 1e-9
    ) {
      result.push(point)
    }
  }
  return result
}

export function createLineGuidance(
  start: {
    lon: number
    lat: number
    heading: number
    speed: number
    altitude: number
  },
  routeStart: { lon: number; lat: number }, //导引航线的起点
  target: { lon: number; lat: number }, //导引航线的终点
  altitude: number, //目标高度（米）
): SimulatedGuidance {
  //以飞机当前位置为原点，建立一个本地 ENU 坐标系。
  const localFrame = createLocalFrame(start.lon, start.lat)
  //将导引航线起点的经纬度转换为本地 ENU 坐标系下的点
  const end = toLocal(routeStart.lon, routeStart.lat, localFrame)
  //计算飞机当前位置到导引航线起点的距离
  const distance = Math.hypot(end.x, end.y)
  //直线导引航线长度
  const arcDistance = geodesicDistance(routeStart, target)
  //采样出导引航线上的点，点的数量根据航线长度动态调整，最少 24 个，最多 2000 个
  const arcPoints = sampleGeodesic(
    routeStart,
    target,
    Math.max(24, Math.min(2000, Math.ceil(arcDistance / 1000))),
  )
  //飞机速度
  const speed = Math.max(5, start.speed || 25)
  // “用有限横滚角约束出来的转弯半径，保证过渡段有真实可行的转弯速度。
  // Dubins 算法再解决飞机和航点的各种相对位置关系，
  // 包括航点恰好在飞机后方这种极端情况

  //转弯半径的计算方式
  // const turnRadius = Math.max(
  //   MIN_TURN_RADIUS,
  //   (speed * speed) / (GRAVITY * Math.tan(DEFAULT_MAX_BANK_ANGLE)),
  // )
  const turnRadius = 200
  //计算导引线的航向角（相对于正北方向）
  const routeHeading = geoHeading(routeStart, target)

  const transitionPoints =
    distance < 1
      ? [{ x: 0, y: 0 }]
      : sampleDubins(
          end,
          Math.PI / 2 - ((start.heading || 0) * Math.PI) / 180,
          Math.PI / 2 - (routeHeading * Math.PI) / 180,
          turnRadius,
        )
  const transitionGeo = transitionPoints.map((point) =>
    toGeo(point.x, point.y, localFrame),
  )
  const points = finishGeoPoints(
    dedupeGeoPoints([...transitionGeo, ...arcPoints.slice(1)]),
  )
  return {
    mode: 'line',
    points,
    progress: 0,
    speed,
    lastUpdate: Date.now(),
    altitude: Math.max(0, altitude),
    currentAltitude: Math.max(0, start.altitude),
    target,
    start: routeStart,
  }
}

export function createOrbitGuidance(
  start: {
    lon: number
    lat: number
    heading: number
    speed: number
    altitude: number
  },
  center: { lon: number; lat: number },
  radiusMeters: number,
  laps: number,
  altitude: number,
): SimulatedGuidance {
  const localFrame = createLocalFrame(start.lon, start.lat)
  const centerLocal = toLocal(center.lon, center.lat, localFrame)
  const radius = Math.max(50, radiusMeters)
  const speed = Math.max(5, start.speed || 25)

  // const turnRadius = Math.max(
  //   MIN_TURN_RADIUS,
  //   (speed * speed) / (GRAVITY * Math.tan(DEFAULT_MAX_BANK_ANGLE)),
  // )
  const turnRadius = 200
  const startAngle = Math.PI / 2 - ((start.heading || 0) * Math.PI) / 180
  type OrbitEntryCandidate = {
    angle: number
    direction: 1 | -1
    point: { x: number; y: number }
    path: DubinsPath
    cost: number
  }
  let candidate: OrbitEntryCandidate | null = null
  const entrySamples = Math.min(
    2000,
    Math.max(144, Math.ceil((2 * Math.PI * radius) / 250)),
  )
  // 沿着整个盘旋轨道分别检查左右两种转向方式。
  // 只有符合最终盘旋方向的 L-S-L 或 R-S-R 轨迹才会被选用，
  // 这样飞机在合并进圆轨之前就不会出现反向倾斜，也不会突然换转向方向
  for (const direction of [1, -1] as const) {
    const turnType: DubinsSegment = direction === 1 ? 'L' : 'R'
    for (let step = 0; step < entrySamples; step += 1) {
      const angle = -Math.PI + (step * 2 * Math.PI) / entrySamples
      const point = {
        x: centerLocal.x + radius * Math.cos(angle),
        y: centerLocal.y + radius * Math.sin(angle),
      }
      const endAngle = angle + (direction * Math.PI) / 2
      const path = dubinsPaths(point, startAngle, endAngle, turnRadius)
        .filter(
          (candidatePath) =>
            candidatePath.types.every(
              (type, index) =>
                type === 'S' ||
                type === turnType ||
                candidatePath.lengths[index] < 1e-6,
            ) &&
            candidatePath.types.reduce(
              (turn, type, index) =>
                turn + (type === 'S' ? 0 : candidatePath.lengths[index]),
              0,
            ) <=
              2 * Math.PI + 1e-6,
        )
        .reduce<DubinsPath | null>(
          (best, candidatePath) =>
            !best || candidatePath.cost < best.cost ? candidatePath : best,
          null,
        )
      if (!path) continue
      const cost = path.cost * turnRadius
      if (!candidate || cost < candidate.cost) {
        candidate = { angle, direction, point, path, cost }
      }
    }
  }
  if (!candidate) {
    throw new Error('无法生成满足转弯半径约束的盘旋切入路径')
  }
  const direction = candidate.direction
  const entryAngle = candidate.angle
  const entry = candidate.point
  const transition = sampleDubinsPath(
    candidate.path,
    startAngle,
    turnRadius,
    entry,
    15,
  )
  const orbitPoints: { x: number; y: number }[] = []
  const samples = Math.min(
    2000,
    Math.max(72, Math.ceil((2 * Math.PI * radius) / 50)),
  )
  const totalSamples = samples * Math.max(1, Math.round(laps))
  for (let i = 0; i <= totalSamples; i += 1) {
    const angle = entryAngle + direction * (i / samples) * 2 * Math.PI
    orbitPoints.push({
      x: centerLocal.x + radius * Math.cos(angle),
      y: centerLocal.y + radius * Math.sin(angle),
    })
  }
  return {
    mode: 'orbit',
    points: finishPoints([...transition, ...orbitPoints.slice(1)], localFrame),
    progress: 0,
    speed,
    lastUpdate: Date.now(),
    altitude: Math.max(0, altitude),
    currentAltitude: Math.max(0, start.altitude),
    center,
    radiusMeters: radius,
    laps: Math.max(1, Math.round(laps)),
  }
}

export function guidancePosition(
  guidance: SimulatedGuidance,
  now = Date.now(),
) {
  const points = guidance.points
  const deltaSeconds = Math.max(
    0,
    Math.min(1, (now - guidance.lastUpdate) / 1000),
  )
  guidance.lastUpdate = now
  const altitudeDelta = guidance.altitude - guidance.currentAltitude
  const maxAltitudeStep = SIMULATED_GUIDANCE_MAX_VERTICAL_SPEED * deltaSeconds
  const altitudeStep =
    Math.abs(altitudeDelta) <= maxAltitudeStep
      ? altitudeDelta
      : Math.sign(altitudeDelta) * maxAltitudeStep
  guidance.currentAltitude += altitudeStep
  const verticalSpeed = deltaSeconds > 0 ? altitudeStep / deltaSeconds : 0
  if (points.length < 2) {
    return { ...points[0], altitude: guidance.currentAltitude, verticalSpeed }
  }
  let remaining = guidance.speed * deltaSeconds
  while (remaining > 0 && guidance.progress < points.length - 1) {
    const a = points[Math.floor(guidance.progress)]
    const b = points[Math.floor(guidance.progress) + 1]
    const segment = Math.max(0.1, geodesicDistance(a, b))
    const fraction = guidance.progress % 1
    const available = segment * (1 - fraction)
    if (remaining < available) {
      guidance.progress += remaining / segment
      remaining = 0
    } else {
      guidance.progress = Math.floor(guidance.progress) + 1
      remaining -= available
    }
  }
  const index = Math.min(points.length - 1, Math.floor(guidance.progress))
  const fraction = guidance.progress - index
  const a = points[index]
  const b = points[Math.min(index + 1, points.length - 1)]
  const position = interpolateGeodesic(a, b, fraction)
  return {
    lon: position.lon,
    lat: position.lat,
    heading:
      a.heading + (((b.heading - a.heading + 540) % 360) - 180) * fraction,
    altitude: guidance.currentAltitude,
    verticalSpeed,
  }
}
