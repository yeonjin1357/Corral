<!--
  Uptime Kuma (MIT) src/components/MonitorListItem.vue 의 목록 항목 구성(알약 배지 · 이름 · 작은 태그 · 작은 하트비트)을 가져옴.
  바꾼 점: 알약에 업타임 % 대신 도구 이름(Claude·Codex)을, 색은 상태(작업 중 초록·권한 대기 주황·쉬는 중 회색·오류 빨강)로,
  태그는 상태·브랜치, 하트비트는 작업 중 여부 기록이다.
-->
<script setup lang="ts">
import { computed } from 'vue'
import type { AgentRow } from '../../../shared/types'
import { worktreeFolder } from '../../../shared/format'
import { text } from '../../../shared/text'
import type { Beat } from '../history'
import { AGENT_PILL, AGENT_TAG, TAG_COLORS, type ItemTag } from '../tags'
import HeartbeatBar from './HeartbeatBar.vue'
import ItemTags from './ItemTags.vue'

const props = defineProps<{ row: AgentRow; beats: Beat[]; active: boolean }>()
const emit = defineEmits<{ select: [] }>()

const name = computed(() =>
  props.row.worktree ? worktreeFolder(props.row.worktree) : text.ui.tags.noWorktree
)
const tags = computed(() => {
  const list: ItemTag[] = [
    { text: text.ui.agent.states[props.row.state], color: AGENT_TAG[props.row.state] }
  ]
  if (props.row.worktree)
    list.push({ text: props.row.worktree.branch ?? text.detached, color: TAG_COLORS.indigo })
  return list
})
</script>

<template>
  <a href="#" class="item" :class="{ active }" @click.prevent="emit('select')">
    <div class="row">
      <div class="col-8 small-padding d-flex gap-2 align-items-center">
        <div class="me-1">
          <span class="badge rounded-pill" :class="AGENT_PILL[row.state]">
            {{ text.ui.agent.tools[row.tool] }}
          </span>
        </div>
        <div class="flex-fill text-truncate" style="min-width: 0">
          <div class="name text-truncate">{{ name }}</div>
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
