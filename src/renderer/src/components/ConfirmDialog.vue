<!--
  앱 안 확인 창: 메인이 보낸 확인 요청(끄기·지우기·연동 바꾸기)을 앱의 Card·Button 모양으로 그리고,
  누른 버튼 번호만 돌려준다. 묻고 판단하는 것은 메인이다 — 화면은 그리기만 한다(배경을 눌러도 닫히지 않는다).
  shadcn alert-dialog 처럼: 앱 전체를 어둡게 덮고 가운데 카드, 확인 버튼(첫 버튼)이 오른쪽 끝, 그 왼쪽에 나머지.
-->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, type Component } from 'vue'
import { CircleX, Info, TriangleAlert } from '@lucide/vue'
import type { ConfirmRequest } from '../../../shared/types'
import type { ButtonVariant } from '../ui/variants'
import Card from '../ui/Card.vue'
import Button from '../ui/Button.vue'

const props = defineProps<{ request: ConfirmRequest }>()
const emit = defineEmits<{
  /** 누른 버튼 번호(Esc 는 cancelId). 한 번만. */
  answer: [index: number]
  /** 그렸다(처음 초점까지 둔 뒤). */
  shown: []
}>()

type Look = 'danger' | 'error' | 'normal'
/** 위험 = 주황 경고 삼각형, 오류 = 빨간 원, 보통 = 파란 정보. */
const LOOKS: Record<Look, { icon: Component; color: string }> = {
  danger: { icon: TriangleAlert, color: 'var(--peach)' },
  error: { icon: CircleX, color: 'var(--red)' },
  normal: { icon: Info, color: 'var(--primary)' }
}
const look = computed<Look>(() =>
  props.request.kind === 'error' ? 'error' : props.request.tone === 'danger' ? 'danger' : 'normal'
)

/** 문단 안의 덩어리: 보통 줄들, 또는 `• ` 로 시작하는 줄들(목록). */
type Block = { kind: 'lines'; lines: string[] } | { kind: 'list'; items: string[] }
const BULLET = '• '

/** 본문: 빈 줄로 나뉜 문단, 문단 안에서 `• ` 로 시작하는 줄은 목록으로. */
const paragraphs = computed<Block[][]>(() =>
  props.request.detail
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.split('\n').filter((line) => line.trim() !== ''))
    .filter((lines) => lines.length > 0)
    .map((lines) => {
      const blocks: Block[] = []
      for (const line of lines) {
        const bullet = line.startsWith(BULLET)
        const last = blocks[blocks.length - 1]
        if (bullet && last?.kind === 'list') last.items.push(line.slice(BULLET.length))
        else if (bullet) blocks.push({ kind: 'list', items: [line.slice(BULLET.length)] })
        else if (last?.kind === 'lines') last.lines.push(line)
        else blocks.push({ kind: 'lines', lines: [line] })
      }
      return blocks
    })
)

/** 버튼: 확인(첫 버튼)이 오른쪽 끝이 되게 거꾸로 놓는다(Tab 순서도 왼쪽부터). */
const buttons = computed(() =>
  props.request.buttons
    .map((label, index) => ({
      label,
      index,
      variant: (index > 0
        ? 'outline'
        : props.request.tone === 'danger'
          ? 'destructive'
          : 'default') as ButtonVariant
    }))
    .reverse()
)

const messageId = computed(() => `confirm-${props.request.id}-message`)
const detailId = computed(() => `confirm-${props.request.id}-detail`)

const root = ref<HTMLElement | null>(null)
let answered = false
/** 열기 전 초점(닫히면 돌려준다). */
let before: HTMLElement | null = null

function answer(index: number): void {
  if (answered) return
  answered = true
  emit('answer', index)
}

function buttonElements(): HTMLButtonElement[] {
  return [...(root.value?.querySelectorAll<HTMLButtonElement>('[data-confirm-button]') ?? [])]
}

/** Tab 은 카드 안 버튼 사이에서만 돈다(카드 밖에 있으면 처음·끝 버튼으로). */
function cycle(step: 1 | -1): void {
  const list = buttonElements()
  if (list.length === 0) return
  const at = list.indexOf(document.activeElement as HTMLButtonElement)
  const next = at < 0 ? (step > 0 ? 0 : list.length - 1) : (at + step + list.length) % list.length
  list[next].focus()
}

