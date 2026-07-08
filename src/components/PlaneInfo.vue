<!-- 
点击显示飞机信息的面板 
-->
<template>
  <div
    v-if="selectedPlane && visible"
    class="plane-info-panel"
    :style="{ left: panelPos.x + 'px', top: panelPos.y + 'px' }"
  >
  <!-- 信息框标题 -->
    <div class="title">
      {{ panelTitle }}
    </div>
  <!-- 信息框 -->
    <div
      v-for="row in infoRows"
      :key="row.label"
      class="row"
    >
      <span>{{ row.label }}</span>
      <b>{{ row.value }}</b>
    </div>
  </div>
</template>

<script setup lang="ts">
import * as Cesium from "cesium";
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useUavStore } from "@/store/uavStore";

import type { UAVInfo, FP95Frame94Sub1, FP981CAggregate, PlaneType, PlaneState } from "@/types/entityoptions";

import { normalizeUAVInfo, normalizeFP95, normalizeFP981C } from "@/utils/plane/planeAdapter";
import { PLANE_CONFIG } from "@/utils/plane/planeConfig";

import { useSelectedPlaneStore } from '@/store/selectedPlaneStore'
//选中飞机的信息状态管理
const selectedPlaneStore = useSelectedPlaneStore()
//飞机模型的的id和类型的对象
type PlaneModelId = {
  key: string;
  kind: PlaneType;
};
//飞机信息的字段和值(展示面板上用)
type InfoRow = {
  label: string;
  value: string | number;
};
//真实飞机数据的状态管理store
const store = useUavStore();

//用于存储当前选中的飞机 key
const selectedKey = ref<string | null>(null);

//飞机信息框位置（屏幕坐标）
const panelPos = ref({
  x: 0,
  y: 0,
});

//飞机在视野内时才显示面板
const visible = ref(false);

//当前高亮的模型(Cesium.Model)
let highlighted: Cesium.Model | null = null;

// Cesium 点击事件处理器
let handler: Cesium.ScreenSpaceEventHandler | null = null;

//移除 postRender(因为飞机位置是实时变化的所以要一直渲染监听) 监听的函数
let removeRender: (() => void) | null = null;

// 把 store 里的两种飞机数据统一转换成 PlaneState格式，并存储在 allPlaneMap 里
const allPlaneMap = computed(() => {
  const map = new Map<string, PlaneState>();
  store.uavInfoMap?.forEach((uav: UAVInfo) => {
    const plane = normalizeUAVInfo(uav);
    map.set(plane.id, plane);
  });

  store.fp95Map?.forEach((item: FP95Frame94Sub1) => {
    const plane = normalizeFP95(item);
    map.set(plane.id, plane);
  });
  store.fp981cMap?.forEach((item: FP981CAggregate) => {
    const plane = normalizeFP981C(item);
    map.set(plane.id, plane);
  });
  return map;
});

//当前选中的飞机完整信息(拿到这个PlaneState对象，就可以拿到飞机的原始数据)计算属性
const selectedPlane = computed(() => {
  if (!selectedKey.value) {
    return null;
  }
  return allPlaneMap.value.get(selectedKey.value) ?? null;
});

// 面板标题
const panelTitle = computed(() => {
  const plane = selectedPlane.value;
  if (!plane) {
    return "";
  }

  if (plane.type === "uavInfo") {
    const raw = plane.raw as UAVInfo;//飞机原始信息
    return `UAV ${raw.uavId}`;
  }

  if (plane.type === "fp95") {
    const raw = plane.raw as FP95Frame94Sub1;//飞机原始信息
    return `ADS-B ${raw.sAddress}`;
  }

  if (plane.type === "fp981c") {
    const raw = plane.raw as FP981CAggregate;
    return `FP981C ${raw.uav_id}`;
  }

  return "飞机信息";
});

//根据飞机类型生成不同面板字段
 //不同飞机显示字段不同，就在这里分支处理。
