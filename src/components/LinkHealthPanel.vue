<template>
  <div class="avionics-panel" :style="panelStyle" @mousedown="startDrag">
    <n-config-provider :abstract="true" :theme="darkTheme" :theme-overrides="naiveThemeOverrides">
      <!-- Header -->
      <div class="panel-header" :data-tauri-drag-region="props.standalone ? '' : undefined">
        <div class="title" :data-tauri-drag-region="props.standalone ? '' : undefined">
          <span :data-tauri-drag-region="props.standalone ? '' : undefined">LINK HEALTH</span>
          <span class="sub-title" :data-tauri-drag-region="props.standalone ? '' : undefined">链路状态</span>
        </div>
        <div class="header-meta">
          <div v-if="props.standalone" class="window-controls" @mousedown.stop>
            <button class="window-control" type="button" aria-label="最小化窗口" title="最小化" @click="emit('minimize')">
              <svg aria-hidden="true" viewBox="0 0 12 12"><path d="M2 8.5h8" /></svg>
            </button>
            <button class="window-control window-control-close" type="button" aria-label="关闭窗口" title="关闭" @click="emit('close')">
              <svg aria-hidden="true" viewBox="0 0 12 12"><path d="m2.5 2.5 7 7m0-7-7 7" /></svg>
            </button>
          </div>
        </div>
      </div>

      <!-- Main Body -->
      <div class="panel-body">
        <!-- Aircraft Overall Connectivity -->
        <section class="transponder-section" @mousedown.stop v-if="uavStore.rxHealth.aircraft.length > 0">
          <div class="section-header-title">
            <span>飞行器连接状态</span>
            <span class="section-sub">AIRCRAFT CONNECTIVITY</span>
          </div>
          <div class="transponder-layout" style="display: block;">
            <div class="setting-row" v-for="(ac, idx) in uavStore.rxHealth.aircraft" :key="idx">
              <span class="label-text">UAV {{ ac.uavId }} ({{ ac.protocol }})</span>
              <div class="setting-control" style="justify-content: flex-start; margin-left: 20px;">
                <div class="status" :class="{
                  'online': ac.state === 'online',
                  'recovering': ac.state === 'recovering' || ac.state === 'degraded',
                  'offline': ac.state === 'offline'
                }">
                  <span class="status-dot"></span>
                  <span>{{ ac.state.toUpperCase() }}</span>
                </div>
                <output class="readback-value" style="margin-left: 20px;">
                  更新: {{ ac.state === 'offline' ? '-' : ac.freshAgeMs + ' ms' }} | 链路缺失: {{ ac.allLinksMissing }}
                </output>
              </div>
            </div>
          </div>
        </section>

        <!-- Links Detail -->
        <section class="transponder-section" @mousedown.stop>
          <div class="section-header-title">
            <span>通信链路详情</span>
            <span class="section-sub">COMMUNICATION LINKS</span>
          </div>
          <div v-if="uavStore.rxHealth.links.length === 0" style="color: var(--text-tertiary); font-size: 12px; padding: 10px;">
            暂无链路数据
          </div>
          <div class="links-layout" v-else>
            <div class="link-card" v-for="(link, idx) in uavStore.rxHealth.links" :key="idx">
              <div class="column-heading" style="border-bottom: 1px solid var(--border-light); padding-bottom: 8px; margin-bottom: 8px;">
                <div>
                  <h3>{{ link.linkName }}</h3>
                  <p>协议: {{ link.protocol }} | UAV ID: {{ link.uavId }}</p>
                </div>
                <div class="status" :class="{
                  'online': link.state === 'healthy',
                  'recovering': link.state === 'suspect' || link.state === 'recovering',
                  'offline': link.state === 'down'
                }">
                  <span class="status-dot"></span>
                  <span>{{ link.state.toUpperCase() }}</span>
                </div>
              </div>
              
              <div class="link-metrics">
                <div class="metric-item">
                  <span class="metric-label">时效 (Fresh/Valid)</span>
                  <span class="metric-value" v-if="link.state === 'down'">-</span>
                  <span class="metric-value" v-else>{{ link.freshAgeMs }} / {{ link.validAgeMs }} ms</span>
                </div>
                <div class="metric-item">
                  <span class="metric-label">延迟 (Relative/EWMA)</span>
                  <span class="metric-value">{{ formatMs(link.relativeDelayMs) }} / {{ formatMs(link.delayEwmaMs) }} ms</span>
                </div>
                <div class="metric-item">
                  <span class="metric-label">抖动 (Jitter)</span>
                  <span class="metric-value">{{ formatMs(link.jitterEwmaMs) }} ms</span>
                </div>
                <div class="metric-item">
                  <span class="metric-label">已接收帧数</span>
                  <span class="metric-value">{{ link.deliveredFrames }} (First Wins: {{ link.firstArrivalWins }})</span>
                </div>
                <div class="metric-item">
                  <span class="metric-label">丢包/重复/过期/冲突</span>
                  <span class="metric-value" style="color: var(--accent-warning);">
                    {{ link.missedFrames }} / {{ link.duplicateFrames }} / {{ link.staleFrames }} / {{ link.conflictFrames }}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </n-config-provider>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onBeforeUnmount } from 'vue'
