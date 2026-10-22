<!--
  记录/回放入口：地图右侧悬浮。
  自动记录态显示只读录制脉冲与路数；点击回放按钮弹出文件选择并进入回放。
  去除手动记录与暂停控制，全自动感应录制。
  悬停提示同时列出按链路的原始记录与按飞机号的校验记录（validated 子目录）。
-->
<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { NTooltip, NIcon, useMessage } from 'naive-ui'
import { PlayBackOutline } from '@vicons/ionicons5'
import { useReplayStore, type AircraftRecordStatus } from '@/store/replayStore'

const store = useReplayStore()
const message = useMessage()

/** 指示器文字：原始记录路数，有校验记录时追加飞机数 */
const indicatorLabel = computed(() => {
  const aircraftCount = store.recordingAircraft.length
  const links = `${store.activeRecordingsCount}路`
  return aircraftCount > 0 ? `${links}·${aircraftCount}机` : links
})

function aircraftLabel(item: AircraftRecordStatus): string {
  const sources = item.sources.length ? ` · ${item.sources.join(' / ')}` : ''
  return `${item.uavId} 号机${sources}`
}

async function handleReplayClick() {
  if (store.sessionActive && !store.isFinished) {
    message.info('当前正在回放中，可先在底部控制条暂停或关闭')
    return
  }
  try {
    const started = await store.startReplayFromFile(1)
    if (started) message.success('回放已开始')
  } catch (e) {
    message.error(String(e))
  }
}

onMounted(async () => {
  await store.ensureListeners()
})
</script>

<template>
  <div class="recorder-entry">
    <!-- 自动记录状态指示器（只读展示，通信开始后自动感应） -->
    <n-tooltip v-if="store.isRecording" placement="left" trigger="hover">
      <template #trigger>
        <div class="entry-indicator is-recording" aria-label="正在自动记录链路数据">
          <span class="rec-dot" />
          <span class="rec-label">{{ indicatorLabel }}</span>
        </div>
      </template>
      <div class="rec-tooltip-content">
        <div class="rec-tooltip-title">
          正在自动记录原始链路数据（共 {{ store.activeRecordingsCount }} 条）：
        </div>
        <div
          v-for="link in store.recordingLinks"
          :key="link.file"
          class="rec-file-item"
        >
          <span class="rec-link-name">[{{ link.protocol }}] {{ link.linkName }}</span>
          <span class="rec-file-name">{{ link.fileName }}</span>
        </div>
        <template v-if="store.recordingAircraft.length">
          <div class="rec-tooltip-title rec-tooltip-subtitle">
            按飞机号记录校验数据（共 {{ store.recordingAircraft.length }} 架）：
          </div>
          <div
            v-for="item in store.recordingAircraft"
            :key="item.file"
            class="rec-file-item"
          >
            <span class="rec-link-name">{{ aircraftLabel(item) }}</span>
            <span class="rec-file-name">{{ item.fileName }}</span>
          </div>
        </template>
      </div>
    </n-tooltip>

    <!-- 回放入口按钮 -->
    <n-tooltip placement="left" trigger="hover">
      <template #trigger>
        <button
          type="button"
          class="entry-btn"
          aria-label="回放记录文件"
          @click="handleReplayClick"
        >
          <n-icon size="18">
            <PlayBackOutline />
          </n-icon>
        </button>
      </template>
      回放 dat 记录文件（原始记录或 validated 目录下的校验记录）
    </n-tooltip>
  </div>
</template>

<style scoped>
.recorder-entry {
  position: absolute;
  right: 1.8rem;
  bottom: 8rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  z-index: 10;
}

.entry-btn {
  position: relative;
  width: 2.25rem;
  height: 2.25rem;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  border-radius: 0.45rem;
  background: rgb(30 36 48 / 85%);
  color: #d5dae3;
  cursor: pointer;
  backdrop-filter: blur(4px);
  transition: background 0.15s ease;
}

.entry-btn:hover {
  background: rgb(48 58 78 / 90%);
}

.entry-indicator {
  position: relative;
  width: auto;
  min-width: 3.8rem;
  height: 1.8rem;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  padding: 0 0.5rem;
  border-radius: 0.45rem;
  background: rgb(30 36 48 / 90%);
  color: #ff6b6b;
  font-size: 0.75rem;
  user-select: none;
  backdrop-filter: blur(4px);
  border: 1px solid rgb(255 77 79 / 35%);
}

.rec-dot {
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 50%;
  background: #ff4d4f;
  animation: rec-blink 1.2s ease-in-out infinite;
}

.rec-label {
  font-family: 'Consolas', monospace;
  font-weight: 600;
  color: #ff8585;
}

.rec-tooltip-content {
  max-width: 340px;
  font-size: 0.78rem;
  line-height: 1.4;
}

.rec-tooltip-title {
  font-weight: 600;
  margin-bottom: 0.3rem;
  color: #ff9c9c;
}

.rec-tooltip-subtitle {
  margin-top: 0.5rem;
}

.rec-file-item {
  display: flex;
  flex-direction: column;
  padding: 0.2rem 0;
  border-bottom: 1px solid rgb(255 255 255 / 10%);
}

.rec-file-item:last-child {
  border-bottom: none;
}

.rec-link-name {
  color: #93c5fd;
  font-weight: 500;
}

.rec-file-name {
  color: #9ca3af;
  font-family: 'Consolas', monospace;
  font-size: 0.72rem;
  word-break: break-all;
}

@keyframes rec-blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.25;
  }
}
</style>
