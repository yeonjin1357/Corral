<!--
  Uptime Kuma (MIT) src/components/Tag.vue 의 작은 태그 모양(둥근 색 상자 · 흰 글씨 · 0.7em)을 가져옴.
  목록 항목 이름 아래에 여러 개를 한 줄로 늘어놓는다(MonitorListItem.vue 의 .tags).
-->
<script setup lang="ts">
import type { ItemTag } from '../tags'

defineProps<{ tags: ItemTag[] }>()
</script>

<template>
  <div class="tags gap-1">
    <span
      v-for="(tag, i) in tags"
      :key="i"
      class="tag-wrapper rounded d-inline-flex px-2 py-0"
      :style="{ backgroundColor: tag.color, fontSize: '0.7em' }"
    >
      <span class="tag-text">{{ tag.text }}</span>
    </span>
  </div>
</template>

<style scoped lang="scss">
/* Uptime Kuma MonitorListItem.vue · Tag.vue */
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
