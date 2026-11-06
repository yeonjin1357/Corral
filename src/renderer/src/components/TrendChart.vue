<!--
  Uptime Kuma (MIT) src/components/PingChart.vue 처럼 vue-chartjs Line 으로 그린다(선·채우기·격자 색은 chart.ts).
-->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { Line } from 'vue-chartjs'
import {
  CategoryScale,
  Chart as ChartJS,
  Filler,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  type ChartData,
  type ChartOptions
} from 'chart.js'
import type { Point } from '../history'
import { trendChartData, trendChartOptions, type TrendUnit } from '../chart'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip)

const props = defineProps<{ points: Point[]; label: string; unit: TrendUnit }>()

// body.dark 가 바뀌면(OS 테마 전환) 격자·툴팁 색도 바꾼다.
const dark = ref(document.body.classList.contains('dark'))
let observer: MutationObserver | null = null
onMounted(() => {
  observer = new MutationObserver(() => {
    dark.value = document.body.classList.contains('dark')
  })
  observer.observe(document.body, { attributes: true, attributeFilter: ['class'] })
})
onUnmounted(() => observer?.disconnect())

const data = computed(() => trendChartData(props.points, props.label) as ChartData<'line'>)
const options = computed(
  () => trendChartOptions(dark.value, props.unit) as unknown as ChartOptions<'line'>
)
</script>

<template>
  <div class="chart-wrapper">
    <Line :data="data" :options="options" />
  </div>
</template>

<style scoped>
.chart-wrapper {
  height: 250px;
}
</style>
