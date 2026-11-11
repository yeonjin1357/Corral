<!--
  묶음별 메모리 추이(G6): 묶음을 GROUP_ORDER 순서로 아래에서 위로 쌓은 면 그래프. 세로축은 전체 RAM.
  모양은 ResourceTrend(여백 2·3·3·2, 높이 112, 아래 한 줄 설명, 마우스를 올리면 그 시각의 값 툴팁)와 같게 맞춘다.
  가로축은 "최근 windowMs" 고정이고, 기록이 gapMs 보다 끊긴 곳(앱이 꺼져 있었음)은 잇지 않는다.
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { GroupPoint, ProcessGroup } from '../../../shared/types'
import { formatBytes } from '../../../shared/format'
import { text } from '../../../shared/text'
import { GROUP_COLOR, GROUP_ORDER } from '../memory'

const props = withDefaults(
  defineProps<{
    points: GroupPoint[]
    /** 가로축 길이(ms). */
    windowMs: number
    /** 세로축 최댓값(전체 RAM). 모르면(0) 기록의 최댓값에 여유를 둔다. */
    totalBytes: number
    /** 이웃한 기록이 이보다 벌어지면(앱이 꺼져 있었음) 그 사이를 잇지 않고 비운다. 없으면 모두 잇는다. */
    gapMs?: number | null
  }>(),
  { gapMs: null }
)

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

const height = 112
const PAD = { left: 2, right: 3, top: 3, bottom: 2 }
const title = text.ui.memorySheet.trendGroupsTitle

const end = computed(() => props.points.at(-1)?.t ?? 0)
const start = computed(() => end.value - props.windowMs)
const visible = computed(() => props.points.filter((p) => p.t >= start.value))
/** 그리는 묶음: 보이는 기록에 0 보다 큰 값이 있는 것만, 쌓는 순서(아래부터)대로. */
const drawn = computed(() => GROUP_ORDER.filter((g) => visible.value.some((p) => p[g] > 0)))
const stackTop = (p: GroupPoint, upTo: number): number =>
  drawn.value.slice(0, upTo + 1).reduce((sum, g) => sum + p[g], 0)
const ceiling = computed(() => {
  if (props.totalBytes > 0) return props.totalBytes
  const top = Math.max(0, ...visible.value.map((p) => stackTop(p, drawn.value.length - 1)))
  return top > 0 ? top * 1.15 : 1
})

const x = (t: number): number =>
  PAD.left + ((t - start.value) / props.windowMs) * Math.max(0, width.value - PAD.left - PAD.right)
const y = (v: number): number =>
  PAD.top + (1 - Math.max(0, Math.min(1, v / ceiling.value))) * (height - PAD.top - PAD.bottom)

/** 끊긴 곳(gapMs 초과)에서 나눈 이어진 구간들(두 점 이상인 것만 면이 된다). */
const segments = computed(() => {
  const out: GroupPoint[][] = []
  for (const p of visible.value) {
    const seg = out[out.length - 1]
    const prev = seg?.[seg.length - 1]
    if (!seg || (props.gapMs != null && prev && p.t - prev.t > props.gapMs)) out.push([p])
    else seg.push(p)
  }
  return out.filter((seg) => seg.length >= 2)
})
const pt = (p: GroupPoint, v: number): string => `${x(p.t).toFixed(1)},${y(v).toFixed(1)}`

/** 묶음마다 면(윗선을 왼쪽→오른쪽, 아랫선(아래 묶음의 윗선)을 오른쪽→왼쪽)과 윗선. */
const layers = computed(() =>
  drawn.value.map((group, i) => {
    const top = (p: GroupPoint): number => stackTop(p, i)
    const bottom = (p: GroupPoint): number => (i === 0 ? 0 : stackTop(p, i - 1))
    const line = segments.value
      .map((seg) => seg.map((p, k) => `${k ? 'L' : 'M'}${pt(p, top(p))}`).join(''))
      .join('')
    const area = segments.value
      .map(
        (seg) =>
          seg.map((p, k) => `${k ? 'L' : 'M'}${pt(p, top(p))}`).join('') +
          [...seg]
            .reverse()
            .map((p) => `L${pt(p, bottom(p))}`)
            .join('') +
          'Z'
      )
      .join('')
    return { group, color: GROUP_COLOR[group], area, line }
  })
)

const label = (g: ProcessGroup): string =>
  g === 'system' ? text.ui.groups.systemShort : text.ui.groups[g]
const legend = computed(() =>
  drawn.value.map((g) => ({ group: g, label: label(g), color: GROUP_COLOR[g] }))
)

