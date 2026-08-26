export type LinkProtocol = 'FP95' | 'FP981C' | 'UAVInfo'
export type LinkHealthState = 'healthy' | 'suspect' | 'down' | 'recovering'
export type AircraftConnectivity =
  | 'online'
  | 'degraded'
  | 'recovering'
  | 'offline'
//链路健康快照
export interface LinkHealthSnapshot {
  linkName: string
  protocol: LinkProtocol
  uavId: number
  state: LinkHealthState
  validAgeMs: number
  freshAgeMs: number
  relativeDelayMs: number | null
  delayEwmaMs: number | null
  jitterEwmaMs: number | null
  deliveredFrames: number
  firstArrivalWins: number
  duplicateFrames: number
  staleFrames: number
  conflictFrames: number
  missedFrames: number
}

export interface AircraftHealthSnapshot {
  protocol: LinkProtocol
  uavId: number
  state: AircraftConnectivity
  freshAgeMs: number
  allLinksMissing: number
}

export interface RxHealthSnapshot {
  links: LinkHealthSnapshot[]
  aircraft: AircraftHealthSnapshot[]
}
