<!-- 在图层管理面板里面显示的子组件 -->
<script setup lang="ts">
import { Menu } from '@vicons/ionicons5'
import { useLayerStore } from '@/store/layerManagerStore.ts'
import { ref } from 'vue'
let layerShow = ref(true)

let layer: { name: string; id: string } = {
  name: '',
  id: '',
}
let itemOptions = [
  { label: '移除图层', key: 'remove' },
  { label: '缩放至图层', key: 'lookAt' },
  { label: '移至顶层', key: 'moveTop' },
  { label: '移至底层', key: 'moveBottom' },
]
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
          if (layer.dataSource) window.viewer.flyTo(layer.dataSource)
          if (layer.imageLayer) window.viewer.flyTo(layer.imageLayer)
          if (layer.entity.length > 0) window.viewer.flyTo(layer.entity.at(-1))
          break
        }
        case 'moveTop': {
          //TODO:
          break
        }
        case 'moveBottom': {
          // TODO:
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
