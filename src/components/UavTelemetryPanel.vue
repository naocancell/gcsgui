<template>
    <div
        class="avionics-panel"
        :style="panelStyle"
        @mousedown="startDrag"
    >
        <n-config-provider :abstract="true" :theme="darkTheme" :theme-overrides="naiveThemeOverrides">
            <!-- Header -->
        <div class="panel-header" :data-tauri-drag-region="props.standalone ? '' : undefined">
            <div class="title" :data-tauri-drag-region="props.standalone ? '' : undefined">
                <span :data-tauri-drag-region="props.standalone ? '' : undefined">UAV AVIONICS</span>
                <span class="sub-title" :data-tauri-drag-region="props.standalone ? '' : undefined">无人机航电</span>
            </div>
            <div class="header-meta">
                <div
                    class="status"
                    :class="{
                        online: isFp95Online,
                        offline: !isFp95Online
                    }"
                >
                    <span class="status-dot"></span>
                    <span>{{ isFp95Online ? 'ONLINE' : 'TIMEOUT' }}</span>
                </div>
                <div v-if="props.standalone" class="window-controls" @mousedown.stop>
                    <button
                        class="window-control"
                        type="button"
                        aria-label="最小化航电窗口"
                        title="最小化"
                        @click="emit('minimize')"
                    >
                        <svg aria-hidden="true" viewBox="0 0 12 12">
                            <path d="M2 8.5h8" />
                        </svg>
                    </button>
                    <button
                        class="window-control window-control-close"
                        type="button"
                        aria-label="关闭航电窗口"
                        title="关闭"
                        @click="emit('close')"
                    >
                        <svg aria-hidden="true" viewBox="0 0 12 12">
                            <path d="m2.5 2.5 7 7m0-7-7 7" />
                        </svg>
                    </button>
                </div>
            </div>
        </div>

        <!-- Main Body -->
        <div class="panel-body">
            <!-- 1. 应答机设置模块 -->
            <section class="transponder-section" @mousedown.stop>
                <div class="section-header-title">
                    <span>应答机设置</span>
                    <span class="section-sub">TRANSPONDER SETTINGS</span>
                </div>
                <div class="transponder-layout">
                    <div class="transponder-left">
                        <div class="column-heading">
                            <div>
                                <h3>状态与模式</h3>
                                <p>配置应答模式并核对设备回读</p>
                            </div>
                            <span class="column-index">01</span>
                        </div>

                        <fieldset class="setting-row">
                            <legend class="visually-hidden">空地指示状态</legend>
                            <span class="label-text" aria-hidden="true">空地指示状态</span>
                            <div class="setting-control">
                                <div class="segment-control">
                                    <label class="segment-option">
                                        <input v-model="uavStore.transponderSwitchConfig.airGroundState" class="segment-input" type="radio" :value="0" />
                                        <span>地面</span>
                                    </label>
                                    <label class="segment-option">
                                        <input v-model="uavStore.transponderSwitchConfig.airGroundState" class="segment-input" type="radio" :value="1" />
                                        <span>空中</span>
                                    </label>
                                </div>
                                <output class="readback-value" aria-live="polite">
                                    <span class="readback-caption">回读</span>
                                    {{ uavStore.transponderSwitchReadback.airGroundState || '—' }}
                                </output>
                            </div>
                        </fieldset>

                        <fieldset class="setting-row">
                            <legend class="visually-hidden">DF11 断续振荡</legend>
                            <span class="label-text" aria-hidden="true">DF11 断续振荡</span>
                            <div class="setting-control">
                                <div class="segment-control">
                                    <label class="segment-option">
                                        <input v-model="uavStore.transponderSwitchConfig.df11osc" class="segment-input" type="radio" :value="0" />
                                        <span>关闭</span>
                                    </label>
                                    <label class="segment-option">
                                        <input v-model="uavStore.transponderSwitchConfig.df11osc" class="segment-input" type="radio" :value="1" />
                                        <span>工作</span>
                                    </label>
                                </div>
                                <output class="readback-value" aria-live="polite">
                                    <span class="readback-caption">回读</span>
                                    {{ uavStore.transponderSwitchReadback.df11osc || '—' }}
                                </output>
                            </div>
                        </fieldset>

                        <fieldset class="setting-row">
                            <legend class="visually-hidden">特殊位置识别</legend>
                            <span class="label-text" aria-hidden="true">特殊位置识别</span>
                            <div class="setting-control">
                                <div class="segment-control">
                                    <label class="segment-option">
                                        <input v-model="uavStore.transponderSwitchConfig.spiState" class="segment-input" type="radio" :value="0" />
                                        <span>正常</span>
                                    </label>
                                    <label class="segment-option">
                                        <input v-model="uavStore.transponderSwitchConfig.spiState" class="segment-input" type="radio" :value="1" />
                                        <span>特殊识别</span>
                                    </label>
                                </div>
                                <output class="readback-value" aria-live="polite">
                                    <span class="readback-caption">回读</span>
                                    {{ uavStore.transponderSwitchReadback.spiState || '—' }}
                                </output>
                            </div>
                        </fieldset>

                        <fieldset class="setting-row">
                            <legend class="visually-hidden">A/C/S 模式</legend>
                            <span class="label-text" aria-hidden="true">A/C/S 模式</span>
                            <div class="setting-control">
                                <div class="segment-control mode-segment-control">
                                    <label class="segment-option">
                                        <input v-model="uavStore.transponderSwitchConfig.modeSwitch" class="segment-input" type="radio" :value="0" />
                                        <span>静默</span>
                                    </label>
                                    <label class="segment-option">
                                        <input v-model="uavStore.transponderSwitchConfig.modeSwitch" class="segment-input" type="radio" :value="1" />
                                        <span>仅 A/S</span>
                                    </label>
                                    <label class="segment-option">
                                        <input v-model="uavStore.transponderSwitchConfig.modeSwitch" class="segment-input" type="radio" :value="2" />
                                        <span>A/C/S 全开</span>
                                    </label>
                                </div>
                                <output class="readback-value" aria-live="polite">
                                    <span class="readback-caption">回读</span>
                                    {{ uavStore.transponderSwitchReadback.modeSwitch || '—' }}
                                </output>
                            </div>
                        </fieldset>

                        <fieldset class="setting-row">
                            <legend class="visually-hidden">标准气压高度</legend>
                            <span class="label-text" aria-hidden="true">标准气压高度</span>
                            <div class="setting-control">
                                <div class="segment-control">
                                    <label class="segment-option">
                                        <input v-model="uavStore.transponderSwitchConfig.baroAltitudeSwitch" class="segment-input" type="radio" :value="0" />
                                        <span>关闭</span>
                                    </label>
                                    <label class="segment-option">
                                        <input v-model="uavStore.transponderSwitchConfig.baroAltitudeSwitch" class="segment-input" type="radio" :value="1" />
                                        <span>高度有效</span>
                                    </label>
                                </div>
                                <output class="readback-value" aria-live="polite">
                                    <span class="readback-caption">回读</span>
                                    {{ uavStore.transponderSwitchReadback.baroAltitudeSwitch || '—' }}
                                </output>
                            </div>
                        </fieldset>

                        <fieldset class="setting-row">
                            <legend class="visually-hidden">ADS-B OUT</legend>
                            <span class="label-text" aria-hidden="true">ADS-B OUT</span>
                            <div class="setting-control">
                                <div class="segment-control">
                                    <label class="segment-option">
                                        <input v-model="uavStore.transponderSwitchConfig.adsbOutSwitch" class="segment-input" type="radio" :value="0" />
                                        <span>关闭</span>
                                    </label>
                                    <label class="segment-option">
                                        <input v-model="uavStore.transponderSwitchConfig.adsbOutSwitch" class="segment-input" type="radio" :value="1" />
                                        <span>工作</span>
                                    </label>
                                </div>
                                <output class="readback-value" aria-live="polite">
                                    <span class="readback-caption">回读</span>
                                    {{ uavStore.transponderSwitchReadback.adsbOutSwitch || '—' }}
                                </output>
                            </div>
                        </fieldset>

                        <fieldset class="setting-row">
                            <legend class="visually-hidden">ADS-B IN</legend>
                            <span class="label-text" aria-hidden="true">ADS-B IN</span>
                            <div class="setting-control">
                                <div class="segment-control">
                                    <label class="segment-option">
                                        <input v-model="uavStore.transponderSwitchConfig.adsbInSwitch" class="segment-input" type="radio" :value="0" />
                                        <span>关闭</span>
                                    </label>
                                    <label class="segment-option">
                                        <input v-model="uavStore.transponderSwitchConfig.adsbInSwitch" class="segment-input" type="radio" :value="1" />
                                        <span>工作</span>
                                    </label>
                                </div>
                                <output class="readback-value" aria-live="polite">
                                    <span class="readback-caption">回读</span>
                                    {{ uavStore.transponderSwitchReadback.adsbInSwitch || '—' }}
                                </output>
                            </div>
                        </fieldset>

                        <div class="left-btn-group">
                            <button
                                class="action-btn query-btn"
                                :disabled="!uavStore.fp95Aggregate || uavStore.transponderOperationPending"
                                @click="handleQueryLeftSwitches"
                            >{{ uavStore.transponderOperationPending ? '处理中…' : '查询状态' }}</button>
                            <button
                                class="action-btn bind-btn"
                                :disabled="!uavStore.fp95Aggregate || uavStore.transponderOperationPending"
                                @click="handleBindLeftSwitches"
                            >{{ uavStore.transponderOperationPending ? '处理中…' : '装订状态' }}</button>
                        </div>
                    </div>

                    <div class="transponder-right">
                        <div class="column-heading">
                            <div>
                                <h3>航管参数</h3>
                                <p>录入识别信息并查看最近回读</p>
                            </div>
                            <span class="column-index">02</span>
                        </div>

                        <div class="param-bind-area">
                            <div class="param-form">
                            <div class="param-row">
                                <span class="param-label">A 代码</span>
                                <div class="acode-inputs">
                                    <n-select
                                        v-model:value="uavStore.transponderParamConfig.aCode[0]"
                                        :options="aCodeSelectOptions"
                                        size="small"
                                        class="n-code-select"
                                    />
                                    <n-select
                                        v-model:value="uavStore.transponderParamConfig.aCode[1]"
                                        :options="aCodeSelectOptions"
                                        size="small"
                                        class="n-code-select"
                                    />
                                    <n-select
                                        v-model:value="uavStore.transponderParamConfig.aCode[2]"
                                        :options="aCodeSelectOptions"
                                        size="small"
                                        class="n-code-select"
                                    />
                                    <n-select
                                        v-model:value="uavStore.transponderParamConfig.aCode[3]"
                                        :options="aCodeSelectOptions"
                                        size="small"
                                        class="n-code-select"
                                    />
                                </div>
                            </div>

                            <div class="param-row">
                                <span class="param-label">S 模式地址</span>
                                <div class="smode-inputs">
                                    <n-select
                                        v-model:value="uavStore.transponderParamConfig.sModeAddr[0]"
                                        :options="hexByteSelectOptions"
                                        filterable
                                        tag
                                        :on-create="handleHexCreate"
                                        size="small"
                                        class="n-smode-select"
                                    />
                                    <n-select
                                        v-model:value="uavStore.transponderParamConfig.sModeAddr[1]"
                                        :options="hexByteSelectOptions"
                                        filterable
                                        tag
                                        :on-create="handleHexCreate"
                                        size="small"
                                        class="n-smode-select"
                                    />
                                    <n-select
                                        v-model:value="uavStore.transponderParamConfig.sModeAddr[2]"
                                        :options="hexByteSelectOptions"
                                        filterable
                                        tag
                                        :on-create="handleHexCreate"
                                        size="small"
                                        class="n-smode-select"
                                    />
                                </div>
                            </div>

                            <div class="param-row">
                                <span class="param-label">飞行器类别</span>
                                <div class="category-inputs">
                                    <n-select
                                        v-model:value="uavStore.transponderParamConfig.aircraftCategory"
                                        :options="aircraftCategoryOptions"
                                        size="small"
                                        class="n-cat-select-short"
                                    />
                                    <n-select
                                        v-model:value="uavStore.transponderParamConfig.adsbEmitterType"
                                        :options="aircraftEmitterSelectOptions"
                                        size="small"
                                        class="n-cat-select-long"
                                    />
                                </div>
                            </div>

                            <div class="param-row">
                                <span class="param-label">航班号</span>
                                <input type="text" v-model="uavStore.transponderParamConfig.flightNumber" class="flight-input" placeholder="输入航班号/呼号..." />
                            </div>
                            </div>

                            <div class="readback-heading">
                                <span>最近回读</span>
                                <span>LAST READBACK</span>
                            </div>

                            <div class="readback-list">
                            <div class="param-readback-row">
                                <span class="param-readback-label">A 代码</span>
                                <output class="param-readback-box" aria-live="polite">{{ uavStore.transponderParamReadback.aCode || '—' }}</output>
                            </div>
                            <div class="param-readback-row">
                                <span class="param-readback-label">S模式地址</span>
                                <output class="param-readback-box" aria-live="polite">{{ uavStore.transponderParamReadback.sModeAddr || '—' }}</output>
                            </div>
                            <div class="param-readback-row">
                                <span class="param-readback-label">飞行器类别</span>
                                <output class="param-readback-box" aria-live="polite">{{ uavStore.transponderParamReadback.aircraftCategoryInfo || '—' }}</output>
                            </div>
                            <div class="param-readback-row">
                                <span class="param-readback-label">航班号</span>
                                <output class="param-readback-box" aria-live="polite">{{ uavStore.transponderParamReadback.flightNumber || '—' }}</output>
                            </div>
                            </div>

                            <div class="right-btn-group">
                                <button
                                    class="action-btn query-btn"
                                    :disabled="!uavStore.fp95Aggregate || uavStore.transponderOperationPending"
                                    @click="handleQueryRightParams"
                                >{{ uavStore.transponderOperationPending ? '处理中…' : '查询参数' }}</button>
                                <button
                                    class="action-btn bind-btn"
                                    :disabled="!uavStore.fp95Aggregate || uavStore.transponderOperationPending"
                                    @click="handleBindRightParams"
                                >{{ uavStore.transponderOperationPending ? '处理中…' : '装订参数' }}</button>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            <!-- 2. 航电开关 / AVIONICS SWITCH -->
            <section class="legacy-avionics-switches" @mousedown.stop>
                <div class="section-title">
                    <span>AVIONICS SWITCH</span>
                    <span class="section-sub">航电开关</span>
                </div>
                <div class="row switch-row">
                    <span>PAYLOAD POWER / 任务载荷电源</span>
                    <div class="switch-control">
                        <span class="switch-current" :class="{ enabled: hasFp95SwitchTelemetry && fp95Switches.payloadPower }">
                            {{ formatSwitchState(fp95Switches.payloadPower) }}
                        </span>
                        <n-switch
                            :value="fp95Switches.payloadPower"
                            :loading="payloadSwitchPending"
                            :disabled="!hasFp95SwitchTelemetry || payloadSwitchPending"
                            size="small"
                            @update:value="handlePayloadSwitch"
                        >
                            <template #checked>开</template>
                            <template #unchecked>关</template>
                        </n-switch>
                    </div>
                </div>

                <div class="row switch-row">
                    <span>TRANSPONDER / 应答机</span>
                    <div class="switch-control">
                        <span class="switch-current" :class="{ enabled: hasFp95SwitchTelemetry && fp95Switches.transponder }">
                            {{ formatSwitchState(fp95Switches.transponder) }}
                        </span>
                        <n-switch
                            :value="fp95Switches.transponder"
                            :loading="transponderSwitchPending"
                            :disabled="!hasFp95SwitchTelemetry || transponderSwitchPending"
                            size="small"
                            @update:value="handleTransponderSwitch"
                        >
                            <template #checked>开</template>
                            <template #unchecked>关</template>
                        </n-switch>
                    </div>
                </div>
            </section>
        </div>

        <!-- Warning -->
        <div
            v-if="telemetryStore.stale"
            class="warning"
        >
            ⚠ TELEMETRY LOST / 数据超时
        </div>
        </n-config-provider>
    </div>
