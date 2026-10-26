<template>
  <section class="dd-card relay-card">
    <div class="dd-card-head">
      <span class="dd-card-title">继电器回路控制器</span>
      <span
        class="dd-card-sub"
        :class="relayStatus ? 'c-green' : 'c-muted'"
        :title="`回路掩码 ${maskText}`"
      >
        {{
          relayStatus
            ? `已闭合 ${closedRelayCount}/${CONTROLLABLE_RELAY_COUNT}`
            : '等待回路状态'
        }}
      </span>
    </div>

    <div v-for="group in RELAY_GROUPS" :key="group.key" class="relay-group">
      <div class="dd-section-label">{{ group.title }}</div>
      <div
        class="relay-grid"
        :style="{
          gridTemplateColumns: `repeat(${group.columns}, minmax(0, 1fr))`,
        }"
      >
        <div
          v-for="ch in group.channels"
          :key="ch.id"
          class="relay-tile"
          :class="{
            'is-closed': isRelayClosed(ch.id),
          }"
          :title="tileTitle(ch)"
        >
          <div class="tile-name">{{ ch.tileName }}</div>
          <button
            class="tile-btn"
            type="button"
            :disabled="loadingSwitch === ch.id"
            @click="handleToggleRelay(ch.id, !isRelayClosed(ch.id))"
          >
            <template v-if="loadingSwitch === ch.id">下发中…</template>
            <template v-else>
              {{ isRelayClosed(ch.id) ? '断开' : '通电' }}
            </template>
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { usePayloadStore, type VoltageSensorData } from '@/store/payloadStore'
import { usePayloadRelayControl } from '@/composables/useDeiceDashboard'
import {
  CONTROLLABLE_RELAY_COUNT,
  RELAY_GROUPS,
  type RelayChannelDef,
} from '@/utils/deice/dashboardModel'

const payloadStore = usePayloadStore()
const {
  relayStatus,
  closedRelayCount,
  loadingSwitch,
  isRelayClosed,
  handleToggleRelay,
} = usePayloadRelayControl()

const maskText = computed(() => {
  const mask = relayStatus.value?.mask
  if (typeof mask !== 'number' || !Number.isFinite(mask)) return '—'
  return `0x${mask.toString(16).toUpperCase().padStart(4, '0')}`
})

function pad(id: number) {
  return String(id).padStart(2, '0')
}

function tileTitle(ch: RelayChannelDef): string {
  const head = `CH${pad(ch.id)} · ${ch.name}`
  if (!isRelayClosed(ch.id)) return `${head} · 断开`
  const v = voltageText(ch.voltageKey)
  return `${head} · 通电中${v ? ` · ${v}V` : ''}`
}

function voltageText(key: keyof VoltageSensorData | null): string {
  if (!key) return ''
  const v = payloadStore.currentPayload?.voltageSensor?.[key]
  return typeof v === 'number' && Number.isFinite(v) ? v.toFixed(1) : ''
}
</script>

<style scoped>
.relay-card {
  gap: 4px;
}

.relay-group {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.relay-grid {
  display: grid;
  gap: 5px;
}

.relay-tile {
  background: var(--dd-tile);
  border: 1px solid var(--dd-tile-border);
  border-radius: 6px;
  padding: 4px 7px 5px;
  display: flex;
  flex-direction: column;
  gap: 0;
  min-width: 0;
  transition:
    background 0.15s ease,
    border-color 0.15s ease;
}

.tile-name {
  font-size: 10.5px;
  line-height: 14px;
  color: var(--dd-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tile-btn {
  margin-top: 3px;
  height: 18px;
  border: none;
  border-radius: 4px;
  background: rgb(148 163 184 / 10%);
  color: var(--dd-text);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease;
}

.tile-btn:hover:not(:disabled) {
  background: rgb(148 163 184 / 18%);
}

.tile-btn:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.relay-tile.is-closed {
  background: rgb(22 101 52 / 30%);
  border-color: rgb(74 222 128 / 25%);
}

.relay-tile.is-closed .tile-name {
  color: var(--dd-green);
}

.relay-tile.is-closed .tile-btn {
  background: rgb(5 46 22 / 70%);
  color: var(--dd-green);
}

.relay-tile.is-closed .tile-btn:hover:not(:disabled) {
  background: rgb(5 46 22 / 95%);
}
</style>
