import { convertFileSrc } from '@tauri-apps/api/core'
import { invokeSafe } from '@/utils/ipc'
import { logger } from '@/utils/logger'

// 模型服务根地址由后端统一配置（get_service_endpoints，可在应用配置目录 services.json 覆盖），
// 获取失败时回退到默认地址，保证与后端下载白名单一致。
const DEFAULT_SERVICE_BASE = 'http://172.10.0.183:8890'
let serviceBasePromise: Promise<string> | undefined

type ServiceEndpoints = {
  nfzBase: string
  obstacleBase: string
}

function getServiceBase(): Promise<string> {
  if (!serviceBasePromise) {
    serviceBasePromise = invokeSafe<ServiceEndpoints>('get_service_endpoints', undefined, { silent: true })
      .then(endpoints => endpoints.obstacleBase.replace(/\/+$/, '') || DEFAULT_SERVICE_BASE)
      .catch(error => {
        logger.warn('获取模型服务地址失败，使用默认地址', error)
        return DEFAULT_SERVICE_BASE
      })
  }
  return serviceBasePromise
}

const commonModelTypes = [
  'house',
  'lowPowerPole',
  'highPowerTower',
  'signalTower',
  'radarStation',
  'highPowerPole',
  'waterTower',
]

type ModelMeta = {
  id: number //模型id
  obstacle_type: string //模型type
  updated_at: string //模型数据库更新时间
  file_size: number //模型尺寸大小
  sha256?: string   //SHA256 哈希值 检验模型是否过期
}
//Promise 记录是否已经发起请求避免重复请求
let catalogPromise: Promise<ModelMeta[]> | undefined
// 只合并正在进行的磁盘检查/下载；完成后移除，避免磁盘文件被外部删除后仍返回旧路径。
const modelPathPromises = new Map<string, Promise<string>>()
// 获取所有模型的目录（从后端 API 拉取）
function loadModelCatalogOnce(): Promise<ModelMeta[]> {
    //如果还没有发送过请求 还没有缓存的 Promise
  if (!catalogPromise) {
    //发起请求  获取所有模型的列表
    catalogPromise = getServiceBase()
      .then(base => fetch(`${base}/api/models`))
      .then(response => {
        if (!response.ok) {
          throw new Error('模型目录请求失败')
        }
        //解析服务端传递过来的ModelMeta数组
        return response.json() as Promise<ModelMeta[]>
      })
      .catch(error => {
        catalogPromise = undefined
        throw error
      })
  }

  return catalogPromise
}
//优先用文件的 SHA256 哈希值作为版本号，如果没有则用“最后更新时间 + 文件大小”拼接成一个字符串
function getModelVersion(model: ModelMeta): string {
  return model.sha256 || `${model.updated_at}:${model.file_size}`
}

function ensureModelPath(model: ModelMeta): Promise<string> {
  // 生成版本标识
  const version = getModelVersion(model)
  // 模型下载任务的缓存键  
  const cacheKey = `${model.id}:${version}`
  //看看这个模型是否正在由RUST下载的promise任务
  // 如果有，交给调用者，自己不再发起新请求
  const cached = modelPathPromises.get(cacheKey)
  if (cached) return cached
 // 检查本地是否存在模型  不存在就请求 存在返回系统绝对路径地址
 // pending promise对象 = 获取绝对路径的任务
 // await pending 最终拿到模型绝对路径
 const pending = getServiceBase().then(base => invokeSafe<string>(
    'ensure_model_cached',
    {
      modelId: model.id,
      obstacleType: model.obstacle_type,
      version,
      downloadUrl: `${base}/api/models/${model.id}/file`,
    },
    { silent: true },
  ))
  //给promise执行成功和失败使用的回调函数
  const clearPending = () => {
    if (modelPathPromises.get(cacheKey) === pending) {
      modelPathPromises.delete(cacheKey)
    }
  }
  //任务完成后，把“正在执行的任务记录”删除
  void pending.then(clearPending, clearPending)
  //建立这个任务就记录在modelPathPromises中
  modelPathPromises.set(cacheKey, pending)
  return pending
}

async function resolveCachedModelPath(type: string): Promise<string | null> {
  try {
    return await invokeSafe<string | null>('resolve_cached_model', {
      obstacleType: type,
    }, { silent: true })
  } catch (error) {
    // 兼容旧版本后端没有该命令的情况，继续尝试服务目录解析。
    logger.warn(`本地模型缓存查询失败: ${type}`, error)
    return null
  }
}
//传入一个模型type  返回模型的路径（已经被convertFileSrc转换为前端可以请求的路径）
export async function resolveObstacleModelUri(type: string): Promise<string | null> {
  const cachedPath = await resolveCachedModelPath(type)
  if (cachedPath) return convertFileSrc(cachedPath)

  const catalog = await loadModelCatalogOnce()
  const model = catalog.find(item => item.obstacle_type === type)
  if (!model) return null

  return convertFileSrc(await ensureModelPath(model))
}
//预加载部分模型缓存到磁盘中
export async function cacheCommonModelsToDisk() {
    // 获取所有模型的目录（从后端 API 拉取）
  const catalog = await loadModelCatalogOnce() 
  //遍历所有的需要缓存的模型类型
  for (const type of commonModelTypes) {
    const model = catalog.find(item => item.obstacle_type === type)

    if (!model) {
      logger.warn(`服务端没有模型: ${type}`)
      continue
    }

    await ensureModelPath(model)
  }
}
