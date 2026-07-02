<script setup lang="ts">
import {
  ArrowBackOutline,
  ArrowForwardOutline,
  Save,
  Add,
  SaveOutline,
  FolderOpenOutline,
  DownloadOutline,
} from '@vicons/ionicons5'
import { nextTick, onBeforeUnmount, onMounted, ref,watch,computed } from 'vue'
import { darkTheme, useMessage } from 'naive-ui'
import { useRouteStore } from '@/store/RouteStore.ts'
import { Airline } from '@/types/entityoptions.ts'
import { newAirline, newAirlinePt } from '@/assets/js/TypeInitial.ts'
import * as echarts from 'echarts'
import { EChartsType } from 'echarts'
import { transLonlat2Car3 } from '@/utils/map/geocomputation.ts'
import {
  drawEcharts_RouteDetection,
  profileAnalyse,
} from '@/utils/map/SpatialAnalysis.ts'
import RouteManageViewer from '@/assets/js/RouteManageViewer.js'
import {
  query_surface_forecast,
  query_upper_forecast,
  requireWeatherLevel,
} from '@/assets/js/weatherRequest.ts'
import { setChartOptions } from '@/assets/js/weatherCharts.ts'
import type { NotificationType } from 'naive-ui'
import { useNotification } from 'naive-ui'
import { useStaticStore } from '@/store/staticOptions'
import { useRouter } from 'vue-router'
import { invoke } from '@tauri-apps/api/core'
import { useUavStore } from '@/store/uavStore.ts'
import { ArrowLeft, ArrowRight } from '@vicons/carbon'//引入又移图标

let myChart: EChartsType = undefined
let weatherChart: EChartsType = undefined
let routeStore = useRouteStore()
let selectedRouteCode = ref(null)
let selectedLevel = ref(null)
let showPtList = ref(true)
let selectedRoute = ref<Airline>(newAirline())

let routeManage = null
let routePtNumber = ref(1)
let uiMsg = useMessage()
let nowTime = ref('')
let timer = null

// 当前激活的内容页：detail=航点详情 profile=地形剖面 weather=气象信息
let activeTab = ref<'detail' | 'profile' | 'weather'>('detail')

let PtOptions = [
  { label: '删除航点', key: 'deletePt' },
  { label: '插入航点', key: 'insertPt' },
]
let routeCode = [
  {
    label: '任务航线1',
    value: 1,
  },
  {
    label: '任务航线2',
    value: 2,
  },
  {
    label: '任务航线3',
    value: 3,
  },
  {
    label: '任务航线4',
    value: 4,
  },
  {
    label: '任务航线5',
    value: 5,
  },
]
let levelOptions = ref<any[]>()
let sStore = useStaticStore()
let uavStore = useUavStore()
const router = useRouter()

const notification = useNotification()
const notify = (type: NotificationType, title: string, detail: string) => {
  notification[type]({
    title: title,
    meta: detail,
    duration: 3000,
    closable: true,
    keepAliveOnHover: true,
  })
}
//计算属性获取routesListRef 用于在面板上显示航线列表的信息（应该交给store去管理）
const routesListRef = computed(() => {
  return routeStore.flyRoute.map((route) => {
    return {
      value: route.unicode,//唯一码就是这个value
      label: route.name,
    }
  })
})

onBeforeUnmount(() => {
  clearInterval(timer)
})
onMounted(() => {
  routeManage = new RouteManageViewer(window.viewer)
  myChart = echarts.init(document.getElementById('echarts-profile'), 'dark')
  weatherChart = echarts.init(document.getElementById('weatherChart'), 'dark')

  timer = setInterval(getTimesInterval, 1000)

  requireWeatherLevel().then((res) => {
    console.log(res)
    // 查询失败
    if (!res.data.success) {
      notify('error', '气象信息查询失败', res.data.message)
      return
    }
    levelOptions.value =
      res.data.data.levelsAvailableList[0].pressureLevels.map(
        (level, index) => {
          return {
            value: level,
            label:
              level +
              'hPa/ ' +
              res.data.data.levelsAvailableList[0].heightLevels[index] +
              'm',
          }
        },
      )
    levelOptions.value.reverse()
    levelOptions.value.unshift({ value: -1, label: '地面' })
    selectedLevel.value = -1
  })
})

