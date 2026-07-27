export interface WeightCentroidParams {
  emptyUavWeight: number
  emptyUavC: number
  loadWeight: number
  loadC: number
  oilTotal: number
}

export interface WeightCentroidResult {
  oilWeight: number
  totalWeight: number
  centroid: number
  isValid: boolean
}

export const FUEL_TYPE_OPTIONS = [
  { label: '95#', value: 1 },
  { label: 'ORB 燃油', value: 2 },
  { label: 'ORB 燃油+5%', value: 3 },
  { label: '100LL', value: 4 },
]

export function calculateWeightCentroid(
  params: WeightCentroidParams,
): { ok: true; value: WeightCentroidResult } | { ok: false; error: string } {
  const { emptyUavWeight, emptyUavC, loadWeight, loadC, oilTotal } = params

  if (
    !Number.isFinite(emptyUavWeight) ||
    !Number.isFinite(emptyUavC) ||
    !Number.isFinite(loadWeight) ||
    !Number.isFinite(loadC) ||
    !Number.isFinite(oilTotal)
  ) {
    return { ok: false, error: '输入包含非有限数值' }
  }

  if (
    emptyUavWeight < 0 ||
    emptyUavC < 0 ||
    loadWeight < 0 ||
    loadC < 0 ||
    oilTotal < 0
  ) {
    return { ok: false, error: '重量、重心和油量不能为负数' }
  }

  const oilWeight = 0.75 * oilTotal
  const totalWeight = oilWeight + emptyUavWeight + loadWeight

  if (totalWeight <= 0) {
    return { ok: false, error: '飞机总重量必须大于 0' }
  }

  const oilMoment = oilWeight * 0.394
  const emptyMoment = emptyUavWeight * emptyUavC * 0.01
  const loadMoment = loadWeight * ((loadC - 0.05) / 2.269)

  const centroid = (oilMoment + emptyMoment + loadMoment) / totalWeight
  const isValid = centroid > 0.19 && centroid < 0.31

  return {
    ok: true,
    value: {
      oilWeight,
      totalWeight,
      centroid,
      isValid,
    },
  }
}
