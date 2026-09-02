<template>
  <n-modal
    :show="show"
    style="width: 48%; min-width: 550px"
    :mask-closable="false"
    preset="dialog"
    title=""
    @update:show="$emit('update:show', $event)"
  >
    <template #header>
      <div style="font-weight: bold; font-size: 16px">多通道通信配置</div>
    </template>
    <div
      style="margin: 1rem 1rem 0.5rem 1rem; max-height: 70vh; overflow-y: auto"
    >
      <n-space justify="end" style="margin-bottom: 0.8rem">
        <n-button @click="$emit('addLink')" type="primary" size="small">
          新增链路
        </n-button>
      </n-space>

      <div v-if="links.length === 0" class="comms-empty-state">
        暂无链路，请点击“新增链路”。
      </div>

      <div
        v-for="link in links"
        :key="link.id"
        class="comms-link-card"
      >
        <div class="comms-link-card__header">
          <n-input v-model:value="link.name" placeholder="链路名称" />
          <n-select
            :value="link.kind"
            :options="linkKindOptions"
            style="width: 140px"
            @update:value="$emit('updateLinkKind', link, $event)"
          />
          <n-button
            quaternary
            type="error"
            size="small"
            @click="$emit('removeLink', link)"
          >
            删除
          </n-button>
        </div>

        <n-form
          :model="link"
          label-placement="left"
          label-width="auto"
          size="small"
        >
          <n-form-item label="协议类型">
            <n-select
              v-model:value="link.protocol"
              :options="
                link.kind === 'serial'
                  ? serialProtocolOptions
                  : udpProtocolOptions
              "
              placeholder="请选择协议"
            />
          </n-form-item>

          <template v-if="link.kind !== 'serial'">
            <n-form-item label="目标地址">
              <n-input
                v-model:value="link.ip"
                placeholder="组播地址或远端 IPv4"
              />
            </n-form-item>
            <n-form-item label="本地监听端口">
              <n-input-number
                v-model:value="link.localPort"
                :min="1"
                :max="65535"
                :show-button="false"
              />
            </n-form-item>
            <n-form-item label="目标发送端口">
              <n-input-number
                v-model:value="link.targetPort"
                :min="1"
                :max="65535"
                :show-button="false"
              />
            </n-form-item>
            <n-form-item label="网卡绑定">
              <n-select
                v-model:value="link.interfaceIp"
                :options="interfaceOptions"
                placeholder="请选择网卡"
              />
            </n-form-item>
          </template>

          <template v-else>
            <n-form-item label="串口号">
              <n-select
                v-model:value="link.portName"
                :options="portOptions"
                placeholder="请选择串口号"
              />
            </n-form-item>
            <n-form-item label="波特率">
              <n-select
                v-model:value="link.baudRate"
                :options="baudRateOptions"
                placeholder="请选择波特率"
              />
            </n-form-item>
          </template>

          <n-form-item label="启用链路">
            <n-switch v-model:value="link.enabled" />
            <n-tag
              :type="link.enabled ? 'success' : 'default'"
              style="margin-left: 0.6rem"
            >
              {{ link.enabled ? '已启用' : '已停用' }}
            </n-tag>
          </n-form-item>
        </n-form>
      </div>
      <n-divider style="margin: 1rem 0 0.8rem 0" />
      <n-space justify="center" style="margin-bottom: 0.8rem">
        <n-button @click="$emit('saveConfig')" type="success" size="small">
          保存配置
        </n-button>
      </n-space>
    </div>
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
  NFormItem,
  NInputNumber,
  NSwitch,
  NTag,
  NDivider,
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
.comms-empty-state {
  padding: 1.5rem;
  color: #999;
  text-align: center;
  border: 1px dashed #555;
  border-radius: 6px;
}

.comms-link-card {
  padding: 0.8rem;
  margin-bottom: 0.8rem;
  border: 1px solid #3d3d3d;
  border-radius: 6px;
}

.comms-link-card__header {
  display: flex;
  gap: 0.6rem;
  align-items: center;
  margin-bottom: 0.8rem;
}

.comms-link-card__header .n-input {
  flex: 1;
}
</style>
