<template>
  <div class="route-tab-panel">
    <n-flex vertical class="route-detail-panel">
      <n-space justify="space-around" style="margin-top: 0.5rem">
        <n-ellipsis style="width: 2rem; margin-left: 0.2rem">序号</n-ellipsis>
        <n-ellipsis style="width: 5.5rem">经度</n-ellipsis>
        <n-ellipsis style="width: 5.5rem">纬度</n-ellipsis>
        <n-ellipsis style="width: 3rem">高度</n-ellipsis>
      </n-space>

      <n-scrollbar class="route-tab-scrollbar">
        <div v-if="selectedRoute.points && selectedRoute.points.length > 0 && showPtList">
          <n-space
            v-for="(pt, index) in selectedRoute.points"
            :key="`${selectedRoute.unicode}-${index}`"
            justify="space-around"
            style="margin: 0.2rem 0"
          >
            <n-dropdown
              trigger="hover"
              size="small"
              placement="top-start"
              :show-arrow="true"
              :disabled="isDrawing"
              :options="PtOptions"
              @select="$emit('ptSelect', $event, index)"
            >
              <n-button
                secondary
                type="info"
                size="small"
                style="width: 1.7rem; margin-left: 0.2rem"
              >
                {{ pt.nPt }}
              </n-button>
            </n-dropdown>

            <n-input-number
              size="small"
              v-model:value="pt.lon"
              :show-button="false"
              style="width: 6rem"
              placeholder="经度"
              :max="180"
              :min="-180"
              @update:value="$emit('pointChanged')"
            ></n-input-number>

            <n-input-number
              size="small"
              v-model:value="pt.lat"
              :show-button="false"
              style="width: 6rem"
              placeholder="纬度"
              :max="90"
              :min="-90"
              @update:value="$emit('pointChanged')"
            ></n-input-number>

            <n-input-number
              size="small"
              v-model:value="pt.alt"
              :show-button="false"
              style="width: 6rem"
              placeholder="高度"
              :max="12000"
              :min="-500"
              @update:value="$emit('pointChanged')"
            ></n-input-number>
          </n-space>
        </div>

        <n-space v-else justify="space-around">
          <n-empty style="margin-top: 3rem" description="无内容"></n-empty>
        </n-space>
      </n-scrollbar>

      <n-space justify="center" style="margin: 0.5rem 0">
        <n-button
          type="warning"
          size="small"
          :disabled="!canEdit"
          @click="$emit('startEdit')"
        >
          开始编辑
        </n-button>

        <n-button
          type="info"
          size="small"
          :disabled="!hasSelectedRoute"
          @click="$emit('saveEdit')"
        >
          <template #icon>
            <SaveOutline />
          </template>
          保存编辑
        </n-button>

        <n-button
          size="small"
          :disabled="!isEditing"
          @click="$emit('cancelEdit')"
        >
          取消编辑
        </n-button>
      </n-space>
    </n-flex>
  </div>
</template>

<script setup lang="ts">
import {
  NFlex,
  NSpace,
  NEllipsis,
  NScrollbar,
  NDropdown,
  NButton,
  NInputNumber,
  NEmpty,
} from 'naive-ui'
import { SaveOutline } from '@vicons/ionicons5'
import type { Airline } from '@/types/entityoptions'
import { PtOptions } from '@/composables/useRouteEditor'

defineProps<{
  selectedRoute: Airline
  showPtList: boolean
  isDrawing: boolean
  isEditing: boolean
  canEdit: boolean
  hasSelectedRoute: boolean
}>()

defineEmits<{
  (e: 'ptSelect', key: any, index: number): void
  (e: 'pointChanged'): void
  (e: 'startEdit'): void
  (e: 'saveEdit'): void
  (e: 'cancelEdit'): void
}>()
</script>

<style scoped>
.route-tab-panel {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.route-detail-panel {
  height: 100%;
  min-height: 0;
}

.route-tab-scrollbar {
  height: 100%;
}
</style>
