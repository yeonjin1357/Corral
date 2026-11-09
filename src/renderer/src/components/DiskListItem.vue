<!--
  Uptime Kuma (MIT) src/components/MonitorListItem.vue 의 목록 항목 구성(알약 배지 · 이름 · 작은 태그)을 가져옴.
  바꾼 점: 알약에 업타임 % 대신 지울 수 있는 크기를(정리할 대상이라 주황 = 원본의 pending 색, 사용 중이면 회색),
  이름은 워크트리 폴더, 태그는 끝났다고 본 근거·브랜치·사용 중이다. 하트비트 칸 없이 이름 칸을 끝까지 쓴다.
-->
<script setup lang="ts">
import { computed } from 'vue'
import type { DiskRow } from '../../../shared/types'
import { formatBytes } from '../../../shared/format'
import { text } from '../../../shared/text'
import { TAG_COLORS, type ItemTag } from '../tags'
import ItemTags from './ItemTags.vue'

const props = defineProps<{ row: DiskRow; active: boolean }>()
const emit = defineEmits<{ select: [] }>()

const folder = computed(
  () => props.row.worktreeRoot.split(/[\\/]/).filter(Boolean).pop() ?? props.row.worktreeRoot
)
const size = computed(() =>
  props.row.totalBytes == null ? text.ui.disk.measuring : formatBytes(props.row.totalBytes)
)
const tags = computed(() => {
  const list: ItemTag[] = [
    { text: text.ui.disk.evidence[props.row.evidence], color: TAG_COLORS.green },
    { text: props.row.branch ?? text.detached, color: TAG_COLORS.indigo }
  ]
  if (props.row.inUse) list.push({ text: text.ui.disk.inUse, color: TAG_COLORS.orange })
  return list
})
</script>

<template>
  <a href="#" class="item" :class="{ active }" @click.prevent="emit('select')">
    <div class="row">
      <div class="col-12 small-padding d-flex gap-2 align-items-center">
        <div class="me-1">
          <span class="badge rounded-pill" :class="row.inUse ? 'bg-secondary' : 'bg-warning'">
            {{ size }}
          </span>
        </div>
        <div class="flex-fill text-truncate" style="min-width: 0">
          <div class="name text-truncate">{{ folder }}</div>
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
