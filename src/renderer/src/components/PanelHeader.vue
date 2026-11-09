<!--
  NeoHtop (MIT) stats/*Panel.svelte 의 카드 머리: 색 칩 아이콘 + 제목, 오른쪽에 배지와 ↗ 버튼.
-->
<script setup lang="ts">
import type { Component } from 'vue'
import { ArrowUpRight } from '@lucide/vue'
import CardHeader from '../ui/CardHeader.vue'
import CardTitle from '../ui/CardTitle.vue'
import Badge from '../ui/Badge.vue'
import Button from '../ui/Button.vue'

defineProps<{
  icon: Component
  title: string
  /** 아이콘 칩 색(var(--chart-1) 등). 없으면 회색 칩(NeoHtop System 카드). */
  color?: string | null
  /** ↗ 버튼 설명. 없으면 버튼을 두지 않는다. */
  actionLabel?: string | null
}>()
const emit = defineEmits<{ action: [] }>()
</script>

<template>
  <CardHeader class="grid-cols-[1fr_auto] items-center gap-2">
    <CardTitle class="flex min-w-0 items-center gap-2 text-sm font-medium text-muted-foreground">
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
      <span class="truncate">{{ title }}</span>
    </CardTitle>
    <div class="flex items-center gap-1">
      <slot name="badge" />
      <Button
        v-if="actionLabel"
        variant="ghost"
        size="icon-xs"
        :aria-label="actionLabel"
        :title="actionLabel"
        @click="emit('action')"
      >
        <ArrowUpRight class="size-3.5" />
      </Button>
    </div>
  </CardHeader>
</template>
