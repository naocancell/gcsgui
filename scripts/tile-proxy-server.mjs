/*
 * 瓦片地图动态代理与持久化缓存服务
 * 适用场景：局域网离线电脑（如 192.168.2.26）通过网线向本电脑（192.168.2.104）请求地图瓦片
 * 本服务会自动缓存所有请求过的瓦片到本地磁盘（tile-cache 目录），离线后依然永久可用。
 */

import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = 8088
// 瓦片本地持久化缓存目录
const CACHE_ROOT = path.join(__dirname, '..', 'tile-cache')

// 天地图开发者 Token
const TDT_TK = '1c5b7cbf9da7d33b221f68c32b6a1791'

// 轮询天地图服务器负载子域 (t0 ~ t7)
const getTdtSubdomain = () => Math.floor(Math.random() * 8)

// 针对不同类型的瓦片设定格式与 Content-Type
const TYPE_MAPPINGS = {
  img: { ext: 'jpg', contentType: 'image/jpeg' }, // 影像底图
  cia: { ext: 'png', contentType: 'image/png' },  // 影像中文注记
  vec: { ext: 'png', contentType: 'image/png' },  // 矢量底图
  cva: { ext: 'png', contentType: 'image/png' },  // 矢量中文注记
  ter: { ext: 'jpg', contentType: 'image/jpeg' }, // 地形晕渲
  cta: { ext: 'png', contentType: 'image/png' },  // 地形注记
}

// 缓存统计计数
let hitCount = 0
let missCount = 0

// 正在请求中的瓦片 Promise 缓存，防止瞬间重复请求打到远程
const inFlightRequests = new Map()

// 瓦片网络失败防刷屏节流机制
let lastTileErrSec = 0
let tileErrSuppressedCount = 0

function logThrottledTileError(msg) {
  const nowSec = Math.floor(Date.now() / 1000)
  if (nowSec > lastTileErrSec) {
    if (tileErrSuppressedCount > 0) {
      const timeDesc = (nowSec === lastTileErrSec + 1) ? '前 1 秒内' : '此前波动期'
      console.error(`${msg} (${timeDesc}累计抑制了 ${tileErrSuppressedCount} 次连续失败)`)
      tileErrSuppressedCount = 0
    } else {
      console.error(msg)
    }
    lastTileErrSec = nowSec
  } else {
    tileErrSuppressedCount++
  }
}

const server = http.createServer(async (req, res) => {
  // 跨域支持 (CORS)
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', '*')

  if (req.method === 'OPTIONS') {
    res.writeHead(200)
    res.end()
    return
  }

  // 状态查看接口
  if (req.url === '/status' || req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(
      JSON.stringify(
        {
          status: 'running',
          port: PORT,
          cacheRoot: CACHE_ROOT,
          hitCount,
          missCount,
          totalRequests: hitCount + missCount,
        },
        null,
        2,
      ),
    )
    return
  }

  // URL 匹配：/tiles/:type/:z/:x/:y(.png|.jpg)?
  const match = req.url.match(/^\/tiles\/([a-zA-Z]+)\/(\d+)\/(\d+)\/(\d+)(?:\.[a-zA-Z]+)?$/)
  if (!match) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('未找到请求路径。格式规范: /tiles/{img|cia|vec|cva}/{z}/{x}/{y}.png')
    return
  }

  const [, type, z, x, y] = match
  const meta = TYPE_MAPPINGS[type] || { ext: 'png', contentType: 'image/png' }

  const localDir = path.join(CACHE_ROOT, type, z, x)
  const localFilePath = path.join(localDir, `${y}.${meta.ext}`)

  // 1. 命中本地缓存：直接返回本地文件
  if (fs.existsSync(localFilePath)) {
    try {
      const data = await fs.promises.readFile(localFilePath)
      hitCount++
      res.writeHead(200, {
        'Content-Type': meta.contentType,
        'Cache-Control': 'public, max-age=31536000',
        'X-Cache': 'HIT',
      })
      res.end(data)
      return
    } catch (err) {
      console.warn(`[缓存读取异常] ${localFilePath}:`, err.message)
    }
  }

  // 2. 未命中缓存：检查是否有相同的瓦片正在下载中
  const cacheKey = `${type}_${z}_${x}_${y}`
  let downloadPromise = inFlightRequests.get(cacheKey)

  if (!downloadPromise) {
    missCount++
    downloadPromise = (async () => {
      const sub = getTdtSubdomain()
      const remoteUrl = `https://t${sub}.tianditu.gov.cn/DataServer?T=${type}_w&x=${x}&y=${y}&l=${z}&tk=${TDT_TK}`

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 10000)

      try {
        const response = await fetch(remoteUrl, {
          signal: controller.signal,
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            Referer: 'http://localhost/',
          },
        })
        clearTimeout(timer)

        if (!response.ok) {
          throw new Error(`天地图响应状态异常: ${response.status}`)
        }

        const contentType = response.headers.get('content-type') || ''
        if (contentType.includes('application/json')) {
          const errJson = await response.text()
          throw new Error(`天地图接口返回错误: ${errJson}`)
        }

        const arrayBuffer = await response.arrayBuffer()
        const buffer = Buffer.from(arrayBuffer)

        if (buffer.length > 0) {
          await fs.promises.mkdir(localDir, { recursive: true })
          await fs.promises.writeFile(localFilePath, buffer)
          console.log(`[在线下载并已缓存] 类型:${type} 级别:${z} x:${x} y:${y} (${buffer.length} 字节)`)
        }
        return buffer
      } finally {
        inFlightRequests.delete(cacheKey)
      }
    })()

    inFlightRequests.set(cacheKey, downloadPromise)
  }

  try {
    const buffer = await downloadPromise
    res.writeHead(200, {
      'Content-Type': meta.contentType,
      'Cache-Control': 'public, max-age=31536000',
      'X-Cache': 'MISS',
    })
    res.end(buffer)
  } catch (err) {
    logThrottledTileError(`[瓦片获取失败] 类型:${type} 级别:${z} x:${x} y:${y}: ${err.message}`)
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('瓦片获取失败')
  }
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`================================================================`)
  console.log(`  GCSGUI 瓦片动态代理与离线持久化缓存服务已启动！`)
  console.log(`  服务端口: ${PORT}`)
  console.log(`  本机访问: http://127.0.0.1:${PORT}/tiles/`)
  console.log(`  局域网访问（离线电脑可用）: http://192.168.2.104:${PORT}/tiles/`)
  console.log(`  缓存存储路径: ${CACHE_ROOT}`)
  console.log(`  状态监控: http://127.0.0.1:${PORT}/status`)
  console.log(`================================================================`)
})
