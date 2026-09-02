/**
 * 菜单下拉项与选择配置常量
 */

export interface MenuKeyOption {
  label: string
  key: string
}

export interface MenuValueOption {
  label: string
  value: string
}

export type MenuOption = MenuKeyOption | MenuValueOption

export interface MenuOptionsConfig {
  obstacleOptions: MenuKeyOption[]
  EditOptions: MenuKeyOption[]
  sceneOptions: MenuValueOption[]
  MeasureOptions: MenuKeyOption[]
  DrawOptions: MenuKeyOption[]
  AnalyzeOptions: MenuKeyOption[]
  layerOptions: MenuValueOption[]
  LosAnalyzeOptions: MenuKeyOption[]
}

/** 障碍物菜单配置项 */
export const OBSTACLE_OPTIONS: readonly MenuKeyOption[] = [
  { label: '选择机场加载', key: 'selectAirports' },
  { label: '显示障碍物', key: 'showObstacle' },
] as const

/** 编辑菜单配置项 */
export const EDIT_OPTIONS: readonly MenuKeyOption[] = [
  { label: '绘制航线', key: 'createLine' },
  { label: '航线管理', key: 'manage' },
  { label: '标记障碍', key: 'marker' },
] as const

/** 场景菜单配置项 */
export const SCENE_OPTIONS: readonly MenuValueOption[] = [
  { label: '三维伴飞', value: 'companion' },
  { label: '取消伴飞', value: 'untrace' },
] as const

/** 测量菜单配置项 */
export const MEASURE_OPTIONS: readonly MenuKeyOption[] = [
  { label: '距离测量', key: 'distance' },
  { label: '面积测量', key: 'area' },
  { label: '清除测量', key: 'clear' },
] as const

/** 标绘形状菜单配置项 */
export const DRAW_OPTIONS: readonly MenuKeyOption[] = [
  { label: '矩形', key: 'rec' },
  { label: '圆形', key: 'circle' },
  { label: '多边形', key: 'polygon' },
  { label: '清除形状', key: 'clear' },
] as const

/** 分析菜单配置项 */
export const ANALYZE_OPTIONS: readonly MenuKeyOption[] = [
  { label: '通视分析', key: 'visibility' },
  { label: '地形剖面', key: 'profile' },
] as const

/** 默认图层选项 */
export const INITIAL_LAYER_OPTIONS: readonly MenuValueOption[] = [
  { label: '图层1', value: 'layer1' },
] as const

/** 航线通视分析选项 */
export const LOS_ANALYZE_OPTIONS: readonly MenuKeyOption[] = [
  { label: '通视分析', key: 'losAnalyse' },
  { label: '停止分析', key: 'stopLosAnalyse' },
] as const

/** 默认完整菜单选项结构 */
export const DEFAULT_MENU_OPTIONS: MenuOptionsConfig = {
  obstacleOptions: [...OBSTACLE_OPTIONS],
  EditOptions: [...EDIT_OPTIONS],
  sceneOptions: [...SCENE_OPTIONS],
  MeasureOptions: [...MEASURE_OPTIONS],
  DrawOptions: [...DRAW_OPTIONS],
  AnalyzeOptions: [...ANALYZE_OPTIONS],
  layerOptions: [...INITIAL_LAYER_OPTIONS],
  LosAnalyzeOptions: [...LOS_ANALYZE_OPTIONS],
}