</template>

<script setup lang="ts">
import {
    computed,
    ref,
    onBeforeUnmount,
    watch
} from 'vue'
import { useMessage, NConfigProvider, darkTheme, NSelect } from 'naive-ui'

import {
    useTelemetryStore
} from '@/store/useTelemetryStore'
import { useUavStore } from '@/store/uavStore'
import { getFp95AvionicsSwitches } from '@/utils/plane/fp95Telemetry'
import { getFp95EmitterOptions } from '@/utils/plane/fp95Transponder'
import {
    isFp95SwitchTelemetryConfirmed,
    type Fp95PendingSwitchControl
} from '@/utils/plane/fp95AvionicsControl'

const telemetryStore =
    useTelemetryStore()
const uavStore = useUavStore()
const message = useMessage()
const props = defineProps<{
    standalone?: boolean
}>()
const emit = defineEmits<{
    minimize: []
    close: []
}>()
const telemetry =
    computed(() => {
        return telemetryStore.telemetry
    })
const fp95Switches =
    computed(() => {
        return getFp95AvionicsSwitches(
            uavStore.fp95Aggregate
        )
    })
const hasFp95SwitchTelemetry =
    computed(() => Boolean(
        uavStore.fp95Aggregate?.frame84
    ))
const isFp95Online =
    computed(() => Boolean(
        uavStore.fp95Aggregate
    ))

