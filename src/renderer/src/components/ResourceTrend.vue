<!--
  NeoHtop (MIT) stats/ResourceTrend.svelte 의 작은 추이 그래프(면 + 선 + 고른 점 + 아래 한 줄 설명).
  NeoHtop 은 layerchart 로 그리지만 pitwall 은 같은 모양을 SVG 로 직접 그린다(여백 2·3·3·2, 선 1.5, 면 .32→.01).
  가로축은 "최근 windowMs" 고정이라 기록이 쌓일수록 오른쪽부터 채워진다.
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { Point } from '../history'
import { text } from '../../../shared/text'

const props = withDefaults(
  defineProps<{
    points: Point[]
    /** 가로축 길이(ms). */
    windowMs: number
    /** 세로축 최댓값. 없으면 기록의 최댓값에 여유를 둔다. */
    max?: number | null
    /** 선·면 색(CSS 값). */
    color?: string
    expanded?: boolean
    /** 이 값이 무엇인지(설명 줄·읽어 주기용). */
    label: string
    format: (value: number) => string
    /** 세로축 범위 문구(예: 0–100%). 없으면 0–(최댓값). */
    range?: string | null
    /** 이웃한 기록이 이보다 벌어지면(앱이 꺼져 있었음) 그 사이를 잇지 않고 비운다. 없으면 모두 잇는다. */
    gapMs?: number | null
  }>(),
  { max: null, color: 'var(--chart-1)', expanded: false, range: null, gapMs: null }
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

const height = computed(() => (props.expanded ? 112 : 48))
const PAD = { left: 2, right: 3, top: 3, bottom: 2 }
const gradientId = `trend-${Math.random().toString(36).slice(2)}`

const end = computed(() => props.points.at(-1)?.t ?? 0)
const start = computed(() => end.value - props.windowMs)
const visible = computed(() => props.points.filter((p) => p.t >= start.value))
const ceiling = computed(() => {
  if (props.max != null) return props.max
  const top = Math.max(0, ...visible.value.map((p) => p.value))
  return top > 0 ? top * 1.15 : 1
})

const x = (t: number): number =>
  PAD.left + ((t - start.value) / props.windowMs) * Math.max(0, width.value - PAD.left - PAD.right)
const y = (v: number): number =>
  PAD.top +
  (1 - Math.max(0, Math.min(1, v / ceiling.value))) * (height.value - PAD.top - PAD.bottom)

/** 끊긴 곳(gapMs 초과)에서 나눈 이어진 구간들. */
const segments = computed(() => {
  const out: Point[][] = []
  for (const p of visible.value) {
    const seg = out[out.length - 1]
    const prev = seg?.[seg.length - 1]
    if (!seg || (props.gapMs != null && prev && p.t - prev.t > props.gapMs)) out.push([p])
    else seg.push(p)
  }
  return out
})
const pathOf = (seg: Point[]): string =>
  seg.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.value).toFixed(1)}`).join('')
const line = computed(() => segments.value.map(pathOf).join(''))
const area = computed(() => {
  const bottom = height.value - PAD.bottom
  return segments.value
    .filter((seg) => seg.length >= 2)
    .map(
      (seg) =>
        `${pathOf(seg)}L${x(seg[seg.length - 1].t).toFixed(1)},${bottom}L${x(seg[0].t).toFixed(1)},${bottom}Z`
    )
    .join('')
})

const hovered = ref<number | null>(null)
const selected = computed(() =>
  hovered.value == null
    ? visible.value.at(-1)
    : visible.value.reduce<Point | undefined>(
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

/**
 * 툴팁 위치(화면 기준). 카드 밖으로 잘리지 않게 body 에 띄우고, 점 바로 위에 둔다.
 * 창 가장자리에서는 안쪽으로 밀고, 위가 좁으면 점 아래로 내린다.
 */
const TIP_HALF = 80
const tip = computed(() => {
  if (hovered.value == null || !selected.value || !box.value) return null
  const rect = box.value.getBoundingClientRect()
  const px = rect.left + (width.value > 0 ? x(selected.value.t) : rect.width)
  const py = rect.top + (width.value > 0 ? y(selected.value.value) : 0)
  const left = Math.max(TIP_HALF + 8, Math.min(window.innerWidth - TIP_HALF - 8, px))
  const below = py < 72
  return {
    left,
    top: below ? py + 12 : py - 12,
    below,
    time: time(selected.value.t),
    value: props.format(selected.value.value)
  }
})

const time = (t: number): string =>
  new Date(t).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit', second: '2-digit' })
const windowText = computed(() => text.ui.trend.window(props.windowMs))
const caption = computed(() => {
  if (visible.value.length < 2) return text.ui.trend.collecting
  return `${windowText.value} · ${props.range ?? `0–${props.format(ceiling.value)}`}`
})
const describe = computed(() =>
  selected.value
    ? `${props.label} ${windowText.value}: ${time(selected.value.t)} ${props.format(selected.value.value)}`
    : `${props.label}: ${text.ui.trend.collecting}`
)
</script>

<template>
  <div class="mt-auto min-w-0 space-y-1">
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
        v-if="visible.length && width > 0"
        :width="width"
        :height="height"
        class="block overflow-visible"
      >
        <defs>
          <linearGradient :id="gradientId" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" :style="{ stopColor: color, stopOpacity: 0.32 }" />
            <stop offset="100%" :style="{ stopColor: color, stopOpacity: 0.01 }" />
          </linearGradient>
        </defs>
        <path v-if="area" :d="area" :fill="`url(#${gradientId})`" />
        <path
          :d="line"
          fill="none"
          :style="{ stroke: color }"
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
        <circle
          v-if="selected"
          :cx="x(selected.t)"
          :cy="y(selected.value)"
          :r="hovered != null ? 3 : 2"
          :style="{ fill: color, stroke: 'var(--card)' }"
          stroke-width="1.5"
        />
      </svg>
      <div v-else class="flex h-full w-full items-end">
        <div class="w-full border-b border-border/60"></div>
      </div>
    </div>
    <div class="min-h-3 truncate text-[10px] leading-3 text-muted-foreground tabular-nums">
      {{ caption }}
    </div>
    <!-- NeoHtop (MIT) ui/chart/chart-tooltip.svelte 모양(색 점 + 이름 + 값). -->
    <Teleport to="body">
      <div
        v-if="tip"
        data-slot="chart-tooltip"
        role="tooltip"
        class="pointer-events-none fixed z-50 grid min-w-32 items-start gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl"
        :style="{
          left: `${tip.left}px`,
          top: `${tip.top}px`,
          transform: tip.below ? 'translateX(-50%)' : 'translate(-50%, -100%)'
        }"
      >
        <div class="font-medium tabular-nums">{{ tip.time }}</div>
        <div class="flex w-full items-center gap-2">
          <div class="h-2.5 w-2.5 shrink-0 rounded-[2px]" :style="{ background: color }"></div>
          <div class="flex flex-1 shrink-0 items-center justify-between gap-4 leading-none">
            <span class="text-muted-foreground">{{ label }}</span>
            <span class="font-mono font-medium text-foreground tabular-nums">{{ tip.value }}</span>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
