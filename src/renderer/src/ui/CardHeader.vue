<!-- NeoHtop (MIT) ui/card/card-header.svelte -->
<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from './cn'

const props = defineProps<{ class?: HTMLAttributes['class'] }>()
</script>

<template>
  <div
    data-slot="card-header"
    :class="
      cn(
        'gap-1 rounded-t-xl px-(--card-spacing) [.border-b]:pb-(--card-spacing) group/card-header grid auto-rows-min items-start',
        props.class
      )
    "
  >
    <slot />
  </div>
</template>
