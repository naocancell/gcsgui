export type LosViewPoint = {
  longitude: number
  latitude: number
  altitude: number
}

export type RouteLosAnalyseParams = {
  isDualViewPointMode: boolean
  viewPoints: LosViewPoint[]
  routeInterval: number
  losInterval: number
  isCalculateRefractionCorrection: boolean
}
