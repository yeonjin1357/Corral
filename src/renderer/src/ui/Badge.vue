<!-- NeoHtop (MIT) ui/badge/badge.svelte -->
<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from './cn'
import { badgeClass, type BadgeVariant } from './variants'

const props = withDefaults(
  defineProps<{ variant?: BadgeVariant; class?: HTMLAttributes['class'] }>(),
  { variant: 'default', class: undefined }
)
</script>

<template>
  <span data-slot="badge" :class="cn(badgeClass(variant), props.class)"><slot /></span>
</template>
