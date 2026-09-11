/**
 * 13所光电吊舱（Z45 指令集）前端指令定义表。
 *
 * 依据《13所吊舱控制功能集成与协议规范》第四节整理：
 * - Z45 核心指令经 fcode=0x70 注入（`send_pod_command`）
 * - VMC 辅助指令经飞控开关指令帧三判二下发（`submit_vmc_command`）
 */

/** Z45 单次触发指令（点击后注入约 100ms 自动复位）。 */
export interface PodSingleCommand {
  kind: 'single'
  /** 指令唯一键。 */
  key: string
  /** 中文名称。 */
  label: string
  /** 功能指令码 SwitchCmd。 */
  code: number
  /** 按钮提示。 */
  hint?: string
}

/** Z45 连续/长按指令（按住期间 10Hz 持续发送，松开复位）。 */
export interface PodContinuousCommand {
  kind: 'continuous'
  key: string
  label: string
  code: number
  hint?: string
}

/** 数字引导指令（SwitchCmd 固定 0x19，携带俯仰/方位角）。 */
export interface PodGuideCommand {
  kind: 'guide'
  key: string
  label: string
  /** 俯仰角（度），向下为负。 */
  pitchDeg: number
  /** 方位角（度）。 */
  yawDeg: number
  hint?: string
}

export type PodCommandDef =
  | PodSingleCommand
  | PodContinuousCommand
  | PodGuideCommand

/** VMC（视频管理计算机）通道指令。 */
export interface VmcCommandDef {
  key: string
  label: string
  code: number
  hint?: string
}

/** 数字引导指令码。 */
export const POD_GUIDE_CODE = 0x19

/** 俯仰角范围（度，向下为负）。 */
export const POD_PITCH_MIN = -110
export const POD_PITCH_MAX = 50
/** 方位角范围（度）。 */
export const POD_YAW_MIN = -180
export const POD_YAW_MAX = 180

/** 步进控制每步角度（度）。 */
export const POD_STEP_DEG = 1
/** 步进控制发送周期（毫秒，对应规范 10Hz）。 */
export const POD_STEP_INTERVAL_MS = 100

// ==================== 工作模式（单次触发） ====================

export const POD_MODE_COMMANDS: PodSingleCommand[] = [
  { kind: 'single', key: 'lock', label: '锁定', code: 0x15, hint: '吊舱锁定当前瞄准线' },
  { kind: 'single', key: 'scan', label: '扫描', code: 0x17, hint: '启动自动周视扫描' },
  { kind: 'single', key: 'manual', label: '手动', code: 0x25, hint: '切换手动操控模式' },
  { kind: 'single', key: 'reset', label: '平台复位', code: 0x1b, hint: '机械平台归位，角度记录清零' },
]

export const POD_TRACK_COMMANDS: PodSingleCommand[] = [
  { kind: 'single', key: 'track-tv', label: '可见光跟踪', code: 0x27, hint: '电视图像闭环跟踪' },
  { kind: 'single', key: 'track-ir', label: '红外跟踪', code: 0x28, hint: '红外热像闭环跟踪' },
]

// ==================== 数字引导快捷位 ====================

export const POD_GUIDE_COMMANDS: PodGuideCommand[] = [
  {
    kind: 'guide',
    key: 'guide-center',
    label: '回中',
    pitchDeg: 0,
    yawDeg: 0,
    hint: '方位/俯仰引导至正前平视（0°, 0°）',
  },
  {
    kind: 'guide',
    key: 'guide-nadir',
    label: '垂直下视',
    // 规范表 4.1 第 40 条写 param1=+9000，但俯仰有效范围是 -110°~+50°；垂直下视按向下为负取 -90°。
    pitchDeg: -90,
    yawDeg: 0,
    hint: '方位 0°，俯仰垂直向下 90°',
  },
]

// ==================== 补漂微调（长按） ====================

export const POD_DRIFT_COMMANDS: PodContinuousCommand[] = [
  { kind: 'continuous', key: 'drift-yaw-minus', label: '方位−', code: 0x1d, hint: '方位陀螺漂移负向补偿' },
  { kind: 'continuous', key: 'drift-yaw-plus', label: '方位＋', code: 0x1f, hint: '方位陀螺漂移正向补偿' },
  { kind: 'continuous', key: 'drift-pitch-minus', label: '俯仰−', code: 0x21, hint: '俯仰陀螺漂移负向补偿' },
  { kind: 'continuous', key: 'drift-pitch-plus', label: '俯仰＋', code: 0x23, hint: '俯仰陀螺漂移正向补偿' },
]

// ==================== 红外与图像 ====================

export const POD_IR_COMMANDS: PodSingleCommand[] = [
  { kind: 'single', key: 'ir-white-hot', label: '红外白热', code: 0x81, hint: '高温显示为白' },
  { kind: 'single', key: 'ir-black-hot', label: '红外黑热', code: 0x82, hint: '高温显示为黑' },
  { kind: 'single', key: 'ir-narrow-fov', label: '红外小视场', code: 0x87, hint: '窄角高倍' },
  { kind: 'single', key: 'ir-wide-fov', label: '红外大视场', code: 0x89, hint: '广角宽视场' },
]

