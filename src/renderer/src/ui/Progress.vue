<!-- NeoHtop (MIT) ui/progress/progress.svelte. 색은 style="--primary:var(--chart-3)" 처럼 바꾼다. -->
<script setup lang="ts">
import { computed, type HTMLAttributes } from 'vue'
import { cn } from './cn'

const props = withDefaults(
  defineProps<{ value: number | null; max?: number; class?: HTMLAttributes['class'] }>(),
  { max: 100, class: undefined }
)
const shift = computed(() => {
  const v = props.value == null || !Number.isFinite(props.value) ? 0 : props.value
  const ratio = Math.max(0, Math.min(1, v / props.max))
  return 100 - 100 * ratio
})
</script>

<template>
  <div
    data-slot="progress"
    role="progressbar"
    :aria-valuemin="0"
    :aria-valuemax="max"
    :aria-valuenow="value ?? undefined"
    :class="
      cn(
        'bg-muted h-1.5 rounded-full relative flex w-full items-center overflow-x-hidden',
        props.class
      )
    "
  >
    <div
      data-slot="progress-indicator"
      class="bg-primary size-full flex-1 transition-all"
      :style="{ transform: `translateX(-${shift}%)` }"
    ></div>
  </div>
</template>
