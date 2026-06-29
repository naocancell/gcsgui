import * as echarts from 'echarts'
import { EChartsType } from 'echarts'

/**
 * 天气图表Echarts的配置函数
 * @param wChart 图表对象
 * @param timeSeries 时间序列
 * @param temp 温度
 * @param windSpeed 风速
 * @param wind360 风向
 * @param precip 降水
 * @param humidity 湿度（暂未使用）
 */
export const setChartOptions = (
  wChart: EChartsType,
  timeSeries: string[],
  temp: number[],
  windSpeed: number[],
  wind360: number[],
  precip: number[],
  humidity?: number[],
) => {
  let windDirection = wind360.map((item) => {
    let arr = [
      22.5,
      22.5 + 45,
      22.5 + 45 * 2,
      22.5 + 45 * 3,
      22.5 + 45 * 4,
      22.5 + 45 * 5,
      22.5 + 45 * 6,
      22.5 + 45 * 7,
    ]
    let str = [
      '北风',
      '东北风',
      '东风',
      '东南风',
      '南风',
      '西南风',
      '西风',
      '西北风',
    ]
    if (item <= arr[0] || item > arr[7]) {
      return str[0] + ': ' + Math.round(item) + '°'
    } else if (arr[0] <= item && item <= arr[1]) {
      return str[1] + ' : ' + Math.round(item) + '°'
    } else if (arr[1] <= item && item <= arr[2]) {
      return str[2] + ' : ' + Math.round(item) + '°'
    } else if (arr[2] <= item && item <= arr[3]) {
      return str[3] + ' : ' + Math.round(item) + '°'
    } else if (arr[3] <= item && item <= arr[4]) {
      return str[4] + ' : ' + Math.round(item) + '°'
    } else if (arr[4] <= item && item <= arr[5]) {
      return str[5] + ' : ' + Math.round(item) + '°'
    } else if (arr[5] <= item && item <= arr[6]) {
      return str[6] + ' : ' + Math.round(item) + '°'
    } else if (arr[6] <= item && item <= arr[7]) {
      return str[7] + ' : ' + Math.round(item) + '°'
    }
  })
  let colors = ['#5470C6', '#91CC75', '#EE6666']
  wChart.setOption({
    backgroundColor: '#101014',
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        type: 'cross',
      },
    },
    color: colors,
    grid: [
      { x: '7%', y: '7%', height: '40%', left: '12%', right: '15%' },
      {
        x: '7%',
        y2: '7%',
        height: '38%',
        left: '12%',
        right: '15%',
        bottom: '10%',
      },
    ],
    legend: {
      data: ['风速', '降水', '温度'],
    },
    xAxis: [
      {
        show: false, //隐藏了x轴
        type: 'category',
        gridIndex: 0, //对应前面grid的索引位置（第一个）
        axisTick: {
          alignWithLabel: true,
        },
        data: windDirection,
      },
      {
        type: 'category',
        gridIndex: 1, //对应前面grid的索引位置（第二个）
        axisTick: {
          alignWithLabel: true,
        },
        data: timeSeries,
      },
    ],
    //y轴，不管有几个x轴，几个y轴，或者图，只要找到他对应的grid图的序号索引就可以精准匹配
    yAxis: [
      {
        type: 'value',
        gridIndex: 1, //对应前面grid的索引位置（第二个）
        splitLine: { show: false },
        position: 'right',
        axisLine: {
          lineStyle: {
            color: colors[1],
          },
        },
        axisLabel: {
          formatter: '{value}ml',
        },
      },
      {
        type: 'value',
        gridIndex: 1,
        nameLocation: 'middle',
        name: '温度',
        nameTextStyle: {
          padding: 25,
        },
        splitLine: { show: false },
        position: 'left',
        axisLine: {
          lineStyle: {
            color: colors[2],
          },
        },
        axisLabel: {
          formatter: '{value}°C',
        },
      },
      {
        type: 'value',
        gridIndex: 0,
        name: '风速',
        nameTextStyle: {
          padding: 25,
        },
        position: 'left',
        splitLine: { show: false },
        axisLine: {
          lineStyle: {
            color: colors[0],
          },
        },
        axisLabel: {
          formatter: '{value}',
          fontSize: 12, //y轴坐标轴上的字体大小
        },
      },
    ],
    series: [
      {
        name: '风速',
        type: 'line',
        xAxisIndex: 0,
        yAxisIndex: 2,
        data: windSpeed,
      },
      {
        name: '降水',
        type: 'bar',
        xAxisIndex: 1,
        yAxisIndex: 0,
        data: precip,
      },
      {
        name: '温度',
        type: 'line',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: temp,
      },
    ],
  })
}