export const POD_ZOOM_COMMANDS: PodContinuousCommand[] = [
  { kind: 'continuous', key: 'zoom-in', label: '焦距＋', code: 0x85, hint: '望远/窄视场，按住持续变焦' },
  { kind: 'continuous', key: 'zoom-out', label: '焦距−', code: 0x86, hint: '广角/大视场，按住持续变焦' },
]

export const POD_IMAGE_COMMANDS: PodSingleCommand[] = [
  { kind: 'single', key: 'osd-toggle', label: 'OSD', code: 0xa1, hint: '视频字符叠加开关' },
  { kind: 'single', key: 'image-switch', label: '图像切换', code: 0xa3, hint: '可见光/红外主画面切换' },
  { kind: 'single', key: 'pip-on', label: '画中画开', code: 0xb5 },
  { kind: 'single', key: 'pip-off', label: '画中画关', code: 0xb6 },
  { kind: 'single', key: 'stab-on', label: '稳像开', code: 0xb8, hint: '电子稳像' },
  { kind: 'single', key: 'stab-off', label: '稳像关', code: 0xb7 },
]

export const POD_DEFOG_COMMANDS: PodSingleCommand[] = [
  { kind: 'single', key: 'defog-off', label: '透雾关', code: 0xbe },
  { kind: 'single', key: 'defog-1', label: '透雾 1', code: 0xbb },
  { kind: 'single', key: 'defog-2', label: '透雾 2', code: 0xbc },
  { kind: 'single', key: 'defog-3', label: '透雾 3', code: 0xbd },
]

// ==================== 照相与激光 ====================

export const POD_CAMERA_COMMANDS: PodSingleCommand[] = [
  { kind: 'single', key: 'photo-single', label: '拍一张', code: 0xc5, hint: '单张拍照抓拍' },
  { kind: 'single', key: 'photo-burst', label: '连续照相', code: 0xc1, hint: '高清相机连拍' },
  { kind: 'single', key: 'photo-stop', label: '停止照相', code: 0xc3 },
]

export const POD_LASER_COMMANDS: PodSingleCommand[] = [
  { kind: 'single', key: 'laser-power-on', label: '电源开', code: 0x92, hint: '激光测距机电源' },
  { kind: 'single', key: 'laser-power-off', label: '电源关', code: 0x93 },
  { kind: 'single', key: 'laser-range-on', label: '测距开', code: 0x94, hint: '连续激光测距' },
  { kind: 'single', key: 'laser-range-off', label: '测距关', code: 0x95 },
]

// ==================== VMC 视频通道（飞控开关指令帧） ====================

export const VMC_RATE_COMMANDS: VmcCommandDef[] = [
  { key: 'vmc-rate-2m', label: '2M 速率', code: 0xc4, hint: '视频码率 2 Mbps' },
  { key: 'vmc-rate-4m', label: '4M 速率', code: 0xc5, hint: '视频码率 4 Mbps' },
]

export const VMC_CHANNEL_COMMANDS: VmcCommandDef[] = [
  { key: 'vmc-channel-1', label: '吊舱通道 1', code: 0xc6, hint: '主传感器通道' },
  { key: 'vmc-channel-2', label: '吊舱通道 2', code: 0xc7, hint: '辅助传感器通道' },
]

export const VMC_LAYOUT_COMMANDS: VmcCommandDef[] = [
  { key: 'vmc-mosaic-03', label: '0-3 拼图', code: 0xc8, hint: '第 0~3 路画面合成' },
  { key: 'vmc-mosaic-46', label: '4-6 拼图', code: 0xc9, hint: '第 4~6 路画面合成' },
]

export const VMC_RECORD_COMMANDS: VmcCommandDef[] = [
  { key: 'vmc-record', label: '记录', code: 0xcb, hint: '机载视频记录' },
  { key: 'vmc-record-stop', label: '停止记录', code: 0xcc },
  { key: 'vmc-data-clear', label: '清空数据', code: 0xcd, hint: '清除机载视频缓存' },
]

export const VMC_OUTPUT_COMMANDS: VmcCommandDef[] = [
  { key: 'vmc-out-lband', label: 'L 链输出', code: 0xc0, hint: '视频导向 L 波段数传' },
  { key: 'vmc-out-satcom', label: '卫通输出', code: 0xc1, hint: '视频导向卫通终端' },
  { key: 'vmc-out-dual', label: '双路输出', code: 0xc2, hint: 'L 链 + 卫通并发' },
]

/** 角度限幅（度）。 */
export function clampPodAngle(
  value: number,
  axis: 'pitch' | 'yaw',
): number {
  if (!Number.isFinite(value)) return 0
  if (axis === 'pitch') {
    return Math.min(POD_PITCH_MAX, Math.max(POD_PITCH_MIN, value))
  }
  return Math.min(POD_YAW_MAX, Math.max(POD_YAW_MIN, value))
}
