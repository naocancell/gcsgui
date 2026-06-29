<script lang="ts">
import { defineComponent } from 'vue'
import { drawEchartsVisibility } from '@/utils/map/SpatialAnalysis.ts'

export default defineComponent({
  name: 'UnitTest',
  mounted() {
    let xdt = [
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
    ]
    let ydt = [
      23, 34, 3, 4, 5, 6, 7, 8, 9, 23, 123, 122, 90, 45, 34, 16, 17, 142, 53, 2,
      10,
    ]
    drawEchartsVisibility(xdt, ydt, 30, 20)
  },
})
</script>

<template>
  <div
    id="Echarts-UnitTest"
    style="position: absolute; width: 100%; height: 40rem"
  ></div>
</template>

<style scoped></style>
