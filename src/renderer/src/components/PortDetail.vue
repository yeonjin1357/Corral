<!--
  Uptime Kuma (MIT) src/pages/Details.vue 의 구성(h1 이름 · 초록 링크 · 버튼 줄 · 하트비트+상태 배지 상자 · 숫자 칸 상자 · 그래프 상자)을 가져옴.
  바꾼 점: 감시 대상 대신 개발 서버 포트의 메모리·연결·PID·하위 프로세스·브랜치를, 응답 시간 대신 메모리 추이를 보여 준다.
-->
<script setup lang="ts">
import { computed } from 'vue'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { faArrowUpRightFromSquare, faTrash } from '@fortawesome/free-solid-svg-icons'
import type { PortRow } from '../../../shared/types'
import { formatBytes } from '../../../shared/format'
import { text } from '../../../shared/text'
import type { PortHistory } from '../history'
import HeartbeatBar from './HeartbeatBar.vue'
import TrendChart from './TrendChart.vue'

const props = defineProps<{
  row: PortRow
  history: PortHistory | undefined
  busy: boolean
  notice: string | null
  intervals: { openMs: number; closedMs: number }
}>()
const emit = defineEmits<{ open: []; kill: [] }>()

const title = computed(() => {
  if (!props.row.worktree) return text.ui.tags.unresolvable
  const parts = props.row.worktree.root.split(/[\\/]+/).filter(Boolean)
  return parts[parts.length - 1] ?? props.row.worktree.root
})
const inUse = computed(() => props.row.clientCount > 0)
const branchKind = computed(() =>
  props.row.worktree?.isLinkedWorktree ? text.ui.detail.linkedWorktree : text.ui.detail.mainCheckout
)
</script>

<template>
  <div>
    <h1>{{ title }}</h1>
    <p class="url">
      <a href="#" @click.prevent="emit('open')">{{ text.ui.detail.url(row.port) }}</a>
    </p>

    <div class="functions">
      <div class="btn-group" role="group">
        <button type="button" class="btn btn-normal btn-open" @click="emit('open')">
          <FontAwesomeIcon :icon="faArrowUpRightFromSquare" /> {{ text.ui.detail.open }}
        </button>
        <button
          v-if="!row.unresolvable"
          type="button"
          class="btn btn-normal text-danger btn-kill"
          :disabled="busy"
          @click="emit('kill')"
        >
          <FontAwesomeIcon :icon="faTrash" /> {{ text.ui.detail.kill }}
        </button>
      </div>
    </div>

    <p v-if="notice" class="kill-notice text-danger mt-3 mb-0">{{ notice }}</p>

    <div class="shadow-box">
      <div class="row">
        <div class="col-md-8">
          <HeartbeatBar :beats="history?.beats ?? []" />
          <span class="word">
            {{ text.ui.detail.every(intervals.openMs / 1000, intervals.closedMs / 1000) }}
          </span>
        </div>
        <div class="col-md-4 text-center d-flex align-items-center justify-content-center">
          <span
            class="badge rounded-pill status-badge"
            :class="inUse ? 'bg-primary' : 'bg-secondary'"
            style="font-size: 30px"
          >
            {{ inUse ? text.ui.detail.inUse : text.ui.detail.idle }}
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
          <h4>{{ text.ui.detail.clients }}</h4>
          <p>{{ text.ui.detail.current }}</p>
          <span class="num">{{ row.clientCount }}</span>
        </div>
        <div class="col">
          <h4>{{ text.ui.detail.pid }}</h4>
          <p>({{ row.processName }})</p>
          <span class="num">{{ row.pid }}</span>
        </div>
        <div class="col">
          <h4>{{ text.ui.detail.children }}</h4>
          <p>{{ text.ui.detail.current }}</p>
          <span class="num">{{ row.descendantPids.length }}</span>
        </div>
        <div class="col">
          <h4>{{ text.ui.detail.branch }}</h4>
          <p>{{ branchKind }}</p>
          <span class="num branch text-truncate" :title="row.worktree?.branch ?? ''">
            {{ row.worktree?.branch ?? '(detached)' }}
          </span>
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

  a {
    color: $primary;
  }
}

.shadow-box {
  padding: 20px;
  margin-top: 25px;
}

.word {
  color: $secondary-text;
  font-size: 14px;
}

.stats p {
  font-size: 13px;
  color: $secondary-text;
}

.stats {
  padding: 10px;

  .col {
    margin: 20px 0;
    min-width: 0;
  }

  /* 원본 상세 화면의 값은 첫 화면의 큰 초록 숫자(.num)가 아니라 보통 글씨다. */
  .num {
    font-size: 1rem;
    font-weight: normal;
    color: inherit;
  }

  /* 긴 브랜치 이름이 칸을 넘어 두 줄로 꺾이지 않게 한 줄 말줄임(전체 이름은 툴팁). */
  .branch {
    display: block;
  }
}
</style>
