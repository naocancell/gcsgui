/**
 * 文件描述：数据导入 Composable (KML/KMZ, GeoJSON, Shapefile, 3D Tiles)
 */
import { useMessage } from 'naive-ui'
import { invoke } from '@tauri-apps/api/core'
import shp from 'shpjs'

export type LocalAsset = { path: string; file: File }
export type LocalDirectoryAssets = { assets: LocalAsset[]; name: string }

export const dataOptions = [
  { label: '加载 KML / KMZ', key: 'kml' },
  { label: '加载 GeoJSON', key: 'geojson' },
  { label: '加载 Shapefile', key: 'shp' },
  { label: '加载 3D Tiles（选择 tileset.json）', key: '3dtiles' },
]

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

export function normalizeAssetPath(path: string): string {
  const parts = path.replaceAll('\\', '/').split('/')
  const normalized: string[] = []
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') normalized.pop()
    else normalized.push(part)
  }
  return normalized.join('/')
}

export function pickSingleFile(accept: Record<string, string[]>): Promise<File | undefined> {
  const picker = (window as any).showOpenFilePicker
  if (typeof picker === 'function') {
    return picker({ multiple: false, types: [{ accept }] }).then(([fileHandle]: any[]) =>
      fileHandle ? fileHandle.getFile() : undefined,
    )
  }

  return new Promise<File | undefined>((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = Object.values(accept).flat().join(',')
    input.onchange = () => {
      resolve(input.files?.[0])
      input.remove()
    }
    input.oncancel = () => {
      resolve(undefined)
      input.remove()
    }
    input.click()
  })
}

export function pickShapefileParts(): Promise<File[] | undefined> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.accept = '.shp,.shx,.dbf,.prj,.qpj,.cpg'
    input.onchange = () => {
      resolve(Array.from(input.files ?? []))
      input.remove()
    }
    input.oncancel = () => {
      resolve(undefined)
      input.remove()
    }
    input.click()
  })
}

/**
 * 将目录中的相对资源转换成 Blob URL，使 tileset.json 可在本地 WebView 中加载。
 */
