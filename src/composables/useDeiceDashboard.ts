import { ref, computed, watch, onMounted, onBeforeUnmount, type Ref } from 'vue'
import { useMessage } from 'naive-ui'
import { usePayloadStore } from '@/store/payloadStore'
import type { useUavStore } from '@/store/uavStore'
import { logger } from '@/utils/logger'
import {
  CONTROLLABLE_RELAY_COUNT,
  RELAY_CHANNELS,
} from '@/utils/deice/dashboardModel'

/** 挂载载荷遥测监听，并在进入页面时主动巡检一次继电器初态 */
export function usePayloadLink() {
  const payloadStore = usePayloadStore()
  onMounted(() => {
    payloadStore.startListening()
    payloadStore.queryRelayStatus().catch((err) => {
      logger.warn('初态同步继电器状态巡检异常:', err)
    })
  })
  onBeforeUnmount(() => {
    payloadStore.stopListening()
  })
  return payloadStore
}

/** 0xC3 继电器回路控制：单路切换、批量总控与闭合统计 */
export function usePayloadRelayControl() {
  const payloadStore = usePayloadStore()
  const message = useMessage()
  const loadingSwitch = ref<number | null>(null)
  const loadingBatch = ref(false)

  const relayStatus = computed(() => payloadStore.relayStatus)

  const closedRelayCount = computed(() => {
    const channels = relayStatus.value?.channels
    if (!channels) return 0
    return channels.slice(0, CONTROLLABLE_RELAY_COUNT).filter(Boolean).length
  })

  function isRelayClosed(index: number): boolean {
    const channels = relayStatus.value?.channels
    if (!channels || index < 1 || index > CONTROLLABLE_RELAY_COUNT) return false
    return Boolean(channels[index - 1])
  }

  function scheduleReadback(tag: string) {
    // 控制下发后延时 200ms 主动回读一次，快速确认状态
    setTimeout(() => {
      payloadStore.queryRelayStatus().catch((err) => {
        logger.warn(`${tag}继电器状态回读巡检异常:`, err)
      })
    }, 200)
  }

  async function handleToggleRelay(index: number, enabled: boolean) {
    loadingSwitch.value = index
    const name = RELAY_CHANNELS[index - 1]?.name ?? `回路${index}`
    try {
      await payloadStore.sendRelayControl(index, enabled)
      message.success(`已下发: ${name} [${enabled ? '通电' : '断开'}]`)
      scheduleReadback('')
    } catch (e: unknown) {
      message.error(`控制 ${name} 失败: ${e}`)
    } finally {
      loadingSwitch.value = null
    }
  }

  async function handleSetAll(enabled: boolean) {
    loadingBatch.value = true
    try {
      await payloadStore.sendRelayBatch(enabled ? 0xffff : 0x0000)
      message.success(`已下发全部 [${enabled ? '通电' : '断开'}]`)
      scheduleReadback('批量')
    } catch (e: unknown) {
      message.error(`操作失败: ${e}`)
    } finally {
      loadingBatch.value = false
    }
  }

  return {
    relayStatus,
    closedRelayCount,
    loadingSwitch,
    loadingBatch,
    isRelayClosed,
    handleToggleRelay,
    handleSetAll,
  }
}

export interface PowerSample {
  target: number | null
  current: number | null
}

/** 防除冰功率遥测滚动历史（每收到一帧 94-2 子帧记录一次） */
export function useDeicePowerHistory(
  store: ReturnType<typeof useUavStore>,
  maxSamples = 60,
) {
  const samples = ref<PowerSample[]>([])
  const toNum = (v: unknown) =>
    typeof v === 'number' && Number.isFinite(v) ? v : null

  watch(
    () => store.fp95Deice,
    (frame) => {
      if (!frame) return
      samples.value.push({
        target: toNum(frame.targetPower),
        current: toNum(frame.currentPower),
      })
      if (samples.value.length > maxSamples) {
        samples.value.splice(0, samples.value.length - maxSamples)
      }
    },
    { immediate: true },
  )

  return { samples }
}