const payloadPendingTarget = ref<Fp95PendingSwitchControl | null>(null)
const transponderPendingTarget = ref<Fp95PendingSwitchControl | null>(null)
const payloadSwitchPending = computed(
    () => payloadPendingTarget.value !== null
)
const transponderSwitchPending = computed(
    () => transponderPendingTarget.value !== null
)
let payloadConfirmationTimer: ReturnType<typeof setTimeout> | null = null
let transponderConfirmationTimer: ReturnType<typeof setTimeout> | null = null
const SWITCH_CONFIRMATION_TIMEOUT = 2000

function formatSwitchState(enabled: boolean) {
    if (!hasFp95SwitchTelemetry.value) {
        return '暂无遥测'
    }
    return `当前：${enabled ? '开' : '关'}`
}

function formatControlError(error: unknown) {
    if (typeof error === 'string') return error
    if (error instanceof Error) return error.message
    if (error && typeof error === 'object' && 'message' in error) {
        return String((error as { message: unknown }).message)
    }
    return '未知错误'
}

function clearPayloadPending() {
    payloadPendingTarget.value = null
    if (payloadConfirmationTimer) {
        clearTimeout(payloadConfirmationTimer)
        payloadConfirmationTimer = null
    }
}

function clearTransponderPending() {
    transponderPendingTarget.value = null
    if (transponderConfirmationTimer) {
        clearTimeout(transponderConfirmationTimer)
        transponderConfirmationTimer = null
    }
}

