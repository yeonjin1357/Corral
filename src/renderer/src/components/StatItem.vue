<!-- NeoHtop (MIT) stats/StatItem.svelte -->
<script setup lang="ts">
defineProps<{ label: string; value: string }>()
</script>

<template>
  <div class="flex min-w-0 items-start justify-between gap-2 text-xs">
    <span class="shrink-0 text-muted-foreground">{{ label }}</span
    ><span class="break-words text-right tabular-nums"
      ><slot>{{ value }}</slot></span
    >
  </div>
</template>
