const EMITTER_OPTIONS: Record<string, readonly string[]> = {
  A类: [
    '无ADS-B发射器类型信息',
    '轻型',
    '小型',
    '大型',
    '高漩涡式大型',
    '重型',
    '高性能',
    '旋翼飞机',
  ],
  B类: [
    '无ADS-B发射器类型信息',
    '滑翔机',
    'Light-than-air超轻型',
    'Parachutist/Skydiver',
    '超轻型/悬挂式滑翔机/翼伞飞行器',
    '无人飞行器',
    'Space/Trans-atmospheric vehicle',
  ],
  C类: [
    '无ADS-B发射器类型信息',
    '水面航行器-应急设备',
    '水面航行器-服务设备',
    '单点式障碍物（包括系留气球）',
  ],
  D类: ['保留（无定义）'],
}

export function getFp95EmitterOptions(category: string): readonly string[] {
  return EMITTER_OPTIONS[category] ?? []
}