async function handlePayloadSwitch(enabled: boolean) {
    const aggregate = uavStore.fp95Aggregate
    if (!aggregate?.frame84) {
        message.error('暂无 FP95 航电开关遥测')
        return
    }
    payloadPendingTarget.value = {
        aircraftId: aggregate.uavId,
        target: enabled
    }
    payloadConfirmationTimer = setTimeout(() => {
        clearPayloadPending()
        message.warning('指令已发送，但遥测状态未确认')
    }, SWITCH_CONFIRMATION_TIMEOUT)

    try {
        await uavStore.controlFp95AvionicsSwitch('payload', enabled)
    } catch (error) {
        clearPayloadPending()
        message.error(`载荷控制失败：${formatControlError(error)}`)
    }
}

async function handleTransponderSwitch(enabled: boolean) {
    const aggregate = uavStore.fp95Aggregate
    if (!aggregate?.frame84) {
        message.error('暂无 FP95 航电开关遥测')
        return
    }
    transponderPendingTarget.value = {
        aircraftId: aggregate.uavId,
        target: enabled
    }
    transponderConfirmationTimer = setTimeout(() => {
        clearTransponderPending()
        message.warning('指令已发送，但遥测状态未确认')
    }, SWITCH_CONFIRMATION_TIMEOUT)

    try {
        await uavStore.controlFp95AvionicsSwitch('transponder', enabled)
    } catch (error) {
        clearTransponderPending()
        message.error(`应答机控制失败：${formatControlError(error)}`)
    }
}