import { darkTheme } from 'naive-ui'
import { useUavStore } from '@/store/uavStore'

const props = defineProps({
    standalone: {
        type: Boolean,
        default: false
    }
})

const emit = defineEmits(['minimize', 'close'])
const uavStore = useUavStore()

const formatMs = (val: number | null | undefined) => val != null ? val.toFixed(1) : '-'

const naiveThemeOverrides = {
    common: {
        primaryColor: '#2563eb',
        primaryColorHover: '#3b82f6',
        primaryColorPressed: '#1d4ed8',
        primaryColorSuppl: '#2563eb'
    }
}

// Panel Drag
const panelPosition = ref({ x: 16, y: 56 })

const panelStyle = computed(() => {
    if (props.standalone) {
        return {
            left: '0px',
            top: '0px',
            width: '100%',
            height: '100vh',
            maxHeight: '100vh',
            position: 'relative' as const,
            borderRadius: '0px',
            border: 'none',
            boxShadow: 'none',
            boxSizing: 'border-box' as const
        }
    }
    return {
        left: panelPosition.value.x + 'px',
        top: panelPosition.value.y + 'px'
    }
})

let dragging = false
let startX = 0, startY = 0, originX = 0, originY = 0

function startDrag(e: MouseEvent) {
    if (props.standalone) return
    if (e.button !== 0) return
    dragging = true
    startX = e.clientX
    startY = e.clientY
    originX = panelPosition.value.x
    originY = panelPosition.value.y
    window.addEventListener('mousemove', onDrag)
    window.addEventListener('mouseup', stopDrag)
    e.preventDefault()
}

function onDrag(e: MouseEvent) {
    if (!dragging) return
    if (e.buttons !== 1) {
        stopDrag()
        return
    }
    let x = originX + e.clientX - startX
    let y = originY + e.clientY - startY
    x = Math.max(0, Math.min(window.innerWidth - 790, x))
    y = Math.max(0, Math.min(window.innerHeight - 200, y))
    panelPosition.value.x = x
    panelPosition.value.y = y
}

function stopDrag() {
    dragging = false
    window.removeEventListener('mousemove', onDrag)
    window.removeEventListener('mouseup', stopDrag)
}

onBeforeUnmount(() => {
    stopDrag()
})
</script>

<style scoped>
.avionics-panel {
    --surface-primary: #212121;
    --surface-under: #181818;
    --surface-secondary: #282828;
    --text-primary: rgb(255 255 255 / 90%);
    --text-secondary: rgb(255 255 255 / 65%);
    --text-tertiary: rgb(255 255 255 / 45%);
    --border-light: rgb(255 255 255 / 4%);
    --border-default: rgb(255 255 255 / 8%);
    --border-heavy: rgb(255 255 255 / 14%);
    --focus-blue: #339cff;
    --accent-blue: #2563eb;
    --accent-green: #10a37f;
    --accent-red: #ef4444;
    --accent-warning: #f59e0b;

    position: fixed;
    width: 760px;
    max-height: 86vh;
    overflow-y: auto;
    padding: 16px 20px;
    background: rgba(33, 33, 33, 0.96);
    color: var(--text-primary);
    border: 1px solid var(--border-default);
    border-radius: 14px;
    backdrop-filter: blur(16px);
    box-shadow: 0 16px 32px -8px rgba(0, 0, 0, 0.45), 0 0 0 1px var(--border-light);
    font-size: 13px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    z-index: 2000;
    user-select: none;
}

