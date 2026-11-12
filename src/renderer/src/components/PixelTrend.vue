<!--
  픽셀 추이(G6): 메모리 카드의 작은 RAM 추이를 앱 아이콘의 픽셀 그래프처럼 계단식 막대 24 칸으로 그린다.
  칸마다 그 시간대의 최댓값, 점이 없는 칸은 비운다. 칸 색은 경고·위험 기준을 따른다(민트 → 노랑 → 빨강).
  설명 줄·읽어 주기·마우스 풍선말은 ResourceTrend 와 같은 문구다. 값은 0–100(%)이라고 본다.
-->
<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Point } from '../history'
import { pixelBuckets } from '../pixelTrend'
import { formatTimeOfDay } from '../../../shared/format'
import { text } from '../../../shared/text'
import ChartTooltip from './ChartTooltip.vue'

const props = defineProps<{
  points: Point[]
  /** 가로축 길이(ms). */
  windowMs: number
  /** 이 값이 무엇인지(설명 줄·읽어 주기용). */
  label: string
  format: (value: number) => string
  /** 세로축 범위 문구(예: 0–100%). */
  range: string
  /** 이 값 이상이면 노랑. */
  warn: number
  /** 이 값 이상이면 빨강. */
  danger: number
}>()

const BAR_COUNT = 24
const HEIGHT = 48
/** 막대 높이는 2px 단위로 끊어 계단처럼 보이게 한다. */
const STEP = 2

type Level = 'ok' | 'warn' | 'danger'
const COLOR: Record<Level, string> = {
  ok: 'var(--status-running)',
  warn: 'var(--status-waiting)',
  danger: 'var(--status-stopped)'
}
const levelOf = (v: number): Level =>
  v >= props.danger ? 'danger' : v >= props.warn ? 'warn' : 'ok'

const box = ref<HTMLElement | null>(null)
const end = computed(() => props.points.at(-1)?.t ?? 0)
const start = computed(() => end.value - props.windowMs)
const visible = computed(() => props.points.filter((p) => p.t >= start.value))
const buckets = computed(() => pixelBuckets(props.points, end.value, props.windowMs, BAR_COUNT))
const barHeight = (v: number): number =>
  Math.max(STEP, Math.round((Math.max(0, Math.min(100, v)) / 100) * (HEIGHT / STEP)) * STEP)
/** 칸의 시작 시각(풍선말에 보이는 시각). */
const bucketTime = (i: number): number => start.value + (i / BAR_COUNT) * props.windowMs

const hovered = ref<number | null>(null)
/** 마우스가 올라간 칸(값이 있을 때), 없으면 가장 새 값이 든 칸. */
const selected = computed<number | null>(() => {
  if (hovered.value != null) return buckets.value[hovered.value] != null ? hovered.value : null
  for (let i = BAR_COUNT - 1; i >= 0; i--) if (buckets.value[i] != null) return i
  return null
})

const TIP_HALF = 80
const tip = computed(() => {
  const i = hovered.value
  if (i == null || selected.value == null || !box.value) return null
  const v = buckets.value[i]!
  const rect = box.value.getBoundingClientRect()
  const px = rect.left + ((i + 0.5) / BAR_COUNT) * rect.width
  const py = rect.top + HEIGHT - barHeight(v)
  const left = Math.max(TIP_HALF + 8, Math.min(window.innerWidth - TIP_HALF - 8, px))
  const below = py < 72
  return {
    left,
    top: below ? py + 12 : py - 12,
    below,
    time: formatTimeOfDay(bucketTime(i)),
    value: props.format(v),
    color: COLOR[levelOf(v)]
  }
})

const windowText = computed(() => text.ui.trend.window(props.windowMs))
const caption = computed(() =>
  visible.value.length < 2 ? text.ui.trend.collecting : `${windowText.value} · ${props.range}`
)
const describe = computed(() => {
  const i = selected.value
  return i == null
    ? `${props.label}: ${text.ui.trend.collecting}`
    : `${props.label} ${windowText.value}: ${formatTimeOfDay(bucketTime(i))} ${props.format(buckets.value[i]!)}`
})
</script>

<template>
  <div data-pixel-trend class="mt-auto min-w-0 space-y-1">
    <div
      ref="box"
      class="grid w-full"
      :style="{
        height: `${HEIGHT}px`,
        gridTemplateColumns: `repeat(${BAR_COUNT}, minmax(0, 1fr))`,
        columnGap: '1px'
      }"
      role="img"
      :aria-label="describe"
      @pointerleave="hovered = null"
    >
      <div
        v-for="(v, i) in buckets"
        :key="i"
        data-bar
        :data-level="v == null ? undefined : levelOf(v)"
        class="flex h-full items-end"
        @pointerenter="hovered = i"
      >
        <div
          v-if="v != null"
          class="w-full"
          :style="{ height: `${barHeight(v)}px`, background: COLOR[levelOf(v)] }"
        ></div>
      </div>
    </div>
    <div class="min-h-3 truncate text-[10px] leading-3 text-muted-foreground tabular-nums">
      {{ caption }}
    </div>
    <ChartTooltip
      v-if="tip"
      :left="tip.left"
      :top="tip.top"
      :below="tip.below"
      :time="tip.time"
      :label="label"
      :value="tip.value"
      :color="tip.color"
    />
  </div>
</template>
