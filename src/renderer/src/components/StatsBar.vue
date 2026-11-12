<!--
  NeoHtop (MIT) stats/StatsBar.svelte 와 CpuPanel·MemoryPanel·StoragePanel·SystemPanel 의 카드 모양을 가져옴.
  바꾼 점: CPU·GPU·저장소·시스템·네트워크 대신 pitwall 의 메모리·개발 서버·에이전트·무거운 작업·남은 프로세스·디스크 정리.
  넓은 첫 칸(NeoHtop CPU 칸 자리)은 메모리로, 코어별 막대 대신 전체 RAM 을 묶음별(개발 서버·에이전트·…)로 쌓은 막대와 범례를 둔다.
  아래 칸 구분선 + 세 숫자(NeoHtop System 카드의 Load average)는 개발 서버 판단·에이전트 상태 개수에 쓴다.
  간단히 단계(compact, G2)에서는 카드마다 CompactCard 한 장(제목·큰 값·설명 한 줄)으로 그린다.
  카드 줄은 배치(layout, G3)의 순서대로 그린다. 새 카드(응답 대기·토큰·한도·최근 기록)는 cards/ 의 작은 컴포넌트다.
  편집 모드(editing)에서는 숨긴 카드도 흐리게 보이고, 카드마다 아래 가장자리 가운데에 앞으로·뒤로·숨기기/보이기·빼기
  막대(제목·큰 값을 가리지 않게, 간단히 카드에서는 설명 줄 자리), 끌어서 놓으면 놓은 카드 자리로 옮긴다.
  편집 중에는 카드 안을 누를 수 없다(inert).
  카드 줄의 가로 스크롤바 높이를 재어 알린다(scrollbar) — 손잡이의 끄는·붙는 높이에 더한다.
-->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, type Component } from 'vue'
import {
  ChevronLeft,
  ChevronRight,
  Globe,
  Hammer,
  HardDrive,
  Hourglass,
  MemoryStick,
  RefreshCw,
  SquareTerminal,
  Unplug
} from '@lucide/vue'
import type { DashboardSnapshot, ProcessGroup } from '../../../shared/types'
import type { PitEvent } from '../../../shared/events'
import { formatBytes, formatDuration, codexLimitView, pressureText } from '../../../shared/format'
import { text } from '../../../shared/text'
import { DEFAULT_THRESHOLDS } from '../../../shared/defaults'
import type { Point } from '../history'
import {
  DEFAULT_CARDS,
  EXTRA_CARDS,
  cardColumns,
  moveCard,
  removeCard,
  setCardHidden,
  visibleCards,
  type CardId,
  type CardLayout
} from '../layoutState'
import { GROUP_COLOR, memoryComposition, tipPercent, type CompositionPart } from '../memory'
import Card from '../ui/Card.vue'
import CardContent from '../ui/CardContent.vue'
import Badge from '../ui/Badge.vue'
import Button from '../ui/Button.vue'
import type { BadgeVariant } from '../ui/variants'
import PanelHeader from './PanelHeader.vue'
import StatItem from './StatItem.vue'
import PixelTrend from './PixelTrend.vue'
import ItemIcon from './ItemIcon.vue'
import CompactCard from './CompactCard.vue'
import QuietCard from './QuietCard.vue'
import WaitingCard from './cards/WaitingCard.vue'
import TokensCard from './cards/TokensCard.vue'
import EventsCard from './cards/EventsCard.vue'
import { agentIcon, heavyIcon, leftoverIcon, serverIcon, type RowIcon } from '../rows'
import { selectionKey } from '../../../shared/keys'

export type TabKey = 'ports' | 'agents' | 'leftovers' | 'heavy' | 'disk' | 'apps' | 'events'

const props = defineProps<{
  snapshot: DashboardSnapshot
  ramHistory: Point[]
  /** 추이 그래프 가로축(ms). */
  windowMs: number
  /** 메모리 추이 막대 색 기준(RAM %): 이상이면 노랑·빨강. 없으면 기본 기준. */
  warnPercent?: number
  dangerPercent?: number
  /** 기록이 이보다 끊기면 그래프를 잇지 않는다(앱이 꺼져 있었음). */
  gapMs?: number | null
  /** 간단히 단계: 카드마다 제목·큰 값·설명 한 줄(추이 그래프·아래 칸 없음). */
  compact?: boolean
  /** 카드 편집 중(G3): 숨긴 카드도 흐리게 보이고 카드마다 편집 단추. */
  editing?: boolean
  /** 최근 기록 카드의 기록(오래된 것부터). */
  events?: PitEvent[]
}>()
/** 카드 배치(G3). 주지 않으면 기본 여섯 장. */
const layout = defineModel<CardLayout>('layout', {
  default: () => ({ order: [...DEFAULT_CARDS], hidden: [] })
})
const emit = defineEmits<{
  memory: []
  tab: [key: TabKey]
  diskScan: []
  select: [key: string]
  /** 카드 줄의 가로 스크롤바 높이(px, 없으면 0). 바뀔 때만(처음 한 번은 늘). */
  scrollbar: [heightPx: number]
}>()

// ── 카드 배치(G3) ──
const T = text.ui.cardsEdit
/** 카드 줄에 그리는 카드: 편집 중이면 order 전체(숨긴 것은 흐리게), 아니면 보이는 것만. */
const shownCards = computed(() => (props.editing ? layout.value.order : visibleCards(layout.value)))
const isHidden = (id: CardId): boolean => layout.value.hidden.includes(id)
/** 하나 남은 보이는 카드는 숨기거나 뺄 수 없다(조작 함수도 그대로 돌려준다 — 단추도 막아 둔다). */
const lastVisible = computed(() => visibleCards(layout.value).length <= 1)
/** 열 너비: 카드마다 비중과 최소 너비(cardColumns), 조용한 카드는 104px. 다 들어가지 않으면 카드 줄만 가로로 스크롤한다. */
const columns = computed(() => cardColumns(shownCards.value, quiet.value))

const grid = ref<HTMLElement | null>(null)

/**
 * 카드 줄의 가로 스크롤바 높이 = 바깥 높이 − 안쪽 높이(카드 줄에는 테두리가 없다). 카드가 넘치거나 창 너비가 바뀌어
 * 스크롤바가 생기고 없어지면 바깥 높이만 바뀌므로 테두리 상자를 지켜본다.
 */