.avionics-panel::-webkit-scrollbar { width: 6px; }
.avionics-panel::-webkit-scrollbar-track { background: transparent; }
.avionics-panel::-webkit-scrollbar-thumb { background: rgb(255 255 255 / 15%); border-radius: 3px; }
.avionics-panel::-webkit-scrollbar-thumb:hover { background: rgb(255 255 255 / 25%); }

.panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    cursor: move;
    padding-bottom: 14px;
    border-bottom: 1px solid var(--border-default);
}

.header-meta, .window-controls { display: flex; align-items: center; }
.header-meta { gap: 10px; }
.window-controls { gap: 2px; }

.window-control {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    color: var(--text-tertiary);
    background: transparent;
    border: 0;
    border-radius: 7px;
    cursor: pointer;
    transition: color 140ms ease, background-color 140ms ease;
}

.window-control svg {
    width: 12px;
    height: 12px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-width: 1.4;
}

.window-control:hover { color: var(--text-primary); background: rgb(255 255 255 / 8%); }
.window-control-close:hover { color: #fff; background: #c42b1c; }
.window-control:focus-visible { outline: 2px solid var(--focus-blue); outline-offset: 1px; }

.title {
    font-size: 15px;
    font-weight: 600;
    color: var(--text-primary);
    letter-spacing: -0.2px;
    display: flex;
    align-items: center;
}

.sub-title {
    margin-left: 8px;
    font-size: 12px;
    font-weight: 400;
    color: var(--text-tertiary);
}

.status {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 500;
    font-size: 11px;
    letter-spacing: 0.3px;
    padding: 3px 8px;
    border-radius: 9999px;
    background: rgb(255 255 255 / 5%);
    border: 1px solid var(--border-light);
}

.status-dot { width: 6px; height: 6px; border-radius: 50%; }

.online { color: var(--text-secondary); }
.online .status-dot { background: var(--accent-green); }

.recovering { color: var(--accent-warning); background: rgba(245, 158, 11, 0.08); border-color: rgba(245, 158, 11, 0.2); }
.recovering .status-dot { background: var(--accent-warning); }

.offline { color: var(--accent-red); background: rgba(239, 68, 68, 0.08); border-color: rgba(239, 68, 68, 0.2); }
.offline .status-dot { background: var(--accent-red); }

.transponder-section {
    margin-top: 16px;
    padding: 16px;
    background: var(--surface-under);
    border: 1px solid var(--border-default);
    border-radius: 12px;
}

.section-header-title {
    display: flex;
    align-items: baseline;
    margin-bottom: 14px;
    padding-bottom: 10px;
    color: var(--text-primary);
    border-bottom: 1px solid var(--border-light);
    font-size: 14px;
    font-weight: 600;
    letter-spacing: -0.1px;
}

.section-sub {
    margin-left: 8px;
    color: var(--text-tertiary);
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.45px;
}

.transponder-layout {
    display: grid;
    grid-template-columns: minmax(0, 1.08fr) minmax(0, 0.92fr);
    gap: 18px;
}

.setting-row {
    display: grid;
    grid-template-columns: minmax(92px, 0.8fr) minmax(0, 1.7fr);
    align-items: center;
    min-width: 0;
    min-height: 44px;
    margin: 0;
    padding: 6px 0;
    border: 0;
    border-bottom: 1px solid var(--border-light);
    font-size: 12px;
}

.label-text {
    min-width: 0;
    padding: 0 8px 0 0;
    color: var(--text-secondary);
    font-size: 12px;
    line-height: 1.35;
}

.setting-control {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    min-width: 0;
}

.readback-value {
    min-width: 56px;
    color: #8ec8ff;
    font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    font-size: 11px;
    line-height: 1.25;
    text-align: right;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* Links specific styles */
.links-layout {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: 16px;
}

.link-card {
    background: var(--surface-primary);
    border: 1px solid var(--border-light);
    border-radius: 8px;
    padding: 12px;
    display: flex;
    flex-direction: column;
}

.column-heading {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
}

.column-heading h3 {
    margin: 0;
    color: var(--text-primary);
    font-size: 13px;
    font-weight: 600;
    line-height: 1.2;
}

.column-heading p {
    margin: 4px 0 0;
    color: var(--text-tertiary);
    font-size: 10px;
    line-height: 1.35;
}

.link-metrics {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 8px;
}

.metric-item {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
}

.metric-label {
    color: var(--text-secondary);
}

.metric-value {
    font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    color: #8ec8ff;
}

</style>