watch(
    () => [
        hasFp95SwitchTelemetry.value,
        uavStore.fp95Aggregate?.uavId ?? null,
        fp95Switches.value.payloadPower
    ] as const,
    ([hasTelemetry, aircraftId, actualState]) => {
        if (isFp95SwitchTelemetryConfirmed(
            payloadPendingTarget.value,
            aircraftId,
            hasTelemetry,
            actualState
        )) {
            clearPayloadPending()
        }
    }
)

watch(
    () => [
        hasFp95SwitchTelemetry.value,
        uavStore.fp95Aggregate?.uavId ?? null,
        fp95Switches.value.transponder
    ] as const,
    ([hasTelemetry, aircraftId, actualState]) => {
        if (isFp95SwitchTelemetryConfirmed(
            transponderPendingTarget.value,
            aircraftId,
            hasTelemetry,
            actualState
        )) {
            clearTransponderPending()
        }
    }
)

const naiveThemeOverrides = {
    common: {
        primaryColor: '#2563eb',
        primaryColorHover: '#3b82f6',
        primaryColorPressed: '#1d4ed8',
        primaryColorSuppl: '#2563eb'
    },
    Select: {
        fontSizeSmall: '11px',
        fontSizeMedium: '11px',
        optionFontSizeSmall: '11px',
        optionFontSizeMedium: '11px',
        optionHeightSmall: '28px',
        optionHeightMedium: '28px',
        optionTextColorActive: '#60a5fa',
        optionCheckColor: '#2563eb',
        optionColorActive: 'rgba(37, 99, 235, 0.18)',
        optionColorActivePending: 'rgba(37, 99, 235, 0.28)',
        peers: {
            InternalSelection: {
                borderRadius: '8px',
                heightSmall: '30px',
                fontSizeSmall: '11px',
                fontSizeMedium: '11px',
                color: '#282828',
                colorActive: '#282828',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderHover: '1px solid rgba(255, 255, 255, 0.2)',
                borderActive: '1px solid #2563eb',
                borderFocus: '1px solid #2563eb'
            },
            InternalSelectMenu: {
                borderRadius: '8px',
                color: '#282828',
                optionFontSizeSmall: '11px',
                optionFontSizeMedium: '11px',
                optionHeightSmall: '28px',
                optionHeightMedium: '28px',
                optionTextColorActive: '#60a5fa',
                optionCheckColor: '#2563eb',
                optionColorActive: 'rgba(37, 99, 235, 0.18)',
                optionColorActivePending: 'rgba(37, 99, 235, 0.28)',
                optionColorPending: 'rgba(255, 255, 255, 0.08)'
            }
        }
    },
    Popover: {
        borderRadius: '8px',
        color: '#282828',
        boxShadow: '0 8px 24px -4px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.08)'
    }
}

