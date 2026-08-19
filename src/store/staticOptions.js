import { defineStore } from 'pinia'
import cesiumAirPlane from '@/assets/models/Cesium_Air.glb?url'
import fp985Plane from '@/assets/models/FP-985.gltf?url'
import fp98Plane from '@/assets/models/fp-98.gltf?url'

export const useStaticStore = defineStore('staticOptions', {
  state: () => {
    return {
      temp: {
        userName: 'sysUser003',
        password: 'sysUser003',
        token: '',
      },
      networkStatus: {
        offlineMode: false, //离线模式
      },
      showRouteManage: false, // 是否显示航线管理页面

      menuOptions: {
        obstacleOptions: [
          { label: '选择机场加载', key: 'selectAirports' },
          { label: '显示障碍物', key: 'showObstacle' },
        ],
        EditOptions: [
          { label: '绘制航线', key: 'createLine' },
          { label: '航线管理', key: 'manage' },
          { label: '标记障碍', key: 'marker' },
        ],
        sceneOptions: [
          { label: '三维伴飞', value: 'companion' },
          { label: '取消伴飞', value: 'untrace' },
        ],
        MeasureOptions: [
          { label: '距离测量', key: 'distance' },
          { label: '面积测量', key: 'area' },
          { label: '清除测量', key: 'clear' },
        ],
        DrawOptions: [
          { label: '矩形', key: 'rec' },
          { label: '圆形', key: 'circle' },
          { label: '多边形', key: 'polygon' },
          { label: '清除形状', key: 'clear' },
        ],
        AnalyzeOptions: [
          { label: '通视分析', key: 'visibility' },
          { label: '地形剖面', key: 'profile' },
        ],
        //图层选项，动态
        layerOptions: [
          {
            label: '图层1',
            value: 'layer1',
          },
        ],
        //航线通视分析
        LosAnalyzeOptions: [
          { label: '通视分析', key: 'losAnalyse' },
          { label: '停止分析', key: 'stopLosAnalyse' },
        ],
      },
      webskt: {
        ws: null,
        isOpen: false,
        ws_config: {
          address: '127.0.0.1',
          port: 9090,
        },
      },
      models: {
        defaultAirPlane: cesiumAirPlane,
        fp985: fp985Plane,
        fp98: fp98Plane,
      },
      hasPlane: false,
      uav: {
        ModelIDinMap: '', //地图中的飞机entity ID
      },

      analysisVars: {
        //当前的空间分析类型，剖面1 通视2
        analysisType: -1,
        profilePts: [], //地形分析的点数组
      },
    }
  },
})
