import { Airline, AirlinePoint } from '@/types/entityoptions.ts'

export function newAirlinePt() {
  let pt: AirlinePoint = {
    alt: undefined,
    ch1: 0,
    ch2: 0,
    lat: undefined,
    lon: undefined,
    nPt: undefined,
    speed: 0,
  }
  return pt
}

export function newAirline() {
  let flyLine: Airline = {
    PtNum: undefined,
    code: undefined,
    isClose: false,
    name: '',
    points: [],
    totalDistance: undefined,
  }
  return flyLine
}
