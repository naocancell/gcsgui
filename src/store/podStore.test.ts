import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@tauri-apps/api/event', () => ({
  emit: vi.fn(async () => undefined),
  listen: vi.fn(async () => vi.fn()),
}))
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async () => undefined),
}))

import { invoke } from '@tauri-apps/api/core'
import { usePodStore } from './podStore'
import { useUavStore } from './uavStore'
import {
  POD_GUIDE_CODE,
  POD_MODE_COMMANDS,
  POD_ZOOM_COMMANDS,
  VMC_RATE_COMMANDS,
} from '@/utils/pod/pod13Command'

const invokeMock = vi.mocked(invoke)

function commandNames() {
  return invokeMock.mock.calls.map((call) => call[0])
}

function lastIndex(name: string) {
  return commandNames().lastIndexOf(name)
}

function expectInjectStoppedAfterSend() {
  const lastSend = lastIndex('send_pod_command')
  const lastStop = lastIndex('stop_pod_command')
  expect(lastStop).toBeGreaterThan(-1)
  if (lastSend !== -1) {
    expect(lastStop).toBeGreaterThan(lastSend)
  }
}

describe('podStore hold and step timing', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    invokeMock.mockReset()
    invokeMock.mockResolvedValue(undefined)
    useUavStore().fp95Aggregate = { uavId: 7 }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function deferredSend() {
    let releaseSend = () => {}
    invokeMock.mockImplementation((cmd) => {
      if (cmd === 'send_pod_command') {
        return new Promise<void>((resolve) => {
          releaseSend = resolve
        })
      }
      return Promise.resolve()
    })
    return {
      release: () => releaseSend(),
    }
  }

  it('marks the continuous key before send_pod_command returns', async () => {
    const send = deferredSend()
    const store = usePodStore()
    const pending = store.startContinuous(POD_ZOOM_COMMANDS[0])
    expect(store.activeContinuousKey).toBe('zoom-in')

    await Promise.resolve()
    send.release()
    await pending
  })

  it('stops inject when pointerup races an in-flight continuous start', async () => {
    const send = deferredSend()
    const store = usePodStore()
    const pendingStart = store.startContinuous(POD_ZOOM_COMMANDS[0])
    await Promise.resolve()
    const pendingStop = store.stopContinuous()
    send.release()
    await pendingStop
    await pendingStart

    expect(store.activeContinuousKey).toBeNull()
    expectInjectStoppedAfterSend()
  })

  it('stopAll clears an in-flight continuous start even before the key would previously be set', async () => {
    const send = deferredSend()
    const store = usePodStore()
    const pendingStart = store.startContinuous(POD_ZOOM_COMMANDS[0])
    await store.stopAll()
    send.release()
    await pendingStart

    expect(store.activeContinuousKey).toBeNull()
    expect(store.activeStepKey).toBeNull()
    expectInjectStoppedAfterSend()
  })

  it('steps with a latched continuous 0x19 inject, advancing on the first frame', async () => {
    const store = usePodStore()
    await store.startStepping('step-pitch-plus', 'pitch', 1)

    expect(store.podPitch).toBe(1)
    expect(store.podYaw).toBe(0)
    expect(invokeMock).toHaveBeenCalledWith(
      'send_pod_command',
      expect.objectContaining({
        aircraftId: 7,
        request: expect.objectContaining({
          switchCode: POD_GUIDE_CODE,
          mode: 'continuous',
          pitchDeg: 1,
          yawDeg: 0,
        }),
      }),
    )
  })

  it('calls stop_pod_command when stepping is released', async () => {
    const store = usePodStore()
    await store.startStepping('step-yaw-plus', 'yaw', 1)
    await store.stopStepping()

    expect(store.activeStepKey).toBeNull()
    expect(invokeMock).toHaveBeenCalledWith('stop_pod_command')
  })

  it('does not advance local angle when a step send fails', async () => {
    invokeMock.mockImplementation((cmd) => {
      if (cmd === 'send_pod_command') {
        return Promise.reject(new Error('conflict'))
      }
      return Promise.resolve()
    })

    const store = usePodStore()
    await store.startStepping('step-pitch-plus', 'pitch', 1)

    expect(store.podPitch).toBe(0)
  })

  it('does not arm the step interval if the gesture was released during the first send', async () => {
    vi.useFakeTimers()
    let releaseSend = () => {}
    invokeMock.mockImplementation((cmd) => {
      if (cmd === 'send_pod_command') {
        return new Promise<void>((resolve) => {
          releaseSend = resolve
        })
      }
      return Promise.resolve()
    })

    const store = usePodStore()
    const pendingStart = store.startStepping('step-pitch-plus', 'pitch', 1)
    await store.stopStepping()
    releaseSend?.()
    await pendingStart
    invokeMock.mockClear()
    await vi.advanceTimersByTimeAsync(300)

    expect(invokeMock).not.toHaveBeenCalledWith(
      'send_pod_command',
      expect.anything(),
    )
    expect(store.podPitch).toBe(0)
  })
})

describe('podStore without telemetry', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    invokeMock.mockReset()
    invokeMock.mockResolvedValue(undefined)
    useUavStore().fp95Aggregate = null
  })

  it('sends a single command with fallback aircraft id when FP95 telemetry is missing', async () => {
    const store = usePodStore()
    await store.sendSingle(POD_MODE_COMMANDS[0])

    expect(invokeMock).toHaveBeenCalledWith(
      'send_pod_command',
      expect.objectContaining({
        aircraftId: 255,
        request: expect.objectContaining({
          switchCode: POD_MODE_COMMANDS[0].code,
          mode: 'single',
        }),
      }),
    )
  })

  it('starts continuous inject without telemetry', async () => {
    const store = usePodStore()
    await store.startContinuous(POD_ZOOM_COMMANDS[0])

    expect(store.activeContinuousKey).toBe('zoom-in')
    expect(invokeMock).toHaveBeenCalledWith(
      'send_pod_command',
      expect.objectContaining({
        aircraftId: 255,
        request: expect.objectContaining({
          switchCode: POD_ZOOM_COMMANDS[0].code,
          mode: 'continuous',
        }),
      }),
    )
  })

  it('sends VMC commands without telemetry', async () => {
    const store = usePodStore()
    await store.sendVmc(VMC_RATE_COMMANDS[0])

    expect(invokeMock).toHaveBeenCalledWith(
      'submit_vmc_command',
      expect.objectContaining({
        aircraftId: 255,
        switchCode: VMC_RATE_COMMANDS[0].code,
      }),
    )
  })
})