const infoRows = computed<InfoRow[]>(() => {
  const plane = selectedPlane.value;//当前选中的飞机
  if (!plane) {
    return [];
  }

  if (plane.type === "uavInfo") {
    const raw = plane.raw as UAVInfo;
    return [
      {
        label: "飞机号",
        value: raw.uavId,
      },
      {
        label: "型号",
        value: raw.uavSeries,
      },
      {
        label: "经度",
        value: raw.longitude.toFixed(6),
      },
      {
        label: "纬度",
        value: raw.latitude.toFixed(6),
      },
      {
        label: "海拔高度",
        value: `${raw.altitude.toFixed(1)} m`,
      },
      {
        label: "相对高度",
        value: `${raw.relativeAltitude.toFixed(1)} m`,
      },
      {
        label: "地速",
        value: `${raw.groundSpeed.toFixed(1)} m/s`,
      },
      {
        label: "地速方向",
        value: `${raw.groundSpeedDirection.toFixed(1)} °`,
      },
      {
        label: "垂直速度",
        value: `${raw.verticalSpeed.toFixed(1)} m/s`,
      },
      {
        label: "空速",
        value: `${raw.airspeed.toFixed(1)} m/s`,
      },
      {
        label: "真空速",
        value: `${raw.trueAirspeed.toFixed(1)} m/s`,
      },
      {
        label: "俯仰角",
        value: `${raw.pitchAngle.toFixed(1)} °`,
      },
      {
        label: "滚转角",
        value: `${raw.rollAngle.toFixed(1)} °`,
      },
      {
        label: "航向角",
        value: `${raw.headingAngle.toFixed(1)} °`,
      },
      {
        label: "当前航线",
        value: raw.currentRouteId,
      },
      {
        label: "下一航线",
        value: raw.nextRouteId,
      },
      {
        label: "下一航点",
        value: raw.nextPoint,
      },
      {
        label: "待飞距",
        value: `${raw.distanceNext.toFixed(1)} m`,
      },
    ];
  }

  if (plane.type === "fp95") {
    const raw = plane.raw as FP95Frame94Sub1;

    return [
      {
        label: "地址类型",
        value: raw.addressType,
      },
      {
        label: "S模式地址",
        value: raw.sAddress,
      },
      {
        label: "经度",
        value: raw.adsLon.toFixed(6),
      },
      {
        label: "纬度",
        value: raw.adsLat.toFixed(6),
      },
      {
        label: "高度",
        value: `${raw.adsAlt.toFixed(1)} m`,
      },
      {
        label: "航向角",
        value: `${raw.adsYaw.toFixed(1)} °`,
      },
      {
        label: "水平速度",
        value: `${raw.adsVl.toFixed(1)} m/s`,
      },
      {
        label: "垂直速度",
        value: `${raw.adsVu.toFixed(1)} m/s`,
      },
    ];
  }

  if (plane.type === "fp981c") {
    const raw = plane.raw as FP981CAggregate;

    return [
      {
        label: "FP981C ID",
        value: raw.uav_id,
      },
      {
        label: "Longitude",
        value: plane.lon.toFixed(6),
      },
      {
        label: "Latitude",
        value: plane.lat.toFixed(6),
      },
      {
        label: "Altitude",
        value: `${plane.alt.toFixed(1)} m`,
      },
      {
        label: "Heading",
        value: `${plane.heading.toFixed(1)} deg`,
      },
      {
        label: "Pitch",
        value: `${(plane.pitch ?? 0).toFixed(1)} deg`,
      },
      {
        label: "Roll",
        value: `${(plane.roll ?? 0).toFixed(1)} deg`,
      },
    ];
  }

  return [];
});

/**
 * 获取点击模型ID的函数
 * 从 Cesium.Model 的 id 中取出飞机 key 和 type
 * id: {
 *   key: plane.key,
 *   kind: plane.type,
 * }
 */
const getPlaneModelId = (model: Cesium.Model): PlaneModelId | null => {
  const id = model.id as PlaneModelId | string | undefined;

  if (!id) {
    return null;
  }
  // id 是对象形式
  if (typeof id === "object" && "key" in id && "kind" in id) {
    return id;
  }

  return null;
};


//恢复模型默认颜色函数
const applyDefaultColor = (model: Cesium.Model) => {
  const modelId = getPlaneModelId(model);
  if (!modelId) {
    return;
  }
//根据飞机类型拿到配置信息
  const config = PLANE_CONFIG[modelId.kind];
//恢复最初的配置信息
  model.color = config.color;
  model.colorBlendMode = Cesium.ColorBlendMode.MIX;
  model.colorBlendAmount = config.colorBlendAmount;
};

