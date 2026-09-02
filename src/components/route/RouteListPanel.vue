<template>
  <n-flex vertical class="route-overview">
    <n-ellipsis><h3>航线列表</h3></n-ellipsis>

    <n-radio-group
      class="route-list-group"
      :value="selectedRouteCode"
      name="radiogroup"
      @update:value="$emit('selectRoute', $event)"
    >
      <n-scrollbar class="route-list-scrollbar">
        <n-space vertical>
          <n-space
            v-for="r in routesList"
            :key="r.value"
            justify="space-between"
            style="
              margin-right: 1rem;
              border-bottom: #383737 1px solid;
            "
            @click="$emit('flyToRoute', r.value)"
          >
            <n-space align="center" :wrap="false" :size="4">
              <n-button
                data-route-visibility-toggle="true"
                quaternary
                circle
                size="tiny"
                :type="r.visible ? 'success' : 'default'"
                :aria-label="r.visible ? '隐藏航线' : '显示航线'"
                style="width: 1.5rem; height: 1.5rem"
                @click.stop="$emit('toggleVisibility', r.value)"
              >
                <template #icon>
                  <n-icon>
                    <EyeOutline v-if="r.visible" />
                    <EyeOffOutline v-else />
                  </n-icon>
                </template>
              </n-button>

              <n-radio
                :key="r.value"
                :value="r.value"
                :disabled="!r.visible"
              >
                {{ r.label }}
              </n-radio>
            </n-space>

            <n-button-group>
              <n-button
                secondary
                size="small"
                type="info"
                style="height: 1.3rem"
                @click.stop="$emit('sendToQt', r.value)"
              >
                下发
              </n-button>

              <n-button
                secondary
                size="small"
                type="error"
                style="height: 1.3rem; margin-bottom: 4px"
                @click.stop="$emit('deleteRoute', r.value)"
              >
                删除
              </n-button>
            </n-button-group>
          </n-space>
        </n-space>
      </n-scrollbar>
    </n-radio-group>

    <n-divider style="margin: 0.2rem -0.5rem"></n-divider>

    <n-space vertical style="margin: 0.2rem 0.5rem">
      <n-space>
        <n-ellipsis style="width: 4rem">航线名称</n-ellipsis>
        <n-input
          size="small"
          style="width: 10rem"
          :value="selectedRoute.name"
          :disabled="!hasSelectedRoute"
          @update:value="onNameChange"
        ></n-input>
      </n-space>

      <n-space>
        <n-space>
          <n-ellipsis>开闭</n-ellipsis>
          <n-switch
            :value="selectedRoute.isClose"
            size="small"
            :disabled="!hasSelectedRoute"
            @update:value="$emit('closeChanged', $event)"
          >
            <template #checked>闭</template>
            <template #unchecked>开</template>
          </n-switch>
        </n-space>

        <n-space style="margin-left: 0.5rem">
          <n-ellipsis>航点数</n-ellipsis>
          <n-input-number
            :show-button="false"
            disabled
            size="small"
            style="width: 5rem"
            :value="selectedRoute.PtNum"
          ></n-input-number>
        </n-space>
      </n-space>

      <n-space>
        <n-ellipsis style="width: 4rem">航线类型</n-ellipsis>
        <n-select
          style="width: 10rem"
          size="small"
          :value="selectedRoute.code"
          :options="routeCode"
          :disabled="!hasSelectedRoute"
          @update:value="onCodeChange"
        />
      </n-space>
    </n-space>
  </n-flex>
</template>

<script setup lang="ts">
import {
  NFlex,
  NEllipsis,
  NRadioGroup,
  NRadio,
  NScrollbar,
  NSpace,
  NButton,
  NButtonGroup,
  NIcon,
  NDivider,
  NInput,
  NSwitch,
  NInputNumber,
  NSelect,
} from 'naive-ui'
import { EyeOutline, EyeOffOutline } from '@vicons/ionicons5'
import type { Airline } from '@/types/entityoptions'
import { routeCode } from '@/composables/useRouteEditor'

const props = defineProps<{
  routesList: { value: string | number; label: string; visible: boolean }[]
  selectedRouteCode: string | number | null
  selectedRoute: Airline
  hasSelectedRoute: boolean
}>()

const emit = defineEmits<{
  (e: 'selectRoute', val: string | number): void
  (e: 'flyToRoute', val: string | number): void
  (e: 'toggleVisibility', val: string | number): void
  (e: 'sendToQt', val: string | number): void
  (e: 'deleteRoute', val: string | number): void
  (e: 'metaChanged'): void
  (e: 'closeChanged', val: boolean): void
}>()

function onNameChange(val: string) {
  props.selectedRoute.name = val
  emit('metaChanged')
}

function onCodeChange(val: any) {
  props.selectedRoute.code = val
  emit('metaChanged')
}
</script>

<style scoped>
.route-overview {
  flex: 0 1 42%;
  min-height: 0;
  margin: 0.5rem 1rem 0;
  overflow: hidden;
}

.route-overview h3 {
  margin: 0.5rem 0;
}

.route-list-group {
  display: block;
  flex: 1;
  min-height: 0;
}

.route-list-scrollbar {
  height: 100%;
}
</style>
