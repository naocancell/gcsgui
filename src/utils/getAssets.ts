/*
 * @Author: cbwu 504-wuchengbo@htsdfp.com
 * @Date: 2024-04-10 11:21:35
 * @LastEditors: cbwu
 * @LastEditTime: 2024-04-10 11:29:01
 * @Description: 获取静态资源文件
 */
// 获取地图assets静态资源
export const getMapAssetsFile = (url: string) => {
  return new URL(`../assets/map/${url}`, import.meta.url).href
}
