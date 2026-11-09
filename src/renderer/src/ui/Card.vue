<!-- NeoHtop (MIT) ui/card/card.svelte -->
<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from './cn'

const props = withDefaults(
  defineProps<{ size?: 'default' | 'sm'; class?: HTMLAttributes['class'] }>(),
  { size: 'default', class: undefined }
)
</script>

<template>
  <div
    data-slot="card"
    :data-size="size"
    :class="
      cn(
        'ring-border bg-card text-card-foreground gap-(--card-spacing) overflow-hidden rounded-xl py-(--card-spacing) text-sm shadow-xs ring-1 [--card-spacing:--spacing(6)] data-[size=sm]:[--card-spacing:--spacing(4)] group/card flex flex-col',
        props.class
      )
    "
  >
    <slot />
  </div>
</template>
