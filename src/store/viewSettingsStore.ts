import { defineStore } from 'pinia'

export type AdministrativeLevel = 'province' | 'city' | 'county'

export const useViewSettingsStore = defineStore('viewSettings', {
  state: () => ({
    // 经纬网默认关闭，由视图设置控制是否显示。
    showCoordinates: false,
    showProvince: false,
    showCity: false,
    showCounty: false,
  }),
})
