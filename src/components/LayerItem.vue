<!-- 在图层管理面板里面显示的子组件 -->
<script setup lang="ts">
import { Menu } from '@vicons/ionicons5'
import { useLayerStore } from '@/store/layerManagerStore.ts'
import { ref } from 'vue'
let layerShow = ref(true)
import * as Cesium from 'cesium'
let layer: { name: string; id: string } = {
  name: '',
  id: '',
}
let itemOptions = [
  { label: '移除图层', key: 'remove' },
  { label: '缩放至图层', key: 'lookAt' },
  { label: '移至顶层', key: 'moveTop' },
  { label: '上移一层', key: 'moveUp' },
  { label: '下移一层', key: 'moveDown' },
  { label: '移至底层', key: 'moveBottom' },
]

function flyToEntities(entities: Cesium.Entity[]) {
  const viewer = window.viewer
  const tmp = new Cesium.BoundingSphere()
  const display = viewer.dataSourceDisplay as any
  let tries = 0

  function tryFly() {
    const spheres: Cesium.BoundingSphere[] = []
    let pending = false

    for (const entity of entities) {
      const state = display.getBoundingSphere(entity, false, tmp)
      if (state === 1 /* PENDING */) {
        pending = true
        break
      }
      if (state === 0 /* DONE */) {
        spheres.push(Cesium.BoundingSphere.clone(tmp))
      }
      // 2 = FAILED，跳过
    }

    // 几何还没建好：推一帧渲染，下一帧再试（这就是“跨帧”，等同于你勾选/取消争取到的时间）
    if (pending && tries < 60) {
      tries++
      viewer.scene.requestRender()
      requestAnimationFrame(tryFly)
      return
    }

    if (spheres.length === 0) return

    const combined = Cesium.BoundingSphere.fromBoundingSpheres(spheres)
    viewer.camera.flyToBoundingSphere(combined, { duration: 1.5 })
  }

  tryFly()
}

function handleLayerItem(key: any) {
  useLayerStore().Layers.forEach((layer) => {
    if (layer.lName == props.lname && layer.lId == props?.lid) {
      switch (key) {
        case 'remove': {
          if (layer.dataSource) {
            layer.dataSource.then((ds) => {
              window.viewer.dataSources.remove(ds)
            })
          }
          if (layer.imageLayer) {
            window.viewer.imageryLayers.remove(layer.imageLayer)
          }
          if (layer.entity.length > 0) {
            layer.entity.forEach((item) => {
              console.log(window.viewer.entities.remove(item))
            })
            window.viewer.scene.requestRender()
          }

          useLayerStore().removeLayer(layer.lId)
          break
        }
        case 'lookAt': {
           if (layer.entity.length > 0) {
    console.log('entity 数量:', layer.entity.length)
    layer.entity.forEach((e, i) => {
      console.log(`#${i}`, {
        是否Entity实例: e instanceof Cesium.Entity,
        在场景里: window.viewer.entities.contains(e),
        有polyline: !!e?.polyline,
        show: e?.show,
      })
    })
    window.viewer.flyTo(layer.entity)
  }
  break
        }
        //图层移动：
        case 'moveTop': {
          // 影像图层置顶
          if (layer.imageLayer) {
            window.viewer.imageryLayers.raiseToTop(layer.imageLayer)
          }
          // DataSource 图层置顶
          if (layer.dataSource) {
            layer.dataSource.then((ds) => {
              if (window.viewer.dataSources.contains(ds)) {
                window.viewer.dataSources.raiseToTop(ds)
              }
            })
          }

          // 左侧图层列表同步置顶
          useLayerStore().moveLayerTop(layer.lId)

          window.viewer.scene.requestRender()
          break
        }
        case 'moveBottom': {
          // 影像图层置底
          if (layer.imageLayer) {
            window.viewer.imageryLayers.lowerToBottom(layer.imageLayer)
          }
          // DataSource 图层置底
          if (layer.dataSource) {
            layer.dataSource.then((ds) => {
              if (window.viewer.dataSources.contains(ds)) {
                window.viewer.dataSources.lowerToBottom(ds)
              }
            })
          }
          // 左侧图层列表同步置底
          useLayerStore().moveLayerBottom(layer.lId)
          window.viewer.scene.requestRender()
          break
        }
        //移动一层
      case 'moveUp': {
        if (layer.imageLayer) {
          window.viewer.imageryLayers.raise(layer.imageLayer)
        }

        if (layer.dataSource) {
          layer.dataSource.then((ds) => {
            if (window.viewer.dataSources.contains(ds)) {
              window.viewer.dataSources.raise(ds)
            }
          })
        }

        useLayerStore().moveLayerUp(layer.lId)

        window.viewer.scene.requestRender()
        break
      }

      case 'moveDown': {
        if (layer.imageLayer) {
          window.viewer.imageryLayers.lower(layer.imageLayer)
        }

        if (layer.dataSource) {
          layer.dataSource.then((ds) => {
            if (window.viewer.dataSources.contains(ds)) {
              window.viewer.dataSources.lower(ds)
            }
          })
        }

        useLayerStore().moveLayerDown(layer.lId)

        window.viewer.scene.requestRender()
        break
      }
      }
    }
  })
}
//从父组件接收数据
const props = defineProps<{ lname: String; lid?: String }>()
//勾选显示  取消勾选不显示
function onCheck(checked: boolean) {
  useLayerStore().Layers.forEach((layer) => {
    if (layer.lName == props.lname && layer.lId == props?.lid) {
      if (checked) {
        // 选中事件
        if (layer.dataSource) {
          // dataSource视Promise对象
          layer.dataSource.then((ds) => {
            ds.show = true
          })
          window.viewer.flyTo(layer.dataSource)
        }
        if (layer.imageLayer) layer.imageLayer.show = true
        if (layer.entity.length > 0) {
          layer.entity.forEach((item) => {
            window.viewer.entities.add(item)
          })
          window.viewer.scene.requestRender()
        }
        layer.show = true
      } else {
        //取消选中  隐藏图层
        if (layer.dataSource) {
          layer.dataSource.then((ds) => {
            ds.show = false
          })
        }
        if (layer.imageLayer) layer.imageLayer.show = false
        if (layer.entity.length > 0) {
          layer.entity.forEach((item) => {
            window.viewer.entities.remove(item)
          })
          window.viewer.scene.requestRender()
        }
        layer.show = false
      }
    }
  })
  layerShow.value = !layerShow.value
}
</script>

<template>
  <n-row
    justify-content="space-between"
    style="align-items: center; border-bottom: 1px solid #e7e6e6"
  >
  <!-- 该图层的显示与隐藏 -->
    <n-checkbox
      size="medium"
      :label="props.lname"
      style="margin: 0 0 0 1rem"
      :checked="layerShow"
      @update:checked="onCheck"
    />
    <!--三条横杠 可选项 -->
    <n-dropdown :options="itemOptions" @select="handleLayerItem">
      <n-button tertiary type="success" size="medium">
        <template #icon>
          <n-icon><Menu /></n-icon>
        </template>
      </n-button>
    </n-dropdown>
  </n-row>
</template>

<style scoped></style>
