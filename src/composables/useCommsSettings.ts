/**
 * 文件描述：多通道通信设置 Composable (UDP/Serial)
 */
import { ref, computed } from 'vue'
import { useMessage } from 'naive-ui'
import { useUavStore } from '@/store/uavStore'
import type { LinkDraft, LinkKind } from '@/store/commsConfig'
import {
  getTileProxyUrl,
  applyTileProxyUrlIfChanged,
  testTileProxyConnection,
  isValidTileProxyUrl,
  normalizeTileUrl,
  DEFAULT_TILE_PROXY_URL,
  type TileTestResult,
} from '@/utils/map/tileConfig'

export const baudRateOptions = [
  { label: '9600', value: 9600 },
  { label: '19200', value: 19200 },
  { label: '38400', value: 38400 },
  { label: '57600', value: 57600 },
  { label: '115200', value: 115200 },
]

export const serialProtocolOptions = [
  { label: 'FP981C', value: 'FP981C' },
  { label: 'FP95', value: 'FP95' },
]

export const linkKindOptions = [
  { label: 'UDP 点播', value: 'udp-unicast' as LinkKind },
  { label: 'UDP 组播', value: 'udp-multicast' as LinkKind },
  { label: '串口', value: 'serial' as LinkKind },
]

export const udpProtocolOptions = [
  { label: 'FP981C', value: 'FP981C' },
  { label: 'FP95', value: 'FP95' },
  { label: 'UAVInfo', value: 'UAVInfo' },
  { label: '伺服转台', value: 'ServoTurntable' },
]

export function useCommsSettings() {
  const message = useMessage()
  const uavStore = useUavStore()

  const showUdpModal = ref(false)
  const tileProxyUrlInput = ref(getTileProxyUrl())
  const tileTesting = ref(false)
  const tileTestResult = ref<TileTestResult | null>(null)

  const interfaceOptions = computed(() => {
    const options = [{ label: '0.0.0.0 (默认路由网卡)', value: '0.0.0.0' }]
    uavStore.networkInterfaces.forEach((iface) => {
      if (!options.some((opt) => opt.value === iface.ip)) {
        options.push({
          label: iface.ip,
          value: iface.ip,
        })
      }
    })
    return options
  })

  const portOptions = computed(() => {
    return uavStore.availablePorts.map((port) => ({
      label: port,
      value: port,
    }))
  })

  async function openUdpSettings() {
    showUdpModal.value = true
    tileProxyUrlInput.value = getTileProxyUrl()
    tileTestResult.value = null
    try {
      await uavStore.fetchNetworkInterfaces()
      await uavStore.loadCommsConfig()
      await uavStore.startPortsMonitoring()
    } catch (err) {
      message.error('获取本地网卡或读取配置失败: ' + err)
    }
  }

  async function handleSaveConfig() {
    if (!isValidTileProxyUrl(tileProxyUrlInput.value)) {
      message.error('瓦片服务地址须以 http:// 或 https:// 开头')
      return
    }
    try {
      await uavStore.saveCommsConfig()
      applyTileProxyUrlIfChanged(tileProxyUrlInput.value)
      message.success('配置已保存并成功应用热重载！')
      showUdpModal.value = false
    } catch (err) {
      message.error('保存配置失败: ' + err)
    }
  }

  async function handleTestTileConnection() {
    if (!isValidTileProxyUrl(tileProxyUrlInput.value)) {
      message.warning('瓦片服务地址须以 http:// 或 https:// 开头')
      return
    }
    tileTesting.value = true
    tileTestResult.value = null
    try {
      const res = await testTileProxyConnection(tileProxyUrlInput.value)
      tileTestResult.value = res
      if (res.ok) {
        message.success(res.message)
      } else {
        message.error(res.message)
      }
    } finally {
      tileTesting.value = false
    }
  }

  function handleResetTileUrl() {
    tileProxyUrlInput.value = normalizeTileUrl(DEFAULT_TILE_PROXY_URL)
    tileTestResult.value = null
    message.info('已恢复为默认瓦片服务地址，点击保存配置后生效')
  }

  function addCommunicationLink() {
    uavStore.addLink('udp-multicast')
  }

  function updateCommunicationLinkKind(link: LinkDraft, kind: LinkKind) {
    uavStore.updateLinkKind(link, kind)
  }

  function removeCommunicationLink(link: LinkDraft) {
    uavStore.removeLink(link.id)
  }

  return {
    showUdpModal,
    tileProxyUrlInput,
    tileTesting,
    tileTestResult,
    defaultTileProxyUrl: DEFAULT_TILE_PROXY_URL,
    interfaceOptions,
    portOptions,
    baudRateOptions,
    serialProtocolOptions,
    linkKindOptions,
    udpProtocolOptions,
    openUdpSettings,
    handleSaveConfig,
    handleTestTileConnection,
    handleResetTileUrl,
    addCommunicationLink,
    updateCommunicationLinkKind,
    removeCommunicationLink,
  }
}
