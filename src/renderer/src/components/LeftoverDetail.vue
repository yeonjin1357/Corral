<!--
  Uptime Kuma (MIT) src/pages/Details.vue 의 구성(h1 이름 · 초록 글줄 · 버튼 줄 · 숫자 칸 상자)을 가져옴.
  바꾼 점: 감시 대상 대신 주인 없이 남은 프로세스의 명령줄·메모리·PID·하위 프로세스·실행 시간을 보여 주고,
  버튼 줄에는 끄기만 둔다(끄기 전 메인에서 확인 창).
-->
<script setup lang="ts">
import { computed } from 'vue'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { faTrash } from '@fortawesome/free-solid-svg-icons'
import type { LeftoverRow } from '../../../shared/types'
import { formatBytes, formatDuration, worktreeLabel } from '../../../shared/format'
import { text } from '../../../shared/text'

const props = defineProps<{
  row: LeftoverRow
  busy: boolean
  notice: string | null
  /** 실행 시간을 셀 기준 시각(스냅샷 시각). */
  now: number
}>()
const emit = defineEmits<{ kill: [] }>()

const where = computed(() =>
  props.row.worktree ? worktreeLabel(props.row.worktree) : text.ui.tags.noWorktree
)
const runtime = computed(() =>
  props.row.startedAt == null ? text.ui.none : formatDuration(props.now - props.row.startedAt)
)
</script>

<template>
  <div>
    <h1>{{ row.label }}</h1>
    <p class="url" :class="{ muted: !row.worktree }">{{ where }}</p>
    <p class="note">{{ text.ui.leftover.why }}</p>

    <div class="functions">
      <div class="btn-group" role="group">
        <button
          type="button"
          class="btn btn-normal text-danger btn-kill"
          :disabled="busy"
          @click="emit('kill')"
        >
          <FontAwesomeIcon :icon="faTrash" /> {{ text.ui.leftover.kill }}
        </button>
      </div>
    </div>

    <p v-if="notice" class="kill-notice text-danger mt-3 mb-0">{{ notice }}</p>

    <div class="shadow-box">
      <h4>{{ text.ui.leftover.commandLine }}</h4>
      <code class="command-line">{{ row.commandLine }}</code>
    </div>

    <div class="shadow-box big-padding text-center stats">
      <div class="row">
        <div class="col-6 col-lg stat">
          <h4>{{ text.ui.detail.memory }}</h4>
          <p>{{ text.ui.detail.current }}</p>
          <span class="num">{{ formatBytes(row.memoryBytes) }}</span>
        </div>
        <div class="col-6 col-lg stat">
          <h4>{{ text.ui.detail.pid }}</h4>
          <p>({{ row.processName }})</p>
          <span class="num">{{ row.pid }}</span>
        </div>
        <div class="col-6 col-lg stat">
          <h4>{{ text.ui.detail.children }}</h4>
          <p>{{ text.ui.detail.current }}</p>
          <span class="num">{{ row.descendantPids.length }}</span>
        </div>
        <div class="col-6 col-lg stat">
          <h4>{{ text.ui.leftover.runtime }}</h4>
          <p>{{ text.ui.detail.current }}</p>
          <span class="num">{{ runtime }}</span>
        </div>
      </div>
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

.command-line {
  display: block;
  font-size: 13px;
  word-break: break-all;
  white-space: pre-wrap;
  color: inherit;
}

.stats p {
  font-size: 13px;
  color: $secondary-text;
}

.stats {
  padding: 10px;

  .stat {
    margin: 20px 0;
  }

  .num {
    font-size: 1rem;
    font-weight: normal;
    color: inherit;
  }
}

/* 좁은 창에서 한글 제목(하위 프로세스 등)이 글자 중간에서 꺾이지 않게 */
.stats h4 {
  word-break: keep-all;
}
</style>
