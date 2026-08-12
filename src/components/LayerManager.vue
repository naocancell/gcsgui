<!--
  文件描述：Cesium地图的图层管理器组件
  创建时间：2025/3/4 11:25
  创建人：Zhaipeixiu
-->
<script setup lang="ts">
import { ArrowBackOutline } from '@vicons/ionicons5'
import LayerItem from '@/components/LayerItem.vue'
import { darkTheme } from 'naive-ui'
import { ref } from 'vue'
import { useLayerStore } from '@/store/layerManagerStore.ts'
import { removeLayerResources } from '@/utils/map/layerResources'
//定义允许父组件使用的函数或变量
defineExpose({
  //父组件点击添加图层显示图层管理面板
  open_closeSidebar: () => {
    // 获取侧边栏元素
    let sidebar = document.querySelector('.LayerManagerSidebar')
    if (sidebar?.classList.contains('open')) {
      //关闭侧边栏
      sidebar?.classList.remove('open')
    } else {
      // 打开侧边栏
      sidebar?.classList.add('open')
    }
  },
})
//点击关闭图层管理器侧边栏
function closeLayerManagerSidebar() {
  let sidebar = document.querySelector('.LayerManagerSidebar')
  sidebar?.classList.remove('open')
}

let showWmsModal = ref(false)

let wmsConfig = {
  url: '',
}
//点击添加WMS地图服务的地址
function addWMSLayer() {
  window.measureViewer.AddWMSLayer(wmsConfig.url)
}
//清空图层函数
async function clearLayers() {
  const layerStore = useLayerStore()
  const layers = [...layerStore.Layers]

  await Promise.allSettled(
    layers.map((layer) => removeLayerResources(window.viewer, layer)),
  )
  window.viewer.scene.requestRender()
  layerStore.clearLayersList()
}
</script>

<template>
  <div>
    <n-config-provider :theme="darkTheme">
      <n-layout class="LayerManagerSidebar">
        <n-layout-header>
          <n-row
            justify-content="space-between"
            style="margin-bottom: 0.5rem; border-bottom: solid 1px #dcd9d8"
          >
            <h2 style="margin: 0.3rem 1rem">图层管理</h2>
            <!-- 关闭图层管理面板 -->
            <n-button
              style="margin: 0.6rem"
              @click="closeLayerManagerSidebar"
              size="tiny"
              type="error"
            >
              <template #icon>
                <n-icon><ArrowBackOutline /></n-icon>
              </template>
            </n-button>
          </n-row>
        </n-layout-header>
        <n-layout-content>
          <n-empty
            size="large"
            description="暂未加载图层"
            v-show="useLayerStore().Layers.length == 0"
          />
          <!--  图层项目 layeritem 动态增减layer-item组件 -->
          <layer-item
            v-for="layer in useLayerStore().Layers"
            :lid="layer.lId"
            :lname="layer.lName"
            :key="layer.lId"
          ></layer-item>
        </n-layout-content>

        <n-layout-footer style="margin: 0.5rem">
          <n-space justify="space-around">
            <n-button size="small" type="info" @click="showWmsModal = true">
              添加WMS图层
            </n-button>
            <n-button size="small" type="warning" @click="clearLayers">
              清空图层
            </n-button>
          </n-space>
        </n-layout-footer>
      </n-layout>
    </n-config-provider>
    <!-- 填写WMS的模态框 -->
    <n-modal
      v-model:show="showWmsModal"
      style="width: 30%"
      :mask-closable="false"
      preset="dialog"
      title=""
    >
      <template #header>
        <div>WMS资源配置</div>
      </template>
      <div style="margin: 2rem 2rem 0.5rem 1rem">
        <n-space>
          <n-form
            ref="formRef"
            :model="wmsConfig"
            label-placement="left"
            label-width="auto"
            require-mark-placement="right-hanging"
          >
            <n-form-item label="WMS URL">
              <n-input
                v-model:value="wmsConfig.url"
                placeholder="127.0.0.1/wms"
              />
            </n-form-item>
          </n-form>
        </n-space>
        <n-space justify="center">
          <n-button @click="addWMSLayer" type="primary" size="small">
            确定
          </n-button>
          <n-button @click="showWmsModal = false" type="warning" size="small">
            取消
          </n-button>
        </n-space>
      </div>
    </n-modal>
  </div>
</template>

<style scoped>
/* 侧边栏基础样式 */
.LayerManagerSidebar {
  position: absolute;
  top: 3rem;
  left: -15rem; /* 默认隐藏 */
  width: 15rem;
  padding: 0;
  border-radius: 7px;
  transition: left 0.3s;
}

/* 侧边栏展开样式 */
.LayerManagerSidebar.open {
  left: 0;
}
</style>
