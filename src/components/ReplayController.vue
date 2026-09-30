<!--
  回放控制条：仅回放会话激活时渲染（v-if），停止即卸载，零常驻冗余。
  组成：播放/暂停 | 进度条（拖拽跳转） | 时间 | 倍速 | 停止。
-->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  PlayOutline,
  PauseOutline,
  StopOutline,
  CloseOutline,
} from '@vicons/ionicons5'
import {
  NButton,
  NIcon,
  NSlider,
  NSelect,
  NSpace,
  NText,
  NTooltip,
  useMessage,
} from 'naive-ui'
import {
  useReplayStore,
  formatReplayTime,
  formatWallTime,
} from '@/store/replayStore'

const store = useReplayStore()
const message = useMessage()

/** 拖拽与跳转中的本地锁定进度（未完成 seek 与稳定前不回显后端旧 position，杜绝乱跳与回弹） */
const dragging = ref(false)
const dragPosition = ref(0)
const seeking = ref(false)
let seekLockTimer: ReturnType<typeof setTimeout> | null = null
let clickDebounceTimer: ReturnType<typeof setTimeout> | null = null

const position = computed(() =>
  dragging.value || seeking.value
    ? dragPosition.value
    : (store.replayStatus?.positionNs ?? 0),
)
const duration = computed(() => store.replayStatus?.durationNs ?? 0)
const timeText = computed(
  () =>
    `${formatReplayTime(position.value)} / ${formatReplayTime(duration.value)}`,
)
const fileName = computed(() => store.replayStatus?.fileName ?? '')
const finished = computed(() => store.isFinished)
const startWallMs = computed(() => store.replayStatus?.startWallMs)

/** 进度条悬浮 Tooltip 格式化：显示当时的实际录制时间（YYYY-MM-DD HH:mm:ss） */
function formatSliderTooltip(val: number): string {
  if (startWallMs.value && startWallMs.value > 0) {
    const wallStr = formatWallTime(startWallMs.value, val)
    return `${wallStr} (${formatReplayTime(val)})`
  }
  return formatReplayTime(val)
}

/** 进度百分比字符串（0.0% ~ 100.0%） */
const percentText = computed(() => {
  const dur = duration.value
  if (!dur || dur <= 0) return '0.0%'
  const pct = Math.min(100, Math.max(0, (position.value / dur) * 100))
  return `${pct.toFixed(1)}%`
})

/** 当前播放点对应的实际录制时间 */
const currentWallTimeText = computed(() => {
  if (startWallMs.value && startWallMs.value > 0) {
    return formatWallTime(startWallMs.value, position.value)
  }
  return ''
})

const speedOptions = [
  { label: '0.5×', value: 0.5 },
  { label: '1×', value: 1 },
  { label: '2×', value: 2 },
  { label: '4×', value: 4 },
  { label: '8×', value: 8 },
  { label: 'MAX', value: 0 },
]

const currentSpeed = computed(() => store.replayStatus?.speed ?? 1)

function handleDragStart() {
  if (clickDebounceTimer) {
    clearTimeout(clickDebounceTimer)
    clickDebounceTimer = null
  }
  dragging.value = true
  dragPosition.value = store.replayStatus?.positionNs ?? 0
}

function handleDragUpdate(value: number) {
  dragPosition.value = value
  // 若用户单纯点击轨道（未触发拖拽），通过防抖提交跳转，保证点击也能顺畅跳转
  if (!dragging.value) {
    if (clickDebounceTimer) clearTimeout(clickDebounceTimer)
    clickDebounceTimer = setTimeout(() => {
      clickDebounceTimer = null
      commitSeek(value)
    }, 60)
  }
}

async function commitSeek(target: number) {
  if (clickDebounceTimer) {
    clearTimeout(clickDebounceTimer)
    clickDebounceTimer = null
  }
  dragPosition.value = target
  seeking.value = true
  if (seekLockTimer) clearTimeout(seekLockTimer)

  try {
    await store.seek(target)
  } catch (e) {
    message.error(String(e))
  } finally {
    dragging.value = false
    // 锁定 250ms，跨过后端 100ms emitter 首个同步周期，平滑过渡无抖动
    seekLockTimer = setTimeout(() => {
      seeking.value = false
      seekLockTimer = null
    }, 250)
  }
}