// 切换内容页：切到图表页时 resize，避免在隐藏状态初始化导致的尺寸错乱
function switchTab(tab: 'detail' | 'profile' | 'weather') {
  activeTab.value = tab
  nextTick(() => {
    if (tab === 'profile') myChart?.resize()
    if (tab === 'weather') weatherChart?.resize()
  })
}

function getTimesInterval() {
  let now = new Date()
  let year = now.getFullYear() // 年
  let month = (now.getMonth() + 1).toString().padStart(2, '0') // 月
  let day = now.getDate().toString().padStart(2, '0') // 日
  let hours = now.getHours().toString().padStart(2, '0') // 时
  let minutes = now.getMinutes().toString().padStart(2, '0') // 分
  let seconds = now.getSeconds().toString().padStart(2, '0') // 秒

  // 格式化时间
  nowTime.value = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
}


/**
 * 生成地形剖面所需航点。
 * 闭合航线会在末尾临时追加首点，但不会修改原航线数据。
 */
function getProfilePoints(route: Airline) {
  const points = route.points.map((pt) => ({ ...pt }))

  if (!route.isClose || points.length < 2) {
    return points
  }

  const first = points[0]
  const last = points[points.length - 1]

  // 防止导入的闭合航线本身已经重复保存了首点
  const alreadyClosed =
    Math.abs(first.lon - last.lon) < 1e-8 &&
    Math.abs(first.lat - last.lat) < 1e-8 &&
    Math.abs(first.alt - last.alt) < 1e-3

  if (!alreadyClosed) {
    points.push({
      ...first,
      // 只用于剖面图上的顺序，不改变原航点编号
      nPt: points.length + 1,
    })
  }

  return points
}

/**
 * 绘制航线地形剖面
 */
function drawRouteProfile(route: Airline) {
  if (!route?.points || route.points.length < 2) {
    myChart?.clear()
    return
  }

  // 闭合航线会临时形成：首点 -> ... -> 末点 -> 首点
  const profilePoints = getProfilePoints(route)
  const cartesianPositions = transLonlat2Car3(profilePoints)

  const result = profileAnalyse(
    window.viewer,
    cartesianPositions,
    1000,
  )

  const orderArr = profilePoints.map((_, index) => {
  // 闭合航线最后一个剖面点实际上是首航点
  if (route.isClose && index === profilePoints.length - 1) {
    return 1
  }

  return index + 1
})

  const hArr = profilePoints.map((point) => point.alt)

  drawEcharts_RouteDetection(
    myChart,
    result.distanceArray,
    result.elevationArray,
    orderArr,
    hArr,
  )
}
// 航线选择,选择航线后才真正绘制了实体
function checkRoute(key: number | string) {
  new Promise((resolve, reject) => {
    selectedRoute.value = routeStore.flyRoute.filter(
      (element) => element.unicode === String(key),
    )[0]
    if (selectedRoute.value == null) reject('未找到航线')
    routeManage.routeParams.isClose = selectedRoute.value.isClose
    window.viewer.flyTo(routeManage.addAirLine(selectedRoute.value), {
      duration: 2,
    })
    queryWeather(
      selectedRoute.value.points[0].lon,
      selectedRoute.value.points[0].lat,
    )
    setTimeout(() => resolve('success'), 2500)
  })
    .then((result) => {
      //绘制航线地形剖面
     drawRouteProfile(selectedRoute.value)
    })
    .catch((err) => {
      uiMsg.error(err)
    })
}

// 在尾部添加航点
function addPtToTail() {
  let newPt = newAirlinePt()
  newPt.nPt = selectedRoute.value.points.at(-1).nPt + 1
  selectedRoute.value.points.push(newPt)
}

