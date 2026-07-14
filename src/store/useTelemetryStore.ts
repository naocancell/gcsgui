// stores/useTelemetryStore.ts
import { defineStore } from 'pinia'

export interface UavTelemetry {
    timestamp: number

    longitude: number
    latitude: number
    altitude: number

    heading: number
    pitch: number
    roll: number
    yaw: number

    groundSpeed: number
    verticalSpeed: number

    battery: number
    gpsSatellites: number

    flightMode: string
    armed: boolean
}

export const useTelemetryStore = defineStore(
    'telemetry',
    {
        state: () => ({
            // telemetry: null as UavTelemetry | null,
            telemetry: {
                timestamp: 0,

                longitude: 0,
                latitude: 0,
                altitude: 0,

                heading: 0,
                pitch: 0,
                roll: 0,
                yaw: 0,

                groundSpeed: 0,
                verticalSpeed: 0,

                battery: 0,
                gpsSatellites: 0,

                flightMode: '未知',
                armed: false,

                signalStrength: 0,
                voltage: 0,
                current: 0,

                homeDistance: 0,
                flightTime: 0
            } as UavTelemetry,
            
            connected: false,

            lastUpdateTime: 0,

            stale: false,

            TIMEOUT: 2000 // 2秒没有数据认为数据超时
        }),

        actions: {
            setConnected(value: boolean) {
                this.connected = value
            },

            checkTimeout() {

                if (!this.lastUpdateTime) {
                    return
                }
                const now = Date.now()
                if (
                    now - this.lastUpdateTime > this.TIMEOUT
                ) {
                    this.stale = true
                }
    },

            updateTelemetry(data: UavTelemetry) {
                this.telemetry = data
                this.lastUpdateTime = Date.now()
                this.stale = false
            },

            markStale() {
                this.stale = true
            },

            clearTelemetry() {
                this.telemetry = null
                this.lastUpdateTime = 0
                this.stale = true
            }
        }
    }
)