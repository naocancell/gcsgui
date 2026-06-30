import { defineStore } from 'pinia'
import { Airline, routeTerrain } from '@/types/entityoptions.ts'
type layer = {
  lName: string   //图层名称
  lId: string     //图层ID
  dataSource?: any //数据源
  imageLayer?: any //图层
  entity?: any[]   //几何实体
  show: boolean    //是否显示
}

export const useLayerStore = defineStore('LayerStore', {
  state: () => {
    return {
      Layers: [] as layer[],
      openDetect: true,
      validYCData: false,
      navi: {
        airlines: [] as Airline[],
        currentRouteID: -1, //当前航线号
        nextRouteID: -1, //下一航线号
        nextPoint: -1, //下一航点号
        distonext: -1, //待飞距离
        hFactor: 3, //高度修正数
        activeDesignRoute: null as Airline | null, //当前激活的设计航线（用于三维伴飞和高度预警）
      },
      routesTerrain: [] as routeTerrain[],
    }
  },
  actions: {
    //添加图层数组
    addLayer(
      lName: string,
      dataSource?: any,
      imageLayer?: any,
      entity?: any[],
      show = true,
    ) {
      let time = new Date()
      //自定义的layer类型 用于展示图层的属性
      let layer: layer = {
        dataSource: dataSource,
        imageLayer: imageLayer,
        entity: entity,
        lId: time.getTime().toString(),
        lName: lName,
        show: show,
      }
      //记录图层
      this.Layers.push(layer)
    },
    removeLayer(lId: string) {
      let i = this.Layers.findIndex((layer: layer) => layer.lId === lId)
      if (i > -1) {
        //从i位置删除一个图层
        this.Layers.splice(i, 1)
      }
    },
    //删除Layer中的所有图层
    clearLayersList() {
      this.Layers = []
    },
    /**
     * 根据航线编号从已有航线中匹配并激活设计航线
     * @param routeId 航线编号
     */
    setActiveDesignRoute(routeId: number) {
      const found = this.navi.airlines.find(
        (r: Airline) => r.code === routeId && r.isDesignRoute,
      )
      this.navi.activeDesignRoute = found ?? null
    },
        // 置顶
    moveLayerTop(lId: string) {
      const index = this.Layers.findIndex((item) => item.lId === lId);

      // 没找到，或者已经在最上面了
      if (index <= 0) {
        return;
      }

      const [layer] = this.Layers.splice(index, 1);
      this.Layers.unshift(layer);
    },

    // 置底
    moveLayerBottom(lId: string) {
      const index = this.Layers.findIndex((item) => item.lId === lId);

      // 没找到，或者已经在最下面了
      if (index === -1 || index >= this.Layers.length - 1) {
        return;
      }

      const [layer] = this.Layers.splice(index, 1);
      this.Layers.push(layer);
    },
      // 上移一层
    moveLayerUp(lId: string) {
      const index = this.Layers.findIndex((item) => item.lId === lId);

      // 没找到，或者已经在最上面了
      if (index <= 0) {
        return;
      }

      const temp = this.Layers[index - 1];
      this.Layers[index - 1] = this.Layers[index];
      this.Layers[index] = temp;
    },

    // 下移一层
    moveLayerDown(lId: string) {
      const index = this.Layers.findIndex((item) => item.lId === lId);

      // 没找到，或者已经在最下面了
      if (index === -1 || index >= this.Layers.length - 1) {
        return;
      }
      
      const temp = this.Layers[index + 1];
      this.Layers[index + 1] = this.Layers[index];
      this.Layers[index] = temp;
    },
  },
})
