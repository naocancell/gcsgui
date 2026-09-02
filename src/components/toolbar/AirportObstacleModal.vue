<template>
  <n-modal
    :show="show"
    preset="card"
    title="机场障碍物"
    class="airport-obstacle-modal"
    :mask-closable="!obstacleLoading"
    @update:show="$emit('update:show', $event)"
  >
    <div class="airport-obstacle-toolbar">
      <n-checkbox
        :checked="allAirportsSelected"
        :indeterminate="selectedAirportIds.length > 0 && !allAirportsSelected"
        @update:checked="toggleAllAirports"
      >
        全选
      </n-checkbox>
      <span>
        已选 {{ selectedAirportIds.length }} / {{ airportList.length }}
      </span>
    </div>
    <n-spin :show="airportListLoading">
      <n-checkbox-group v-model:value="selectedAirportIds">
        <n-scrollbar class="airport-obstacle-list">
          <div
            v-for="airport in airportList"
            :key="airport.id"
            class="airport-obstacle-row"
          >
            <n-checkbox :value="Number(airport.id)">
              <span class="airport-obstacle-name">{{ airport.name }}</span>
              <span class="airport-obstacle-code">{{ airport.code }}</span>
            </n-checkbox>
            <div class="airport-obstacle-meta">
              <span>
                {{ airport.obstacle_count ?? airport.obstacleCount ?? 0 }}
                个障碍物
              </span>
            </div>
          </div>
          <n-empty
            v-if="!airportListLoading && airportList.length === 0"
            description="没有可用机场"
          />
        </n-scrollbar>
      </n-checkbox-group>
    </n-spin>
    <template #footer>
      <n-space justify="end">
        <n-button :disabled="obstacleLoading" @click="$emit('update:show', false)">
          取消
        </n-button>
        <n-button
          type="primary"
          :loading="obstacleLoading"
          :disabled="selectedAirportIds.length === 0"
          @click="loadSelectedAirports"
        >
          加载所选机场
        </n-button>
      </n-space>
    </template>
  </n-modal>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import {
  NModal,
  NCheckbox,
  NCheckboxGroup,
  NSpin,
  NScrollbar,
  NEmpty,
  NSpace,
  NButton,
  useMessage,
} from 'naive-ui'
import { invoke } from '@tauri-apps/api/core'
import { useMarkObstacle } from '@/hooks/useMarkObstacle'

const props = defineProps<{
  show: boolean
}>()

const emit = defineEmits<{
  (e: 'update:show', val: boolean): void
  (e: 'loaded'): void
}>()

const message = useMessage()
const { loadAirports } = useMarkObstacle()

const airportListLoading = ref(false)
const obstacleLoading = ref(false)
const selectedAirportIds = ref<number[]>([])
const airportList = ref<any[]>([])

const allAirportsSelected = computed(
  () =>
    airportList.value.length > 0 &&
    selectedAirportIds.value.length === airportList.value.length,
)

async function queryAirports() {
  airportListLoading.value = true
  try {
    airportList.value = await invoke<any[]>('list_obstacle_airports')
    selectedAirportIds.value = selectedAirportIds.value.filter((id) =>
      airportList.value.some((airport) => Number(airport.id) === id),
    )
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    message.error(detail || '查询机场列表失败')
  } finally {
    airportListLoading.value = false
  }
}

function toggleAllAirports(checked: boolean) {
  selectedAirportIds.value = checked
    ? airportList.value.map((airport) => Number(airport.id))
    : []
}

async function loadSelectedAirports() {
  const selected = airportList.value.filter((airport) =>
    selectedAirportIds.value.includes(Number(airport.id)),
  )
  if (selected.length === 0) {
    message.warning('请至少选择一个机场')
    return
  }
  obstacleLoading.value = true
  try {
    const result = await loadAirports(selected)
    emit('loaded')
    emit('update:show', false)
    const updated = result.results.filter((item) => item.source === 'updated').length
    const remote = result.results.filter((item) => item.source === 'remote').length
    const stale = result.results.filter((item) => item.stale).length
    const details = [
      `${selected.length} 个机场，共 ${result.count} 个障碍物`,
      updated ? `更新 ${updated}` : '',
      remote ? `远端加载 ${remote}` : '',
      stale ? `离线使用旧缓存 ${stale}` : '',
    ].filter(Boolean)
    message.success(details.join('，'))
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    message.error(detail || '加载机场障碍物失败')
  } finally {
    obstacleLoading.value = false
  }
}

watch(
  () => props.show,
  (val) => {
    if (val) void queryAirports()
  },
)
</script>

<style scoped>
.airport-obstacle-modal {
  width: min(560px, calc(100vw - 32px));
}

.airport-obstacle-toolbar,
.airport-obstacle-row,
.airport-obstacle-meta {
  display: flex;
  align-items: center;
}

.airport-obstacle-toolbar {
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
  color: var(--n-text-color-2, #666);
  font-size: 12px;
}

.airport-obstacle-list {
  max-height: min(52vh, 420px);
  padding-right: 4px;
}

.airport-obstacle-row {
  justify-content: space-between;
  gap: 12px;
  min-height: 44px;
  padding: 7px 4px;
  border-bottom: 1px solid var(--n-divider-color, #e5e7eb);
}

.airport-obstacle-name {
  margin-right: 8px;
  color: var(--n-text-color-1, #1f2937);
}

.airport-obstacle-code {
  color: var(--n-text-color-3, #8b95a7);
  font-size: 11px;
}

.airport-obstacle-meta {
  flex-shrink: 0;
  gap: 8px;
  color: var(--n-text-color-2, #666);
  font-size: 11px;
}
</style>
