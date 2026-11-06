<!--
  Uptime Kuma (MIT) src/components/MonitorListItem.vue 의 목록 항목 구성(알약 배지 · 이름 · 작은 태그 · 작은 하트비트)과
  src/components/Tag.vue 의 태그 모양을 가져옴.
  바꾼 점: 업타임 % 대신 포트 번호를, 사용자 태그 대신 브랜치·프로세스 이름을 보여 준다.
  이름이 원본보다 길어(폴더 이름) 이름 칸을 조금 넓혔다(원본 col-9/col-xl-6 → col-8).
-->
<script setup lang="ts">
import { computed } from 'vue'
import type { PortRow } from '../../../shared/types'
import { worktreeFolder } from '../../../shared/format'
import { text } from '../../../shared/text'
import type { Beat } from '../history'
import HeartbeatBar from './HeartbeatBar.vue'

const props = defineProps<{ row: PortRow; beats: Beat[]; active: boolean }>()
const emit = defineEmits<{ select: [] }>()

/** Uptime Kuma 기본 태그 색: Indigo(브랜치), Blue(프로세스). */
const TAG_INDIGO = '#4F46E5'
const TAG_BLUE = '#2563EB'

const pillClass = computed(() =>
  props.row.clientCount > 0 && !props.row.unresolvable ? 'bg-primary' : 'bg-secondary'
)
const tags = computed(() => {
  const list: { text: string; color: string }[] = []
  if (props.row.worktree) {
    list.push({ text: props.row.worktree.branch ?? text.detached, color: TAG_INDIGO })
  }
  list.push({ text: props.row.processName, color: TAG_BLUE })
  return list
})
</script>

<template>
  <a href="#" class="item" :class="{ active }" @click.prevent="emit('select')">
    <div class="row">
      <div class="col-8 small-padding d-flex gap-2 align-items-center">
        <div class="me-1">
          <span class="badge rounded-pill" :class="pillClass">:{{ row.port }}</span>
        </div>
        <div class="flex-fill text-truncate" style="min-width: 0">
          <div class="name text-truncate">{{ worktreeFolder(row.worktree) }}</div>
          <div class="tags gap-1">
            <span
              v-for="tag in tags"
              :key="tag.text"
              class="tag-wrapper rounded d-inline-flex px-2 py-0"
              :style="{ backgroundColor: tag.color, fontSize: '0.7em' }"
            >
              <span class="tag-text">{{ tag.text }}</span>
            </span>
          </div>
        </div>
      </div>
      <div class="col-4 d-flex align-items-center">
        <HeartbeatBar class="w-100" :beats="beats" size="small" />
      </div>
    </div>
  </a>
</template>

<style scoped lang="scss">
/* Uptime Kuma MonitorListItem.vue · Tag.vue · Uptime.vue */
.small-padding {
  padding-left: 5px !important;
  padding-right: 5px !important;
}

.badge {
  min-width: 62px;
}

.tags {
  margin-top: 4px;
  padding-left: 4px;
  display: flex;
  flex-wrap: wrap;
  min-width: 0;
}

.tag-wrapper {
  color: white;
  opacity: 0.85;
  margin-right: 4px;
  max-width: 100%;

  .dark & {
    opacity: 1;
  }
}

.tag-text {
  padding-bottom: 1px !important;
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
}
</style>