let observer: ResizeObserver | null = null
let lastScrollbar: number | null = null
function measureScrollbar(): void {
  const el = grid.value
  if (!el) return
  const px = Math.max(0, el.offsetHeight - el.clientHeight)
  if (px === lastScrollbar) return
  lastScrollbar = px
  emit('scrollbar', px)
}
onMounted(() => {
  measureScrollbar()
  if (typeof ResizeObserver !== 'undefined' && grid.value) {
    observer = new ResizeObserver(measureScrollbar)
    observer.observe(grid.value, { box: 'border-box' })
  }
})
onBeforeUnmount(() => observer?.disconnect())
/**
 * 앞으로·뒤로. 칸이 자리를 옮기며 누른 단추가 초점을 잃을 수 있어, 다시 그린 뒤 같은 단추(끝에 닿아 막혔으면
 * 반대쪽 단추)로 초점을 돌려준다 — 키보드로 이어서 옮길 수 있게.
 */
async function moveBy(id: CardId, step: -1 | 1): Promise<void> {
  layout.value = moveCard(layout.value, id, layout.value.order.indexOf(id) + step)
  await nextTick()
  const button = (action: string): HTMLButtonElement | null | undefined =>
    grid.value?.querySelector<HTMLButtonElement>(
      `[data-card="${id}"] [data-card-action="${action}"]`
    )
  const same = button(step < 0 ? 'left' : 'right')
  ;(same && !same.disabled ? same : button(step < 0 ? 'right' : 'left'))?.focus()
}
function toggleHidden(id: CardId): void {
  layout.value = setCardHidden(layout.value, id, !isHidden(id))
}
function remove(id: CardId): void {
  layout.value = removeCard(layout.value, id)
}

/** 끄는 카드와 지금 그 위에 있는 카드(놓을 자리 표시). */
const dragging = ref<CardId | null>(null)
const dropTarget = ref<CardId | null>(null)
function onDragStart(e: DragEvent, id: CardId): void {
  if (!props.editing) return
  dragging.value = id
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
  }
}
function onDragOver(e: DragEvent, id: CardId): void {
  if (!dragging.value) return
  // 기본 동작을 막아야 이 카드에 놓을 수 있다.
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  dropTarget.value = id
}
function onDragLeave(e: DragEvent, id: CardId): void {
  // 카드 안의 편집 단추로 옮겨 갈 때는 그대로 둔다.
  const inside = (e.currentTarget as Node).contains(e.relatedTarget as Node | null)
  if (dropTarget.value === id && !inside) dropTarget.value = null
}
/** 놓은 카드의 자리(order 의 위치)로 옮긴다. */
function onDrop(e: DragEvent, id: CardId): void {
  const from = dragging.value
  if (!from) return
  e.preventDefault()
  onDragEnd()
  if (from !== id) layout.value = moveCard(layout.value, from, layout.value.order.indexOf(id))
}
function onDragEnd(): void {
  dragging.value = null
  dropTarget.value = null
}
/** 카드 아래 편집 막대의 단추(작게, 아이콘 단추는 정사각형). */
const CONTROL =
  'flex h-5 shrink-0 items-center justify-center rounded-full text-[10px] leading-none text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40'

const s = computed(() => props.snapshot)
const hasMemory = computed(() => s.value.memory.totalBytes > 0)
// 화면·트레이 공통 규칙: 내림해야 경고 기준과 표시가 어긋나지 않는다.
const ramPercent = computed(() => Math.floor(s.value.memory.usedPercent))
const level = computed(() => s.value.memory.level)
/** 경고·위험의 이유로 말할 사용률("RAM 85%" 또는 "커밋 86%"). */
const pressure = computed(() => pressureText(s.value.memory))
/** level 은 RAM·커밋 중 높은 쪽이라, ramLevel 과 다르면 원인은 커밋이다. */
const commitCaused = computed(() => level.value !== s.value.memory.ramLevel)
/** 메모리 카드 머리의 배지: 경고·위험, 원인이 커밋이면 그 옆에 "커밋"(자세히·간단히 같음). */
const memoryBadges = computed(() => {
  const l = level.value
  if (!hasMemory.value || l === 'normal') return []
  const badges: { key: string; label: string; variant: BadgeVariant }[] = [
    {
      key: 'level',
      label: text.ui.cards.levels[l],
      variant: l === 'danger' ? 'destructive' : 'secondary'
    }
  ]
  if (commitCaused.value)
    badges.push({ key: 'commit', label: text.ui.cards.commitCause, variant: 'outline' })
  return badges
})
const commit = computed(() => s.value.memory.commit)
const COMMIT_COLOR = { warn: 'var(--status-waiting)', danger: 'var(--destructive)' } as const
/** "104.8 / 127.7 GB (82%)": 두 값의 단위가 같으면 앞 값의 단위는 뺀다. */
const commitLine = computed(() => {
  const c = commit.value
  if (!c) return null
  const used = formatBytes(c.usedBytes)
  const limit = formatBytes(c.limitBytes)
  const unit = limit.slice(limit.lastIndexOf(' '))
  return text.ui.cards.commitLine(
    used.endsWith(unit) ? used.slice(0, -unit.length) : used,
    limit,
    Math.floor(c.percent)
  )
})

/** 전체 RAM 을 묶음별로 나눈 쌓은 막대(G4). 전체를 모르면 null(막대를 그리지 않는다). */
const composition = computed(() => memoryComposition(s.value.memory, s.value.groups))
/** 범례의 %: 반올림, 0 보다 크고 1 보다 작으면 "<1%". */
const legendPercent = (share: number): string =>
  share > 0 && share < 0.01 ? '<1%' : `${Math.round(share * 100)}%`
const partTip = (part: CompositionPart): string =>
  text.ui.cards.memoryPart(
    text.ui.groups[part.group],
    formatBytes(part.bytes),
    tipPercent(part.share)
  )