// 应答机选项与控制联动逻辑
const hexByteOptions = computed(() => {
    return Array.from({ length: 256 }, (_, i) => `0x${i.toString(16).padStart(2, '0').toUpperCase()}`)
})
const hexByteSelectOptions = computed(() => {
    return hexByteOptions.value.map(hex => ({ label: hex, value: hex }))
})
const handleHexCreate = (label: string) => {
    let clean = label.trim().toUpperCase()
    if (clean.startsWith('0X')) {
        clean = clean.slice(2)
    }
    const num = parseInt(clean, 16)
    if (isNaN(num)) {
        return { label: '0x00', value: '0x00' }
    }
    const finalHex = `0x${Math.min(255, Math.max(0, num)).toString(16).padStart(2, '0').toUpperCase()}`
    return { label: finalHex, value: finalHex }
}
const aCodeSelectOptions = Array.from({ length: 8 }, (_, i) => ({ label: `${i}`, value: i }))
const aircraftEmitterOptions = computed(() => {
    return getFp95EmitterOptions(uavStore.transponderParamConfig.aircraftCategory)
})
const aircraftCategoryOptions = [
    { label: 'A类', value: 'A类' },
    { label: 'B类', value: 'B类' },
    { label: 'C类', value: 'C类' },
    { label: 'D类', value: 'D类' }
]
const aircraftEmitterSelectOptions = computed(() => {
    return aircraftEmitterOptions.value.map(opt => ({ label: opt, value: opt }))
})

watch(aircraftEmitterOptions, (options) => {
    if (!options.includes(uavStore.transponderParamConfig.adsbEmitterType)) {
        uavStore.transponderParamConfig.adsbEmitterType = options[0] ?? ''
    }
}, { immediate: true })

async function handleBindLeftSwitches() {
    try {
        await uavStore.bindTransponderSwitches(uavStore.transponderSwitchConfig)
        message.success('应答机状态参数装订成功')
    } catch (error) {
        message.error(`应答机状态参数装订失败：${formatControlError(error)}`)
    }
}

async function handleQueryLeftSwitches() {
    try {
        await uavStore.queryTransponderSwitches()
        message.success('应答机状态参数查询成功')
    } catch (error) {
        message.error(`应答机状态参数查询失败：${formatControlError(error)}`)
    }
}

async function handleBindRightParams() {
    try {
        await uavStore.bindTransponderParams(uavStore.transponderParamConfig)
        message.success('航管参数装订成功')
    } catch (error) {
        message.error(`航管参数装订失败：${formatControlError(error)}`)
    }
}

