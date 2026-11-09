<!-- NeoHtop (MIT) ui/input/input.svelte -->
<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from './cn'
import { INPUT_CLASS } from './variants'

const props = defineProps<{ class?: HTMLAttributes['class'] }>()
const model = defineModel<string | number>()
</script>

<template>
  <input v-model="model" data-slot="input" :class="cn(INPUT_CLASS, props.class)" />
</template>