export async function createLocalTilesetUrl(assets: LocalAsset[]) {
  const files = new Map(assets.map((asset) => [normalizeAssetPath(asset.path), asset.file]))
  const rootPath = [...files.keys()].find((path) => /(^|\/)tileset\.json$/i.test(path))
  if (!rootPath) throw new Error('所选目录中未找到 tileset.json')

  const objectUrls: string[] = []
  const urlByPath = new Map<string, string>()
  const pending = new Map<string, Promise<string>>()

  const resolveReference = (basePath: string, value: string) => {
    if (/^(?:[a-z]+:|\/\/)/i.test(value)) return undefined
    const [pathPart] = value.split(/[?#]/, 1)
    const baseParts = basePath.split('/')
    baseParts.pop()
    const candidate = normalizeAssetPath([...baseParts, decodeURIComponent(pathPart)].join('/'))
    return files.has(candidate) ? candidate : undefined
  }

  const createUrl = async (path: string): Promise<string> => {
    const existing = urlByPath.get(path)
    if (existing) return existing
    const ongoing = pending.get(path)
    if (ongoing) return ongoing
    const file = files.get(path)
    if (!file) throw new Error(`本地 Tiles 资源不存在：${path}`)

    const task = (async () => {
      const isJson = /\.(json|gltf)$/i.test(path)
      let blob: Blob
      if (isJson) {
        let value: any
        try {
          value = JSON.parse(await file.text())
        } catch {
          throw new Error(`无法解析本地 JSON 资源：${path}`)
        }
        const rewrite = async (node: any): Promise<any> => {
          if (Array.isArray(node)) return Promise.all(node.map(rewrite))
          if (!node || typeof node !== 'object') return node
          const result: any = {}
          for (const [key, child] of Object.entries(node)) {
            if (typeof child === 'string') {
              const target = resolveReference(path, child)
              result[key] = target ? await createUrl(target) : child
            } else {
              result[key] = await rewrite(child)
            }
          }
          return result
        }
        const rewritten = await rewrite(value)
        blob = new Blob([JSON.stringify(rewritten)], {
          type: file.type || 'application/json',
        })
      } else {
        blob = file
      }
      const objectUrl = URL.createObjectURL(blob)
      urlByPath.set(path, objectUrl)
      objectUrls.push(objectUrl)
      return objectUrl
    })()
    pending.set(path, task)
    return task
  }

  try {
    return {
      url: await createUrl(rootPath),
      objectUrls,
      name: rootPath.split('/').pop()!,
    }
  } catch (error) {
    objectUrls.forEach((url) => URL.revokeObjectURL(url))
    throw error
  }
}

export function useDataImporter() {
  const message = useMessage()

  async function loadDataFile(
    kind: 'kml' | 'geojson',
    selectedFile?: File,
    displayKind = kind === 'kml' ? 'KML' : 'GeoJSON',
  ) {
    const accept =
      kind === 'kml'
        ? {
            'application/vnd.google-earth.kml+xml': ['.kml'],
            'application/vnd.google-earth.kmz': ['.kmz'],
          }
        : {
            'application/geo+json': ['.geojson'],
            'application/json': ['.json', '.topojson'],
          }
    const file = selectedFile || (await pickSingleFile(accept))
    if (!file) return
    if (!window.measureViewer || !window.viewer) {
      message.error('地图尚未初始化完成')
      return
    }
    const loading = message.loading(`${displayKind} 加载中`, { duration: 0 })
    try {
      await (kind === 'kml'
        ? window.measureViewer.addKml(file)
        : window.measureViewer.addJson(file))
      message.success(`${displayKind} 加载成功`)
    } catch (error) {
      message.error(
        `${displayKind} 加载失败：${error instanceof Error ? error.message : String(error)}`,
      )
    } finally {
      loading.destroy()
    }
  }

  async function loadShapefile() {
    const selected = await pickShapefileParts()
    if (!selected?.length) return

    const shpFile = selected.find((file) => /\.shp$/i.test(file.name))
    if (!shpFile) throw new Error('请选择 .shp 文件，并同时选择对应的 .dbf、.shx 文件')

    const stem = shpFile.name.replace(/\.shp$/i, '')
    const byExtension = (extension: string) =>
      selected.find(
        (file) =>
          file.name.replace(/\.[^.]+$/, '').toLowerCase() === stem.toLowerCase() &&
          file.name.toLowerCase().endsWith(extension),
      )

    const dbfFile = byExtension('.dbf')
    const prjFile = byExtension('.prj') || byExtension('.qpj')
    const cpgFile = byExtension('.cpg')
    if (!dbfFile) {
      throw new Error('缺少与 .shp 同名的 .dbf 文件，无法读取属性名称')
    }
    const geojson = await shp({
      shp: await shpFile.arrayBuffer(),
      dbf: dbfFile ? await dbfFile.arrayBuffer() : undefined,
      prj: prjFile ? await prjFile.text() : undefined,
      cpg: cpgFile ? (await cpgFile.text()).trim() : 'GBK',
    })
    const features = Array.isArray(geojson) ? geojson : [geojson]
    const output =
      features.length === 1
        ? features[0]
        : {
            type: 'FeatureCollection',
            features: features.flatMap((item: any) => item.features || []),
          }
    const geojsonFile = new File([JSON.stringify(output)], `${stem}.geojson`, {
      type: 'application/geo+json',
    })
    await loadDataFile('geojson', geojsonFile, 'Shapefile')
  }

  async function load3DTiles() {
    if (!window.measureViewer || !window.viewer) {
      message.error('地图尚未初始化完成')
      return
    }
    const loading = message.loading('3D Tiles 加载中', { duration: 0 })
    try {
      const selection = await invoke<{ url: string; name: string } | null>('pick_3d_tiles_file')
      if (!selection) return
      await window.measureViewer.add3DTiles(selection.url, selection.name)
      message.success('3D Tiles 加载成功')
    } catch (error) {
      message.error(
        `3D Tiles 加载失败：${error instanceof Error ? error.message : String(error)}`,
      )
    } finally {
      loading.destroy()
    }
  }

  async function handleDataSelect(key: string) {
    try {
      if (key === 'kml' || key === 'geojson') await loadDataFile(key)
      else if (key === 'shp') await loadShapefile()
      else if (key === '3dtiles') await load3DTiles()
    } catch (error) {
      if (!isAbortError(error)) {
        message.error(
          `选择数据失败：${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
  }

  return {
    dataOptions,
    loadDataFile,
    loadShapefile,
    load3DTiles,
    handleDataSelect,
  }
}