// 保存航点编辑
// 1 重新编辑航点的ch2属性
// 2 刷新航线属性
// 3 将改动更新到store中
function savePt() {
  selectedRoute.value.points.forEach((pt, index) => {
    pt.ch2 = 3
    pt.nPt = index + 1 //航点序号从1起
  })
  selectedRoute.value.points.at(-1).ch2 = 1
  selectedRoute.value.PtNum = selectedRoute.value.points.length
  routeStore.addRoute(selectedRoute.value)

 if (routeManage) {
    // 移除旧航线并绘制新航线
    routeManage.removeRoute(selectedRoute.value)
    const routeEntity = routeManage.addAirLine(selectedRoute.value)

    // 保存后缩放至当前航线
    if (routeEntity) {
      window.viewer.flyTo(routeEntity, {
        duration: 1.5,
      })
    }

    // 重新绘制地形剖面，闭合航线包含末点到首点
    drawRouteProfile(selectedRoute.value)
  }

    // 保存后重新请求当前航点天气
    const currentPoint = selectedRoute.value.points[routePtNumber.value - 1]

    if (currentPoint?.lon && currentPoint?.lat) {
      queryWeather(
        currentPoint.lon,
        currentPoint.lat,
        Number(selectedLevel.value),
      )
    }
    uiMsg.success('保存编辑成功')
}
//航点变化后就重新绘制剖面请求天气
function refreshRouteAfterPointChanged() {
  if (!selectedRoute.value?.points) return

  // 更新航点数量
  selectedRoute.value.PtNum = selectedRoute.value.points.length

  // 防止当前航点序号越界
  if (routePtNumber.value > selectedRoute.value.points.length) {
    routePtNumber.value = selectedRoute.value.points.length
  }

  if (routePtNumber.value < 1) {
    routePtNumber.value = 1
  }

  // 重新绘制地图航线
  if (routeManage && selectedRoute.value.points.length >= 2) {
    routeManage.removeRoute(selectedRoute.value)
    const routeEntity = routeManage.addAirLine(selectedRoute.value)

    if (routeEntity) {
      window.viewer.flyTo(routeEntity, {
        duration: 1.5,
      })
    }
  }

  // 重新绘制剖面图
  if (selectedRoute.value.points.length >= 2) {
    drawRouteProfile(selectedRoute.value)
  } else {
    myChart?.clear()
  }

  // 重新请求当前航点天气
  const currentPoint = selectedRoute.value.points[routePtNumber.value - 1]

  if (currentPoint?.lon != null && currentPoint?.lat != null) {
    queryWeather(
      currentPoint.lon,
      currentPoint.lat,
      Number(selectedLevel.value),
    )
  } else {
    weatherChart?.clear()
  }
}


/** 删除或在此前插入航点
 *
 * @param key 下拉菜单key
 * @param index 航点索引
 */
function handlePtSelect(key: any, index: number) {
  if (key == 'deletePt') {
    selectedRoute.value.points.splice(index, 1)

    selectedRoute.value.points.forEach((pt, i) => {
      pt.nPt = i + 1
    })

    showPtList.value = false

    nextTick(() => {
      showPtList.value = true
      refreshRouteAfterPointChanged()
    })
  } else if (key == 'insertPt') {
    selectedRoute.value.points.forEach((pt, i) => {
      if (i >= index) pt.nPt = i + 2
    })
    let newPt = newAirlinePt()
    newPt.nPt = index + 1
    showPtList.value = false
    nextTick(() => {
      selectedRoute.value.points.splice(index, 0, newPt)
      showPtList.value = true
    })
  }
}

//查询上一航点的气象信息
function prevPtWeather() {
  routePtNumber.value -= 1
  window.viewer.flyTo(
    window.viewer.entities.getById(
      selectedRoute.value.unicode + '-航点' + routePtNumber.value.toString(),
    ),
    { duration: 1 },
  )
  let lat = selectedRoute.value.points[routePtNumber.value - 1].lat
  let lon = selectedRoute.value.points[routePtNumber.value - 1].lon
  if (lat && lon) {
    queryWeather(lon, lat, selectedLevel.value)
  }
}