/** 顶栏时钟：HH:mm · UTC±N */
export function useWallClock() {
  const now = ref(new Date())
  let timer: ReturnType<typeof setInterval> | null = null

  onMounted(() => {
    timer = setInterval(() => {
      now.value = new Date()
    }, 1000)
  })
  onBeforeUnmount(() => {
    if (timer) clearInterval(timer)
    timer = null
  })

  const clockText = computed(() => {
    const d = now.value
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    const offsetH = -d.getTimezoneOffset() / 60
    const sign = offsetH >= 0 ? '+' : '-'
    const abs = Math.abs(offsetH)
    const offset = Number.isInteger(abs) ? String(abs) : abs.toFixed(1)
    return `${hh}:${mm} · UTC${sign}${offset}`
  })

  return { clockText }
}

/**
 * 大屏自适应缩放：以三栏中最高一栏的自然高度为基准，
 * 当可用高度不足时对主体应用 CSS zoom（重新排版，文字保持清晰），
 * 缩放下限 minZoom，低于下限时保留各栏纵向滚动。
 */
export function useDashboardFit(
  bodyRef: Ref<HTMLElement | null>,
  minZoom = 0.74,
) {
  const zoom = ref(1)
  let observer: ResizeObserver | null = null
  let frame = 0
  let settleTimer: ReturnType<typeof setTimeout> | null = null

  function fit() {
    const body = bodyRef.value
    if (!body || typeof window === 'undefined') return
    body.style.zoom = '1'
    const avail = body.clientHeight
    const cols = Array.from(body.children) as HTMLElement[]
    const need = Math.max(0, ...cols.map((c) => c.scrollHeight))
    if (avail <= 0 || need <= 0) return
    let next = Math.max(minZoom, Math.min(1, (avail - 2) / need))
    body.style.zoom = String(next)
    // 二次校准：缩放后栏宽变化可能引起换行差异，残余溢出时按比例再收紧一次
    if (next > minZoom) {
      const over = Math.max(
        0,
        ...cols.map((c) => c.scrollHeight - c.clientHeight),
      )
      if (over > 0) {
        const inner = body.clientHeight
        next = Math.max(minZoom, next * (inner / (inner + over + 2)))
        body.style.zoom = String(next)
      }
    }
    zoom.value = Math.round(next * 1000) / 1000
  }

  function scheduleFit() {
    if (typeof requestAnimationFrame === 'undefined') return
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(fit)
  }

  onMounted(() => {
    const body = bodyRef.value
    const host = body?.parentElement
    if (host && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(scheduleFit)
      observer.observe(host)
    }
    scheduleFit()
    // 首帧遥测到达后内容高度可能变化，延时再校准一次
    settleTimer = setTimeout(scheduleFit, 1200)
  })

  onBeforeUnmount(() => {
    observer?.disconnect()
    observer = null
    if (typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(frame)
    if (settleTimer) clearTimeout(settleTimer)
  })

  return { zoom, refit: scheduleFit }
}

/**
 * 遥测刷新率：统计 source 值在最近 windowMs 内的变化次数并换算为 Hz。
 * source 应返回每帧都会变化的字段（如帧计数 / 更新时间戳）。
 */
export function useTelemetryRate(source: () => unknown, windowMs = 2000) {
  const rate = ref<number | null>(null)
  const stamps: number[] = []

  watch(source, (val) => {
    if (val === null || val === undefined) return
    stamps.push(Date.now())
  })

  let timer: ReturnType<typeof setInterval> | null = null
  onMounted(() => {
    timer = setInterval(() => {
      const now = Date.now()
      while (stamps.length && now - stamps[0] > windowMs) stamps.shift()
      rate.value = stamps.length ? (stamps.length * 1000) / windowMs : null
    }, 500)
  })
  onBeforeUnmount(() => {
    if (timer) clearInterval(timer)
  })
  return rate
}
