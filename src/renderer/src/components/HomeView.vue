<!--
  Uptime Kuma (MIT) src/pages/DashboardHome.vue 의 구성(h1 제목 · 큰 숫자 칸 상자 · 표 상자)을 가져옴.
  바꾼 점: 감시 상태 개수 대신 RAM·개발 서버·에이전트 수를, 이벤트 표 대신 메모리 묶음 표를, 그 사이에 RAM 추이 그래프를 둔다.
-->
<script setup lang="ts">
import { computed } from 'vue'
import type { DashboardSnapshot, GroupUsage, ProcessGroup } from '../../../shared/types'
import { formatBytes } from '../../../shared/format'
import { text } from '../../../shared/text'
import type { Point } from '../history'
import TrendChart from './TrendChart.vue'

const props = defineProps<{ snapshot: DashboardSnapshot; ramHistory: Point[] }>()

const hasMemory = computed(() => props.snapshot.memory.totalBytes > 0)
// 화면·트레이 공통 규칙: 내림해야 경고 기준과 표시가 어긋나지 않는다.
const ramPercent = computed(() =>
  hasMemory.value ? `${Math.floor(props.snapshot.memory.usedPercent)}%` : text.ui.none
)
const ramClass = computed(() => {
  if (!hasMemory.value) return 'text-secondary'
  return { normal: '', warn: 'text-warning', danger: 'text-danger' }[props.snapshot.memory.level]
})

const ORDER: ProcessGroup[] = ['devServer', 'agent', 'other']
const LABEL: Record<ProcessGroup, string> = {
  devServer: text.ui.groups.devServer,
  agent: text.ui.groups.agent,
  other: text.ui.groups.other
}
const groups = computed(() =>
  ORDER.map((g) => props.snapshot.groups.find((x) => x.group === g)).filter(
    (g): g is GroupUsage => !!g
  )
)
</script>

<template>
  <div>
    <h1 class="mb-3">{{ text.ui.home.title }}</h1>

    <div class="shadow-box big-padding text-center mb-3 stats">
      <div class="row">
        <div class="col">
          <h3>{{ text.ui.home.ram }}</h3>
          <span class="num" :class="ramClass">{{ ramPercent }}</span>
          <p v-if="hasMemory" class="sub">
            {{
              text.ui.home.ramUsage(
                formatBytes(snapshot.memory.usedBytes),
                formatBytes(snapshot.memory.totalBytes)
              )
            }}
          </p>
        </div>
        <div class="col">
          <h3>{{ text.ui.home.ports }}</h3>
          <span class="num" :class="{ 'text-secondary': snapshot.ports.length === 0 }">
            {{ snapshot.ports.length }}
          </span>
          <p class="sub">{{ text.ui.home.current }}</p>
        </div>
        <div class="col">
          <h3>{{ text.ui.home.agents }}</h3>
          <span class="num" :class="{ 'text-secondary': snapshot.agentProcessCount === 0 }">
            {{ snapshot.agentProcessCount }}
          </span>
          <p class="sub">{{ text.ui.home.current }}</p>
        </div>
        <div class="col">
          <h3>{{ text.ui.home.leftovers }}</h3>
          <span class="num text-secondary">{{ text.ui.none }}</span>
          <p class="sub">{{ text.ui.nextStage }}</p>
        </div>
        <div class="col">
          <h3>{{ text.ui.home.disk }}</h3>
          <span class="num text-secondary">{{ text.ui.none }}</span>
          <p class="sub">{{ text.ui.nextStage }}</p>
        </div>
      </div>
    </div>

    <div class="shadow-box big-padding mb-3">
      <h4 class="mb-3">{{ text.ui.home.ramTrend }}</h4>
      <TrendChart :points="ramHistory" :label="text.ui.home.ram" unit="percent" />
    </div>

    <div class="shadow-box table-shadow-box">
      <table class="table table-borderless table-hover m-0">
        <thead>
          <tr>
            <th>{{ text.ui.home.groupHeaders.name }}</th>
            <th>{{ text.ui.home.groupHeaders.memory }}</th>
            <th>{{ text.ui.home.groupHeaders.processes }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="g in groups" :key="g.group">
            <td>{{ LABEL[g.group] }}</td>
            <td>{{ formatBytes(g.memoryBytes) }}</td>
            <td>{{ text.ui.groups.processes(g.processCount) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <p v-if="snapshot.collectMode" class="collect-mode mt-3">
      {{ text.ui.home.collectMode(text.ui.home.collectModes[snapshot.collectMode]) }}
    </p>
  </div>
</template>

<style scoped lang="scss">
@import '../styles/vars.scss';

/* Uptime Kuma DashboardHome.vue */
.shadow-box {
  padding: 20px;
}

table {
  font-size: 14px;
}

.sub {
  font-size: 13px;
  color: $secondary-text;
  margin: 4px 0 0;
}

.collect-mode {
  font-size: 12px;
  color: $secondary-text;
}

/* 원본 제목(Up·Down 등)보다 한글 제목이 길어 다섯 칸에 들어가도록 조금 줄인다. */
.stats h3 {
  font-size: 1.4rem;
  word-break: keep-all;
}
</style>
