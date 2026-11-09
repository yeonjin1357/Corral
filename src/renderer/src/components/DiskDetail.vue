<!--
  Uptime Kuma (MIT) src/pages/Details.vue 의 구성(h1 이름 · 초록 글줄 · 버튼 줄 · 숫자 칸 상자 · 표 상자)을 가져옴.
  바꾼 점: 감시 대상 대신 끝난 워크트리의 의존성 폴더(이름·경로·크기)와 끝났다고 본 근거를 보여 주고,
  버튼 줄에는 의존성 폴더 지우기만 둔다(지우기 전 메인에서 다시 확인하고 확인 창).
-->
<script setup lang="ts">
import { computed } from 'vue'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { faTrash } from '@fortawesome/free-solid-svg-icons'
import type { DiskFolder, DiskRow } from '../../../shared/types'
import { formatBytes } from '../../../shared/format'
import { text } from '../../../shared/text'

const props = defineProps<{ row: DiskRow; busy: boolean; notice: string | null }>()
const emit = defineEmits<{ remove: [] }>()

const folder = computed(
  () => props.row.worktreeRoot.split(/[\\/]/).filter(Boolean).pop() ?? props.row.worktreeRoot
)
const deletable = computed(() => props.row.folders.filter((f) => !f.skipped))
const canRemove = computed(
  () =>
    !props.busy &&
    !props.row.inUse &&
    deletable.value.length > 0 &&
    deletable.value.every((f) => f.bytes != null)
)
const total = computed(() =>
  props.row.totalBytes == null ? text.ui.disk.measuring : formatBytes(props.row.totalBytes)
)

function folderSize(f: DiskFolder): string {
  if (f.skipped) return text.ui.disk.link
  return f.bytes == null ? text.ui.disk.measuring : formatBytes(f.bytes)
}
</script>

<template>
  <div>
    <h1>{{ folder }}</h1>
    <p class="url">{{ row.worktreeRoot }}</p>
    <p class="note" :class="{ 'text-warning': row.inUse }">
      {{ row.inUse ? text.ui.disk.inUseNote : text.ui.disk.evidenceNote[row.evidence] }}
    </p>

    <div class="functions">
      <div class="btn-group" role="group">
        <button
          type="button"
          class="btn btn-normal text-danger btn-remove"
          :disabled="!canRemove"
          @click="emit('remove')"
        >
          <FontAwesomeIcon :icon="faTrash" /> {{ text.ui.disk.remove }}
        </button>
      </div>
    </div>

    <p v-if="notice" class="remove-notice mt-3 mb-0">{{ notice }}</p>

    <div class="shadow-box big-padding text-center stats">
      <div class="row">
        <div class="col">
          <h4>{{ text.ui.disk.size }}</h4>
          <p>{{ text.ui.disk.sizeSub }}</p>
          <span class="num">{{ total }}</span>
        </div>
        <div class="col">
          <h4>{{ text.ui.disk.branch }}</h4>
          <p>{{ text.ui.detail.linkedWorktree }}</p>
          <span class="num text-truncate d-block" :title="row.branch ?? ''">
            {{ row.branch ?? text.detached }}
          </span>
        </div>
        <div class="col">
          <h4>{{ text.ui.disk.evidenceTitle }}</h4>
          <p>{{ text.ui.disk.evidenceSub }}</p>
          <span class="num">{{ text.ui.disk.evidence[row.evidence] }}</span>
        </div>
      </div>
    </div>

    <div class="shadow-box table-shadow-box folders">
      <table class="table table-borderless table-hover m-0">
        <thead>
          <tr>
            <th>{{ text.ui.disk.folders }}</th>
            <th>{{ text.ui.disk.size }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="f in row.folders" :key="f.path">
            <td>
              <div>{{ f.name }}</div>
              <div class="path">{{ f.path }}</div>
            </td>
            <td class="text-nowrap">{{ folderSize(f) }}</td>
          </tr>
        </tbody>
      </table>
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
    min-width: 0;
  }

  .num {
    font-size: 1rem;
    font-weight: normal;
    color: inherit;
  }
}

table {
  font-size: 14px;
}

.path {
  font-size: 12px;
  color: $secondary-text;
  word-break: break-all;
}
</style>
