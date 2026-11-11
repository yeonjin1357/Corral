<!--
  카드 제목 앞의 색 칩 아이콘(NeoHtop stats/*Panel.svelte). 카드 머리(PanelHeader)와 간단히 카드(CompactCard)가 같이 쓴다.
  제목이 같은 뜻을 글로 보이므로 읽어 주지 않는다.
-->
<script setup lang="ts">
import type { Component } from 'vue'
import Badge from '../ui/Badge.vue'

defineProps<{
  icon: Component
  /** 칩 색(var(--chart-1) 등). 없으면 회색 칩(NeoHtop System 카드). */
  color?: string | null
}>()
</script>

<template>
  <Badge
    variant="secondary"
    :class="
      color
        ? 'size-5 rounded-md border-0 p-0 bg-primary/10 text-primary [&>svg]:size-3!'
        : 'size-5 rounded-md border-0 p-0 bg-muted text-muted-foreground [&>svg]:size-3!'
    "
    :style="color ? { '--primary': color } : undefined"
    aria-hidden="true"
  >
    <component :is="icon" />
  </Badge>
</template>