async function handleQueryRightParams() {
    try {
        await uavStore.queryTransponderParams()
        message.success('航管参数查询成功')
    } catch (error) {
        message.error(`航管参数查询失败：${formatControlError(error)}`)
    }
}

// Panel Drag
const panelPosition = ref({
    x: 16,
    y: 56
})

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
let startX = 0
let startY = 0
let originX = 0
let originY = 0

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
    clearPayloadPending()
    clearTransponderPending()
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

/* 滚动条 */
.avionics-panel::-webkit-scrollbar {
    width: 6px;
}
.avionics-panel::-webkit-scrollbar-track {
    background: transparent;
}
.avionics-panel::-webkit-scrollbar-thumb {
    background: rgb(255 255 255 / 15%);
    border-radius: 3px;
}
.avionics-panel::-webkit-scrollbar-thumb:hover {
    background: rgb(255 255 255 / 25%);
}

.panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    cursor: move;
    padding-bottom: 14px;
    border-bottom: 1px solid var(--border-default);
}

.header-meta,
.window-controls {
    display: flex;
    align-items: center;
}

.header-meta {
    gap: 10px;
}

.window-controls {
    gap: 2px;
}

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

.window-control:hover {
    color: var(--text-primary);
    background: rgb(255 255 255 / 8%);
}

.window-control-close:hover {
    color: #fff;
    background: #c42b1c;
}

.window-control:focus-visible {
    outline: 2px solid var(--focus-blue);
    outline-offset: 1px;
}

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

.status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
}

.online {
    color: var(--text-secondary);
}
.online .status-dot {
    background: var(--accent-green);
}

.offline {
    color: var(--accent-red);
    background: rgba(239, 68, 68, 0.08);
    border-color: rgba(239, 68, 68, 0.2);
}
.offline .status-dot {
    background: var(--accent-red);
}

/* 应答机设置 */
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

