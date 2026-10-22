<template>
  <n-modal
    :show="show"
    style="width: 780px; max-width: 92vw"
    :mask-closable="false"
    preset="dialog"
    title=""
    @update:show="$emit('update:show', $event)"
  >
    <template #header>
      <div class="comms-modal-header">
        <span class="comms-modal-title">系统通信与服务设置</span>
        <n-button
          v-if="activeTab === 'links'"
          @click="$emit('addLink')"
          type="primary"
          size="small"
        >
          新增链路
        </n-button>
      </div>
    </template>

    <div class="comms-modal-content">
      <n-tabs
        v-model:value="activeTab"
        type="segment"
        size="small"
        class="comms-tabs"
      >
        <!-- 标签页 1：多通道通信链路 -->
        <n-tab-pane name="links" tab="通信链路配置">
          <!-- 上行机号：所有上行指令统一使用，随「保存配置」写入配置文件 -->
          <div class="comms-uplink-card">
            <div class="comms-uplink-card__row">
              <span class="comms-uplink-card__label">上行机号</span>
              <n-input-number
                :value="uplinkAircraftId"
                :min="0"
                :max="255"
                :precision="0"
                :show-button="false"
                size="small"
                placeholder="0~255"
                class="comms-uplink-card__input"
                data-testid="uplink-aircraft-id-input"
                @update:value="$emit('update:uplinkAircraftId', $event)"
              />
              <span class="comms-uplink-card__range">范围 0~255</span>
            </div>
            <div class="comms-uplink-card__hint">
              全部上行指令（周期帧、飞行开关、吊舱、应答机/航管/重量装订）统一使用此机号，保存配置后写入配置文件并立即生效。
            </div>
          </div>

          <div v-if="links.length === 0" class="comms-empty-state">
            暂无链路，请点击右上角“新增链路”。
          </div>

          <div v-for="link in links" :key="link.id" class="comms-link-card">
            <div class="comms-link-card__header">
              <n-input
                v-model:value="link.name"
                placeholder="链路名称"
                size="small"
                class="comms-link-name-input"
              />
              <n-select
                :value="link.kind"
                :options="linkKindOptions"
                size="small"
                style="width: 125px"
                @update:value="$emit('updateLinkKind', link, $event)"
              />
              <n-switch v-model:value="link.enabled" size="small">
                <template #checked>已启用</template>
                <template #unchecked>已停用</template>
              </n-switch>
              <n-button
                v-if="
                  link.name !== '伺服转台' && link.protocol !== 'ServoTurntable'
                "
                quaternary
                type="error"
                size="small"
                @click="$emit('removeLink', link)"
              >
                删除
              </n-button>
              <n-tag v-else size="small" type="info" :bordered="false">
                固定链路
              </n-tag>
            </div>

            <n-form
              :model="link"
              label-placement="left"
              label-width="auto"
              size="small"
              class="comms-link-form"
            >
              <n-grid :cols="24" :x-gap="12">
                <n-form-item-gi :span="12" label="协议类型">
                  <n-select
                    v-model:value="link.protocol"
                    :options="
                      link.kind === 'serial'
                        ? serialProtocolOptions
                        : udpProtocolOptions
                    "
                    placeholder="请选择协议"
                  />
                </n-form-item-gi>

                <template v-if="link.kind !== 'serial'">
                  <n-form-item-gi :span="12" label="网卡绑定">
                    <n-select
                      v-model:value="link.interfaceIp"
                      :options="interfaceOptions"
                      placeholder="请选择网卡"
                    />
                  </n-form-item-gi>
                  <n-form-item-gi :span="12" label="目标地址">
                    <n-input
                      v-model:value="link.ip"
                      placeholder="组播地址或远端 IPv4"
                    />
                  </n-form-item-gi>
                  <n-form-item-gi :span="6" label="本地端口">
                    <n-input-number
                      v-model:value="link.localPort"
                      :min="1"
                      :max="65535"
                      :show-button="false"
                      placeholder="端口"
                    />
                  </n-form-item-gi>
                  <n-form-item-gi :span="6" label="目标端口">
                    <n-input-number
                      v-model:value="link.targetPort"
                      :min="1"
                      :max="65535"
                      :show-button="false"
                      placeholder="端口"
                    />
                  </n-form-item-gi>
                </template>

                <template v-else>
                  <n-form-item-gi :span="12" label="串口号">
                    <n-select
                      v-model:value="link.portName"
                      :options="portOptions"
                      placeholder="请选择串口号"
                    />
                  </n-form-item-gi>
                  <n-form-item-gi :span="12" label="波特率">
                    <n-select
                      v-model:value="link.baudRate"
                      :options="baudRateOptions"
                      placeholder="请选择波特率"
                    />
                  </n-form-item-gi>
                </template>
              </n-grid>
            </n-form>
          </div>
        </n-tab-pane>

        <!-- 标签页 2：地图瓦片代理服务 -->
        <n-tab-pane name="tile" tab="地图瓦片代理">
          <div class="tile-config-container">
            <n-alert type="info" :bordered="false" class="tile-info-alert">
              适用场景：局域网或离线设备加载卫星影像切片。在局域网内任意联网电脑运行
              <code class="code-inline">pnpm tile-server</code>
              后，在此填入该电脑的 IP 地址与端口。请求过的切片会自动持久化缓存，
              <strong>IP 变动无需重新打包</strong>
              。
            </n-alert>

            <div class="tile-card">
              <n-form label-placement="top" size="small" class="tile-form">
                <n-form-item label="瓦片代理服务地址 (Tile Proxy URL)">
                  <n-input-group>
                    <n-input
                      :value="tileProxyUrl"
                      placeholder="例如: http://192.168.2.104:8088"
                      @update:value="$emit('update:tileProxyUrl', $event)"
                    />
                    <n-button
                      type="primary"
                      ghost
                      :loading="tileTesting"
                      @click="$emit('testTileConnection')"
                    >
                      测试连通性
                    </n-button>
                    <n-button quaternary @click="$emit('resetTileUrl')">
                      恢复默认
                    </n-button>
                  </n-input-group>
                </n-form-item>
              </n-form>

              <!-- 测试反馈结果 -->
              <div v-if="tileTestResult" class="tile-test-feedback">
                <n-alert
                  :type="tileTestResult.ok ? 'success' : 'error'"
                  :title="tileTestResult.ok ? '服务连通正常' : '连接失败'"
                  :bordered="false"
                >
                  <div class="tile-feedback-msg">
                    {{ tileTestResult.message }}
                  </div>
                  <div v-if="tileTestResult.details" class="tile-details-grid">
                    <div>
                      <span class="detail-label">服务状态:</span>
                      <span class="detail-val">
                        {{ tileTestResult.details.status }}
                      </span>
                    </div>
                    <div>
                      <span class="detail-label">命中缓存:</span>
                      <span class="detail-val">
                        {{ tileTestResult.details.hitCount }} 次
                      </span>
                    </div>
                    <div>
                      <span class="detail-label">在线下载:</span>
                      <span class="detail-val">
                        {{ tileTestResult.details.missCount }} 次
                      </span>
                    </div>
                    <div
                      v-if="tileTestResult.details.cacheRoot"
                      class="detail-full"
                    >
                      <span class="detail-label">缓存存储目录:</span>
                      <span class="detail-val">
                        {{ tileTestResult.details.cacheRoot }}
                      </span>
                    </div>
                  </div>
                </n-alert>
              </div>

              <!-- 操作指引与提示 -->
              <div class="tile-tips">
                <div class="tile-tips-title">💡 局域网配置指引：</div>
                <ol class="tile-tips-list">
                  <li>
                    <strong>单机开发调试：</strong>
                    若瓦片服务在本机运行，可填入
                    <code class="code-inline">http://127.0.0.1:8088</code>
                    。
                  </li>
                  <li>
                    <strong>局域网跨机器使用：</strong>
                    若瓦片服务在电脑 A 运行，请在电脑 A 执行
                    <code class="code-inline">ipconfig</code>
                    获取 IPv4 地址（如 192.168.2.104），并在本页面输入
                    <code class="code-inline">http://192.168.2.104:8088</code>
                    。
                  </li>
                  <li>
                    <strong>防火墙与网络：</strong>
                    请确保运行瓦片服务的电脑已在防火墙放行 8088 端口。
                  </li>
                  <li>
                    <strong>生效机制：</strong>
                    点击右下方「保存配置」后自动持久化到当前设备，切换底图至「局域网/离线缓存影像」时立即生效。
                  </li>
                </ol>
              </div>
            </div>
          </div>
        </n-tab-pane>
      </n-tabs>
    </div>

    <template #action>
      <n-space justify="space-between" align="center" style="width: 100%">
        <n-button
          secondary
          type="info"
          size="small"
          :loading="exportingDiagnostic"
          @click="handleExportDiagnostic"
        >
          导出日志
        </n-button>
        <n-space justify="end">
          <n-button size="small" @click="$emit('update:show', false)">
            取消
          </n-button>
          <n-button type="success" size="small" @click="$emit('saveConfig')">
            保存配置
          </n-button>
        </n-space>
      </n-space>
    </template>
  </n-modal>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import {
  NModal,
  NSpace,
  NButton,
  NInput,
  NInputGroup,
  NSelect,
  NForm,
  NGrid,
  NFormItemGi,
  NFormItem,
  NInputNumber,
  NSwitch,
  NTag,
  NTabs,
  NTabPane,
  NAlert,
  useMessage,
} from 'naive-ui'
import { invokeSafe } from '@/utils/ipc'
import type { LinkDraft, LinkKind } from '@/store/commsConfig'
import type { TileTestResult } from '@/utils/map/tileConfig'

