<!--
  文件描述：Cesium地图的图层管理器组件
  创建时间：2025/3/4 11:25
  创建人：Zhaipeixiu
-->
<script setup lang="ts">
import {
  AddOutline,
  CloseOutline,
  LayersOutline,
  TrashOutline,
} from '@vicons/ionicons5'
import LayerItem from '@/components/LayerItem.vue'
import { darkTheme, useMessage } from 'naive-ui'
import { computed, reactive, ref, shallowRef, watch } from 'vue'
import { useLayerStore } from '@/store/layerManagerStore.ts'
import { removeLayerResources } from '@/utils/map/layerResources'
//定义允许父组件使用的函数或变量
defineExpose({
  //父组件点击添加图层显示图层管理面板
  open_closeSidebar: () => {
    // 获取侧边栏元素
    let sidebar = document.querySelector('.LayerManagerSidebar')
    if (sidebar?.classList.contains('open')) {
      //关闭侧边栏
      sidebar?.classList.remove('open')
    } else {
      // 打开侧边栏
      sidebar?.classList.add('open')
    }
  },
})
//点击关闭图层管理器侧边栏
function closeLayerManagerSidebar() {
  let sidebar = document.querySelector('.LayerManagerSidebar')
  sidebar?.classList.remove('open')
}

let showWmsModal = ref(false)
const addingWmsLayer = ref(false)
const message = useMessage()
let wmsLoadingMessage: { destroy: () => void } | null = null
const layerStore = useLayerStore()
const layerCount = computed(() => layerStore.Layers.length)

type WmsBounds = {
  west: number
  south: number
  east: number
  north: number
}

type WmsLayerOption = {
  label: string
  value: string
  bounds?: WmsBounds
}

type WmsCapabilities = {
  url: string
  document: XMLDocument
  options: WmsLayerOption[]
}

const DEFAULT_WMS_URL =
  'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi'
const DEFAULT_WMS_LAYER = 'MODIS_Terra_NDVI_8Day'
const GLOBAL_BOUNDS: WmsBounds = {
  west: -180,
  south: -90,
  east: 180,
  north: 90,
}

const wmsConfig = reactive({
  url: DEFAULT_WMS_URL,
})
const selectedWmsLayers = ref<string[]>([DEFAULT_WMS_LAYER])
const wmsLayerOptions = ref<WmsLayerOption[]>([
  { label: DEFAULT_WMS_LAYER, value: DEFAULT_WMS_LAYER },
])
const readingCapabilities = ref(false)
const capabilities = shallowRef<WmsCapabilities | null>(null)

watch(
  () => wmsConfig.url,
  (url) => {
    if (capabilities.value?.url === url.trim()) return
    capabilities.value = null
    wmsLayerOptions.value = []
    selectedWmsLayers.value = []
  },
)

function getCapabilitiesUrl(serviceUrl: string) {
  const url = new URL(serviceUrl)
  url.searchParams.set('service', 'WMS')
  url.searchParams.set('request', 'GetCapabilities')
  return url.toString()
}

function closeWmsLoadingMessage() {
  wmsLoadingMessage?.destroy()
  wmsLoadingMessage = null
}

function getDirectChild(element: Element, localName: string) {
  return Array.from(element.children).find(
    (child) => child.localName === localName,
  )
}

function getLayerBounds(document: XMLDocument, layerName: string) {
  const layerElement = Array.from(document.getElementsByTagName('Layer')).find(
    (layer) => getDirectChild(layer, 'Name')?.textContent?.trim() === layerName,
  )
  if (!layerElement) return undefined

  const geographicBox = getDirectChild(layerElement, 'EX_GeographicBoundingBox')
  if (geographicBox) {
    const getValue = (name: string) =>
      Number(getDirectChild(geographicBox, name)?.textContent)
    const bounds = {
      west: getValue('westBoundLongitude'),
      south: getValue('southBoundLatitude'),
      east: getValue('eastBoundLongitude'),
      north: getValue('northBoundLatitude'),
    }
    if (Object.values(bounds).every(Number.isFinite)) return bounds
  }

  const latLonBox = getDirectChild(layerElement, 'LatLonBoundingBox')
  if (!latLonBox) return undefined
  const bounds = {
    west: Number(latLonBox.getAttribute('minx')),
    south: Number(latLonBox.getAttribute('miny')),
    east: Number(latLonBox.getAttribute('maxx')),
    north: Number(latLonBox.getAttribute('maxy')),
  }
  return Object.values(bounds).every(Number.isFinite) ? bounds : undefined
}

