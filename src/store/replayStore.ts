import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { isTauri } from '@/utils/homeWindowData'
import { useUavStore } from '@/store/uavStore'

export type ReplayState = 'playing' | 'paused' | 'stopped'

/** 与后端 recorder::replay::ReplayStatus 对应（serde camelCase） */
export interface ReplayStatus {
  state: ReplayState
  positionNs: number
  durationNs: number
  /** 0 = MAX 全速 */
  speed: number
  fileName: string
  startWallMs?: number
}

export interface LinkRecordStatus {
  linkName: string
  protocol: string
  file: string
  startedAtMs: number
  bytes: number
  records: number
  dropped: number
}

/** 与后端 recorder::validated::AircraftRecordStatus 对应：按飞机号记录的校验数据 */
export interface AircraftRecordStatus {
  uavId: number
  file: string
  startedAtMs: number
  bytes: number
  records: number
  dropped: number
  /** 已记录的数据类别，如 ['FP95', '载荷'] */
  sources: string[]
}

/** 与后端 recorder::writer::RecorderStatus 对应（serde camelCase） */
export interface RecorderStatus {
  active: boolean
  activeCount: number
  links: LinkRecordStatus[]
  totalBytes: number
  totalRecords: number
  totalDropped: number
  /** 旧版后端无此字段 */
  aircraft?: AircraftRecordStatus[]
}

function fileNameOf(path: string): string {
  const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return idx >= 0 ? path.slice(idx + 1) : path
}

export const useReplayStore = defineStore('replay', () => {
  const replayStatus = ref<ReplayStatus | null>(null)
  const recorderStatus = ref<RecorderStatus | null>(null)

  const sessionActive = computed(() => replayStatus.value !== null)
  const isPaused = computed(() => replayStatus.value?.state === 'paused')
  const isFinished = computed(() => replayStatus.value?.state === 'stopped')
  const isRecording = computed(() => recorderStatus.value?.active ?? false)
  const activeRecordingsCount = computed(
    () => recorderStatus.value?.activeCount ?? 0,
  )
  const recordingLinks = computed(() => {
    return (recorderStatus.value?.links ?? []).map((link) => ({
      ...link,
      fileName: fileNameOf(link.file),
    }))
  })
  /** 按飞机号记录校验数据的会话 */
  const recordingAircraft = computed(() => {
    return (recorderStatus.value?.aircraft ?? []).map((item) => ({
      ...item,
      fileName: fileNameOf(item.file),
    }))
  })

  let unlistenReplay: UnlistenFn | null = null
  let unlistenRecorder: UnlistenFn | null = null
  let listenersStarted = false

  /** 挂载事件监听（幂等），组件 onMounted 时调用 */
  async function ensureListeners() {
    if (listenersStarted || !isTauri()) return
    listenersStarted = true
    unlistenReplay = await listen<ReplayStatus>('replay-status-event', (e) => {
      replayStatus.value = e.payload
      const uavStore = useUavStore()
      if (e.payload.state === 'playing' || e.payload.state === 'paused') {
        uavStore.setReplaying(true)
      }
    })
    unlistenRecorder = await listen<RecorderStatus>(
      'recorder-status-event',
      (e) => {
        recorderStatus.value = e.payload
      },
    )
    // 兜底：补拉一次当前状态（防止错过事件）
    try {
      const status = await invoke<ReplayStatus | null>('get_replay_status')
      replayStatus.value = status
      if (status && (status.state === 'playing' || status.state === 'paused')) {
        useUavStore().setReplaying(true)
      }
      recorderStatus.value = await invoke<RecorderStatus>('get_recorder_status')
    } catch {
      /* 忽略：后端不可达时保持 null */
    }
  }

  function dispose() {
    unlistenReplay?.()
    unlistenRecorder?.()
    unlistenReplay = null
    unlistenRecorder = null
    listenersStarted = false
  }

  /** 打开文件选择框并启动回放 */
  async function startReplayFromFile(speed = 1): Promise<boolean> {
    const selected = await open({
      title: '选择回放文件',
      filters: [{ name: 'GCS 记录文件', extensions: ['dat'] }],
      multiple: false,
    })
    if (!selected || typeof selected !== 'string') return false
    if (replayStatus.value?.state === 'stopped') {
      try {
        await stop()
      } catch {}
    }
    await invoke('start_replay', { path: selected, speed })
    const uavStore = useUavStore()
    uavStore.setReplaying(true)
    return true
  }

  const pause = () => invoke('pause_replay')
  const resume = () => invoke('resume_replay')
  const stop = async () => {
    try {
      await invoke('stop_replay')
    } finally {
      replayStatus.value = null
      const uavStore = useUavStore()
      uavStore.setReplaying(false)
    }
  }
  const setSpeed = (speed: number) => invoke('set_replay_speed', { speed })
  const seek = async (positionNs: number) => {
    await invoke('seek_replay', { positionNs })
    const uavStore = useUavStore()
    uavStore.setReplaying(true)
  }

  return {
    replayStatus,
    recorderStatus,
    sessionActive,
    isPaused,
    isFinished,
    isRecording,
    activeRecordingsCount,
    recordingLinks,
    recordingAircraft,
    ensureListeners,
    dispose,
    startReplayFromFile,
    pause,
    resume,
    stop,
    setSpeed,
    seek,
  }
})

/** 纳秒 → "mm:ss"（不足一小时） */
export function formatReplayTime(ns: number): string {
  const totalSeconds = Math.floor(ns / 1_000_000_000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

/** 纳秒 + 录制基准时间戳(ms) → 真实录制时间字符串 "YYYY-MM-DD HH:mm:ss" */
export function formatWallTime(
  startWallMs: number | undefined,
  ns: number,
): string {
  if (!startWallMs || startWallMs <= 0) {
    return formatReplayTime(ns)
  }
  const date = new Date(startWallMs + Math.floor(ns / 1_000_000))
  const Y = date.getFullYear()
  const M = String(date.getMonth() + 1).padStart(2, '0')
  const D = String(date.getDate()).padStart(2, '0')
  const h = String(date.getHours()).padStart(2, '0')
  const m = String(date.getMinutes()).padStart(2, '0')
  const s = String(date.getSeconds()).padStart(2, '0')
  return `${Y}-${M}-${D} ${h}:${m}:${s}`
}