//增加高亮
const addHighlight = (model: Cesium.Model) => {
  model.color = Cesium.Color.RED.withAlpha(0.7);
  model.colorBlendMode = Cesium.ColorBlendMode.MIX;
  model.colorBlendAmount = 1;
};

// 取消高亮
const removeHighlight = (model: Cesium.Model | null) => {
  if (model && !model.isDestroyed()) {
    applyDefaultColor(model);
  }
};

// 清空当前选中状态
const clearSelected = () => {
  selectedKey.value = null
  visible.value = false
  removeHighlight(highlighted)
  highlighted = null
  selectedPlaneStore.clearSelectedPlane()
}

onMounted(() => {
  const viewer = window.viewer as Cesium.Viewer;
  if (!viewer) {
    console.error("viewer 不存在");
    return;
  }

  handler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);
// 屏幕点击事件
  handler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
    //picked包含图元信息primitive 也就是飞机
    const picked = viewer.scene.pick(movement.position);
    if (
      Cesium.defined(picked) &&
      picked.primitive instanceof Cesium.Model//点中的是模型
    ) {
      //拿到飞机模型
      const model = picked.primitive as Cesium.Model;
      const modelId = getPlaneModelId(model);
      //飞机是否还存在
      if (modelId && allPlaneMap.value.has(modelId.key)) {
        // 先取消上一个模型的高亮
        removeHighlight(highlighted);
        // 选中当前飞机
        selectedKey.value = modelId.key;
        // 高亮当前模型
        highlighted = model;
        addHighlight(highlighted);

        selectedPlaneStore.setSelectedPlane(model, {
          key: modelId.key,
          kind: modelId.kind,
        })
        return;
      }
    }

    // 没点中飞机，取消选中
    clearSelected();
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);


  const onPostRender = () => {
    // 如果当前高亮模型已经被移出 Cesium 场景，就清空面板
    if (
      highlighted &&
      (
        highlighted.isDestroyed() ||
        !viewer.scene.primitives.contains(highlighted)
      )
    ) {
      clearSelected();
      return;
    }

    const plane = selectedPlane.value;
    if (!plane) {
      clearSelected();
      return;
    }
// 获取飞机在地球上的坐标
    const worldPos = Cesium.Cartesian3.fromDegrees(
      plane.lon,
      plane.lat,
      plane.alt
    );
// 获取屏幕坐标
    const winPos = Cesium.SceneTransforms.wgs84ToWindowCoordinates(
      viewer.scene,
      worldPos
    );

    // 飞机在地球背面、视锥外、或者暂时无法投影时隐藏面板
    if (!winPos) {
      visible.value = false;
      return;
    }
  //获取cesium现在画布在屏幕上的位置
    const rect = viewer.canvas.getBoundingClientRect();

    panelPos.value = {
      x: rect.left + winPos.x + 14,
      y: rect.top + winPos.y - 10,
    };

    visible.value = true;
  };
  // 监听渲染事件
  viewer.scene.postRender.addEventListener(onPostRender);

  removeRender = () => {
    viewer.scene.postRender.removeEventListener(onPostRender);
  };
});

onUnmounted(() => {
  handler?.destroy();
  handler = null;

  removeRender?.();
  removeRender = null;

  removeHighlight(highlighted);
  highlighted = null;
});
</script>

<style scoped>
.plane-info-panel {
  position: fixed;
  z-index: 9999;
  min-width: 220px;
  max-width: 280px;
  padding: 10px 12px;
  background: rgba(20, 28, 40, 0.9);
  color: #e6eefc;
  border: 1px solid rgba(120, 170, 255, 0.4);
  border-radius: 6px;
  font-size: 13px;
  line-height: 1.6;
  pointer-events: none;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  transition: left 0.05s linear, top 0.05s linear;
}

.plane-info-panel .title {
  font-weight: 600;
  margin-bottom: 6px;
  color: #7fb0ff;
}

.plane-info-panel .row {
  display: flex;
  justify-content: space-between;
  gap: 16px;
}

.plane-info-panel .row span {
  color: #9fb3d0;
  white-space: nowrap;
}

.plane-info-panel .row b {
  font-weight: 500;
  text-align: right;
  word-break: break-all;
}
</style>
