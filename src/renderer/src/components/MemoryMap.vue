<!--
  메모리 지도(G6): 사각형 넓이 = 메모리. 1단계 묶음(머리 띠에 이름·크기), 2단계 그 묶음의 줄을 squarify 로 놓는다.
  누를 수 있는 칸(표에 줄이 있는 서버·에이전트·무거운 작업)만 버튼이고, 작은 칸은 글자 없이 풍선말(title)만.
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { DashboardSnapshot, ProcessGroup } from '../../../shared/types'
import { formatBytes } from '../../../shared/format'
import { text } from '../../../shared/text'
import { GROUP_COLOR, tipPercent } from '../memory'
import { memoryMapGroups, type MapTile } from '../memoryMap'
import { squarify, type TreemapRect } from '../treemap'

const props = defineProps<{ snapshot: DashboardSnapshot }>()
const emit = defineEmits<{ select: [key: string] }>()

const box = ref<HTMLElement | null>(null)
const width = ref(0)
let observer: ResizeObserver | null = null
onMounted(() => {
  if (!box.value) return
  width.value = box.value.clientWidth
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(() => (width.value = box.value?.clientWidth ?? 0))
    observer.observe(box.value)
  }
})
onBeforeUnmount(() => observer?.disconnect())

const HEIGHT = 240
/** 묶음 머리 띠 높이. */
const HEADER = 18
/** 칸 사이 틈(칸마다 사방으로 절반씩 줄인다). */
const GAP = 2
/** 이보다 좁거나 낮은 칸은 글자를 숨기고 풍선말로. */
const TEXT_MIN_W = 56
const TEXT_MIN_H = 28
/** 이만큼 높으면 이름 아래에 크기도 적는다. */
const BYTES_MIN_H = 44

const groupLabel = (group: ProcessGroup): string =>
  group === 'system' ? text.ui.groups.systemShort : text.ui.groups[group]
const tip = (label: string, bytes: number): string => {
  const total = props.snapshot.memory.totalBytes
  return text.ui.cards.memoryPart(
    label,
    formatBytes(bytes),
    tipPercent(total > 0 ? bytes / total : 0)
  )
}
/** 틈만큼 줄인 칸(글자를 넣을지는 줄이기 전 크기로 정한다). */
const inset = (r: TreemapRect): TreemapRect => ({
  x: r.x + GAP / 2,
  y: r.y + GAP / 2,
  w: Math.max(0, r.w - GAP),
  h: Math.max(0, r.h - GAP)
})
const place = (r: TreemapRect): Record<string, string> => ({
  left: `${r.x}px`,
  top: `${r.y}px`,
  width: `${r.w}px`,
  height: `${r.h}px`
})

interface PlacedTile extends MapTile {
  rect: TreemapRect
  color: string
  tip: string
  showLabel: boolean
  showBytes: boolean
}
interface PlacedGroup {
  group: ProcessGroup
  label: string
  bytes: number
  color: string
  tip: string
  /** 머리 띠(좁은 묶음은 없음). */
  header: TreemapRect | null
  tiles: PlacedTile[]
}

const groups = computed(() => memoryMapGroups(props.snapshot))
const layout = computed<PlacedGroup[]>(() => {
  if (width.value <= 0) return []
  const area = { x: 0, y: 0, w: width.value, h: HEIGHT }
  return squarify(
    groups.value.map((g) => ({ value: g.bytes, g })),
    area
  ).map(({ item: { g }, ...rect }) => {
    const color = GROUP_COLOR[g.group]
    const label = groupLabel(g.group)
    const hasHeader = rect.w >= TEXT_MIN_W && rect.h >= HEADER + TEXT_MIN_H
    const inner = hasHeader
      ? { x: rect.x, y: rect.y + HEADER, w: rect.w, h: rect.h - HEADER }
      : rect
    const tiles = squarify(
      g.tiles.map((tile) => ({ value: tile.bytes, tile })),
      inner
    ).map(({ item: { tile }, ...r }) => ({
      ...tile,
      rect: inset(r),
      color,
      tip: tip(tile.label, tile.bytes),
      showLabel: r.w >= TEXT_MIN_W && r.h >= TEXT_MIN_H,
      showBytes: r.w >= TEXT_MIN_W && r.h >= BYTES_MIN_H
    }))
    return {
      group: g.group,
      label,
      bytes: g.bytes,
      color,
      tip: tip(label, g.bytes),
      header: hasHeader ? inset({ x: rect.x, y: rect.y, w: rect.w, h: HEADER }) : null,
      tiles
    }
  })
})
</script>

<template>
  <div
    ref="box"
    data-memory-map
    role="group"
    :aria-label="text.ui.memorySheet.mapTitle"
    class="relative w-full overflow-hidden rounded-md bg-muted/40"
    :style="{ height: `${HEIGHT}px` }"
  >
    <template v-for="g in layout" :key="g.group">
      <div
        v-if="g.header"
        :data-map-group="g.group"
        class="absolute flex min-w-0 items-center gap-1 overflow-hidden rounded-t-sm px-1.5 text-[11px] leading-none font-medium whitespace-nowrap text-background"
        :style="{ ...place(g.header), backgroundColor: g.color }"
        :title="g.tip"
      >
        <span class="min-w-0 truncate">{{ g.label }}</span
        ><span class="shrink-0 tabular-nums opacity-80">{{ formatBytes(g.bytes) }}</span>
      </div>
      <component
        :is="tile.key ? 'button' : 'div'"
        v-for="tile in g.tiles"
        :key="tile.id"
        :type="tile.key ? 'button' : undefined"
        :data-map-tile="tile.id"
        :aria-label="tile.key ? tile.tip : undefined"
        :title="tile.tip"
        :class="[
          'map-tile absolute flex min-w-0 flex-col items-start overflow-hidden rounded-sm px-1.5 py-1 text-left text-background',
          tile.key &&
            'cursor-pointer outline-none transition-[filter] hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring'
        ]"
        :style="{ ...place(tile.rect), '--tile': tile.color }"
        @click="tile.key && emit('select', tile.key)"
      >
        <template v-if="tile.showLabel">
          <span class="w-full truncate text-[11px] leading-4 font-medium">{{ tile.label }}</span>
          <span v-if="tile.showBytes" class="text-[10px] leading-3 tabular-nums opacity-80">{{
            formatBytes(tile.bytes)
          }}</span>
        </template>
      </component>
    </template>
  </div>
</template>

<style scoped>
/* 칸은 묶음 색을 바탕과 조금 섞어 머리 띠보다 옅게(칸 사이 틈은 바탕색). */
.map-tile {
  background-color: color-mix(in srgb, var(--tile) 82%, var(--background));
}
</style>
