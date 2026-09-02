<template>
  <div class="route-tab-panel">
    <div class="route-detail-panel">
      <!-- 固定表头 -->
      <div class="waypoint-header-row">
        <span class="col-seq">序号</span>
        <span class="col-lon">经度(°)</span>
        <span class="col-lat">纬度(°)</span>
        <span class="col-alt">高度(m)</span>
      </div>

      <n-scrollbar class="route-tab-scrollbar">
        <div v-if="selectedRoute.points && selectedRoute.points.length > 0 && showPtList" class="waypoint-list">
          <div
            v-for="(pt, index) in selectedRoute.points"
            :key="`${selectedRoute.unicode}-${index}`"
            class="waypoint-data-row"
          >
            <div class="col-seq">
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
                  size="tiny"
                  class="seq-btn"
                >
                  {{ pt.nPt }}
                </n-button>
              </n-dropdown>
            </div>

            <div class="col-lon">
              <n-input-number
                size="tiny"
                v-model:value="pt.lon"
                :show-button="false"
                placeholder="经度"
                :max="180"
                :min="-180"
                @update:value="$emit('pointChanged')"
              />
            </div>

            <div class="col-lat">
              <n-input-number
                size="tiny"
                v-model:value="pt.lat"
                :show-button="false"
                placeholder="纬度"
                :max="90"
                :min="-90"
                @update:value="$emit('pointChanged')"
              />
            </div>

            <div class="col-alt">
              <n-input-number
                size="tiny"
                v-model:value="pt.alt"
                :show-button="false"
                placeholder="高度"
                :max="12000"
                :min="-500"
                @update:value="$emit('pointChanged')"
              />
            </div>
          </div>
        </div>

        <div v-else class="empty-wrap">
          <n-empty description="暂无航点数据" style="margin-top: 2rem;" />
        </div>
      </n-scrollbar>

      <n-space justify="center" class="action-footer">
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
    </div>
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
  display: flex;
  flex-direction: column;
}

.route-detail-panel {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 0 4px;
}

.waypoint-header-row {
  display: flex;
  align-items: center;
  padding: 6px 4px;
  font-size: 12px;
  font-weight: bold;
  color: var(--n-text-color-2, #aaa);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.waypoint-data-row {
  display: flex;
  align-items: center;
  padding: 4px 2px;
  gap: 4px;
}

.col-seq {
  width: 42px;
  flex-shrink: 0;
  text-align: center;
}

.seq-btn {
  width: 32px;
}

.col-lon,
.col-lat {
  flex: 1;
  min-width: 82px;
}

.col-alt {
  width: 74px;
  flex-shrink: 0;
}

.route-tab-scrollbar {
  flex: 1;
  min-height: 0;
}

.empty-wrap {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100%;
}

.action-footer {
  padding: 8px 0;
  flex-shrink: 0;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}
</style>
