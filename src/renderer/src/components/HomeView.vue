<!--
  Uptime Kuma (MIT) src/pages/DashboardHome.vue 의 구성(h1 제목 · 큰 숫자 칸 상자 · 표 상자)을 가져옴.
  바꾼 점: 감시 상태 개수 대신 RAM·개발 서버·에이전트(권한 대기)·남은 프로세스·정리 후보 수를, 이벤트 표 대신 메모리 묶음 표를,
  그 사이에 메모리 정리 추천(RAM 경고 이상)·무거운 작업·Claude 연동 상자·RAM 추이 그래프를 둔다(같은 shadow-box·표 모양).
-->
<script setup lang="ts">
import { computed } from 'vue'
import type { DashboardSnapshot, GroupUsage, ProcessGroup } from '../../../shared/types'
import { formatBytes, formatDuration, worktreeLabel } from '../../../shared/format'
import { cleanupRecommendation } from '../../../shared/recommend'
import { text } from '../../../shared/text'
import type { Point } from '../history'
import { hookControls } from '../hook'
import TrendChart from './TrendChart.vue'

const props = withDefaults(
  defineProps<{
    snapshot: DashboardSnapshot
    ramHistory: Point[]
    hookBusy?: boolean
    /** 메모리 정리 추천 "모두 끄기" 처리 중. */
    recommendBusy?: boolean
    recommendNotice?: string | null
  }>(),
  { hookBusy: false, recommendBusy: false, recommendNotice: null }
)
const emit = defineEmits<{
  hook: [action: 'enable' | 'disable']
  select: [key: string]
  killMany: [keys: string[]]
}>()

const showRecommend = computed(
  () => props.snapshot.memory.totalBytes > 0 && props.snapshot.memory.level !== 'normal'
)
const recommendation = computed(() => cleanupRecommendation(props.snapshot))
const heavyWhere = (w: DashboardSnapshot['heavyJobs'][number]['worktree']): string =>
  w ? worktreeLabel(w) : text.ui.tags.noWorktree
const heavyRuntime = (startedAt: number | null): string =>
  startedAt == null ? text.ui.none : formatDuration(props.snapshot.takenAt - startedAt)

const waiting = computed(() => props.snapshot.agents.filter((a) => a.state === 'waiting').length)
const candidates = computed(
  () => props.snapshot.ports.filter((p) => p.judgement === 'candidate').length
)
const checks = computed(() => props.snapshot.ports.filter((p) => p.judgement === 'check').length)

const hook = computed(() => props.snapshot.hook)
const controls = computed(() => hookControls(hook.value))
const hookText = computed(() => controls.value.text)
const hookButton = computed(() => controls.value.button)
const canAlsoDisable = computed(() => controls.value.canAlsoDisable)

const hasMemory = computed(() => props.snapshot.memory.totalBytes > 0)
// 화면·트레이 공통 규칙: 내림해야 경고 기준과 표시가 어긋나지 않는다.
const ramPercent = computed(() =>
  hasMemory.value ? `${Math.floor(props.snapshot.memory.usedPercent)}%` : text.ui.none
)
const ramClass = computed(() => {
  if (!hasMemory.value) return 'text-secondary'
  return { normal: '', warn: 'text-warning', danger: 'text-danger' }[props.snapshot.memory.level]
})

const ORDER: ProcessGroup[] = ['devServer', 'agent', 'heavy', 'otherApps', 'system']
const LABEL: Record<ProcessGroup, string> = {
  devServer: text.ui.groups.devServer,
  agent: text.ui.groups.agent,
  heavy: text.ui.groups.heavy,
  otherApps: text.ui.groups.otherApps,
  system: text.ui.groups.system
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

    <div v-if="showRecommend" class="shadow-box big-padding mb-3 recommend-box">
      <div class="d-flex align-items-center gap-3 flex-wrap">
        <div class="flex-fill">
          <h4 class="mb-1">{{ text.ui.home.recommendTitle }}</h4>
          <p v-if="recommendation.items.length" class="mb-0" :class="ramClass">
            {{
              text.ui.home.recommendSummary(
                recommendation.items.length,
                formatBytes(recommendation.totalBytes)
              )
            }}
          </p>
          <p v-else class="mb-0">{{ text.ui.home.recommendNone }}</p>
        </div>
        <button
          v-if="recommendation.items.length"
          type="button"
          class="btn btn-danger btn-kill-many"
          :disabled="recommendBusy"
          @click="
            emit(
              'killMany',
              recommendation.items.map((i) => i.key)
            )
          "
        >
          {{ text.ui.home.killAll }}
        </button>
      </div>
      <table
        v-if="recommendation.items.length"
        class="table table-borderless table-hover mt-3 mb-0"
      >
        <tbody>
          <tr
            v-for="item in recommendation.items"
            :key="item.key"
            class="recommend-item"
            role="button"
            @click="emit('select', item.key)"
          >
            <td>{{ item.title }}</td>
            <td>{{ item.where }}</td>
            <td class="text-end">{{ formatBytes(item.memoryBytes) }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="recommendNotice" class="small mt-2 mb-0 recommend-notice">{{ recommendNotice }}</p>
    </div>

    <div v-if="snapshot.heavyJobs.length" class="shadow-box big-padding mb-3 heavy-box">
      <h4 class="mb-1">{{ text.ui.home.heavyTitle }}</h4>
      <p v-if="snapshot.heavyOverlap" class="mb-0 text-warning">
        {{
          text.ui.home.heavyOverlap(
            Math.floor(snapshot.memory.usedPercent),
            snapshot.heavyJobs.length
          )
        }}
      </p>
      <table class="table table-borderless table-hover mt-3 mb-0">
        <tbody>
          <tr v-for="job in snapshot.heavyJobs" :key="job.pid">
            <td>{{ job.label }}</td>
            <td>{{ heavyWhere(job.worktree) }}</td>
            <td>{{ formatBytes(job.memoryBytes) }}</td>
            <td class="text-end">{{ heavyRuntime(job.startedAt) }}</td>
          </tr>
        </tbody>
      </table>
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
        <button
          v-if="canAlsoDisable"
          type="button"
          class="btn btn-normal btn-hook-off"
          :disabled="hookBusy"
          @click="emit('hook', 'disable')"
        >
          {{ text.ui.hook.disable }}
        </button>
      </div>
    </div>

    <div class="shadow-box big-padding mb-3">
      <h4 class="mb-3">{{ text.ui.home.ramTrend }}</h4>
      <TrendChart :points="ramHistory" :label="text.ui.home.ram" unit="percent" />
    </div>

    <div class="shadow-box table-shadow-box mb-3 groups-box">
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
            <td>
              {{ g.group === 'system' ? text.ui.none : text.ui.groups.processes(g.processCount) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="snapshot.topApps.length" class="shadow-box table-shadow-box top-apps-box">
      <table class="table table-borderless table-hover m-0">
        <thead>
          <tr>
            <th>{{ text.ui.home.topAppsTitle }}</th>
            <th>{{ text.ui.home.groupHeaders.memory }}</th>
            <th>{{ text.ui.home.groupHeaders.processes }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="app in snapshot.topApps" :key="app.name">
            <td>{{ app.name }}</td>
            <td>{{ formatBytes(app.memoryBytes) }}</td>
            <td>{{ text.ui.groups.processes(app.processCount) }}</td>
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
