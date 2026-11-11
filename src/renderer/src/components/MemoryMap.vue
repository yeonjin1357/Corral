<!--
  메모리 지도(G6): 사각형 넓이 = 메모리. 1단계 묶음(머리 띠에 이름·크기), 2단계 그 묶음의 줄을 squarify 로 놓는다.
  누를 수 있는 칸(표에 줄이 있는 서버·에이전트·무거운 작업)만 버튼이고, 작은 칸은 글자 없이 풍선말(title)만.
  글자는 바탕색(밝은 테마 흰색, 어두운 테마 짙은 색). 11px 글자가 4.5:1 이상이 되게 밝은 테마는 칸 = 묶음 색 그대로,
  머리 띠 = 검정 쪽으로 22%, 어두운 테마는 칸 = 묶음 색 82%(바탕과 섞음), 머리 띠 = 묶음 색 그대로.
-->
<script setup lang="ts">
import { computed, ref } from 'vue'
import type { DashboardSnapshot, ProcessGroup } from '../../../shared/types'
import { formatBytes } from '../../../shared/format'
import { text } from '../../../shared/text'
import { GROUP_COLOR, tipPercent } from '../memory'
import { memoryMapGroups, type MapTile } from '../memoryMap'
import { squarify, type TreemapRect } from '../treemap'
import { useElementWidth } from '../useElementWidth'

const props = defineProps<{ snapshot: DashboardSnapshot }>()
const emit = defineEmits<{ select: [key: string] }>()

const box = ref<HTMLElement | null>(null)
const width = useElementWidth(box)

const HEIGHT = 240
/** 묶음 머리 띠 높이. */
const HEADER = 18
/** 칸 사이 틈(칸마다 사방으로 절반씩 줄인다). */
const GAP = 2
/** 누를 수 있는 칸의 가장 작은 변(아주 작은 칸도 0 으로 접히지 않고 초점 표시가 보이게). */
const MIN_BUTTON = 2
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
/** 한 변을 min 이상으로 늘린다(가운데를 지키되 0~limit 안에서). */
function grow(start: number, size: number, min: number, limit: number): [number, number] {
  if (size >= min) return [start, size]
  const center = start + size / 2
  return [Math.max(0, Math.min(limit - min, center - min / 2)), min]
}
/** 누를 수 있는 칸: 틈을 뺀 뒤에도 사방 MIN_BUTTON 이상(이웃 칸과 1px 남짓 겹칠 수 있다). */
const atLeast = (r: TreemapRect): TreemapRect => {
  const [x, w] = grow(r.x, r.w, MIN_BUTTON, width.value)
  const [y, h] = grow(r.y, r.h, MIN_BUTTON, HEIGHT)
  return { x, y, w, h }
}
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
      rect: tile.key ? atLeast(inset(r)) : inset(r),
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
        class="absolute flex min-w-0 items-center gap-1 overflow-hidden rounded-t-sm bg-[color-mix(in_srgb,var(--tile)_78%,black)] px-1.5 text-[11px] leading-none font-medium whitespace-nowrap text-background dark:bg-[var(--tile)]"
        :style="{ ...place(g.header), '--tile': g.color }"
        :title="g.tip"
      >
        <span class="min-w-0 truncate">{{ g.label }}</span
        ><span class="shrink-0 font-normal tabular-nums">{{ formatBytes(g.bytes) }}</span>
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
          'absolute flex min-w-0 flex-col items-start overflow-hidden rounded-sm bg-[var(--tile)] px-1.5 py-1 text-left text-background dark:bg-[color-mix(in_srgb,var(--tile)_82%,var(--background))]',
          tile.key &&
            'cursor-pointer outline-none transition-[filter] hover:brightness-90 focus-visible:ring-2 focus-visible:ring-ring dark:hover:brightness-110'
        ]"
        :style="{ ...place(tile.rect), '--tile': tile.color }"
        @click="tile.key && emit('select', tile.key)"
      >
        <template v-if="tile.showLabel">
          <span class="w-full truncate text-[11px] leading-4 font-medium">{{ tile.label }}</span>
          <span v-if="tile.showBytes" class="text-[10px] leading-3 tabular-nums">{{
            formatBytes(tile.bytes)
          }}</span>
        </template>
      </component>
    </template>
  </div>
</template>
