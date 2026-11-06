<!--
  Uptime Kuma (MIT) src/components/MonitorListItem.vue 의 목록 항목 구성(알약 배지 · 이름 · 작은 태그 · 작은 하트비트)을 가져옴.
  바꾼 점: 업타임 % 대신 포트 번호를, 사용자 태그 대신 판단(정리 후보·확인해볼 것)·브랜치·프로세스 이름을 보여 준다.
  이름이 원본보다 길어(폴더 이름) 이름 칸을 조금 넓혔다(원본 col-9/col-xl-6 → col-8).
-->
<script setup lang="ts">
import { computed } from 'vue'
import type { PortRow } from '../../../shared/types'
import { worktreeFolder } from '../../../shared/format'
import { text } from '../../../shared/text'
import type { Beat } from '../history'
import { TAG_COLORS, type ItemTag } from '../tags'
import HeartbeatBar from './HeartbeatBar.vue'
import ItemTags from './ItemTags.vue'

const props = defineProps<{ row: PortRow; beats: Beat[]; active: boolean }>()
const emit = defineEmits<{ select: [] }>()

const pillClass = computed(() =>
  props.row.clientCount > 0 && !props.row.unresolvable ? 'bg-primary' : 'bg-secondary'
)
const tags = computed(() => {
  const list: ItemTag[] = []
  if (props.row.judgement === 'candidate')
    list.push({ text: text.ui.tags.candidate, color: TAG_COLORS.red })
  if (props.row.judgement === 'check')
    list.push({ text: text.ui.tags.check, color: TAG_COLORS.orange })
  if (props.row.worktree) {
    list.push({ text: props.row.worktree.branch ?? text.detached, color: TAG_COLORS.indigo })
  }
  list.push({ text: props.row.processName, color: TAG_COLORS.blue })
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
          <ItemTags :tags="tags" />
        </div>
      </div>
      <div class="col-4 d-flex align-items-center">
        <HeartbeatBar class="w-100" :beats="beats" size="small" />
      </div>
    </div>
  </a>
</template>

<style scoped lang="scss">
/* Uptime Kuma MonitorListItem.vue · Uptime.vue */
.small-padding {
  padding-left: 5px !important;
  padding-right: 5px !important;
}

.badge {
  min-width: 62px;
}
</style>