const message = useMessage()
const exportingDiagnostic = ref(false)

async function handleExportDiagnostic() {
  exportingDiagnostic.value = true
  try {
    const exportPath = await invokeSafe<string>('export_diagnostic_bundle')
    message.success(`日志已成功生成导出:\n${exportPath}`, {
      duration: 6000,
    })
  } catch (err: any) {
    message.error(`导出日志失败: ${err.message || err}`)
  } finally {
    exportingDiagnostic.value = false
  }
}
import {
  baudRateOptions,
  serialProtocolOptions,
  linkKindOptions,
  udpProtocolOptions,
} from '@/composables/useCommsSettings'

const activeTab = ref<'links' | 'tile'>('links')

defineProps<{
  show: boolean
  links: LinkDraft[]
  interfaceOptions: { label: string; value: string }[]
  portOptions: { label: string; value: string }[]
  tileProxyUrl?: string
  tileTesting?: boolean
  tileTestResult?: TileTestResult | null
  defaultTileProxyUrl?: string
  uplinkAircraftId?: number | null
}>()

defineEmits<{
  (e: 'update:show', val: boolean): void
  (e: 'addLink'): void
  (e: 'updateLinkKind', link: LinkDraft, kind: LinkKind): void
  (e: 'removeLink', link: LinkDraft): void
  (e: 'saveConfig'): void
  (e: 'update:tileProxyUrl', val: string): void
  (e: 'update:uplinkAircraftId', val: number | null): void
  (e: 'testTileConnection'): void
  (e: 'resetTileUrl'): void
}>()
</script>

