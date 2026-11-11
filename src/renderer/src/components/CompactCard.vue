<!--
  간단히 단계(G2)의 카드 한 장: 아이콘·제목·큰 값이 한 줄, 그 아래 짧은 설명 한 줄(높이 72px — layoutState 의 TOP_HEIGHTS).
  카드 전체가 버튼이라 누르면 자세히 카드의 ↗ 와 같은 곳으로 간다. 아이콘 칩은 PanelHeader 와 같은 모양.
-->
<script setup lang="ts">
import type { Component } from 'vue'
import Card from '../ui/Card.vue'
import Badge from '../ui/Badge.vue'

defineProps<{
  icon: Component
  title: string
  /** 아이콘 칩 색(var(--chart-1) 등). 없으면 회색 칩. */
  color?: string | null
  /** 제목에 마우스를 올리면 보이는 설명. */
  hint?: string | null
  /** 누르면 하는 일(자세히 카드의 ↗ 버튼 설명과 같다). */
  actionLabel: string
  /** 큰 값과 그 뒤에 작게 붙는 단위(개·%). */
  value: string
  unit?: string | null
}>()
const emit = defineEmits<{ action: [] }>()
</script>

<template>
  <Card size="sm" class="h-18 gap-0 py-0">
    <button
      type="button"
      data-compact-body
      class="flex h-full w-full min-w-0 flex-col justify-center gap-1.5 px-4 text-left outline-none hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
      :title="actionLabel"
      @click="emit('action')"
    >
      <span class="flex w-full min-w-0 items-center gap-2">
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
        <span
          data-slot="card-title"
          class="min-w-0 truncate text-sm font-medium text-muted-foreground"
          :title="hint ?? undefined"
          >{{ title }}</span
        >
        <slot name="badge" />
        <span
          data-compact-value
          class="ml-auto shrink-0 text-xl leading-6 font-semibold tracking-tight tabular-nums"
          >{{ value
          }}<span v-if="unit" class="ml-0.5 text-sm font-normal text-muted-foreground">{{
            unit
          }}</span></span
        >
      </span>
      <span
        data-compact-sub
        class="flex h-4 w-full min-w-0 items-center justify-between gap-2 text-[11px] leading-4 text-muted-foreground"
      >
        <slot />
      </span>
    </button>
  </Card>
</template>