const hovered = ref<number | null>(null)
const selected = computed(() =>
  hovered.value == null
    ? visible.value.at(-1)
    : visible.value.reduce<GroupPoint | undefined>(
        (best, p) =>
          !best || Math.abs(p.t - hovered.value!) < Math.abs(best.t - hovered.value!) ? p : best,
        undefined
      )
)
function point(event: PointerEvent): void {
  if (!box.value || !visible.value.length) return
  const rect = box.value.getBoundingClientRect()
  const ratio =
    rect.width > 0 ? Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) : 1
  hovered.value = start.value + ratio * props.windowMs
}

const time = (t: number): string =>
  new Date(t).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit', second: '2-digit' })
/** 툴팁(화면 기준): ResourceTrend 와 같이 body 에 띄우고 창 가장자리에서는 안쪽으로 민다. 위쪽 묶음부터 적는다. */
const TIP_HALF = 80
const tip = computed(() => {
  const p = selected.value
  if (hovered.value == null || !p || !box.value) return null
  const rect = box.value.getBoundingClientRect()
  const px = rect.left + (width.value > 0 ? x(p.t) : rect.width)
  const left = Math.max(TIP_HALF + 8, Math.min(window.innerWidth - TIP_HALF - 8, px))
  const below = rect.top < 140
  return {
    left,
    top: below ? rect.bottom + 8 : rect.top - 8,
    below,
    time: time(p.t),
    rows: [...legend.value].reverse().map((l) => ({ ...l, value: formatBytes(p[l.group]) }))
  }
})

const windowText = computed(() => text.ui.trend.window(props.windowMs))
const caption = computed(() =>
  visible.value.length < 2
    ? text.ui.trend.collecting
    : `${windowText.value} · 0–${formatBytes(ceiling.value)}`
)
const describe = computed(() => {
  const p = selected.value
  if (!p) return `${title}: ${text.ui.trend.collecting}`
  const parts = legend.value.map((l) => `${l.label} ${formatBytes(p[l.group])}`).join(', ')
  return `${title} ${windowText.value}: ${time(p.t)} ${parts}`
})
</script>

<template>
  <div class="min-w-0 space-y-1">
    <div
      ref="box"
      class="w-full rounded-sm"
      :style="{ height: `${height}px` }"
      role="img"
      :aria-label="describe"
      @pointermove="point"
      @pointerleave="hovered = null"
    >
      <svg
        v-if="segments.length && width > 0"
        :width="width"
        :height="height"
        class="block overflow-visible"
      >
        <path
          v-for="l in layers"
          :key="l.group"
          :data-trend-group="l.group"
          :d="l.area"
          :style="{ fill: l.color }"
          fill-opacity="0.45"
        />
        <path
          v-for="l in layers"
          :key="`line-${l.group}`"
          :d="l.line"
          fill="none"
          :style="{ stroke: l.color }"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <line
          v-if="selected && hovered != null"
          :x1="x(selected.t)"
          :x2="x(selected.t)"
          :y1="PAD.top"
          :y2="height - PAD.bottom"
          :style="{ stroke: 'var(--border)' }"
          stroke-width="1"
          stroke-dasharray="3 3"
        />
      </svg>
      <div v-else class="flex h-full w-full items-end">
        <div class="w-full border-b border-border/60"></div>
      </div>
    </div>
    <div class="min-h-3 truncate text-[10px] leading-3 text-muted-foreground tabular-nums">
      {{ caption }}
    </div>
    <ul v-if="legend.length" class="flex flex-wrap gap-x-3 gap-y-1">
      <li
        v-for="item in legend"
        :key="item.group"
        :data-trend-legend="item.group"
        class="flex items-center gap-1.5 text-[11px] leading-3 text-muted-foreground"
      >
        <span
          class="size-1.5 shrink-0 rounded-full"
          :style="{ backgroundColor: item.color }"
          aria-hidden="true"
        ></span
        >{{ item.label }}
      </li>
    </ul>
    <!-- ResourceTrend 와 같은 NeoHtop (MIT) ui/chart/chart-tooltip.svelte 모양(색 점 + 이름 + 값), 묶음마다 한 줄. -->
    <Teleport to="body">
      <div
        v-if="tip"
        data-slot="chart-tooltip"
        role="tooltip"
        class="pointer-events-none fixed z-50 grid min-w-40 items-start gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl"
        :style="{
          left: `${tip.left}px`,
          top: `${tip.top}px`,
          transform: tip.below ? 'translateX(-50%)' : 'translate(-50%, -100%)'
        }"
      >
        <div class="font-medium tabular-nums">{{ tip.time }}</div>
        <div v-for="row in tip.rows" :key="row.group" class="flex w-full items-center gap-2">
          <div class="h-2.5 w-2.5 shrink-0 rounded-[2px]" :style="{ background: row.color }"></div>
          <div class="flex flex-1 shrink-0 items-center justify-between gap-4 leading-none">
            <span class="text-muted-foreground">{{ row.label }}</span>
            <span class="font-mono font-medium text-foreground tabular-nums">{{ row.value }}</span>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
