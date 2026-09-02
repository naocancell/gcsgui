/**
 * 文件描述：工具条通视分析 (LOS Analysis) 交互与结果显示管理 Composable
 */
import { ref, computed } from 'vue'
import { Cartographic } from 'cesium'
import { useStaticStore } from '@/store/staticStore'
import { useRouteStore } from '@/store/RouteStore'
import {
  useRouteLineOfSight,
  type LosResultType,
  type LosViewPointNumber,
} from '@/hooks/useRouteLineOfSight'
import type { RouteLosAnalyseParams } from '@/types/routeLineOfSight'

export function useToolbarLosAnalyse(message: {
  info: (msg: string) => void
  warning: (msg: string) => void
  success: (msg: string) => void
  error: (msg: string) => void
}) {
  const store = useStaticStore()
  const routeStore = useRouteStore()

  const showLosAnalyseModal = ref(false)
  const {
    drawLosEntities,
    stopLosAnalysis,
    toggleLosViewPointResultVisibility,
    toggleFinalLosResultVisibility,
  } = useRouteLineOfSight()

  const losViewPointResultVisible = ref([
    { result1: false, result2: false },
    { result1: false, result2: false },
  ])
  const finalLosResultVisible = ref(false)
  const losViewPointNumbers: LosViewPointNumber[] = [1, 2]
  const losResultSelectionMap = {
    viewPoint1Result1: { viewPointNumber: 1, resultType: 1 },
    viewPoint1Result2: { viewPointNumber: 1, resultType: 2 },
    viewPoint2Result1: { viewPointNumber: 2, resultType: 1 },
    viewPoint2Result2: { viewPointNumber: 2, resultType: 2 },
  } as const

  function resetLosResultVisibility() {
    losViewPointResultVisible.value.forEach((r) => {
      r.result1 = false
      r.result2 = false
    })
    finalLosResultVisible.value = false
  }

  const losAnalyzeOptions = computed(() => [
    ...store.menuOptions.LosAnalyzeOptions,
    ...losViewPointNumbers.map((vp) => ({
      label: `视点${vp}结果`,
      key: `viewPoint${vp}Results`,
      children: ([1, 2] as LosResultType[]).map((rt) => ({
        label: losViewPointResultVisible.value[vp - 1][`result${rt}` as 'result1' | 'result2']
          ? `隐藏结果${rt}`
          : `显示结果${rt}`,
        key: `viewPoint${vp}Result${rt}`,
      })),
    })),
    {
      label: finalLosResultVisible.value ? '隐藏最终结果' : '显示最终结果',
      key: 'toggleFinalLosResult',
    },
  ])

  async function handleLosAnalyseSelect(key: string) {
    if (key === 'losAnalyse') {
      if (!window.routeManageViewer?.selectedRouteId) return message.info('请选中一条行航线！')
      if (routeStore.routeActionMode === 'losPointPicking') return
      showLosAnalyseModal.value = true
    } else if (key === 'stopLosAnalyse') {
      if (stopLosAnalysis()) resetLosResultVisibility()
      else message.warning('当前没有正在进行的通视分析')
    } else if (key === 'toggleFinalLosResult') {
      const v = toggleFinalLosResultVisibility()
      if (v !== null) {
        finalLosResultVisible.value = v
        message.success(`最终结果已${v ? '显示' : '隐藏'}`)
      }
    } else {
      const sel = losResultSelectionMap[key as keyof typeof losResultSelectionMap]
      if (sel) {
        const v = toggleLosViewPointResultVisibility(sel.viewPointNumber, sel.resultType)
        if (v !== null) {
          losViewPointResultVisible.value[sel.viewPointNumber - 1][
            `result${sel.resultType}` as 'result1' | 'result2'
          ] = v
          message.success(`视点${sel.viewPointNumber}结果${sel.resultType}已${v ? '显示' : '隐藏'}`)
        }
      }
    }
  }

  async function isRouteVisiable(param: RouteLosAnalyseParams) {
    showLosAnalyseModal.value = false
    resetLosResultVisibility()
    const pts = param.viewPoints.map((vp) =>
      Cartographic.fromDegrees(vp.longitude, vp.latitude, vp.altitude),
    )
    const ok = await drawLosEntities(pts, param.routeInterval, param.losInterval)
    if (ok) {
      resetLosResultVisibility()
      if (param.isDualViewPointMode) finalLosResultVisible.value = true
      else losViewPointResultVisible.value[0].result2 = true
      message.success('通视分析完成')
    }
  }

  return {
    showLosAnalyseModal,
    losAnalyzeOptions,
    handleLosAnalyseSelect,
    isRouteVisiable,
    resetLosResultVisibility,
  }
}
