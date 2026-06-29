import * as Cesium from 'cesium'

export default class NFZViewer {
  constructor(viewer) {
    this.viewer = viewer
    this.nfzEntities = []
    this.isVisible = false
    this.nfzData = null
    this.dataSource = null
  }

  async loadNFZData() {
    if (this.nfzData) return this.nfzData;
    try {
      const response = await fetch('/dji_flysafe_cn_only.json');
      this.nfzData = await response.json();
      return this.nfzData;
    } catch (e) {
      console.error('Failed to load NFZ data:', e);
      return [];
    }
  }

  async toggleNFZ(show) {
    this.isVisible = show;
    if (show) {
      if (this.nfzEntities.length === 0 && !this.dataSource) {
        await this.loadNFZData();
        this.renderNFZ();
      } else if (this.dataSource) {
        this.dataSource.show = true;
      }
    } else {
      if (this.dataSource) {
        this.dataSource.show = false;
      }
    }
    this.viewer.scene.requestRender();
  }

  renderNFZ() {
    if (!this.nfzData) return;
    
    this.dataSource = new Cesium.CustomDataSource('NFZ');
    this.viewer.dataSources.add(this.dataSource);

    this.nfzData.forEach(area => {
      let colorStr = area.color || '#DE4329';
      let height = area.height || 100;
      if (height === 0) height = 500; // 0 通常表示管控空域（直接禁飞），这里用较高的高度显示以示区别

      let material = Cesium.Color.fromCssColorString(colorStr).withAlpha(0.4);
      let outlineColor = Cesium.Color.fromCssColorString(colorStr).withAlpha(0.8);

      const drawPolygonOrCylinder = (item, currentHeight, currentColor, currentOutlineColor) => {
        if (item.polygon_points && item.polygon_points.length > 0) {
          item.polygon_points.forEach(polygon => {
            let degreesArray = [];
            polygon.forEach(pt => {
              degreesArray.push(pt[0], pt[1]);
            });
            let entity = this.dataSource.entities.add({
              name: area.name,
              polygon: {
                hierarchy: Cesium.Cartesian3.fromDegreesArray(degreesArray),
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                material: currentColor,
              }
            });
            this.nfzEntities.push(entity);
          });
        } else if (item.radius > 0) {
          let entity = this.dataSource.entities.add({
            name: area.name,
            position: Cesium.Cartesian3.fromDegrees(item.lng || area.lng, item.lat || area.lat),
            ellipse: {
              semiMajorAxis: item.radius,
              semiMinorAxis: item.radius,
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              material: currentColor,
            }
          });
          this.nfzEntities.push(entity);
        }
      };

      if (area.sub_areas && area.sub_areas.length > 0) {
        area.sub_areas.forEach((sub) => {
          let subHeight = sub.height > 0 ? sub.height : height;
          let subColorStr = sub.color || colorStr;
          let subMaterial = Cesium.Color.fromCssColorString(subColorStr).withAlpha(0.4);
          drawPolygonOrCylinder(sub, subHeight, subMaterial, outlineColor);
        });
      } else {
        drawPolygonOrCylinder(area, height, material, outlineColor);
      }
    });
  }
}