/**
 * 창 전체의 키를 먼저 받는다(캡처). 확인 창이 떠 있는 동안 아래 화면(상세 패널의 Esc·단축키)에는 키를 넘기지 않는다.
 * Esc = cancelId, Enter = 초점이 있는 버튼, Tab = 카드 안에서 돈다.
 */
function onKey(event: KeyboardEvent): void {
  event.stopPropagation()
  if (event.key === 'Escape') {
    event.preventDefault()
    answer(props.request.cancelId)
  } else if (event.key === 'Tab') {
    event.preventDefault()
    cycle(event.shiftKey ? -1 : 1)
  } else if (event.key === 'Enter') {
    const at = buttonElements().indexOf(document.activeElement as HTMLButtonElement)
    if (at < 0) return
    event.preventDefault()
    answer(Number(buttonElements()[at].dataset.confirmButton))
  }
}

onMounted(() => {
  before = document.activeElement instanceof HTMLElement ? document.activeElement : null
  window.addEventListener('keydown', onKey, true)
  const first = root.value?.querySelector<HTMLElement>(
    `[data-confirm-button="${props.request.defaultId}"]`
  )
  ;(first ?? root.value?.querySelector<HTMLElement>('[role="alertdialog"]'))?.focus()
  emit('shown')
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKey, true)
  if (before?.isConnected) before.focus()
})
</script>

<template>
  <Teleport to="body">
    <!-- 배경: 눌러도 닫히지 않고, 초점도 카드 밖으로 가져가지 않는다. 창 제목줄(끌기 영역) 위에서도 눌리게 no-drag. -->
    <div
      ref="root"
      data-confirm-overlay
      class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 [-webkit-app-region:no-drag] supports-backdrop-filter:backdrop-blur-xs animate-in fade-in-0 duration-100"
      @mousedown.self.prevent
    >
      <Card
        role="alertdialog"
        aria-modal="true"
        :aria-labelledby="messageId"
        :aria-describedby="paragraphs.length ? detailId : undefined"
        tabindex="-1"
        class="max-h-full w-full max-w-[440px] gap-4 shadow-lg outline-none animate-in zoom-in-95 duration-100"
      >
        <div class="flex shrink-0 items-start gap-3 px-(--card-spacing)">
          <span
            class="flex size-9 shrink-0 items-center justify-center rounded-full"
            :style="{
              color: LOOKS[look].color,
              background: `color-mix(in srgb, ${LOOKS[look].color} 14%, transparent)`
            }"
            :data-confirm-icon="look"
            aria-hidden="true"
          >
            <component :is="LOOKS[look].icon" class="size-5" />
          </span>
          <div class="min-w-0 flex-1 pt-0.5">
            <p data-confirm-title class="text-xs text-muted-foreground">{{ request.title }}</p>
            <h2 :id="messageId" class="mt-0.5 text-base leading-snug font-semibold">
              {{ request.message }}
            </h2>
          </div>
        </div>

        <div
          v-if="paragraphs.length"
          :id="detailId"
          class="min-h-0 space-y-3 overflow-y-auto px-(--card-spacing) text-sm leading-relaxed text-muted-foreground [overflow-wrap:anywhere]"
          data-selectable
        >
          <div v-for="(blocks, p) in paragraphs" :key="p" data-confirm-paragraph class="space-y-1">
            <template v-for="(block, b) in blocks" :key="b">
              <ul v-if="block.kind === 'list'" class="space-y-1">
                <li v-for="(item, i) in block.items" :key="i" class="flex gap-2">
                  <span
                    class="mt-[0.6em] size-1 shrink-0 rounded-full bg-current opacity-70"
                    aria-hidden="true"
                  ></span>
                  <span class="min-w-0">{{ item }}</span>
                </li>
              </ul>
              <template v-else>
                <p v-for="(line, l) in block.lines" :key="l">{{ line }}</p>
              </template>
            </template>
          </div>
        </div>

        <div class="flex shrink-0 flex-wrap justify-end gap-2 px-(--card-spacing)">
          <Button
            v-for="b in buttons"
            :key="b.index"
            :variant="b.variant"
            :data-variant="b.variant"
            :data-confirm-button="b.index"
            @click="answer(b.index)"
          >
            {{ b.label }}
          </Button>
        </div>
      </Card>
    </div>
  </Teleport>
</template>
