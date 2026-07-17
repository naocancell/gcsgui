import type { FP95Aggregate } from '@/types/entityoptions'

export function getFp95AvionicsSwitches(aggregate: FP95Aggregate | null) {
  return {
    payloadPower: aggregate?.frame84?.avionicsSwitchState.payloadPower ?? false,
    transponder: aggregate?.frame84?.avionicsSwitchState.transponder ?? false,
  }
}
