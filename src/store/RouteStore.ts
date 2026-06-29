import { defineStore } from 'pinia'
import { Airline } from '@/types/entityoptions.ts'

export const useRouteStore = defineStore('RouteStore', {
  state: () => {
    return {
      flyRoute: [] as Airline[], //地图中绘制的航线，用于发送给后端（QT）
    }
  },
  actions: {
    /**
     * 向store中添加航线，unicode为唯一码，如冲突，原有航线会被覆盖（应该不会重复）
     * @param route
     */
    addRoute(route: Airline) {
      let index = this.flyRoute.findIndex(
        (item: Airline) => item.unicode === route.unicode,
      )
      if (index > -1) {
        this.flyRoute.splice(index, 1)
      }
      this.flyRoute.push(route)
    },
    /**
     * 从store中删除指定航线
     * @param unicode 航线唯一码
     */
    removeRoute(unicode: string) {
      let index = this.flyRoute.findIndex(
        (item: Airline) => item.unicode === unicode,
      )
      if (index > -1) {
        this.flyRoute.splice(index, 1)
      }
    },
  },
})
