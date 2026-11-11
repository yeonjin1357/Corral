<!--
  카드 영역과 표 사이의 손잡이 줄(G2): 왼쪽 단계 버튼(자세히·간단히·접기), 가운데 잡는 표시, 오른쪽 카드 편집.
  버튼이 아닌 줄 전체가 손잡이다. 끄는 동안은 그 높이를 알리고(drag) 놓으면 가장 가까운 단계에 붙는다.
  더블클릭 = 자세히 ↔ 접기, 손잡이에 초점이 있으면 ↑ = 한 단계 작게, ↓ = 한 단계 크게.
  카드 편집 중(G3)에는 단계 버튼 자리에 편집 막대(더할 수 있는 카드 칩·기본값으로)가 오고 카드 편집 버튼은 완료가 된다.
  막대를 카드 줄 아래가 아니라 이 줄에 두어 편집 중에도 카드 영역 높이(TOP_HEIGHTS)가 그대로다.
-->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { Plus } from '@lucide/vue'
import { text } from '../../../shared/text'
import { TOP_MODES, snapTopMode, type CardId, type TopMode } from '../layoutState'

const props = defineProps<{
  /** 단계마다 카드 영역 높이(px). 끄는 높이의 시작점과 붙을 단계를 정한다. */
  heights: Record<TopMode, number>
  /** 카드 편집 중(카드 편집 버튼이 완료로 바뀌고 단계 버튼 자리에 편집 막대). */
  editing?: boolean
  /** 편집 막대의 칩: 카드 줄에 아직 없는 새 카드. */
  addable?: CardId[]
}>()
const mode = defineModel<TopMode>('mode', { required: true })
const emit = defineEmits<{
  /** 카드 편집 시작·끝(완료). */
  edit: []
  /** 새 카드를 카드 줄 끝에 더한다. */
  add: [id: CardId]
  /** 카드 배치를 기본값으로. */
  reset: []
  /** 끄는 동안 카드 영역 높이(px), 놓거나 취소하면 null. */
  drag: [heightPx: number | null]
}>()

function choose(next: TopMode): void {
  if (next !== mode.value) mode.value = next
}

const maxHeight = computed(() => Math.max(...TOP_MODES.map((m) => props.heights[m])))

/** 이만큼은 움직여야 끌기로 본다(누르거나 더블클릭하며 조금 흔들린 것은 끌기가 아니다). */
const DRAG_START_PX = 3
let start: { y: number; height: number } | null = null
/** 끄는 동안의 높이(px). 아직 끌지 않았으면 null. */
const dragHeight = ref<number | null>(null)

function onPointerDown(e: PointerEvent): void {
  // 끄는 중에 다른 포인터(둘째 손가락·펜)가 눌려도 시작점을 바꾸지 않는다.
  if (start || e.button !== 0) return
  start = { y: e.clientY, height: props.heights[mode.value] }
  // 손잡이 밖으로 나가도 놓을 때까지 이 줄이 포인터를 받는다.
  ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
}

function onPointerMove(e: PointerEvent): void {
  if (!start) return
  const dy = e.clientY - start.y
  if (dragHeight.value == null && Math.abs(dy) < DRAG_START_PX) return
  const height = Math.min(maxHeight.value, Math.max(0, start.height + dy))
  if (height === dragHeight.value) return
  dragHeight.value = height
  emit('drag', height)
}

/** 놓으면(snap) 가장 가까운 단계에 붙고, 취소되면 단계는 그대로 둔다. */
function finish(e: PointerEvent, snap: boolean): void {
  if (!start) return
  start = null
  const el = e.currentTarget as HTMLElement
  if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId)
  const height = dragHeight.value
  if (height == null) return
  dragHeight.value = null
  emit('drag', null)
  if (snap) choose(snapTopMode(height, props.heights))
}

function onDoubleClick(): void {
  choose(mode.value === 'collapsed' ? 'full' : 'collapsed')
}