//查询下一航点的气象信息
function nextPtWeather() {
  routePtNumber.value += 1
  window.viewer.flyTo(
    window.viewer.entities.getById(
      selectedRoute.value.unicode + '-航点' + routePtNumber.value.toString(),
    ),
    { duration: 1 },
  )

  let lat = selectedRoute.value.points[routePtNumber.value - 1].lat
  let lon = selectedRoute.value.points[routePtNumber.value - 1].lon
  if (lat && lon) {
    queryWeather(lon, lat, selectedLevel.value)
  }
}

function queryWeather(lon: number, lat: number, level?: number) {
  let response: Promise<any>
  if (level == null || level == -1) {
    //地面
    response = query_surface_forecast(lon, lat)
  } else {
    response = query_upper_forecast(lon, lat, level)
  }
  response
    .then((res) => {
      // 查询失败
      if (!res.data.success) {
        notify('error', '气象信息查询失败', res.data.message)
        return
      }
      let weatherData = res.data.data
      let timeArr = weatherData.time.map((item) => {
        let i = item.indexOf('T')
        return item.slice(i + 1, i + 3) + '时'
      })
      if (!Reflect.has(weatherData, 'precip')) {
        //高空数据无precip(降水)属性，需添加数组并补0
        weatherData.precip = Array.from({ length: timeArr.length }, () => 0)
      }
      setChartOptions(
        weatherChart,
        timeArr.slice(0, 8),
        weatherData.temp.slice(0, 8),
        weatherData.windSpeed.slice(0, 8),
        weatherData.wind360.slice(0, 8),
        weatherData.precip.slice(0, 8),
        weatherData.humidity.slice(0, 8),
      )
    })
    .catch((e) => {
      console.log()
      uiMsg.error('气象信息查询失败：' + e.message, {
        duration: 3000,
        keepAliveOnHover: true,
      })
    })
}

function levelChanged(key: string | number) {
  selectedLevel.value = key
  let lat = selectedRoute.value.points[routePtNumber.value - 1].lat
  let lon = selectedRoute.value.points[routePtNumber.value - 1].lon
  if (lat && lon) {
    queryWeather(lon, lat, Number(key))
  }
}
//点击开闭重新绘制剖面图

function handleRouteCloseChanged(value: boolean) {
  selectedRoute.value.isClose = value

  if (!selectedRoute.value?.points || selectedRoute.value.points.length < 2) {
    return
  }

  // 地图上的航线也重新绘制
  if (routeManage) {
    routeManage.removeRoute(selectedRoute.value)
    routeManage.addAirLine(selectedRoute.value)
  }

  // 重绘地形剖面
  drawRouteProfile(selectedRoute.value)
}

/**
 * 将航线信息发送给Rust端（每次发送一条航线）
 * @param routeUnicode 航线唯一码
 */
async function sendRouteToQT(routeUnicode: string | number) {
  let selectedRouteToUpload = routeStore.flyRoute.find(
    (element) => element.unicode === String(routeUnicode),
  )
  if (selectedRouteToUpload) {
    try {
      // 下发前，强制处理所有航点的特征字2(ch2)以及序号，无论是否来自文件导入
      if (selectedRouteToUpload.points && selectedRouteToUpload.points.length > 0) {
        selectedRouteToUpload.points.forEach((pt, index) => {
          pt.ch2 = 3
          pt.nPt = index + 1 // 航点序号从1起
        })
        selectedRouteToUpload.points.at(-1).ch2 = 1
        selectedRouteToUpload.PtNum = selectedRouteToUpload.points.length
      }

      console.log('正在下发航线：', selectedRouteToUpload.name)
      console.log('发送的具体特征字2(ch2)：', selectedRouteToUpload.points.map(pt => pt.ch2).join(', '))

      const res = await invoke<string>('upload_route', {
        ip: uavStore.udpIp,
        port: uavStore.udpTargetPort,
        route: selectedRouteToUpload,
      })
      uiMsg.info('航线' + selectedRouteToUpload.name + '已下发: ' + res)
    } catch (err: any) {
      uiMsg.error('航线发送失败：' + err)
      console.error(err)
    }
  } else {
    uiMsg.warning('未找到相应的航线')
  }
}

