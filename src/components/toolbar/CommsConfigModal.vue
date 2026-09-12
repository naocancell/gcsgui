<template>
  <n-modal
    :show="show"
    style="width: 760px; max-width: 92vw"
    :mask-closable="false"
    preset="dialog"
    title=""
    @update:show="$emit('update:show', $event)"
  >
    <template #header>
      <div class="comms-modal-header">
        <span class="comms-modal-title">多通道通信配置</span>
        <n-button @click="$emit('addLink')" type="primary" size="small">
          新增链路
        </n-button>
      </div>
    </template>

    <div class="comms-modal-content">
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
    </div>

    <template #action>
      <n-space justify="end">
        <n-button size="small" @click="$emit('update:show', false)">
          取消
        </n-button>
        <n-button type="success" size="small" @click="$emit('saveConfig')">
          保存配置
        </n-button>
      </n-space>
    </template>
  </n-modal>
</template>

<script setup lang="ts">
import {
  NModal,
  NSpace,
  NButton,
  NInput,
  NSelect,
  NForm,
  NGrid,
  NFormItemGi,
  NInputNumber,
  NSwitch,
  NTag,
} from 'naive-ui'
import type { LinkDraft, LinkKind } from '@/store/commsConfig'
import {
  baudRateOptions,
  serialProtocolOptions,
  linkKindOptions,
  udpProtocolOptions,
} from '@/composables/useCommsSettings'

defineProps<{
  show: boolean
  links: LinkDraft[]
  interfaceOptions: { label: string; value: string }[]
  portOptions: { label: string; value: string }[]
}>()

defineEmits<{
  (e: 'update:show', val: boolean): void
  (e: 'addLink'): void
  (e: 'updateLinkKind', link: LinkDraft, kind: LinkKind): void
  (e: 'removeLink', link: LinkDraft): void
  (e: 'saveConfig'): void
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
</style>
