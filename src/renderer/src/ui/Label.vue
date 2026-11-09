<!-- NeoHtop (MIT) ui/label/label.svelte -->
<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from './cn'
import { LABEL_CLASS } from './variants'

const props = withDefaults(defineProps<{ for?: string; class?: HTMLAttributes['class'] }>(), {
  for: undefined,
  class: undefined
})
</script>

<template>
  <label data-slot="label" :for="props.for" :class="cn(LABEL_CLASS, props.class)"><slot /></label>
</template>