function getWmsLayerOptions(document: XMLDocument): WmsLayerOption[] {
  const seen = new Set<string>()
  const options: WmsLayerOption[] = []

  for (const layer of Array.from(document.getElementsByTagName('Layer'))) {
    const name = getDirectChild(layer, 'Name')?.textContent?.trim()
    if (!name || seen.has(name)) continue

    const title = getDirectChild(layer, 'Title')?.textContent?.trim()
    options.push({
      value: name,
      label: title && title !== name ? `${title} (${name})` : name,
      bounds: getLayerBounds(document, name),
    })
    seen.add(name)
  }

  return options
}

async function requestWmsCapabilities(serviceUrl: string) {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), 15000)
  let response: Response
  try {
    response = await fetch(getCapabilitiesUrl(serviceUrl), {
      signal: controller.signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('服务连接超时')
    }
    throw error
  } finally {
    window.clearTimeout(timeoutId)
  }
  if (!response.ok) {
    throw new Error(`服务请求失败（HTTP ${response.status}）`)
  }

  const document = new DOMParser().parseFromString(
    await response.text(),
    'application/xml',
  )
  if (document.querySelector('parsererror')) {
    throw new Error('服务返回的 GetCapabilities 文档无效')
  }

  const serviceException = document.querySelector(
    'ServiceException, ExceptionText',
  )?.textContent
  if (serviceException) throw new Error(serviceException.trim())

  const options = getWmsLayerOptions(document)
  if (options.length === 0) {
    throw new Error('服务未返回可用图层')
  }

  return { url: serviceUrl, document, options }
}

function validateServiceUrl(serviceUrl: string) {
  if (!serviceUrl) {
    message.warning('请输入 WMS 服务地址')
    return false
  }
  try {
    new URL(serviceUrl)
  } catch {
    message.warning('请输入有效的 WMS 服务地址')
    return false
  }
  return true
}

async function readWmsCapabilities() {
  const url = wmsConfig.url.trim()
  if (!validateServiceUrl(url)) return

  readingCapabilities.value = true
  try {
    const result = await requestWmsCapabilities(url)
    capabilities.value = result
    wmsLayerOptions.value = result.options

    const currentSelection = selectedWmsLayers.value.filter((layer) =>
      result.options.some((option) => option.value === layer),
    )
    selectedWmsLayers.value = currentSelection
    message.success(`已读取 ${result.options.length} 个图层`)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    capabilities.value = null
    wmsLayerOptions.value = []
    selectedWmsLayers.value = []
    message.error(`读取 WMS 图层失败：${detail}`)
  } finally {
    readingCapabilities.value = false
  }
}

async function validateWmsService(
  serviceUrl: string,
  layers: string[],
): Promise<WmsBounds | undefined> {
  const result =
    capabilities.value?.url === serviceUrl
      ? capabilities.value
      : await requestWmsCapabilities(serviceUrl)
  const availableLayers = new Set(result.options.map((option) => option.value))
  const missingLayers = layers.filter((layer) => !availableLayers.has(layer))
  if (missingLayers.length > 0) {
    throw new Error(`服务中不存在图层：${missingLayers.join(', ')}`)
  }
  return result.options.find((option) => option.value === layers[0])?.bounds
}

async function addWMSLayer() {
  const url = wmsConfig.url.trim()
  const layers = selectedWmsLayers.value.filter(Boolean)

  if (!validateServiceUrl(url)) return
  if (layers.length === 0) {
    message.warning('请先读取并选择 WMS 图层')
    return
  }
  if (!window.measureViewer || !window.viewer) {
    message.error('地图尚未初始化完成')
    return
  }

  showWmsModal.value = false
  addingWmsLayer.value = true
  closeWmsLoadingMessage()
  wmsLoadingMessage = message.loading('WMS 加载中', { duration: 0 })
  try {
    const serviceBounds = await validateWmsService(url, layers)
    const bounds =
      url === DEFAULT_WMS_URL && layers[0] === DEFAULT_WMS_LAYER
        ? GLOBAL_BOUNDS
        : serviceBounds
    await window.measureViewer.AddWMSLayer(url, layers.join(','), bounds)
    window.viewer.scene.requestRender()
    closeWmsLoadingMessage()
    message.success('WMS 加载成功')
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    closeWmsLoadingMessage()
    message.error(`WMS 加载失败：${detail}`)
  } finally {
    closeWmsLoadingMessage()
    addingWmsLayer.value = false
  }
}
//清空图层函数
async function clearLayers() {
  const layers = [...layerStore.Layers]

  await Promise.allSettled(
    layers.map((layer) => removeLayerResources(window.viewer, layer)),
  )
  window.viewer.scene.requestRender()
  layerStore.clearLayersList()
}
</script>

