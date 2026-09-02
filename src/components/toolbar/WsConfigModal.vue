<!--
  文件描述：WebSocket 通信配置弹窗子组件 (WsConfigModal)
-->
<script setup lang="ts">
import { NModal, NSpace, NForm, NFormItem, NInput, NInputNumber, NButton } from 'naive-ui'
import { useStaticStore } from '@/store/staticStore'

const show = defineModel<boolean>('show', { default: false })
const emit = defineEmits<{
  (e: 'connect'): void
  (e: 'close'): void
}>()

const store = useStaticStore()
</script>

<template>
  <n-modal v-model:show="show" style="width: 30%" :mask-closable="false" preset="dialog" title="">
    <template #header>
      <div>WebSocket配置</div>
    </template>
    <div style="margin: 2rem 2rem 0.5rem 1rem">
      <n-space>
        <n-form :model="store.webskt.ws_config" label-placement="left" label-width="auto">
          <n-form-item label="服务器地址">
            <n-input v-model:value="store.webskt.ws_config.address" placeholder="127.0.0.1" />
          </n-form-item>
          <n-form-item label="端口号">
            <n-input-number v-model:value="store.webskt.ws_config.port" placeholder="8000" />
          </n-form-item>
        </n-form>
      </n-space>
      <n-space justify="center">
        <n-button @click="emit('connect')" type="primary" size="small">开启通信</n-button>
        <n-button @click="emit('close')" type="warning" size="small">关闭通信</n-button>
      </n-space>
    </div>
  </n-modal>
</template>