function delRoute(routeUnicode: string | number) {
  let selectedRouteToDelete = routeStore.flyRoute.find(
    (element) => element.unicode === String(routeUnicode),
  )
  if (!selectedRouteToDelete) {
    uiMsg.warning('未找到相应的航线')
    return
  }

  // 从地图中移除航线实体
  if (routeManage) {
    routeManage.removeRoute(selectedRouteToDelete)
  }

  // 从 store 中删除
  routeStore.removeRoute(String(routeUnicode))

  // 如果删除的正是当前选中的航线，清空选中状态与相关图表
  if (String(selectedRouteCode.value) === String(routeUnicode)) {
    selectedRouteCode.value = null
    selectedRoute.value = newAirline()
    routePtNumber.value = 1
    if (myChart) {
      myChart.clear()
    }
    if (weatherChart) {
      weatherChart.clear()
    }
  }

  uiMsg.success('航线 ' + selectedRouteToDelete.name + ' 已删除')
}

function importRoute() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.route'
  input.onchange = (e: any) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      parseRouteFile(file.name, text)
    }
    reader.readAsText(file)
  }
  input.click()
}

function parseRouteFile(fileName: string, content: string) {
  const lines = content.split('\n').filter((l) => l.trim().length > 0)
  if (lines.length === 0) {
    uiMsg.error('航线文件为空')
    return
  }

  let newRoute = newAirline()
  newRoute.name = fileName.replace(/\.route$/i, '')
  newRoute.unicode =
    Date.now().toString() + Math.floor(Math.random() * 1000).toString()

  let code = 1
  for (let line of lines) {
    const parts = line.split(',').map((p) => p.trim())
    if (parts.length < 8) continue // 格式错误或空行

    let nPt = parseInt(parts[1])
    if (nPt === 0) continue // 第0个航点是默认的，不绘制及处理

    code = parseInt(parts[0])
    let pt = newAirlinePt()
    pt.nPt = nPt
    pt.lon = parseFloat(parts[2])
    pt.lat = parseFloat(parts[3])
    pt.alt = parseFloat(parts[4])
    pt.speed = parseFloat(parts[5]) // 使用speed字段存储下滑角
    pt.ch1 = parseInt(parts[6])
    pt.ch2 = parseInt(parts[7])
    newRoute.points.push(pt)
  }

  if (newRoute.points.length > 0) {
    newRoute.code = code
    newRoute.PtNum = newRoute.points.length
    // 最后一个航点的特征字1，00代表闭合，02代表开合
    let lastPt = newRoute.points[newRoute.points.length - 1]
    newRoute.isClose = lastPt.ch1 === 0
    routeStore.addRoute(newRoute)

    
    
    //导入航线直接显示缩放显示到航线
    window.viewer.flyTo(routeManage.addAirLine(newRoute), {
      duration: 2,
    })
    
    uiMsg.success(`成功导入航线: ${newRoute.name}`)
  } else {
    uiMsg.error('航线文件解析失败，无有效航点')
  }
}

