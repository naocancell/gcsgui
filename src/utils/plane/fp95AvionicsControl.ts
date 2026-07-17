export type Fp95AvionicsDevice = 'payload' | 'transponder'

export type Fp95FlightSwitchCommand =
  | 'payloadOn'
  | 'payloadOff'
  | 'transponderOn'
  | 'transponderOff'

export type Fp95PendingSwitchControl = {
  aircraftId: number
  target: boolean
}

export function getFp95FlightSwitchCommand(
  device: Fp95AvionicsDevice,
  enabled: boolean,
): Fp95FlightSwitchCommand {
  if (device === 'payload') {
    return enabled ? 'payloadOn' : 'payloadOff'
  }
  return enabled ? 'transponderOn' : 'transponderOff'
}

export function isFp95SwitchTelemetryConfirmed(
  pending: Fp95PendingSwitchControl | null,
  currentAircraftId: number | null,
  hasTelemetry: boolean,
  actualState: boolean,
) {
  return Boolean(
    pending
      && hasTelemetry
      && currentAircraftId === pending.aircraftId
      && actualState === pending.target,
  )
}