function onKeydown(e: KeyboardEvent): void {
  const i = TOP_MODES.indexOf(mode.value)
  const step = e.key === 'ArrowUp' ? 1 : e.key === 'ArrowDown' ? -1 : 0
  if (!step) return
  e.preventDefault()
  choose(TOP_MODES[Math.min(TOP_MODES.length - 1, Math.max(0, i + step))])
}
</script>

<template>
  <div class="relative flex h-8 shrink-0 items-center justify-between gap-2 px-4">
    <!-- 줄 전체가 손잡이(버튼은 그 위에 놓인다). 잡는 표시는 가운데. -->
    <div
      role="separator"
      aria-orientation="horizontal"
      tabindex="0"
      :aria-label="text.ui.layout.handle"
      :title="text.ui.layout.handle"
      aria-valuemin="0"
      :aria-valuemax="maxHeight"
      :aria-valuenow="Math.round(dragHeight ?? heights[mode])"
      :aria-valuetext="text.ui.layout.modes[mode]"
      class="group absolute inset-0 flex cursor-row-resize touch-none items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="finish($event, true)"
      @pointercancel="finish($event, false)"
      @lostpointercapture="finish($event, true)"
      @dblclick="onDoubleClick"
      @keydown="onKeydown"
    >
      <span
        aria-hidden="true"
        class="h-1 w-10 rounded-full group-hover:bg-muted-foreground group-focus-visible:bg-primary"
        :class="dragHeight != null ? 'bg-primary' : 'bg-border'"
      ></span>
    </div>
    <!-- 편집 막대(G3): 더할 수 있는 카드 칩과 기본값으로. -->
    <div v-if="editing" class="relative flex min-w-0 items-center gap-1">
      <div
        v-if="addable?.length"
        role="group"
        :aria-label="text.ui.cardsEdit.addable"
        class="flex min-w-0 items-center gap-1"
      >
        <span class="mr-0.5 shrink-0 text-[11px] text-muted-foreground">{{
          text.ui.cardsEdit.addable
        }}</span>
        <button
          v-for="id in addable"
          :key="id"
          type="button"
          :data-add-card="id"
          class="flex h-5 shrink-0 items-center gap-0.5 rounded-md border border-dashed border-border px-1.5 text-[11px] text-muted-foreground outline-none hover:border-solid hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
          @click="emit('add', id)"
        >
          <Plus class="size-3" aria-hidden="true" />{{ text.ui.cardsEdit.title[id] }}
        </button>
      </div>
      <button
        type="button"
        data-action="cards-reset"
        class="h-5 shrink-0 rounded-md border border-border px-1.5 text-[11px] text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        @click="emit('reset')"
      >
        {{ text.ui.cardsEdit.reset }}
      </button>
    </div>
    <div v-else class="relative flex items-center gap-0.5">
      <button
        v-for="m in TOP_MODES"
        :key="m"
        type="button"
        :data-mode="m"
        :aria-pressed="mode === m"
        class="h-5 rounded-md px-1.5 text-[11px] text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 aria-pressed:bg-muted aria-pressed:text-foreground aria-pressed:ring-1 aria-pressed:ring-border"
        @click="choose(m)"
      >
        {{ text.ui.layout.modes[m] }}
      </button>
    </div>
    <!--
      편집 중이 아니면 카드 편집, 편집 중에는 완료(눈에 띄는 색). 글자가 바뀌는 두 단추라 켜고 끄는 단추(aria-pressed)가 아니다.
    -->
    <button
      type="button"
      data-action="cards-edit"
      class="relative h-5 shrink-0 rounded-md border px-1.5 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      :class="
        editing
          ? 'border-primary bg-primary font-medium text-primary-foreground hover:bg-primary/80'
          : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
      "
      @click="emit('edit')"
    >
      {{ editing ? text.ui.cardsEdit.done : text.ui.layout.editCards }}
    </button>
  </div>
</template>
