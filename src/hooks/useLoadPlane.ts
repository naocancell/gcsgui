import * as Cesium from "cesium";
import { watch } from "vue";
import { useUavStore } from "@/store/uavStore.ts";
import { PlaneState } from "@/types/entityoptions";
import { PLANE_CONFIG } from "@/utils/plane/planeConfig";
import {UAVInfo, FP95Frame94Sub1} from "@/types/entityoptions";
import {normalizeUAVInfo, normalizeFP95} from "@/utils/plane/planeAdapter";
export function useLoadPlane() {
  //获取飞机的状态管理store
  const store = useUavStore();
  
  /**
   * 已经成功加载到 Cesium 场景中的飞机模型map
   * key: 飞机唯一标识id
   * value: Cesium.Model 实例
   */
  const planeMap = new Map<string, Cesium.Model>();
   /**
   * 正在异步加载中的飞机 id集合
   * 防重复调用 Cesium.Model.fromGltfAsync()
   */
  const loadingSet = new Set<string>();

  /**
   * 要渲染的目标飞机 targetMap，
   * 每帧渲染时 updateModelMatrix 会读取这个数据
  */
  const targetMap = new Map<string, PlaneState>();
/**
   * 动态尾巴的点（世界坐标）
   * 只有最近 TAIL_SIZE 个点放这里，CallbackProperty 每帧读取，
   * 所以无论总轨迹多长，每帧重算的几何体永远只有这一小段
   */
  const tailPositions = new Map<string, Cesium.Cartesian3[]>();

  // 每架飞机的动态尾巴实体（CallbackProperty polyline），只创建一次
  const tailEntities = new Map<string, Cesium.Entity>();

  /**
   * 已经"封存"的历史段实体列表
   * 每段是一条静态 polyline，画完就不再参与每帧重算
   */
  const frozenTrails = new Map<string, Cesium.Entity[]>();

  // 动态尾巴保留的点数，到这个数量就把这段封存成静态历史段
  const TAIL_SIZE = 50;

  // 冻结后动态尾巴与历史段的重叠点数，保证接缝连续不闪
const TAIL_OVERLAP = 10;

  //每架飞机最后一次收到数据的时间戳，判断飞机是否离线
  const lastSeenMap = new Map<string, number>();

  //移除渲染监听
  let removePreUpdate: (() => void) | null = null;

  //移除watch监听
  let stopWatch: (() => void) | null = null;
  //间隔定时器检查飞机是否离线
  let intervalId: number | null = null; 
//飞机模型矩阵
   const buildMatrix = (p: PlaneState) => {
    // 经纬高转换成 Cesium 世界坐标
    const position = Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.alt);
    // Cesium 使用弧度，所以角度需要转弧度
    const hpr = new Cesium.HeadingPitchRoll(
      Cesium.Math.toRadians(p.heading),
      Cesium.Math.toRadians(p.pitch),
      Cesium.Math.toRadians(p.roll)
    );
    // 根据位置和姿态生成模型矩阵
    return Cesium.Transforms.headingPitchRollToFixedFrame(position, hpr);
  };

  /**
   * 更新某架飞机的航线
   * 1. 新点 push 进动态尾巴
   * 2. 尾巴满了就封存成静态历史段，并保留最后一点接上下一段
   */
  const updateTrail = (viewer: Cesium.Viewer, plane: PlaneState) => {
  const key = plane.id;

  // 取出或初始化该飞机的动态尾巴数组
  let tail = tailPositions.get(key);
  if (!tail) {
    tail = [];
    tailPositions.set(key, tail);
  }

  // 当前点的世界坐标
  const pos = Cesium.Cartesian3.fromDegrees(plane.lon, plane.lat, plane.alt);

  // 和上一个点几乎重合就不重复添加，避免静止时堆积大量点
  const last = tail[tail.length - 1];
  if (last && Cesium.Cartesian3.equalsEpsilon(last, pos, Cesium.Math.EPSILON7)) {
    return;
  }
  tail.push(pos);

  // 动态尾巴实体只创建一次，positions 用 CallbackProperty 每帧读取最新尾巴
  if (!tailEntities.has(key)) {
    const entity = viewer.entities.add({
      polyline: {
        positions: new Cesium.CallbackProperty(
          () => tailPositions.get(key) ?? [],
          false
        ),
        width: 2,
        material: Cesium.Color.YELLOW,
        clampToGround: false,
      },
    });
    tailEntities.set(key, entity);
  }

  // 尾巴满了，封存成历史段
  if (tail.length >= TAIL_SIZE) {
    // 固定快照：创建后引用不再变化
    const frozenPositions = tail.slice();

    const frozen = viewer.entities.add({
      polyline: {
        // 关键：用 CallbackProperty 返回固定引用，
        // 走和动态尾巴一样的“立即渲染”路径，避免静态几何构建的延迟（闪烁根因）
        positions: new Cesium.CallbackProperty(() => frozenPositions, false),
        width: 2,
        material: Cesium.Color.YELLOW,
        clampToGround: false,
      },
    });

    let list = frozenTrails.get(key);
    if (!list) {
      list = [];
      frozenTrails.set(key, list);
    }
    list.push(frozen);

    // 动态尾巴保留最近 TAIL_OVERLAP 个点，与历史段末尾重叠，接缝连续不断线
    tailPositions.set(key, tail.slice(-TAIL_OVERLAP));
  }

  viewer.scene.requestRender();
};

  // 清理某架飞机的所有航线资源（动态尾巴 + 所有历史段）
  const removeTrail = (viewer: Cesium.Viewer, key: string) => {
    // 移除动态尾巴实体
    const tailEntity = tailEntities.get(key);
    if (tailEntity) {
      viewer.entities.remove(tailEntity);
      tailEntities.delete(key);
    }

    // 移除所有冻结历史段实体
    const list = frozenTrails.get(key);
    if (list) {
      for (const entity of list) {
        viewer.entities.remove(entity);
      }
      frozenTrails.delete(key);
    }

    tailPositions.delete(key);
  };

  //移除指定飞机函数
   const removePlane = (viewer: Cesium.Viewer, key: string) => {
    const model = planeMap.get(key);

    // 飞机模型存在，从 Cesium primitives 中移除
    if (model) {
      viewer.scene.primitives.remove(model);
    }
    // 负责连航线一起移除
    removeTrail(viewer, key);

    // 清理该飞机缓存
    planeMap.delete(key);
    loadingSet.delete(key);
    targetMap.delete(key);
    lastSeenMap.delete(key);
  };

 //加载飞机模型函数
  const loadPlaneIfNeeded = async (viewer: Cesium.Viewer, plane: PlaneState) => {
    //获取飞机的唯一标识
    const key = plane.id;
    // 模型存在或者正在加载
    if (planeMap.has(key) || loadingSet.has(key)) {
      return;
    }
    // 标记该飞机正在加载
    loadingSet.add(key);

    // 根据飞机类型读取对应的模型、缩放、颜色等配置
    const config = PLANE_CONFIG[plane.type];

    try {
      //飞机实例
      const model = await Cesium.Model.fromGltfAsync({
        //cesium设置模型自身id属性 设置未飞机id 和type的对象 picked.primitive.id 可以拿到这个对象
        id: {
          key: plane.id,
          kind: plane.type,
        },
        // 飞机对应的 glTF 模型位置
        url: config.url,
        // 初始模型矩阵
        modelMatrix: buildMatrix(plane),
        // 模型缩放比例
        scale: config.scale,
        minimumPixelSize: config.minimumPixelSize,
        maximumScale: config.maximumScale,
        color: config.color,
        // 颜色混合模式
        colorBlendMode: Cesium.ColorBlendMode.MIX,
        // 染色强度，0~1
        colorBlendAmount: config.colorBlendAmount,
      });

      
      //模型是异步加载，判断 targetMap.has(key)是否还存在该模型，不存在不用加载
      if (!targetMap.has(key)) {
        return;
      }
      // 加载飞机模型
      viewer.scene.primitives.add(model);

      // 缓存模型，后续更新位置和清理时都会用到
      planeMap.set(key, model);
      // 请求 Cesium 重新渲染一帧
      viewer.scene.requestRender();
    } catch (e) {
      console.error("模型加载失败", key, e);
    } finally {
      // 不管加载成功还是失败，都取消 loading 标记
      loadingSet.delete(key);
    }
  };

   /**
   * 根据当前 store 中的飞机列表，更新 Cesium 中维护的飞机状态函数
   * 1. 更新 targetMap，让渲染循环拿到最新位置
   * 2. 飞机模型不存在，则发起模型加载
   * 3. 飞机已经不在当前数据里，则移除
   */
  const updatePlanes = (viewer: Cesium.Viewer, planes: PlaneState[]) => {
    const now = Date.now();//获取当前时间戳

    //uavStore中最新飞机数据id
    const currentKeys = new Set<string>();
    for (const plane of planes) {
      currentKeys.add(plane.id);

      // 更新要进行渲染的飞机的id 和数据
      targetMap.set(plane.id, plane);

      // 更新该飞机最后一次收到数据的时间
      lastSeenMap.set(plane.id, now);

      // 如果该飞机模型还没加载，则开始加载
      loadPlaneIfNeeded(viewer, plane);

      // 只有需要显示航线的飞机（UAVInfo 类型）才更新航线
      if (plane.showTrail) {
        updateTrail(viewer, plane);
      }
    }

     //清理当前数据中已经不存在的飞机
    for (const key of Array.from(targetMap.keys())) {
      if (!currentKeys.has(key)) {
        removePlane(viewer, key);
      }
    }

    // 请求重新渲染
    viewer.scene.requestRender();
  };

 //主函数，在Cesium初始化后调用
  const init = (viewer: Cesium.Viewer) => {
    // 开启 Cesium 渲染循环 关闭请求渲染模式
    viewer.scene.requestRenderMode = false;

    // 监听 store 中两类飞机数据的变化 把不同结构的数据 normalize 成统一 PlaneState。
    stopWatch = watch(
      () => [
        store.uavInfoMap,
        store.fp95Map,
      ],//同时监听
      () => {
        //将UAVInfo和FP95数据转换成统一格式 用于加载飞机
        const planes: PlaneState[] = [];
        //normalizeUAVInfo函数将 UAVInfo 类型数据转换成统一 PlaneState格式
        store.uavInfoMap?.forEach((uav: UAVInfo) => {
          planes.push(normalizeUAVInfo(uav));//存放到planes数组中
        });

        //将 FP95 类型数据转换成统一 PlaneState
        store.fp95Map?.forEach((item: FP95Frame94Sub1) => {
          planes.push(normalizeFP95(item));
        });
        // 用统一后的飞机列表更新 Cesium 模型
        updatePlanes(viewer, planes);
      },
      {
        //初始化时立即执行一次，防止 init 调用时 store 里已经有飞机数据
        immediate: true,
      }
    );

    
    //定时检查飞机是否超时每 1 秒检查一次，飞机超过 2 秒没更新移除
    intervalId = window.setInterval(() => {
      const now = Date.now();
      for (const [key, lastSeen] of Array.from(lastSeenMap.entries())) {
        if (now - lastSeen > 2000) {
          removePlane(viewer, key);
        }
      }
    }, 1000);

    //Cesium 每一帧更新前执行 统一更新所有飞机模型的 modelMatrix，
    const onPreUpdate = () => {
      planeMap.forEach((model, key) => {
        const target = targetMap.get(key);
        if (target) {
          model.modelMatrix = buildMatrix(target);
        }
      });

      // 请求下一帧渲染
      viewer.scene.requestRender();
    };

    // 绑定 Cesium 渲染前事件
    viewer.scene.preUpdate.addEventListener(onPreUpdate);

    // 保存解绑函数，clear 时调用
    removePreUpdate = () => {
      viewer.scene.preUpdate.removeEventListener(onPreUpdate);
    };
  };

   //清空并销毁当前维护的所有资源
  const clearAll = (viewer: Cesium.Viewer) => {
    // 停止监听 store 数据
    stopWatch?.();

    // 移除 Cesium 渲染循环监听
    removePreUpdate?.();
    // 清除定时器
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }

    // 从 Cesium 场景中移除所有飞机模型
    planeMap.forEach((model) => {
      viewer.scene.primitives.remove(model);
    });

    // 移除所有动态尾巴实体
    tailEntities.forEach((entity) => {
      viewer.entities.remove(entity);
    });

    // 移除所有冻结历史段实体
    frozenTrails.forEach((list) => {
      list.forEach((entity) => {
        viewer.entities.remove(entity);
      });
    });

    // 清空所有缓存
    planeMap.clear();
    loadingSet.clear();
    targetMap.clear();
    lastSeenMap.clear();
    tailPositions.clear();
    tailEntities.clear();
    frozenTrails.clear();
    // 重置解绑函数，避免重复调用
    stopWatch = null;
    removePreUpdate = null;
  };

  return {
    // 初始化飞机图层
    init,
    // 清空飞机图层并解绑监听
    clearAll,
  };
}