<style scoped>
.comms-modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  padding-right: 28px;
}

.comms-modal-title {
  font-weight: bold;
  font-size: 16px;
}

.comms-modal-content {
  margin: 0.5rem 0;
  max-height: 65vh;
  overflow-y: auto;
  padding-right: 4px;
}

.comms-tabs {
  margin-top: 4px;
}

.comms-uplink-card {
  padding: 0.6rem 0.8rem;
  margin-bottom: 0.6rem;
  border: 1px solid #2f5f8a;
  border-radius: 6px;
  background: rgba(64, 152, 252, 0.06);
}

.comms-uplink-card__row {
  display: flex;
  gap: 0.6rem;
  align-items: center;
}

.comms-uplink-card__label {
  font-weight: bold;
}

.comms-uplink-card__input {
  width: 120px;
}

.comms-uplink-card__range {
  color: #999;
  font-size: 12px;
}

.comms-uplink-card__hint {
  margin-top: 4px;
  color: #aaa;
  font-size: 12px;
  line-height: 1.5;
}

.comms-empty-state {
  padding: 1.5rem;
  color: #999;
  text-align: center;
  border: 1px dashed #555;
  border-radius: 6px;
}

.comms-link-card {
  padding: 0.6rem 0.8rem;
  margin-bottom: 0.6rem;
  border: 1px solid #3d3d3d;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.02);
}

.comms-link-card:last-child {
  margin-bottom: 0;
}

.comms-link-card__header {
  display: flex;
  gap: 0.6rem;
  align-items: center;
  margin-bottom: 0.5rem;
}

.comms-link-name-input {
  flex: 1;
}

.comms-link-form :deep(.n-form-item) {
  --n-feedback-height: 0px;
  margin-bottom: 4px;
}

.comms-link-form :deep(.n-form-item-blank) {
  min-height: auto;
}

/* 瓦片代理配置界面样式 */
.tile-config-container {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
  padding: 0.4rem 0;
}

.tile-info-alert {
  font-size: 13px;
  line-height: 1.5;
}

.code-inline {
  padding: 2px 6px;
  margin: 0 2px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  font-family: monospace;
  font-size: 12px;
}

.tile-card {
  padding: 1rem;
  border: 1px solid #3d3d3d;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.02);
}

.tile-test-feedback {
  margin-top: 0.8rem;
}

.tile-feedback-msg {
  font-size: 13px;
  margin-bottom: 6px;
}

.tile-details-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  font-size: 12px;
  background: rgba(0, 0, 0, 0.2);
  padding: 8px 12px;
  border-radius: 4px;
  margin-top: 6px;
}

.detail-full {
  grid-column: 1 / -1;
  word-break: break-all;
}

.detail-label {
  color: #aaa;
  margin-right: 6px;
}

.detail-val {
  color: #fff;
  font-weight: 500;
}

.tile-tips {
  margin-top: 1.2rem;
  padding-top: 0.8rem;
  border-top: 1px dashed #444;
  font-size: 12px;
  color: #bbb;
}

.tile-tips-title {
  font-weight: bold;
  margin-bottom: 6px;
  color: #eee;
}

.tile-tips-list {
  padding-left: 1.2rem;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
</style>