.section-title {
    display: flex;
    align-items: center;
    margin-bottom: 14px;
    padding-bottom: 8px;
    color: var(--text-primary);
    border-bottom: 1px solid var(--border-light);
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.2px;
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

.transponder-left {
    min-width: 0;
    padding-right: 18px;
    border-right: 1px solid var(--border-light);
}

.transponder-right {
    min-width: 0;
}

.column-heading {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    min-height: 34px;
    margin-bottom: 6px;
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

.column-index {
    padding-top: 1px;
    color: var(--text-tertiary);
    font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    font-size: 10px;
    letter-spacing: 0.4px;
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
    font-size: 11px;
    line-height: 1.35;
}

.visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    white-space: nowrap;
    border: 0;
    clip-path: inset(50%);
}

.setting-control {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    min-width: 0;
}

.segment-control {
    display: inline-flex;
    min-width: 0;
    padding: 2px;
    background: var(--surface-secondary);
    border: 1px solid var(--border-light);
    border-radius: 8px;
}

.mode-segment-control .segment-option span {
    min-width: 34px;
    padding-inline: 5px;
}

.segment-option {
    position: relative;
    flex: 0 0 auto;
    min-width: 0;
}

.segment-input {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
}

.segment-option span {
    display: block;
    min-width: 40px;
    padding: 5px 7px;
    color: var(--text-tertiary);
    border-radius: 6px;
    font-size: 10px;
    line-height: 1.2;
    text-align: center;
    white-space: nowrap;
    cursor: pointer;
    transition: background-color 150ms ease, color 150ms ease;
}

.segment-option:hover span {
    color: var(--text-secondary);
}

.segment-input:checked + span {
    color: var(--text-primary);
    background: #414141;
    box-shadow: inset 0 0 0 1px var(--border-light);
}

.segment-input:focus-visible + span {
    outline: 2px solid var(--focus-blue);
    outline-offset: 1px;
}

.readback-value {
    min-width: 56px;
    color: #8ec8ff;
    font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    font-size: 10px;
    line-height: 1.25;
    text-align: right;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.readback-caption {
    display: block;
    margin-bottom: 2px;
    color: var(--text-tertiary);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 9px;
}

.param-bind-area,
.param-form,
.readback-list {
    display: flex;
    flex-direction: column;
}

.param-bind-area {
    gap: 12px;
}

.param-form,
.readback-list {
    gap: 8px;
}

.param-row,
.param-readback-row {
    display: grid;
    grid-template-columns: 84px minmax(0, 1fr);
    align-items: center;
    gap: 8px;
}

.param-label,
.param-readback-label {
    color: var(--text-secondary);
    font-size: 11px;
}

.acode-inputs,
.smode-inputs,
.category-inputs {
    display: flex;
    gap: 5px;
    min-width: 0;
}

.code-select,
.smode-select,
.cat-select-short,
.cat-select-long,
.flight-input {
    box-sizing: border-box;
    min-width: 0;
    min-height: 30px;
    padding: 0 7px;
    color: var(--text-primary);
    background: var(--surface-secondary);
    border: 0;
    border-radius: 8px;
    box-shadow: none;
    font-size: 11px;
}

.code-select,
.smode-select,
.cat-select-short,
.cat-select-long {
    appearance: none;
    -webkit-appearance: none;
    padding-right: 22px;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='m1 1 4 4 4-4' fill='none' stroke='%23969696' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 6px center;
    background-size: 10px 6px;
    cursor: pointer;
}

.code-select {
    flex: 1;
    padding: 0 22px 0 6px;
}

.smode-select {
    flex: 1;
    padding: 0 22px 0 6px;
}

.cat-select-short {
    flex: 0 0 54px;
}

.n-cat-select-short {
    flex: 0 0 72px;
}

.cat-select-long,
.flight-input {
    flex: 1;
    width: 100%;
}

.n-cat-select-long,
.n-code-select,
.n-smode-select {
    flex: 1;
    min-width: 0;
}

.code-select:focus-visible,
.smode-select:focus-visible,
.cat-select-short:focus-visible,
.cat-select-long:focus-visible,
.flight-input:focus-visible,
.action-btn:focus-visible {
    outline: 2px solid var(--focus-blue);
    outline-offset: 2px;
}

.readback-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-top: 12px;
    color: var(--text-secondary);
    border-top: 1px solid var(--border-light);
    font-size: 11px;
}

.readback-heading span:last-child {
    color: var(--text-tertiary);
    font-size: 9px;
    letter-spacing: 0.4px;
}

.param-readback-box {
    min-width: 0;
    padding: 6px 8px;
    color: #8ec8ff;
    background: var(--surface-primary);
    border: 1px solid var(--border-light);
    border-radius: 7px;
    font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.left-btn-group,
.right-btn-group {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid var(--border-light);
}

.action-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 78px;
    padding: 7px 13px;
    border-radius: 7px;
    font-size: 11px;
    font-weight: 500;
    line-height: 1.2;
    white-space: nowrap;
    cursor: pointer;
    transition: background-color 150ms ease, border-color 150ms ease, color 150ms ease;
}

.action-btn:disabled {
    cursor: not-allowed;
    opacity: 0.38;
}

.query-btn {
    color: var(--text-primary);
    background: rgb(255 255 255 / 8%);
    border: 1px solid var(--border-default);
}

.query-btn:hover:not(:disabled) {
    background: rgb(255 255 255 / 12%);
    border-color: var(--border-heavy);
    color: #ffffff;
}

.bind-btn {
    color: #ffffff;
    background: var(--accent-blue);
    border: 1px solid transparent;
}

.bind-btn:hover:not(:disabled) {
    background: #3b82f6;
}

.bind-btn:active:not(:disabled) {
    background: #1d4ed8;
}

.legacy-avionics-switches {
    margin-top: 16px;
    padding: 16px;
    background: var(--surface-under);
    border: 1px solid var(--border-default);
    border-radius: 12px;
}

/* 航电开关兼容 */
.row {
    display: flex;
    justify-content: space-between;
    padding: 5px 0;
}
.switch-row {
    align-items: center;
}
.switch-control {
    display: flex;
    align-items: center;
    gap: 8px;
}
.switch-current {
    min-width: 52px;
    color: var(--text-tertiary);
    font-size: 11px;
    text-align: right;
    font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}
.switch-current.enabled {
    color: var(--accent-green);
    font-weight: 500;
}

.warning {
    margin-top: 12px;
    padding: 8px 12px;
    color: var(--accent-warning);
    background: rgba(245, 158, 11, 0.1);
    border: 1px solid rgba(245, 158, 11, 0.2);
    border-radius: 6px;
    text-align: center;
    font-size: 12px;
}
</style>