/** 막대 조각: 묶음 순서대로, 0 인 묶음은 조각이 없다. 남은 메모리는 막대 바탕 그대로. */
const memoryParts = computed(() =>
  (composition.value?.parts ?? [])
    .filter((p) => p.bytes > 0)
    .map((p) => ({ ...p, color: GROUP_COLOR[p.group], tip: partTip(p) }))
)
const freeTip = computed(() => {
  const c = composition.value
  return c
    ? text.ui.cards.memoryPart(
        text.ui.cards.memoryFree,
        formatBytes(c.freeBytes),
        tipPercent(c.freeShare)
      )
    : undefined
})
/** 범례: 네 묶음 2×2 자리는 늘 그대로, 무거운 작업은 0 보다 클 때만 다섯째로. */
const memoryLegend = computed(() => {
  const parts = composition.value?.parts ?? []
  return [
    ...parts.filter((p) => p.group !== 'heavy'),
    ...parts.filter((p) => p.group === 'heavy' && p.bytes > 0)
  ].map((p) => ({
    ...p,
    label: p.group === 'system' ? text.ui.groups.systemShort : text.ui.groups[p.group],
    color: GROUP_COLOR[p.group],
    percent: legendPercent(p.share),
    tip: partTip(p)
  }))
})
/**
 * 범례가 세 줄(무거운 작업 포함)이면 카드 높이(h-60)를 넘지 않게 막대·범례 사이와 범례 줄 사이를 좁힌다.
 * 두 줄: 막대 10 + 6 + 범례 12·4·12 = 44px, 세 줄: 막대 10 + 2 + 범례 12×3 = 48px(남는 높이가 48px).
 */
const legendDense = computed(() => memoryLegend.value.length > 4)

const portCounts = computed(() => ({
  candidate: s.value.servers.filter((p) => p.judgement === 'candidate').length,
  check: s.value.servers.filter((p) => p.judgement === 'check').length,
  // "확인해볼 것"(탭만 연결)도 연결이 있지만 거기서 셌으므로 겹치지 않게 뺀다.
  inUse: s.value.servers.filter((p) => p.clientCount > 0 && p.judgement !== 'check').length
}))
const portCount = computed(() => s.value.servers.reduce((n, r) => n + r.ports.length, 0))
/** 서버가 있는 작업 공간 수(같은 작업 공간은 한 번). */
const workspaceCount = computed(
  () =>
    new Set(s.value.servers.flatMap((r) => (r.workspace ? [r.workspace.root.toLowerCase()] : [])))
      .size
)
/** 로고 줄: 같은 종류(로고 제목)끼리 세어 많은 순 3개(좁은 카드에서도 한 줄). */
interface LogoGroup {
  key: string
  icon: RowIcon
  count: number
}
function groupLogos(icons: RowIcon[]): LogoGroup[] {
  const groups = new Map<string, LogoGroup>()
  for (const icon of icons) {
    const key = icon.title ?? icon.fallback
    const group = groups.get(key)
    if (group) group.count++
    else groups.set(key, { key, icon, count: 1 })
  }
  return [...groups.values()].sort((a, b) => b.count - a.count).slice(0, 3)
}
const portLogos = computed(() =>
  groupLogos(s.value.servers.map((p) => serverIcon(p, s.value.platform)))
)
const agentLogos = computed(() => groupLogos(s.value.agents.map(agentIcon)))

/**
 * 카드의 메모리는 메모리 카드 묶음과 같은 값을 쓴다. 표의 행을 더하면 한 프로세스가 포트를 둘 열 때 두 번 세고,
 * 에이전트 행에는 그 아래에서 도는 무거운 작업이 들어 있어 묶음 값과 어긋난다.
 */
const groupBytes = (group: ProcessGroup): number =>
  s.value.groups.find((g) => g.group === group)?.memoryBytes ?? 0
const portMemory = computed(() => groupBytes('devServer'))

// 세 칸 합이 전체와 같도록 셋째 칸은 나머지 전부. 모두 쉬는 중일 때만 "쉬는 중", 확인 중·오류가 섞이면 "그 외".
const agentCounts = computed(() => {
  const working = s.value.agents.filter((a) => a.state === 'working').length
  const waiting = s.value.agents.filter((a) => a.state === 'waiting').length
  const rest = s.value.agents.filter((a) => a.state !== 'working' && a.state !== 'waiting')
  return {
    working,
    waiting,
    rest: rest.length,
    restLabel: rest.every((a) => a.state === 'idle')
      ? text.ui.agent.states.idle
      : text.ui.cards.agentOthers,
    // 오래 쉬는 세션(G2)은 작업 중·응답 대기가 아니므로 모두 셋째 칸에 든다.
    parked: rest.filter((a) => a.parked).length
  }
})
/** Codex 한도(G6): 카드 설명 줄과 풍선말. 지금은 스냅샷 시각(수집 때마다 새로 오므로 따로 시계를 두지 않는다). */
const codexLimit = computed(() => codexLimitView(s.value.codexLimits, s.value.takenAt))
const agentMemory = computed(() => groupBytes('agent'))
const hookOn = computed(() => s.value.hook?.state === 'on')
/** "상태 · …" 줄의 출처: 훅이 켜져 있으면 훅, 아니고 세션 파일로 아는 에이전트가 있으면 세션 파일, 아니면 CPU 추정. */
const stateSourceLabel = computed(() =>
  hookOn.value
    ? text.ui.cards.sourceHook
    : s.value.agents.some((a) => a.stateSource === 'file')
      ? text.ui.cards.sourceFile
      : text.ui.cards.sourceCpu
)

const heavyMemory = computed(() => groupBytes('heavy'))

// ── 카드 강조·조용한 카드(G2) ──
/** 할 일이 있는 카드: 응답 대기가 있으면 에이전트·응답 대기 카드는 warn(노랑), 정리 후보가 있으면 개발 서버는 stopped(빨강). */
const attention = computed<Partial<Record<CardId, 'warn' | 'stopped'>>>(() => {
  const result: Partial<Record<CardId, 'warn' | 'stopped'>> = {}
  if (agentCounts.value.waiting > 0) {
    result.agents = 'warn'
    result.waiting = 'warn'
  }
  if (portCounts.value.candidate > 0) result.servers = 'stopped'
  return result
})
/** 값이 0 인 카드는 좁고 조용하게. 편집 중에는 모든 카드를 그대로 보여 준다. */
const quiet = computed<CardId[]>(() => {
  if (props.editing) return []
  const zero: Partial<Record<CardId, boolean>> = {
    heavy: s.value.heavyJobs.length === 0,
    leftovers: s.value.leftovers.length === 0,
    servers: s.value.servers.length === 0,
    agents: s.value.agents.length === 0,
    waiting: agentCounts.value.waiting === 0
  }
  return shownCards.value.filter((id) => zero[id])
})
/** 조용한 카드의 아이콘·제목과 누르면 가는 탭(응답 대기 카드는 갈 탭이 없다). */
const QUIET_CARD: Partial<
  Record<CardId, { icon: Component; title: string; tab: TabKey | null; label: string | null }>
