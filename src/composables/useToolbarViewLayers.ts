/**
 * 文件描述：工具条视图设置 (经纬网/行政区) 与禁飞区图层管理 Composable
 */
import { ref, computed } from 'vue'
import { useViewSettingsStore, type AdministrativeLevel } from '@/store/viewSettingsStore'
import NFZViewer from '@/core/gis/NFZViewer'
import { toggleAdministrativeBoundary } from '@/utils/map/viewSettings'
import { setGraticuleVisible } from '@/utils/map/graticule'

export function useToolbarViewLayers(message: {
  warning: (msg: string) => void
  error: (msg: string) => void
}) {
  const viewSettingsStore = useViewSettingsStore()

  // 1. 视图设置 (经纬网与行政边界)
  const viewSettingsLoading = ref(false)
  const viewSettingsOptions = computed(() => [
    { label: viewSettingsStore.showCoordinates ? '隐藏经纬网' : '显示经纬网', key: 'coordinates' },
    { label: viewSettingsStore.showProvince ? '隐藏省级行政区' : '显示省级行政区', key: 'province' },
    { label: viewSettingsStore.showCity ? '隐藏市级行政区' : '显示市级行政区', key: 'city' },
    { label: viewSettingsStore.showCounty ? '隐藏县级行政区' : '显示县级行政区', key: 'county' },
  ])
  const viewSettingsActive = computed(
    () =>
      viewSettingsStore.showCoordinates ||
      viewSettingsStore.showProvince ||
      viewSettingsStore.showCity ||
      viewSettingsStore.showCounty,
  )

  async function handleViewSettingsSelect(key: string | number) {
    if (key === 'coordinates') {
      viewSettingsStore.showCoordinates = !viewSettingsStore.showCoordinates
      if (window.viewer) setGraticuleVisible(window.viewer, viewSettingsStore.showCoordinates)
      return
    }
    if (viewSettingsLoading.value || !['province', 'city', 'county'].includes(String(key))) return
    if (!window.viewer) return message.warning('地图尚未初始化')
    viewSettingsLoading.value = true
    try {
      const v = await toggleAdministrativeBoundary(window.viewer, key as AdministrativeLevel)
      if (key === 'province') viewSettingsStore.showProvince = v
      if (key === 'city') viewSettingsStore.showCity = v
      if (key === 'county') viewSettingsStore.showCounty = v
    } catch (err: any) {
      message.error(`行政区边界加载失败：${err?.message || err}`)
    } finally {
      viewSettingsLoading.value = false
    }
  }

  // 2. 禁飞区 (NFZ)
  let nfzViewer: any = null
  const showNFZ = ref(false)
  const nfzLoading = ref(false)
  const nfzOptions = [
    { label: '同步最新禁飞区', key: 'sync' },
    { label: '加载本地禁飞区', key: 'local' },
  ]

  async function handleNFZSelect(key: string | number) {
    if (!window.viewer || nfzLoading.value) return
    if (!nfzViewer) nfzViewer = new NFZViewer(window.viewer)
    const source = key === 'local' ? 'local' : 'sync'
    nfzLoading.value = true
    try {
      await nfzViewer.toggleNFZ(true, source)
      showNFZ.value = true
    } catch (err: any) {
      message.error(
        err?.message || (source === 'local' ? '请先获取禁飞区数据' : '同步禁飞区失败'),
      )
    } finally {
      nfzLoading.value = false
    }
  }

  async function hideNFZ() {
    if (!nfzViewer || !showNFZ.value || nfzLoading.value) return
    nfzLoading.value = true
    try {
      await nfzViewer.toggleNFZ(false)
      showNFZ.value = false
    } catch (err: any) {
      message.error(err?.message || '隐藏禁飞区失败')
    } finally {
      nfzLoading.value = false
    }
  }

  return {
    viewSettingsLoading,
    viewSettingsOptions,
    viewSettingsActive,
    handleViewSettingsSelect,
    showNFZ,
    nfzLoading,
    nfzOptions,
    handleNFZSelect,
    hideNFZ,
  }
}
