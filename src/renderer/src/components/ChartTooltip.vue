<!--
  추이 그래프(ResourceTrend·PixelTrend)가 함께 쓰는 마우스 풍선말.
  NeoHtop (MIT) ui/chart/chart-tooltip.svelte 모양(색 점 + 이름 + 값). 카드 밖으로 잘리지 않게 body 에 띄운다.
-->
<script setup lang="ts">
defineProps<{
  /** 화면 기준 위치(px). below 면 top 아래로, 아니면 top 위로 띄운다. */
  left: number
  top: number
  below: boolean
  time: string
  label: string
  value: string
  color: string
}>()
</script>

<template>
  <Teleport to="body">
    <div
      data-slot="chart-tooltip"
      role="tooltip"
      class="pointer-events-none fixed z-50 grid min-w-32 items-start gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl"
      :style="{
        left: `${left}px`,
        top: `${top}px`,
        transform: below ? 'translateX(-50%)' : 'translate(-50%, -100%)'
      }"
    >
      <div class="font-medium tabular-nums">{{ time }}</div>
      <div class="flex w-full items-center gap-2">
        <div class="h-2.5 w-2.5 shrink-0 rounded-[2px]" :style="{ background: color }"></div>
        <div class="flex flex-1 shrink-0 items-center justify-between gap-4 leading-none">
          <span class="text-muted-foreground">{{ label }}</span>
          <span class="font-mono font-medium text-foreground tabular-nums">{{ value }}</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>