function exportRoute() {
  if (
    !selectedRouteCode.value ||
    !selectedRoute.value ||
    selectedRoute.value.points.length === 0
  ) {
    uiMsg.warning('请先选择一条有效的航线')
    return
  }

  const currentRoute = selectedRoute.value
  const code = currentRoute.code || 1
  // 写入默认的第0个点
  let content = `${code}, 0, 0.000000, 0.000000, 0.00, 0.0, 00, 03\n`

  currentRoute.points.forEach((pt, index) => {
    const nPt = pt.nPt || index + 1
    const lon = (pt.lon || 0).toFixed(6)
    const lat = (pt.lat || 0).toFixed(6)
    const alt = (pt.alt || 0).toFixed(2)
    const speed = (pt.speed || 0).toFixed(1)

    let ch1_val = pt.ch1 || 0
    // 如果是最后一个点，根据当前航线的闭合状态强制更新特征字1
    if (index === currentRoute.points.length - 1) {
      ch1_val = currentRoute.isClose ? 0 : 2
    }

    const ch1 = ch1_val.toString().padStart(2, '0')
    const ch2 = (pt.ch2 || 0).toString().padStart(2, '0')
    content += `${code}, ${nPt}, ${lon}, ${lat}, ${alt}, ${speed}, ${ch1}, ${ch2}\n`
  })

  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${currentRoute.name || '导出航线'}.route`
  a.click()
  URL.revokeObjectURL(url)
  uiMsg.success('航线文件已导出')
}
//点击航线缩放到航线
function handlePtClick(RouteUnicode?: string | number) {
  const route = routeStore.flyRoute.filter(
      (element) => element.unicode === String(RouteUnicode),
    )[0]
  window.viewer.flyTo(routeManage.addAirLine(route), {
      duration: 2,
    })
}
function backToHomePage() {
  sStore.showRouteManage = false
}
</script>

<template>
  <n-config-provider :theme="darkTheme">
    <div class="route-manage-overlay">
      <div id="right">
        <n-layout style="height: 100%">
          <!-- 顶部工具栏 -->
          <n-layout-header :bordered="true">
            <n-space justify="space-between" align="center">
              <n-space>
                  <n-popover trigger="hover">
                    <template #trigger>
                      <n-button
                        quaternary
                        type="success"
                        size="large"
                        @click="importRoute"
                      >
                        <template #icon>
                          <n-icon><FolderOpenOutline /></n-icon>
                        </template>
                      </n-button>
                    </template>
                    导入航线
                  </n-popover>
                  <n-popover trigger="hover">
                    <template #trigger>
                      <n-button
                        quaternary
                        type="success"
                        size="large"
                        @click="exportRoute"
                      >
                        <template #icon>
                          <n-icon><DownloadOutline /></n-icon>
                        </template>
                      </n-button>
                    </template>
                    导出航线
                  </n-popover>
              </n-space>
              <!-- 关闭页面 -->
              <n-space>
                <n-popover trigger="hover">
                  <template #trigger>
                    <n-button
                      quaternary
                      type="success"
                      size="large"
                      @click="backToHomePage"
                    >
                      <template #icon>
                        <n-icon><ArrowRight /></n-icon>
                      </template>
                    </n-button>
                  </template>
                  返回
                </n-popover>
              </n-space>
            </n-space>
          </n-layout-header>

          <n-layout-content style="height: calc(100% - 61px)"
  content-style="height:100%; padding:0;">
            <!-- ===== 上部：航线列表 + 航线属性 ===== -->
            <n-flex vertical style="margin: 0.5rem 1rem; overflow: hidden">
              <n-ellipsis><h3>航线列表</h3></n-ellipsis>
              <n-radio-group
                v-model:value="selectedRouteCode"
                name="radiogroup"
                @update:value="checkRoute"
              >
                <n-scrollbar style="height: 26vh">
                  <n-space vertical>
                    <n-space
                      v-for="r in routesListRef"
                      :key="r.value"
                      justify="space-between"
                      style="
                        margin-right: 1rem;
                        border-bottom: #383737 1px solid;
                      "
                      @click="handlePtClick(r.value)"
                    >
                      <n-radio :key="r.value" :value="r.value">
                        {{ r.label }}
                      </n-radio>
                      <n-button-group>
                        <n-button
                          secondary
                          size="small"
                          type="info"
                          style="height: 1.3rem"
                          @click="sendRouteToQT(r.value)"
                        >
                          下发
                        </n-button>
                        <n-button
                          secondary
                          size="small"
                          type="error"
                          style="height: 1.3rem; margin-bottom: 4px"
                          @click="delRoute(r.value)"
                        >
                          删除
                        </n-button>
                      </n-button-group>
                    </n-space>
                  </n-space>
                </n-scrollbar>

              </n-radio-group>

              <n-divider style="margin: 0.2rem -0.5rem"></n-divider>
              
              <n-space vertical style="margin: 0.2rem 0.5rem">
                <!--航线名称  -->
                <n-space>
                  <n-ellipsis style="width: 4rem">航线名称</n-ellipsis>
                  <n-input
                    size="small"
                    style="width: 10rem"
                    v-model:value="selectedRoute.name"
                  ></n-input>
                </n-space>
                <n-space>
                  <!-- 开闭按钮 -->
                  <n-space>
                    <n-ellipsis>开闭</n-ellipsis>
                    <n-switch
                      v-model:value="selectedRoute.isClose"
                      size="small"
                      @update:value="handleRouteCloseChanged"
                    >
                      <template #checked>闭</template>
                      <template #unchecked>开</template>
                    </n-switch>
                  </n-space>
                  <!-- 航点数 -->
                  <n-space style="margin-left: 0.5rem">
                    <n-ellipsis>航点数</n-ellipsis>
                    <n-input-number
                      :show-button="false"
                      disabled
                      size="small"
                      style="width: 5rem"
                      v-model:value="selectedRoute.PtNum"
                    ></n-input-number>
                  </n-space>
                </n-space>

                
                <!-- 航线类型 -->
                <n-space>
                  <n-ellipsis style="width: 4rem">航线类型</n-ellipsis>
                  <n-select
                    style="width: 10rem"
                    size="small"
                    v-model:value="selectedRoute.code"
                    :options="routeCode"
                  />
                </n-space>
              </n-space>
            </n-flex>

            <n-divider style="margin: 0.2rem -0.5rem"></n-divider>

            <!-- ===== 三个切换按钮 ===== -->
            <n-space justify="center" style="margin: 0.3rem 0">
              <n-button-group>
                <n-button
                  size="small"
                  :type="activeTab === 'detail' ? 'primary' : 'default'"
                  @click="switchTab('detail')"
                >
                  航线详情
                </n-button>
                <n-button
                  size="small"
                  :type="activeTab === 'profile' ? 'primary' : 'default'"
                  @click="switchTab('profile')"
                >
                  地形剖面
                </n-button>
                <n-button
                  size="small"
                  :type="activeTab === 'weather' ? 'primary' : 'default'"
                  @click="switchTab('weather')"
                >
                  气象信息
                </n-button>
              </n-button-group>
            </n-space>

            <n-divider style="margin: 0.2rem -0.5rem"></n-divider>

            <!-- ===== 内容区：用 v-show 保证 echarts DOM 始终存在 ===== -->

            <!-- 航线详情 -->
            <div v-show="activeTab === 'detail'">
              <n-flex vertical>
                <!-- 列表名字头部 -->
                <n-space justify="space-around" style="margin-top: 0.5rem">
                  <n-ellipsis style="width: 2rem; margin-left: 0.2rem">
                    序号
                  </n-ellipsis>
                  <n-ellipsis style="width: 5.5rem">经度</n-ellipsis>
                  <n-ellipsis style="width: 5.5rem">纬度</n-ellipsis>
                  <n-ellipsis style="width: 3rem">高度</n-ellipsis>
                </n-space>

                <!-- 滚动区：只放航点列表动态的，高度调小给按钮腾位置 -->
                <n-scrollbar style="height: 44vh">
                  <div v-if="selectedRoute.points.length > 0 && showPtList">
                    <n-space
                      justify="space-around"
                      style="margin: 0.2rem 0"
                      v-for="(pt, index) in selectedRoute.points"
                      :key="index"
                    >
                   <!-- 悬浮会出来删除和插入航点的下拉菜单 -->
                      <n-dropdown
                        trigger="hover"
                        size="small"
                        placement="top-start"
                        :show-arrow="true"
                        :options="PtOptions"
                        @select="handlePtSelect($event, index)"
                      >
                        <n-button
                          secondary
                          type="info"
                          size="small"
                          style="width: 1.7rem; margin-left: 0.2rem"
                        >
                          {{ pt.nPt }}
                        </n-button>
                      </n-dropdown>
                      <!-- 经度输入框 -->
                      <n-input-number
                        size="small"
                        v-model:value="pt.lon"
                        :show-button="false"
                        style="width: 6rem"
                        placeholder="经度"
                        max="180"
                        min="-180"
                      ></n-input-number>
                      <!-- 纬度输入框 --> 
                      <n-input-number
                        size="small"
                        v-model:value="pt.lat"
                        :show-button="false"
                        style="width: 6rem"
                        placeholder="纬度"
                        max="90"
                        min="-90"
                      ></n-input-number>
                      <!-- 高度输入框 -->
                      <n-input-number
                        size="small"
                        v-model:value="pt.alt"
                        :show-button="false"
                        style="width: 6rem"
                        placeholder="高度"
                        max="12000"
                        min="-500"
                      ></n-input-number>
                    </n-space>
                  </div>

                  <n-space v-else justify="space-around">
                    <n-empty
                      style="margin-top: 3rem"
                      description="无内容"
                    ></n-empty>
                  </n-space>
                </n-scrollbar>

                <!-- 按钮移到滚动区外，固定在底部 -->
                <n-space justify="center" style="margin: 0.5rem 0">
                  <n-button type="info" size="small" @click="addPtToTail">
                    <template #icon>
                      <Add />
                    </template>
                    添加点
                  </n-button>
                  <n-button type="info" size="small" @click="savePt">
                    <template #icon>
                      <SaveOutline />
                    </template>
                    保存编辑
                  </n-button>
                </n-space>
              </n-flex>
            </div>

            <!-- 地形剖面 -->
            <div v-show="activeTab === 'profile'">
              <n-flex vertical style="margin: 0.5rem 0">
              <n-space justify="space-evenly" style="padding: 0 0.5rem">
                <n-ellipsis>采样间隔</n-ellipsis>
                <n-input-number
                  size="small"
                  placeholder="默认1000米"
                  style="width: 8rem"
                  :min="100"
                  :step="100"
                ></n-input-number>
                <n-button type="success" size="small">重新绘图</n-button>
              </n-space>
              <div id="echarts-profile"></div>
            </n-flex>
            </div>

            <!-- 气象信息 -->
            <div v-show="activeTab === 'weather'">
              <n-flex vertical>
                <n-space justify="space-around" class="routePtSelector">
                  <n-button
                    size="small"
                    @click="prevPtWeather"
                    :disabled="routePtNumber <= 1"
                  >
                    <template #icon><ArrowBackOutline /></template>
                  </n-button>
                  <n-ellipsis>航点 {{ routePtNumber }}</n-ellipsis>
                  <n-button
                    size="small"
                    @click="nextPtWeather"
                    :disabled="selectedRoute.points.length <= routePtNumber"
                  >
                    <template #icon><ArrowForwardOutline /></template>
                  </n-button>
                </n-space>

                <n-space justify="center">
                  <n-ellipsis>{{ nowTime }}</n-ellipsis>
                  <n-select
                    style="width: 10rem"
                    size="small"
                    :options="levelOptions"
                    v-model:value="selectedLevel"
                    @update:value="levelChanged"
                    placeholder="选择高度层"
                  ></n-select>
                </n-space>
                <n-scrollbar
                  x-scrollable
                  id="weatherChart"
                  style="width: 100%; height: 44vh"
                >
                </n-scrollbar>
              </n-flex>
            </div>
          </n-layout-content>
        </n-layout>
      </div>
    </div>
  </n-config-provider>
</template>

<style scoped>
.route-manage-overlay {
  display: flex;
  justify-content: flex-end; /* 面板靠右 */
  position: absolute;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  pointer-events: none;
  z-index: 10;
}

#right {
  width: 26vw;
  height: 100vh;
  pointer-events: auto;

  /* 整体半透明 */
  background: rgba(16, 16, 20, 0.75);

  /* 毛玻璃，可选 */
  backdrop-filter: blur(6px);
}

/* 让 Naive UI 的 layout 不再盖住半透明背景 */
#right :deep(.n-layout),
#right :deep(.n-layout-scroll-container),
#right :deep(.n-layout-content),
#right :deep(.n-layout-header) {
  background: transparent !important;
}

#echarts-profile {
  height: 44vh;
  width: 100%;
}

.routePtSelector {
  width: 100%;
  font-weight: bold;
  color: #63e2b7;
}

.routePtSelector:hover {
  background: rgb(24 24 28);
}


</style>
