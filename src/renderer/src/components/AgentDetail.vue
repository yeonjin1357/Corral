<!--
  Uptime Kuma (MIT) src/pages/Details.vue 의 구성(h1 이름 · 초록 글줄 · 하트비트+상태 배지 상자 · 숫자 칸 상자 · 그래프 상자)을 가져옴.
  바꾼 점: 감시 대상 대신 에이전트의 상태·메모리·하위 프로세스·실행 시간·CPU·상태 출처를 보여 준다.
  에이전트는 끄지 않으므로(스펙 비목표) 버튼 줄이 없다.
-->
<script setup lang="ts">
import { computed } from 'vue'
import type { AgentRow, ClaudeHookStatus } from '../../../shared/types'
import { formatBytes, formatDuration, worktreeFolder } from '../../../shared/format'
import { text } from '../../../shared/text'
import type { PortHistory } from '../history'
import { AGENT_PILL } from '../tags'
import HeartbeatBar from './HeartbeatBar.vue'
import TrendChart from './TrendChart.vue'

const props = defineProps<{
  row: AgentRow
  history: PortHistory | undefined
  /** 실행 시간을 셀 기준 시각(스냅샷 시각). */
  now: number
  hook: ClaudeHookStatus | null
}>()

const title = computed(() =>
  props.row.worktree ? worktreeFolder(props.row.worktree) : text.ui.tags.noWorktree
)
const where = computed(() => {
  const tool = text.ui.agent.toolNames[props.row.tool]
  return props.row.worktree ? `${tool} · ${props.row.worktree.root}` : tool
})
const runtime = computed(() =>
  props.row.startedAt == null ? text.ui.none : formatDuration(props.now - props.row.startedAt)
)
const cpu = computed(() =>
  props.row.cpuPercent == null ? text.ui.none : `${props.row.cpuPercent}%`
)
const note = computed(() => {
  if (props.row.tool === 'codex') return text.ui.agent.codexNote
  if (props.row.stateSource === 'cpu' && props.hook?.state !== 'on') return text.ui.agent.noHookNote
  return null
})
</script>

<template>
  <div>
    <h1>{{ title }}</h1>
    <p class="url" :class="{ muted: !row.worktree }">{{ where }}</p>
    <p v-if="note" class="note">{{ note }}</p>

    <div class="shadow-box">
      <div class="row">
        <div class="col-md-8">
          <HeartbeatBar :beats="history?.beats ?? []" />
        </div>
        <div class="col-md-4 text-center d-flex align-items-center justify-content-center">
          <span
            class="badge rounded-pill status-badge"
            :class="AGENT_PILL[row.state]"
            style="font-size: 30px"
          >
            {{ text.ui.agent.states[row.state] }}
          </span>
        </div>
      </div>
    </div>

    <div class="shadow-box big-padding text-center stats">
      <div class="row">
        <div class="col">
          <h4>{{ text.ui.detail.memory }}</h4>
          <p>{{ text.ui.detail.current }}</p>
          <span class="num">{{ formatBytes(row.memoryBytes) }}</span>
        </div>
        <div class="col">
          <h4>{{ text.ui.detail.children }}</h4>
          <p>{{ text.ui.detail.current }}</p>
          <span class="num">{{ row.descendantCount }}</span>
        </div>
        <div class="col">
          <h4>{{ text.ui.agent.runtime }}</h4>
          <p>(PID {{ row.pid }})</p>
          <span class="num">{{ runtime }}</span>
        </div>
        <div class="col">
          <h4>{{ text.ui.agent.cpu }}</h4>
          <p>{{ text.ui.agent.cpuSub }}</p>
          <span class="num">{{ cpu }}</span>
        </div>
        <div class="col">
          <h4>{{ text.ui.agent.stateSource }}</h4>
          <p>{{ text.ui.detail.current }}</p>
          <span class="num">{{ text.ui.agent.sources[row.stateSource] }}</span>
        </div>
      </div>
    </div>

    <div class="shadow-box big-padding">
      <h4 class="mb-3">{{ text.ui.detail.memoryTrend }}</h4>
      <TrendChart :points="history?.memory ?? []" :label="text.ui.detail.memory" unit="bytes" />
    </div>
  </div>
</template>

<style scoped lang="scss">
@import '../styles/vars.scss';

/* Uptime Kuma Details.vue */
.url {
  color: $primary;
  margin-bottom: 20px;
  font-weight: bold;
  word-break: break-all;

  /* 작업 폴더를 모르면 링크처럼 보이지 않게 흐리게 */
  &.muted {
    color: $secondary-text;
  }
}

.note {
  color: $secondary-text;
  font-size: 14px;
  margin-top: -12px;
}

.shadow-box {
  padding: 20px;
  margin-top: 25px;
}

.stats p {
  font-size: 13px;
  color: $secondary-text;
}

.stats {
  padding: 10px;

  .col {
    margin: 20px 0;
  }

  /* 원본 상세 화면의 값은 첫 화면의 큰 초록 숫자(.num)가 아니라 보통 글씨다. */
  .num {
    font-size: 1rem;
    font-weight: normal;
    color: inherit;
  }
}
</style>