<template>
  <div>
    <n-config-provider :theme="darkTheme">
      <n-layout class="LayerManagerSidebar">
        <n-layout-header class="layer-manager-header">
          <div class="layer-manager-title-wrap">
            <div class="layer-manager-kicker">
              <n-icon size="15"><LayersOutline /></n-icon>
              工作区
            </div>
            <div class="layer-manager-title-row">
              <h2>图层管理</h2>
              <span class="layer-count">{{ layerCount }}</span>
            </div>
          </div>
          <n-button
            class="layer-manager-close"
            quaternary
            circle
            size="small"
            aria-label="关闭图层管理"
            @click="closeLayerManagerSidebar"
          >
            <template #icon>
              <n-icon><CloseOutline /></n-icon>
            </template>
          </n-button>
        </n-layout-header>
        <n-layout-content class="layer-manager-content">
          <div class="layer-section-heading">
            <span>已加载图层</span>
            <span class="layer-section-hint">使用菜单调整顺序</span>
          </div>
          <n-empty
            class="layer-empty"
            size="medium"
            description="暂未加载图层"
            v-show="layerCount === 0"
          />
          <!--  图层项目 layeritem 动态增减layer-item组件 -->
          <layer-item
            v-for="layer in layerStore.Layers"
            :lid="layer.lId"
            :lname="layer.lName"
            :key="layer.lId"
          ></layer-item>
        </n-layout-content>

        <n-layout-footer class="layer-manager-footer">
          <n-button
            class="add-layer-button"
            type="primary"
            :disabled="addingWmsLayer"
            @click="showWmsModal = true"
          >
            <template #icon>
              <n-icon><AddOutline /></n-icon>
            </template>
            添加 WMS 图层
          </n-button>
          <n-button
            class="clear-layer-button"
            quaternary
            type="error"
            :disabled="layerCount === 0"
            @click="clearLayers"
          >
            <template #icon>
              <n-icon><TrashOutline /></n-icon>
            </template>
            清空
          </n-button>
        </n-layout-footer>
      </n-layout>
    </n-config-provider>
    <!-- 填写WMS的模态框 -->
    <n-modal
      v-model:show="showWmsModal"
      class="wms-config-modal"
      :mask-closable="false"
      preset="dialog"
      title=""
    >
      <template #header>
        <div>WMS资源配置</div>
      </template>
      <div class="wms-config-content">
        <div class="wms-config-fields">
          <n-form
            ref="formRef"
            :model="wmsConfig"
            class="wms-config-form"
            label-placement="top"
            require-mark-placement="right-hanging"
          >
            <n-form-item label="WMS 服务地址">
              <n-input-group>
                <n-input
                  v-model:value="wmsConfig.url"
                  placeholder="https://example.com/geoserver/wms"
                  :disabled="addingWmsLayer || readingCapabilities"
                  clearable
                  @keyup.enter="readWmsCapabilities"
                />
                <n-button
                  type="info"
                  :loading="readingCapabilities"
                  :disabled="addingWmsLayer"
                  @click="readWmsCapabilities"
                >
                  读取图层
                </n-button>
              </n-input-group>
            </n-form-item>
            <n-form-item label="选择图层">
              <n-select
                v-model:value="selectedWmsLayers"
                :options="wmsLayerOptions"
                :disabled="addingWmsLayer || readingCapabilities"
                :loading="readingCapabilities"
                multiple
                filterable
                tag
                clearable
                placeholder="先读取服务图层，也可手动输入"
                max-tag-count="responsive"
                @keyup.enter="addWMSLayer"
              />
            </n-form-item>
          </n-form>
        </div>
        <div class="wms-config-hint wms-config-hint--visible">
          先读取服务目录，再选择要加载的图层；可同时选择多个图层
        </div>
        <n-space justify="end" class="wms-config-actions">
          <n-button
            @click="addWMSLayer"
            type="primary"
            :disabled="addingWmsLayer || readingCapabilities"
          >
            确认加载
          </n-button>
          <n-button
            @click="showWmsModal = false"
            secondary
            :disabled="addingWmsLayer || readingCapabilities"
          >
            取消
          </n-button>
        </n-space>
      </div>
    </n-modal>
  </div>
</template>

<style scoped>
.LayerManagerSidebar :deep(*) {
  box-sizing: border-box;
}

