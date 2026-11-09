<!--
  NeoHtop (MIT) AnalyticsNotice.svelte 의 알림 카드(카드 sm, 제목 + 작은 설명 + 오른쪽 버튼 + 닫기 X).
  pitwall 은 메모리 정리 추천·무거운 작업 겹침 알림에 쓴다.
-->
<script setup lang="ts">
import type { Component } from 'vue'
import { X } from '@lucide/vue'
import { text } from '../../../shared/text'
import Card from '../ui/Card.vue'
import CardContent from '../ui/CardContent.vue'
import Button from '../ui/Button.vue'

defineProps<{
  title: string
  icon?: Component
  /** 제목 앞 아이콘 색(CSS 값). */
  color?: string
  /** 닫기 X 를 둘지. */
  dismissible?: boolean
}>()
const emit = defineEmits<{ dismiss: [] }>()
</script>

<template>
  <Card size="sm" role="status" class="mx-4 mb-4 shrink-0">
    <CardContent class="flex-row items-start gap-3">
      <component :is="icon" v-if="icon" class="mt-0.5 size-4 shrink-0" :style="{ color }" />
      <div class="min-w-0 flex-1">
        <p class="text-sm font-medium">{{ title }}</p>
        <div class="mt-1 text-xs leading-relaxed text-muted-foreground"><slot /></div>
        <slot name="below" />
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <slot name="actions" />
        <Button
          v-if="dismissible"
          variant="ghost"
          size="icon-sm"
          :aria-label="text.ui.bar.dismiss"
          :title="text.ui.bar.dismiss"
          data-action="dismiss"
          @click="emit('dismiss')"
        >
          <X />
        </Button>
      </div>
    </CardContent>
  </Card>
</template>
