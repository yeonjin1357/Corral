<!--
  Uptime Kuma (MIT) src/pages/DashboardHome.vue 의 구성(h1 제목 · 큰 숫자 칸 상자 · 표 상자)을 가져옴.
  바꾼 점: 감시 상태 개수 대신 RAM·개발 서버·에이전트(권한 대기)·남은 프로세스·정리 후보 수를, 이벤트 표 대신 메모리 묶음 표를,
  그 사이에 RAM 추이 그래프와 Claude 연동 상자를 둔다.
-->
<script setup lang="ts">
import { computed } from 'vue'
import type { DashboardSnapshot, GroupUsage, ProcessGroup } from '../../../shared/types'
import { formatBytes } from '../../../shared/format'
import { text } from '../../../shared/text'
import type { Point } from '../history'
import TrendChart from './TrendChart.vue'

const props = withDefaults(
  defineProps<{ snapshot: DashboardSnapshot; ramHistory: Point[]; hookBusy?: boolean }>(),
  { hookBusy: false }
)
const emit = defineEmits<{ hook: [action: 'enable' | 'disable'] }>()

const waiting = computed(() => props.snapshot.agents.filter((a) => a.state === 'waiting').length)
const candidates = computed(
  () => props.snapshot.ports.filter((p) => p.judgement === 'candidate').length
)
const checks = computed(() => props.snapshot.ports.filter((p) => p.judgement === 'check').length)

const hook = computed(() => props.snapshot.hook)
const hookText = computed(() => {
  const h = hook.value
  if (!h) return ''
  if (h.state === 'error') return text.ui.hook.states[h.problem ?? 'settings']
  return text.ui.hook.states[h.state]
})
const hookButton = computed(() => {
  const h = hook.value
  if (!h) return null
  if (h.state === 'on') return { label: text.ui.hook.disable, action: 'disable' as const }
  if (h.state === 'off') return { label: text.ui.hook.enable, action: 'enable' as const }
  return { label: text.ui.hook.reenable, action: 'enable' as const }
})

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
          <span class="num" :class="{ 'text-secondary': snapshot.agents.length === 0 }">
            {{ snapshot.agents.length }}
          </span>
          <p v-if="waiting > 0" class="sub text-warning">{{ text.ui.home.waiting(waiting) }}</p>
          <p v-else class="sub">{{ text.ui.home.current }}</p>
        </div>
        <div class="col">
          <h3>{{ text.ui.home.leftovers }}</h3>
          <span class="num" :class="snapshot.leftovers.length ? 'text-warning' : 'text-secondary'">
            {{ snapshot.leftovers.length }}
          </span>
          <p class="sub">{{ text.ui.home.current }}</p>
        </div>
        <div class="col">
          <h3>{{ text.ui.home.candidates }}</h3>
          <span class="num" :class="candidates ? 'text-danger' : 'text-secondary'">
            {{ candidates }}
          </span>
          <p v-if="checks > 0" class="sub">{{ text.ui.home.checks(checks) }}</p>
          <p v-else class="sub">{{ text.ui.home.current }}</p>
        </div>
      </div>
    </div>

    <div v-if="hook" class="shadow-box big-padding mb-3 hook-box">
      <div class="d-flex align-items-center gap-3 flex-wrap">
        <div class="flex-fill">
          <h4 class="mb-1">{{ text.ui.hook.title }}</h4>
          <p class="mb-0" :class="{ 'text-danger': hook.state === 'error' }">{{ hookText }}</p>
          <p v-if="hook.allHooksDisabled" class="mb-0 text-warning">
            {{ text.ui.hook.allHooksDisabled }}
          </p>
        </div>
        <button
          v-if="hookButton"
          type="button"
          class="btn btn-normal btn-hook"
          :disabled="hookBusy"
          @click="emit('hook', hookButton.action)"
        >
          {{ hookButton.label }}
        </button>
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
