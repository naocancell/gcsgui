# Vue 3 + Vite + Cesium

- 采用Vue3 + TypeScript + Vite来构建Cesium应用平台。
- 强制使用pnpm作为包管理工具。

## Git提交规范

commit提交时，需使用`git commit -m 'fix: xxx'`
改动类型如下

```
'feat',         //新特性、新功能
'fix',          //修改bug
'docs',         //文档修改
'style',        //代码格式修改, 注意不是 css 修改
'refactor',     //代码重构
'perf',         //优化相关，比如提升性能、体验
'test',         //测试用例修改
'chore',        //其他修改, 比如改变构建流程、或者增加依赖库、工具等
'revert',       //回滚到上一个版本
'build',        //编译相关的修改，例如发布版本、对项目构建或者依赖的改动
```

## Cesium版本

- 采用开源Cesium.js库，版本为1.108
- <font color=red>不要随意升级版本，天地图三维地形服务目前只支持1.108，实测1.109也能用，更高版本则无法使用。</font>

## 地图服务

地图服务采用天地图数据源（ https://www.tianditu.gov.cn/ ）。
时间分辨率：官方未说明
空间分辨率：官方未说明，约为30米

## 打包部署

- 执行build后，需将此项目中的`public`文件夹复制到`dist`目录下，再进行nginx部署。public包含了Cesium所需的静态资源，否则不能加载地球
- 2025.4.17 更新： `public`文件夹如果不复制到`dist`目录下，服务也可以运行，但加载航线时出现异常