> = {
  servers: { icon: Globe, title: text.ui.cards.ports, tab: 'ports', label: text.ui.cards.showList },
  agents: {
    icon: SquareTerminal,
    title: text.ui.cards.agents,
    tab: 'agents',
    label: text.ui.cards.showList
  },
  heavy: { icon: Hammer, title: text.ui.cards.heavy, tab: 'heavy', label: text.ui.cards.showList },
  leftovers: {
    icon: Unplug,
    title: text.ui.cards.leftovers,
    tab: 'leftovers',
    label: text.ui.cards.showList
  },
  waiting: { icon: Hourglass, title: T.title.waiting, tab: null, label: null }
}
/** 간단히 에이전트 카드의 "응답 대기 n · 도구 경과": 가장 오래 기다린 에이전트(시작 시각을 모르면 뒤로, 모두 모르면 첫 에이전트·경과 없음). */
const waitingLine = computed(() => {
  const waiting = s.value.agents.filter((a) => a.state === 'waiting')
  if (!waiting.length) return null
  const oldest = waiting.reduce((best, a) =>
    (a.stateSince ?? Infinity) < (best.stateSince ?? Infinity) ? a : best
  )
  return text.ui.cards.waitingLine(
    waiting.length,
    text.ui.agent.toolNames[oldest.tool],
    oldest.stateSince != null
      ? formatDuration(Math.max(0, s.value.takenAt - oldest.stateSince))
      : null
  )
})

// 에이전트가 있는 워크트리의 남은 프로세스는 그 에이전트가 쓰고 있을 수 있어 개수에서 뺀다.
const freeLeftovers = computed(() => s.value.leftovers.filter((l) => !l.agentInWorktree))
const agentLeftovers = computed(() => s.value.leftovers.length - freeLeftovers.value.length)
const leftoverMemory = computed(() =>
  freeLeftovers.value.reduce((sum, l) => sum + l.memoryBytes, 0)
)

/** 카드 아래 목록(NeoHtop 카드처럼 설명 대신 실제 항목을 보인다). 메모리 큰 순 3개. */
interface MiniItem {
  key: string
  label: string
  title: string
  bytes: number
  icon: RowIcon
}
const MINI = 3
const heavyItems = computed<MiniItem[]>(() =>
  [...s.value.heavyJobs]
    .sort((a, b) => b.memoryBytes - a.memoryBytes)
    .slice(0, MINI)
    .map((j) => ({
      key: selectionKey.heavy(j),
      label: j.label,
      title: j.commandLine,
      bytes: j.memoryBytes,
      icon: heavyIcon(j, s.value.platform)
    }))
)
const leftoverItems = computed<MiniItem[]>(() =>
  [...freeLeftovers.value]
    .sort((a, b) => b.memoryBytes - a.memoryBytes)
    .slice(0, MINI)
    .map((l) => ({
      key: selectionKey.leftover(l),
      label: l.label,
      title: l.commandLine,
      bytes: l.memoryBytes,
      icon: leftoverIcon(l, s.value.platform)
    }))
)

const disk = computed(() => s.value.disk)
const diskReady = computed(() => !!disk.value && disk.value.scannedAt != null)
const diskFree = computed(() => (disk.value?.rows ?? []).filter((r) => !r.inUse))
const diskBytes = computed(() => diskFree.value.reduce((sum, r) => sum + (r.totalBytes ?? 0), 0))
const diskInUse = computed(() => (disk.value?.rows.length ?? 0) - diskFree.value.length)
const scannedTime = computed(() =>
  disk.value?.scannedAt
    ? new Date(disk.value.scannedAt).toLocaleTimeString('ko-KR', {
        hour: 'numeric',
        minute: '2-digit'
      })
    : null
)
const diskNote = computed(() => {
  const d = disk.value
  if (d?.error) return d.error
  if (d?.scanning) return text.ui.disk.scanning
  if (!diskReady.value) return text.ui.cards.diskAuto
  return scannedTime.value ? text.ui.cards.diskScanned(scannedTime.value) : ''
})
const diskSub = computed(() => {
  if (!diskReady.value) return text.ui.cards.diskNotYet
  const stale = diskFree.value.filter((r) => r.evidence === 'stale').length
  return text.ui.cards.diskSub(diskFree.value.length - stale, stale)
})
</script>

