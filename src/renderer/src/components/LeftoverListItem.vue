<!--
  Uptime Kuma (MIT) src/components/MonitorListItem.vue 의 목록 항목 구성(알약 배지 · 이름 · 작은 태그)을 가져옴.
  바꾼 점: 알약에 업타임 % 대신 메모리를(정리할 대상이라 주황 = 원본의 pending 색), 이름은 알아보기 쉬운 이름,
  태그는 작업 폴더·프로세스 이름이다. 기록할 상태가 없어 하트비트 칸 없이 이름 칸을 끝까지 쓴다.
-->
<script setup lang="ts">
import { computed } from 'vue'
import type { LeftoverRow } from '../../../shared/types'
import { formatBytes, worktreeFolder } from '../../../shared/format'
import { text } from '../../../shared/text'
import { TAG_COLORS, type ItemTag } from '../tags'
import ItemTags from './ItemTags.vue'

const props = defineProps<{ row: LeftoverRow; active: boolean }>()
const emit = defineEmits<{ select: [] }>()

const tags = computed(() => {
  const list: ItemTag[] = [
    props.row.worktree
      ? { text: worktreeFolder(props.row.worktree), color: TAG_COLORS.indigo }
      : { text: text.ui.tags.noWorktree, color: TAG_COLORS.grey },
    { text: props.row.processName, color: TAG_COLORS.blue }
  ]
  if (props.row.agentInWorktree)
    list.push({ text: text.ui.tags.agentRunning, color: TAG_COLORS.orange })
  return list
})
</script>

<template>
  <a href="#" class="item" :class="{ active }" @click.prevent="emit('select')">
    <div class="row">
      <div class="col-12 small-padding d-flex gap-2 align-items-center">
        <div class="me-1">
          <span
            class="badge rounded-pill"
            :class="row.agentInWorktree ? 'bg-secondary' : 'bg-warning'"
          >
            {{ formatBytes(row.memoryBytes) }}
          </span>
        </div>
        <div class="flex-fill text-truncate" style="min-width: 0">
          <div class="name text-truncate">{{ row.label }}</div>
          <ItemTags :tags="tags" />
        </div>
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
