<!--
  조용한 카드(G2): 값이 0 이라 할 일이 없는 카드는 좁은 칸(104px)에 아이콘 칩(회색) + 제목 + "없음"만 흐리게 둔다.
  간단히 단계는 안쪽 너비가 72px(104 − 16×2)뿐이라 칩을 빼고 제목(11px) 한 줄 + 없음 한 줄(16px×2 = 32px, 높이 72px 안)로 둔다.
  높이는 원래 카드 그대로(자세히 h-60, 간단히 h-18 — layoutState 의 TOP_HEIGHTS). 누르면 그 탭으로(없으면 누를 수 없다).
-->
<script setup lang="ts">
import type { Component } from 'vue'
import { text } from '../../../shared/text'
import Card from '../ui/Card.vue'
import IconChip from './IconChip.vue'

defineProps<{
  icon: Component
  title: string
  /** 간단히 단계(h-18). */
  compact?: boolean
  /** 누르면 하는 일. 없으면 누를 수 없다. */
  actionLabel?: string | null
}>()
const emit = defineEmits<{ action: [] }>()
</script>

<template>
  <Card size="sm" class="gap-0 py-0" :class="compact ? 'h-18' : 'h-60'">
    <button
      type="button"
      data-compact-body
      class="flex h-full w-full min-w-0 justify-center px-4 text-left outline-none enabled:hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
      :class="compact ? 'flex-col items-start gap-0' : 'flex-col gap-2'"
      :title="actionLabel ?? undefined"
      :disabled="!actionLabel"
      @click="emit('action')"
    >
      <IconChip v-if="!compact" :icon="icon" />
      <span
        data-slot="card-title"
        class="w-full min-w-0 truncate font-medium text-muted-foreground"
        :class="compact ? 'text-[11px] leading-4' : 'text-sm'"
        >{{ title }}</span
      >
      <span
        data-quiet-none
        :data-compact-value="compact || undefined"
        class="shrink-0 text-muted-foreground/60"
        :class="compact ? 'text-[11px] leading-4' : 'text-sm'"
        >{{ text.ui.cards.none }}</span
      >
    </button>
  </Card>
</template>