<template>
  <section
    ref="grid"
    class="resource-grid shrink-0"
    aria-label="자원 요약"
    :style="{ gridTemplateColumns: columns }"
  >
    <!-- 칸마다 카드 한 장. 편집 중에는 칸 전체를 끌 수 있고, 카드 안은 누를 수 없다(inert). -->
    <div
      v-for="(id, index) in shownCards"
      :key="id"
      :data-card="id"
      :data-hidden="(editing && isHidden(id)) || undefined"
      :data-attention="attention[id]"
      :data-quiet="quiet.includes(id) || undefined"
      class="relative min-w-0 rounded-xl"
      :class="
        editing
          ? [
              'cursor-grab outline-1 outline-offset-2 outline-dashed',
              dropTarget === id && dragging !== id ? 'outline-primary' : 'outline-border'
            ]
          : null
      "
      :draggable="!!editing"
      @dragstart="onDragStart($event, id)"
      @dragover="onDragOver($event, id)"
      @dragleave="onDragLeave($event, id)"
      @drop="onDrop($event, id)"
      @dragend="onDragEnd"
    >
      <!-- 간단히 카드는 편집 중 설명 줄을 숨기고 그 자리에 편집 막대를 둔다. -->
      <div
        :inert="editing || undefined"
        :class="{
          'opacity-40': editing && isHidden(id),
          '[&_[data-compact-sub]]:invisible': editing && compact
        }"
      >
        <!-- 조용한 카드(값이 0): 아이콘 칩 + 제목 + 없음 -->
        <QuietCard
          v-if="quiet.includes(id) && QUIET_CARD[id]"
          :icon="QUIET_CARD[id].icon"
          :title="QUIET_CARD[id].title"
          :compact="compact"
          :action-label="QUIET_CARD[id].label"
          @action="QUIET_CARD[id].tab && emit('tab', QUIET_CARD[id].tab)"
        />
        <!-- 메모리(넓은 칸) -->
        <template v-else-if="id === 'memory'">
          <CompactCard
            v-if="compact"
            :icon="MemoryStick"
            :title="text.ui.cards.memory"
            color="var(--chart-3)"
            :action-label="text.ui.cards.memoryDetails"
            :value="hasMemory ? String(ramPercent) : text.ui.none"
            :unit="hasMemory ? '%' : null"
            @action="emit('memory')"
          >
            <template #badge>
              <Badge
                v-for="b in memoryBadges"
                :key="b.key"
                :variant="b.variant"
                class="text-[10px] font-normal"
                >{{ b.label }}</Badge
              >
            </template>
            <!-- 설명 줄 대신 얇은 쌓은 막대(자세히와 같은 조각·풍선말). -->
            <span
              v-if="composition"
              data-memory-bar
              class="flex h-1 w-full gap-px overflow-hidden rounded-full bg-muted"
              :title="freeTip"
              aria-hidden="true"
            >
              <span
                v-for="p in memoryParts"
                :key="p.group"
                :data-memory-part="p.group"
                class="h-full"
                :style="{ width: `${p.share * 100}%`, backgroundColor: p.color }"
                :title="p.tip"
              ></span>
            </span>
            <span v-else class="truncate">{{ text.ui.loading }}</span>
          </CompactCard>
          <Card v-else size="sm" class="h-60 gap-3">
            <PanelHeader
              :icon="MemoryStick"
              :title="text.ui.cards.memory"
              color="var(--chart-3)"
              :action-label="text.ui.cards.memoryDetails"
              @action="emit('memory')"
            >
              <template #badge>
                <Badge
                  v-for="b in memoryBadges"
                  :key="b.key"
                  :variant="b.variant"
                  class="text-[10px] font-normal"
                  >{{ b.label }}</Badge
                >
              </template>
            </PanelHeader>
            <!-- 다른 카드(gap-2)보다 조금 좁혀(gap-1.5) 범례 세 줄도 카드 높이 안에 들어가게 한다(legendDense 참고). -->
            <CardContent class="min-h-0 flex-1 gap-1.5">
              <div>
                <!-- 카드 높이가 정해져 있어 커밋 줄은 큰 숫자와 같은 줄 오른쪽에 둔다. -->
                <div class="flex items-baseline justify-between gap-2">
                  <div class="text-3xl leading-8 font-semibold tracking-tight tabular-nums">
                    {{ hasMemory ? ramPercent : text.ui.none
                    }}<span
                      v-if="hasMemory"
                      class="ml-0.5 text-lg font-normal text-muted-foreground"
                      >%</span
                    >
                  </div>
                  <span
                    v-if="hasMemory && commit && commitLine"
                    data-commit-line
                    class="min-w-0 truncate text-[11px] leading-4 tabular-nums text-muted-foreground"
                    :style="
                      commit.level !== 'normal' ? { color: COMMIT_COLOR[commit.level] } : undefined
                    "
                    :title="text.ui.sheet.commitNote"
                    >{{ commitLine }}</span
                  >
                </div>
                <p class="text-xs leading-4 text-muted-foreground">
                  {{
                    hasMemory
                      ? text.ui.cards.memoryOf(
                          formatBytes(s.memory.usedBytes),
                          formatBytes(s.memory.totalBytes),
                          formatBytes(s.memory.availableBytes)
                        )
                      : text.ui.loading
                  }}
                </p>
              </div>
              <div
                v-if="composition"
                class="shrink-0"
                :class="legendDense ? 'space-y-0.5' : 'space-y-1.5'"
              >
                <!-- 범례가 같은 값을 글로 보이므로 막대는 읽어 주지 않는다. 빈 칸(남은 메모리)은 막대 바탕. -->
                <div
                  data-memory-bar
                  class="flex h-2.5 w-full gap-px overflow-hidden rounded-full bg-muted"
                  :title="freeTip"
                  aria-hidden="true"
                >
                  <div
                    v-for="p in memoryParts"
                    :key="p.group"
                    :data-memory-part="p.group"
                    class="h-full"
                    :style="{ width: `${p.share * 100}%`, backgroundColor: p.color }"
                    :title="p.tip"
                  ></div>
                </div>
                <ul class="grid grid-cols-2 gap-x-4" :class="legendDense ? 'gap-y-0' : 'gap-y-1'">
                  <li
                    v-for="item in memoryLegend"
                    :key="item.group"
                    :data-memory-legend="item.group"
                    class="flex min-w-0 items-center gap-1.5 text-[11px] leading-3"
                    :title="item.tip"
                  >
                    <span
                      class="size-1.5 shrink-0 rounded-full"
                      :style="{ backgroundColor: item.color }"
                      aria-hidden="true"
                    ></span
                    ><span class="min-w-0 truncate text-muted-foreground">{{ item.label }}</span
                    ><span class="ml-auto shrink-0 tabular-nums">{{ item.percent }}</span>
                  </li>
                </ul>
              </div>
              <PixelTrend
                :points="ramHistory"
                :window-ms="windowMs"
                :label="text.ui.cards.memory"
                :format="(v) => `${Math.floor(v)}%`"
                range="0–100%"
                :warn="warnPercent ?? DEFAULT_THRESHOLDS.ramWarnPercent"
                :danger="dangerPercent ?? DEFAULT_THRESHOLDS.ramDangerPercent"
              />
            </CardContent>
          </Card>
        </template>

        <!-- 개발 서버 -->
        <template v-else-if="id === 'servers'">
          <CompactCard
            v-if="compact"
            :icon="Globe"
            :title="text.ui.cards.ports"
            color="var(--chart-1)"
            :action-label="text.ui.cards.showList"
            :value="String(s.servers.length)"
            :unit="text.ui.cards.count"
            @action="emit('tab', 'ports')"
          >
            <!-- 정리 후보가 있으면 설명 줄을 "정리 후보 n"(빨강)으로 바꾼다. -->
            <span
              v-if="portCounts.candidate > 0"
              class="min-w-0 truncate font-bold tabular-nums"
              :style="{ color: 'var(--status-stopped)' }"
              >{{ text.ui.cards.candidateLine(portCounts.candidate) }}</span
            >
            <span v-else class="min-w-0 truncate">{{
              text.ui.cards.portsSub(portCount, workspaceCount)
            }}</span>
          </CompactCard>
          <Card v-else size="sm" class="h-60 gap-3">
            <PanelHeader
              :icon="Globe"
              :title="text.ui.cards.ports"
              color="var(--chart-1)"
              :action-label="text.ui.cards.showList"
              @action="emit('tab', 'ports')"
            />
            <CardContent class="min-h-0 flex-1 gap-2">
              <div>
                <div class="text-3xl leading-8 font-semibold tracking-tight tabular-nums">
                  {{ s.servers.length
                  }}<span class="ml-0.5 text-lg font-normal text-muted-foreground">{{
                    text.ui.cards.count
                  }}</span>
                </div>
                <p class="text-xs leading-4 text-muted-foreground">
                  {{ text.ui.cards.portsSub(portCount, workspaceCount) }}
                </p>
              </div>
              <div v-if="portLogos.length" class="flex h-4 items-center gap-2.5 whitespace-nowrap">
                <span
                  v-for="g in portLogos"
                  :key="g.key"
                  class="flex items-center gap-1 text-[11px] tabular-nums text-muted-foreground"
                  :title="`${g.key} ${g.count}${text.ui.cards.count}`"
                >
                  <ItemIcon :icon="g.icon" :size="14" />{{ g.count }}
                </span>
              </div>
              <StatItem :label="text.ui.cards.memorySum" :value="formatBytes(portMemory)" />
              <div class="mt-auto border-t border-border/60 pt-3">
                <p class="mb-2 text-[11px] text-muted-foreground">{{ text.ui.cards.portJudge }}</p>
                <dl class="flex justify-between gap-2">
                  <div>
                    <dt class="whitespace-nowrap text-[10px] text-muted-foreground">
                      {{ text.ui.cards.candidate }}
                    </dt>
                    <dd
                      class="mt-0.5 text-sm font-medium tabular-nums"
                      :class="{ 'font-bold': portCounts.candidate > 0 }"
                      :style="
                        portCounts.candidate > 0 ? { color: 'var(--status-stopped)' } : undefined
                      "
                    >
                      {{ portCounts.candidate }}
                    </dd>
                  </div>
                  <div>
                    <dt class="whitespace-nowrap text-[10px] text-muted-foreground">
                      {{ text.ui.cards.check }}
                    </dt>
                    <dd class="mt-0.5 text-sm font-medium tabular-nums">{{ portCounts.check }}</dd>
                  </div>
                  <div>
                    <dt class="whitespace-nowrap text-[10px] text-muted-foreground">
                      {{ text.ui.cards.inUse }}
                    </dt>
                    <dd class="mt-0.5 text-sm font-medium tabular-nums">{{ portCounts.inUse }}</dd>
                  </div>
                </dl>
              </div>
            </CardContent>
          </Card>
        </template>

        <!-- 에이전트 -->
        <template v-else-if="id === 'agents'">
          <CompactCard
            v-if="compact"
            :icon="SquareTerminal"
            :title="text.ui.cards.agents"
            color="var(--chart-2)"
            :action-label="text.ui.cards.showList"
            :value="String(s.agents.length)"
            :unit="text.ui.cards.count"
            @action="emit('tab', 'agents')"
          >
            <!-- 좁은 카드에 들어가게 사람이 볼 일(응답 대기)과 정리할 거리(오래 쉼)만. -->
            <span
              class="min-w-0 truncate tabular-nums"
              :style="agentCounts.waiting > 0 ? { color: 'var(--status-waiting)' } : undefined"
              >{{ waitingLine ?? `${text.ui.agent.states.waiting} 0` }}</span
            >
            <span v-if="agentCounts.parked > 0" class="shrink-0 tabular-nums">{{
              text.ui.cards.agentParked(agentCounts.parked)
            }}</span>
          </CompactCard>
          <Card v-else size="sm" class="h-60 gap-3">
            <PanelHeader
              :icon="SquareTerminal"
              :title="text.ui.cards.agents"
              color="var(--chart-2)"
              :action-label="text.ui.cards.showList"
              @action="emit('tab', 'agents')"
            />
            <CardContent class="min-h-0 flex-1 gap-2">
              <div>
                <div class="text-3xl leading-8 font-semibold tracking-tight tabular-nums">
                  {{ s.agents.length
                  }}<span class="ml-0.5 text-lg font-normal text-muted-foreground">{{
                    text.ui.cards.count
                  }}</span>
                </div>
                <p
                  v-if="codexLimit"
                  data-codex-limits
                  class="truncate text-xs leading-4 text-muted-foreground"
                  :title="codexLimit.tip"
                >
                  {{ codexLimit.caption }}
                </p>
                <p v-else class="text-xs leading-4 text-muted-foreground">
                  {{ text.ui.cards.agentsSub }}
                </p>
              </div>
              <div v-if="agentLogos.length" class="flex h-4 items-center gap-2.5 whitespace-nowrap">
                <span
                  v-for="g in agentLogos"
                  :key="g.key"
                  class="flex items-center gap-1 text-[11px] tabular-nums text-muted-foreground"
                  :title="`${g.key} ${g.count}${text.ui.cards.count}`"
                >
                  <ItemIcon :icon="g.icon" :size="14" />{{ g.count }}
                </span>
              </div>
              <StatItem :label="text.ui.cards.memorySum" :value="formatBytes(agentMemory)" />
              <div class="mt-auto border-t border-border/60 pt-3">
                <!-- 카드 높이(h-60)가 이미 꽉 차, 오래 쉬는 세션 수는 셋째 칸 아래 새 줄 대신 이 줄 오른쪽(셋째 칸 위)에 둔다. -->
                <div
                  class="mb-2 flex items-baseline justify-between gap-2 text-[11px] text-muted-foreground"
                >
                  <p class="min-w-0 truncate" :title="text.ui.cards.stateSource">
                    {{ text.ui.cards.agentStates }} ·
                    {{ stateSourceLabel }}
                  </p>
                  <span v-if="agentCounts.parked > 0" data-parked class="shrink-0 tabular-nums">{{
                    text.ui.cards.agentParked(agentCounts.parked)
                  }}</span>
                </div>
                <dl class="flex justify-between gap-2">
                  <div>
                    <dt class="whitespace-nowrap text-[10px] text-muted-foreground">
                      {{ text.ui.agent.states.working }}
                    </dt>
                    <dd class="mt-0.5 text-sm font-medium tabular-nums">
                      {{ agentCounts.working }}
                    </dd>
                  </div>
                  <div>
                    <dt class="whitespace-nowrap text-[10px] text-muted-foreground">
                      {{ text.ui.agent.states.waiting }}
                    </dt>
                    <dd
                      class="mt-0.5 text-sm font-medium tabular-nums"
                      :class="{ 'font-bold': agentCounts.waiting > 0 }"
                      :style="
                        agentCounts.waiting > 0 ? { color: 'var(--status-waiting)' } : undefined
                      "
                    >
                      {{ agentCounts.waiting }}
                    </dd>
                  </div>
                  <div>
                    <dt class="whitespace-nowrap text-[10px] text-muted-foreground">
                      {{ agentCounts.restLabel }}
                    </dt>
                    <dd class="mt-0.5 text-sm font-medium tabular-nums">{{ agentCounts.rest }}</dd>
                  </div>
                </dl>
              </div>
            </CardContent>
          </Card>
        </template>

        <!-- 무거운 작업 -->
        <template v-else-if="id === 'heavy'">
          <CompactCard
            v-if="compact"
            :icon="Hammer"
            :title="text.ui.cards.heavy"
            :hint="text.ui.cards.heavyHelp"
            :color="s.heavyOverlap ? 'var(--status-waiting)' : null"
            :action-label="text.ui.cards.showList"
            :value="String(s.heavyJobs.length)"
            :unit="text.ui.cards.count"
            @action="emit('tab', 'heavy')"
          >
            <template #badge>
              <Badge
                v-if="s.heavyOverlap"
                variant="outline"
                class="border-[color:var(--status-waiting)] text-[10px] font-normal text-[color:var(--status-waiting)]"
                >{{ text.ui.cards.overlap }}</Badge
              >
            </template>
            <span class="min-w-0 truncate">{{ text.ui.cards.heavyRunning }}</span>
            <span class="shrink-0 tabular-nums" :title="text.ui.cards.memorySum">{{
              formatBytes(heavyMemory)
            }}</span>
          </CompactCard>
          <Card v-else size="sm" class="h-60 gap-3">
            <PanelHeader
              :icon="Hammer"
              :title="text.ui.cards.heavy"
              :hint="text.ui.cards.heavyHelp"
              :color="s.heavyOverlap ? 'var(--status-waiting)' : null"
              :action-label="text.ui.cards.showList"
              @action="emit('tab', 'heavy')"
            >
              <template #badge>
                <Badge
                  v-if="s.heavyOverlap"
                  variant="outline"
                  class="border-[color:var(--status-waiting)] text-[10px] font-normal text-[color:var(--status-waiting)]"
                  >{{ text.ui.cards.overlap }}</Badge
                >
              </template>
            </PanelHeader>
            <CardContent class="min-h-0 flex-1 gap-2">
              <div>
                <div class="text-3xl leading-8 font-semibold tracking-tight tabular-nums">
                  {{ s.heavyJobs.length
                  }}<span class="ml-0.5 text-lg font-normal text-muted-foreground">{{
                    text.ui.cards.count
                  }}</span>
                </div>
                <p class="text-xs leading-4 text-muted-foreground">
                  {{ text.ui.cards.heavyRunning }}
                </p>
              </div>
              <StatItem :label="text.ui.cards.memorySum" :value="formatBytes(heavyMemory)" />
              <ul
                v-if="heavyItems.length"
                class="mt-auto space-y-1.5 border-t border-border/60 pt-2.5"
              >
                <li v-for="item in heavyItems" :key="item.key">
                  <button
                    type="button"
                    class="flex w-full min-w-0 items-center gap-2 rounded-sm text-left text-xs outline-none hover:text-primary focus-visible:ring-3 focus-visible:ring-ring/50"
                    :title="item.title"
                    @click="emit('select', item.key)"
                  >
                    <ItemIcon :icon="item.icon" :size="14" />
                    <span class="min-w-0 truncate">{{ item.label }}</span>
                    <span class="ml-auto shrink-0 tabular-nums text-muted-foreground">{{
                      formatBytes(item.bytes)
                    }}</span>
                  </button>
                </li>
              </ul>
              <p
                v-if="s.heavyOverlap"
                class="text-[11px] leading-4 text-destructive"
                :class="{ 'mt-auto': !heavyItems.length }"
              >
                {{ text.ui.cards.overlapNote(pressure) }}
              </p>
            </CardContent>
          </Card>
        </template>

        <!-- 남은 프로세스 -->
        <template v-else-if="id === 'leftovers'">
          <CompactCard
            v-if="compact"
            :icon="Unplug"
            :title="text.ui.cards.leftovers"
            :hint="text.ui.cards.leftoversHelp"
            :color="freeLeftovers.length ? 'var(--status-waiting)' : null"
            :action-label="text.ui.cards.showList"
            :value="String(freeLeftovers.length)"
            :unit="text.ui.cards.count"
            @action="emit('tab', 'leftovers')"
          >
            <span class="min-w-0 truncate">{{ text.ui.cards.leftoversSub }}</span>
            <span class="shrink-0 tabular-nums" :title="text.ui.cards.memorySum">{{
              formatBytes(leftoverMemory)
            }}</span>
          </CompactCard>
          <Card v-else size="sm" class="h-60 gap-3">
            <PanelHeader
              :icon="Unplug"
              :title="text.ui.cards.leftovers"
              :hint="text.ui.cards.leftoversHelp"
              :color="freeLeftovers.length ? 'var(--status-waiting)' : null"
              :action-label="text.ui.cards.showList"
              @action="emit('tab', 'leftovers')"
            />
            <CardContent class="min-h-0 flex-1 gap-2">
              <div>
                <div class="text-3xl leading-8 font-semibold tracking-tight tabular-nums">
                  {{ freeLeftovers.length
                  }}<span class="ml-0.5 text-lg font-normal text-muted-foreground">{{
                    text.ui.cards.count
                  }}</span>
                </div>
                <p class="text-xs leading-4 text-muted-foreground">
                  {{ text.ui.cards.leftoversSub }}
                </p>
              </div>
              <StatItem :label="text.ui.cards.memorySum" :value="formatBytes(leftoverMemory)" />
              <ul
                v-if="leftoverItems.length"
                class="mt-auto space-y-1.5 border-t border-border/60 pt-2.5"
              >
                <li v-for="item in leftoverItems" :key="item.key">
                  <button
                    type="button"
                    class="flex w-full min-w-0 items-center gap-2 rounded-sm text-left text-xs outline-none hover:text-primary focus-visible:ring-3 focus-visible:ring-ring/50"
                    :title="item.title"
                    @click="emit('select', item.key)"
                  >
                    <ItemIcon :icon="item.icon" :size="14" />
                    <span class="min-w-0 truncate">{{ item.label }}</span>
                    <span class="ml-auto shrink-0 tabular-nums text-muted-foreground">{{
                      formatBytes(item.bytes)
                    }}</span>
                  </button>
                </li>
              </ul>
              <p
                v-if="agentLeftovers > 0"
                class="text-[11px] leading-4 text-muted-foreground"
                :class="{ 'mt-auto': !leftoverItems.length }"
              >
                {{ text.ui.cards.leftoversAgent(agentLeftovers) }}
              </p>
            </CardContent>
          </Card>
        </template>

        <!-- 디스크 정리 -->
        <template v-else-if="id === 'disk'">
          <CompactCard
            v-if="compact"
            :icon="HardDrive"
            :title="text.ui.cards.disk"
            color="var(--chart-4)"
            :action-label="text.ui.cards.showList"
            :value="diskReady ? formatBytes(diskBytes) : text.ui.none"
            @action="emit('tab', 'disk')"
          >
            <span class="min-w-0 truncate" :title="diskSub">{{ diskSub }}</span>
          </CompactCard>
          <Card v-else size="sm" class="h-60 gap-3">
            <PanelHeader
              :icon="HardDrive"
              :title="text.ui.cards.disk"
              color="var(--chart-4)"
              :action-label="text.ui.cards.showList"
              @action="emit('tab', 'disk')"
            />
            <CardContent class="min-h-0 flex-1 gap-2">
              <div>
                <div class="text-2xl leading-8 font-semibold tracking-tight tabular-nums">
                  {{ diskReady ? formatBytes(diskBytes) : text.ui.none }}
                </div>
                <p class="text-xs leading-4 text-muted-foreground">{{ diskSub }}</p>
              </div>
              <StatItem
                :label="text.ui.cards.diskInUse"
                :value="`${diskInUse}${text.ui.cards.count}`"
              />
              <div
                class="mt-auto flex items-center justify-between gap-2 border-t border-border/60 pt-2"
              >
                <span
                  class="min-w-0 truncate text-[11px] leading-4"
                  :class="disk?.error ? 'text-destructive' : 'text-muted-foreground'"
                  :title="diskNote"
                  >{{ diskNote }}</span
                >
                <Button
                  variant="ghost"
                  size="xs"
                  class="shrink-0 text-muted-foreground"
                  :disabled="!!disk?.scanning"
                  @click="emit('diskScan')"
                >
                  <RefreshCw :class="{ 'animate-spin': disk?.scanning }" />{{
                    text.ui.cards.rescan
                  }}
                </Button>
              </div>
            </CardContent>
          </Card>
        </template>

        <!-- 새 카드(G3) -->
        <WaitingCard
          v-else-if="id === 'waiting'"
          :agents="s.agents"
          :now="s.takenAt"
          :compact="compact"
          @select="(key) => emit('select', key)"
        />
        <TokensCard
          v-else-if="id === 'tokens'"
          :agents="s.agents"
          :limits="s.codexLimits"
          :now="s.takenAt"
          :compact="compact"
          @tab="(key) => emit('tab', key)"
        />
        <EventsCard
          v-else-if="id === 'events'"
          :events="events ?? []"
          :now="s.takenAt"
          :compact="compact"
          @tab="(key) => emit('tab', key)"
        />
      </div>

      <!--
        편집 막대: 카드(간단히 카드는 카드 전체가 단추) 밖, 칸 아래 가장자리 가운데. 제목·큰 값을 가리지 않고,
        가리는 아래쪽 내용 위에서도 읽히게 바탕(popover)을 깐다.
      -->
      <div
        v-if="editing"
        role="group"
        data-card-controls
        :aria-label="T.title[id]"
        class="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-full border border-border bg-popover px-1 py-0.5 text-popover-foreground shadow-sm"
      >
        <button
          type="button"
          data-card-action="left"
          :class="[CONTROL, 'w-5']"
          :aria-label="T.left"
          :title="T.left"
          :disabled="index === 0"
          @click="moveBy(id, -1)"
        >
          <ChevronLeft class="size-3" aria-hidden="true" />
        </button>
        <button
          type="button"
          data-card-action="right"
          :class="[CONTROL, 'w-5']"
          :aria-label="T.right"
          :title="T.right"
          :disabled="index === shownCards.length - 1"
          @click="moveBy(id, 1)"
        >
          <ChevronRight class="size-3" aria-hidden="true" />
        </button>
        <button
          type="button"
          :data-card-action="isHidden(id) ? 'show' : 'hide'"
          :class="[CONTROL, 'px-1.5']"
          :disabled="!isHidden(id) && lastVisible"
          @click="toggleHidden(id)"
        >
          {{ isHidden(id) ? T.show : T.hide }}
        </button>
        <button
          v-if="EXTRA_CARDS.includes(id)"
          type="button"
          data-card-action="remove"
          :class="[CONTROL, 'px-1.5']"
          :disabled="!isHidden(id) && lastVisible"
          @click="remove(id)"
        >
          {{ T.remove }}
        </button>
      </div>
    </div>
  </section>
</template>