async function handleDragEnd() {
  await commitSeek(dragPosition.value)
}

async function togglePlay() {
  try {
    if (finished.value) {
      // 播完后点击播放：从头开始重放
      await store.seek(0)
      return
    }
    if (store.isPaused) await store.resume()
    else await store.pause()
  } catch (e) {
    message.error(String(e))
  }
}

async function changeSpeed(value: number) {
  try {
    await store.setSpeed(value)
  } catch (e) {
    message.error(String(e))
  }
}

async function handleStop() {
  try {
    await store.stop()
  } catch (e) {
    message.error(String(e))
  }
}

/** 播完自动提示一次 */
watch(finished, (done) => {
  if (done) message.info('回放已播完，可拖动进度条重看或关闭')
})
</script>

<template>
  <div v-if="store.sessionActive" class="replay-controller">
    <n-space align="center" :wrap="false" :size="10">
      <n-tooltip trigger="hover">
        <template #trigger>
          <n-button
            quaternary
            circle
            size="small"
            :aria-label="finished ? '重新播放' : '播放/暂停'"
            @click="togglePlay"
          >
            <template #icon>
              <n-icon size="18">
                <PauseOutline v-if="!store.isPaused && !finished" />
                <PlayOutline v-else />
              </n-icon>
            </template>
          </n-button>
        </template>
        {{ finished ? '从头重新播放' : store.isPaused ? '继续播放' : '暂停' }}
      </n-tooltip>

      <div class="progress-wrap">
        <n-slider
          :value="position"
          :max="Math.max(duration, 1)"
          :min="0"
          :step="1_000_000"
          :format-tooltip="formatSliderTooltip"
          @dragstart="handleDragStart"
          @update:value="handleDragUpdate"
          @dragend="handleDragEnd"
        />
        <div class="progress-meta">
          <span v-if="currentWallTimeText" class="progress-wall-time">
            录制时刻: {{ currentWallTimeText }}
          </span>
          <span class="progress-percent">
            {{ percentText }}
          </span>
        </div>
      </div>

      <n-text class="time-text" depth="2">{{ timeText }}</n-text>

      <n-select
        class="speed-select"
        :value="currentSpeed"
        :options="speedOptions"
        :consistent-menu-width="false"
        size="tiny"
        @update:value="changeSpeed"
      />

      <n-tooltip trigger="hover">
        <template #trigger>
          <n-button
            quaternary
            circle
            size="small"
            aria-label="停止回放"
            @click="handleStop"
          >
            <template #icon>
              <n-icon size="16">
                <StopOutline />
              </n-icon>
            </template>
          </n-button>
        </template>
        停止回放
      </n-tooltip>

      <n-text class="file-text" depth="3" :title="fileName">
        {{ finished ? '已播完' : '回放中' }} · {{ fileName }}
      </n-text>

      <n-tooltip trigger="hover">
        <template #trigger>
          <n-button
            quaternary
            circle
            size="small"
            aria-label="关闭回放"
            @click="handleStop"
          >
            <template #icon>
              <n-icon size="16">
                <CloseOutline />
              </n-icon>
            </template>
          </n-button>
        </template>
        关闭回放
      </n-tooltip>
    </n-space>
  </div>
</template>

<style scoped>
.replay-controller {
  position: absolute;
  left: 50%;
  bottom: 2.4rem;
  transform: translateX(-50%);
  padding: 0.35rem 0.8rem;
  border-radius: 0.5rem;
  background: rgb(24 29 39 / 88%);
  backdrop-filter: blur(6px);
  box-shadow: 0 2px 12px rgb(0 0 0 / 35%);
  z-index: 20;
}

.progress-wrap {
  width: 26rem;
  display: flex;
  flex-direction: column;
}

.progress-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.68rem;
  line-height: 1;
  margin-top: 0.15rem;
  color: #94a3b8;
  font-family: 'Consolas', monospace;
}

.progress-wall-time {
  opacity: 0.85;
}

.progress-percent {
  font-weight: 600;
  color: #38bdf8;
  margin-left: auto;
}

.time-text {
  font-family: 'Consolas', monospace;
  font-size: 0.75rem;
  white-space: nowrap;
}

.speed-select {
  width: 4.2rem;
}

.file-text {
  font-size: 0.72rem;
  max-width: 14rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