.wms-config-modal {
  width: min(520px, calc(100vw - 32px));
}

.wms-config-content {
  padding-top: 8px;
}

.wms-config-form {
  width: 100%;
}

.wms-config-hint {
  display: none;
  min-height: 20px;
  padding: 8px 10px;
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.6;
  color: #4b5563;
  background: #f3f4f6;
  border-left: 3px solid #42b883;
  border-radius: 4px;
}

.wms-config-hint--visible {
  display: block;
}

.wms-config-actions {
  padding-top: 16px;
  margin-top: 16px;
  border-top: 1px solid rgb(255 255 255 / 10%);
}

.LayerManagerSidebar {
  position: absolute;
  top: 3.75rem;
  left: 1rem;
  z-index: 20;
  display: flex;
  flex-direction: column;
  width: min(22.5rem, calc(100vw - 2rem));
  height: auto;
  max-height: min(38rem, calc(100vh - 5rem));
  overflow: hidden;
  color: #e7edf5;
  background: rgb(14 22 32 / 94%);
  border: 1px solid rgb(148 163 184 / 22%);
  border-radius: 14px;
  box-shadow:
    0 18px 48px rgb(0 0 0 / 35%),
    0 2px 8px rgb(0 0 0 / 18%);
  backdrop-filter: blur(18px);
  transform: translateX(calc(-100% - 1.5rem));
  transition:
    transform 0.26s ease,
    box-shadow 0.26s ease;
}

.LayerManagerSidebar.open {
  transform: translateX(0);
  box-shadow:
    0 22px 56px rgb(0 0 0 / 42%),
    0 4px 12px rgb(0 0 0 / 24%);
}

.layer-manager-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 1.05rem 1rem 0.95rem;
  background: linear-gradient(180deg, rgb(30 44 60 / 70%), rgb(14 22 32 / 20%));
  border-bottom: 1px solid rgb(148 163 184 / 14%);
}

.layer-manager-title-wrap {
  min-width: 0;
}

.layer-manager-kicker {
  display: flex;
  gap: 0.35rem;
  align-items: center;
  margin-bottom: 0.35rem;
  color: #8ca2b9;
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.layer-manager-title-row {
  display: flex;
  gap: 0.55rem;
  align-items: center;
}

.layer-manager-title-row h2 {
  margin: 0;
  color: #f8fafc;
  font-size: 1.08rem;
  font-weight: 650;
  line-height: 1.2;
}

.layer-count {
  min-width: 1.35rem;
  padding: 0.17rem 0.38rem;
  color: #b9e6ff;
  font-size: 0.7rem;
  font-weight: 700;
  text-align: center;
  background: rgb(56 189 248 / 16%);
  border: 1px solid rgb(56 189 248 / 25%);
  border-radius: 999px;
}

.layer-manager-close {
  flex: 0 0 auto;
  color: #8ca2b9;
}

.layer-manager-close:hover {
  color: #f8fafc;
  background: rgb(148 163 184 / 16%);
}

.layer-manager-content {
  flex: 0 1 auto;
  min-height: 0;
  max-height: min(28rem, calc(100vh - 13rem));
  padding: 0.9rem 0.8rem;
  overflow-y: auto;
  scrollbar-color: rgb(148 163 184 / 35%) transparent;
  scrollbar-width: thin;
}

.layer-section-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0 0.25rem 0.6rem;
  color: #cbd5e1;
  font-size: 0.76rem;
  font-weight: 650;
}

.layer-section-hint {
  color: #6f8295;
  font-size: 0.64rem;
  font-weight: 450;
  white-space: nowrap;
}

.layer-empty {
  min-height: 15rem;
  padding: 2rem 0.5rem;
  color: #8ca2b9;
  background: rgb(30 44 60 / 24%);
  border: 1px dashed rgb(148 163 184 / 18%);
  border-radius: 10px;
}

.layer-manager-footer {
  display: flex;
  gap: 0.55rem;
  align-items: center;
  padding: 0.8rem;
  background: rgb(8 14 22 / 54%);
  border-top: 1px solid rgb(148 163 184 / 14%);
}

.add-layer-button {
  flex: 1;
  font-weight: 600;
}

.clear-layer-button {
  flex: 0 0 auto;
}

@media (max-width: 480px) {
  .LayerManagerSidebar {
    top: 3.25rem;
    left: 0.6rem;
    width: calc(100vw - 1.2rem);
    max-height: calc(100vh - 4rem);
  }
}
</style>
