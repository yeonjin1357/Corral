<!--
  NeoHtop (MIT) stats/StatsBar.svelte 와 CpuPanel·MemoryPanel·StoragePanel·SystemPanel 의 카드 모양을 가져옴.
  바꾼 점: CPU·GPU·저장소·시스템·네트워크 대신 pitwall 의 메모리·개발 서버·에이전트·무거운 작업·남은 프로세스·디스크 정리.
  넓은 첫 칸(NeoHtop CPU 칸 자리)은 메모리로, 코어별 막대 대신 묶음별(개발 서버·에이전트·…) 막대를 둔다.
  아래 칸 구분선 + 세 숫자(NeoHtop System 카드의 Load average)는 개발 서버 판단·에이전트 상태 개수에 쓴다.
-->
<script setup lang="ts">
import { computed } from 'vue'
import {
  Globe,
  Hammer,
  HardDrive,
  MemoryStick,
  RefreshCw,
  SquareTerminal,
  Unplug
} from '@lucide/vue'
import type { DashboardSnapshot, ProcessGroup } from '../../../shared/types'
import { formatBytes, pressureText } from '../../../shared/format'
import { text } from '../../../shared/text'
import type { Point } from '../history'
import Card from '../ui/Card.vue'
import CardContent from '../ui/CardContent.vue'
import Badge from '../ui/Badge.vue'
import Button from '../ui/Button.vue'
import Progress from '../ui/Progress.vue'
import PanelHeader from './PanelHeader.vue'
import StatItem from './StatItem.vue'
import ResourceTrend from './ResourceTrend.vue'
import ItemIcon from './ItemIcon.vue'
import { agentIcon, heavyIcon, leftoverIcon, serverIcon, type RowIcon } from '../rows'
import { selectionKey } from '../../../shared/keys'

export type TabKey = 'ports' | 'agents' | 'leftovers' | 'heavy' | 'disk' | 'apps'

const props = defineProps<{
  snapshot: DashboardSnapshot
  ramHistory: Point[]
  /** 추이 그래프 가로축(ms). */
  windowMs: number
  /** 기록이 이보다 끊기면 그래프를 잇지 않는다(앱이 꺼져 있었음). */
  gapMs?: number | null
}>()
const emit = defineEmits<{
  memory: []
  tab: [key: TabKey]
  diskScan: []
  select: [key: string]
}>()

const s = computed(() => props.snapshot)
const hasMemory = computed(() => s.value.memory.totalBytes > 0)
// 화면·트레이 공통 규칙: 내림해야 경고 기준과 표시가 어긋나지 않는다.
const ramPercent = computed(() => Math.floor(s.value.memory.usedPercent))
const level = computed(() => s.value.memory.level)
/** 경고·위험의 이유로 말할 사용률("RAM 85%" 또는 "커밋 86%"). */
const pressure = computed(() => pressureText(s.value.memory))
/** level 은 RAM·커밋 중 높은 쪽이라, ramLevel 과 다르면 원인은 커밋이다. */
const commitCaused = computed(() => level.value !== s.value.memory.ramLevel)
const commit = computed(() => s.value.memory.commit)
const COMMIT_COLOR = { warn: 'var(--peach)', danger: 'var(--destructive)' } as const
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

const GROUPS: { key: ProcessGroup; label: string; color: string }[] = [
  { key: 'devServer', label: text.ui.groups.devServer, color: 'var(--chart-1)' },
  { key: 'agent', label: text.ui.groups.agent, color: 'var(--chart-2)' },
  { key: 'heavy', label: text.ui.groups.heavy, color: 'var(--chart-3)' },
  { key: 'otherApps', label: text.ui.groups.otherApps, color: 'var(--chart-4)' }
]
const groupRows = computed(() =>
  GROUPS.map((g) => {
    const bytes = s.value.groups.find((x) => x.group === g.key)?.memoryBytes ?? 0
    const share = hasMemory.value ? (bytes / s.value.memory.totalBytes) * 100 : 0
    return { ...g, bytes, share }
  })
)

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
    // 오래 쉬는 세션(G2)은 작업 중·권한 대기가 아니므로 모두 셋째 칸에 든다.
    parked: rest.filter((a) => a.parked).length
  }
})
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
const diskSub = computed(() =>
  diskReady.value ? text.ui.cards.diskSub(diskFree.value.length) : text.ui.cards.diskNotYet
)
</script>

<template>
  <section class="resource-grid shrink-0" aria-label="자원 요약">
    <!-- 메모리(넓은 칸) -->
    <Card size="sm" class="h-60 gap-3">
      <PanelHeader
        :icon="MemoryStick"
        :title="text.ui.cards.memory"
        color="var(--chart-3)"
        :action-label="text.ui.cards.memoryDetails"
        @action="emit('memory')"
      >
        <template #badge>
          <Badge
            v-if="hasMemory && level !== 'normal'"
            :variant="level === 'danger' ? 'destructive' : 'secondary'"
            class="text-[10px] font-normal"
            >{{ text.ui.cards.levels[level] }}</Badge
          >
          <Badge
            v-if="hasMemory && level !== 'normal' && commitCaused"
            variant="outline"
            class="text-[10px] font-normal"
            >{{ text.ui.cards.commitCause }}</Badge
          >
        </template>
      </PanelHeader>
      <CardContent class="min-h-0 flex-1 gap-2">
        <div>
          <!-- 카드 높이가 정해져 있어 커밋 줄은 큰 숫자와 같은 줄 오른쪽에 둔다. -->
          <div class="flex items-baseline justify-between gap-2">
            <div class="text-3xl leading-8 font-semibold tracking-tight tabular-nums">
              {{ hasMemory ? ramPercent : text.ui.none
              }}<span v-if="hasMemory" class="ml-0.5 text-lg font-normal text-muted-foreground"
                >%</span
              >
            </div>
            <span
              v-if="hasMemory && commit && commitLine"
              data-commit-line
              class="min-w-0 truncate text-[11px] leading-4 tabular-nums text-muted-foreground"
              :style="commit.level !== 'normal' ? { color: COMMIT_COLOR[commit.level] } : undefined"
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
        <div class="grid shrink-0 grid-cols-2 gap-x-4 gap-y-1.5">
          <div v-for="g in groupRows" :key="g.key" class="min-w-0 space-y-1">
            <div class="flex justify-between gap-2 text-[11px] leading-3">
              <span class="truncate text-muted-foreground">{{ g.label }}</span
              ><span class="shrink-0 tabular-nums">{{ formatBytes(g.bytes) }}</span>
            </div>
            <Progress :value="g.share" class="h-1" :style="{ '--primary': g.color }" />
          </div>
        </div>
        <ResourceTrend
          :points="ramHistory"
          :window-ms="windowMs"
          :gap-ms="gapMs"
          :max="100"
          color="var(--chart-3)"
          :label="text.ui.cards.memory"
          :format="(v) => `${Math.floor(v)}%`"
          range="0–100%"
        />
      </CardContent>
    </Card>

    <!-- 개발 서버 -->
    <Card size="sm" class="h-60 gap-3">
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
                :class="{ 'text-destructive': portCounts.candidate > 0 }"
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

    <!-- 에이전트 -->
    <Card size="sm" class="h-60 gap-3">
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
          <p class="text-xs leading-4 text-muted-foreground">{{ text.ui.cards.agentsSub }}</p>
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
              <dd class="mt-0.5 text-sm font-medium tabular-nums">{{ agentCounts.working }}</dd>
            </div>
            <div>
              <dt class="whitespace-nowrap text-[10px] text-muted-foreground">
                {{ text.ui.agent.states.waiting }}
              </dt>
              <dd
                class="mt-0.5 text-sm font-medium tabular-nums"
                :style="agentCounts.waiting > 0 ? { color: 'var(--peach)' } : undefined"
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

    <!-- 무거운 작업 -->
    <Card size="sm" class="h-60 gap-3">
      <PanelHeader
        :icon="Hammer"
        :title="text.ui.cards.heavy"
        :hint="text.ui.cards.heavyHelp"
        :color="s.heavyOverlap ? 'var(--destructive)' : null"
        :action-label="text.ui.cards.showList"
        @action="emit('tab', 'heavy')"
      >
        <template #badge>
          <Badge v-if="s.heavyOverlap" variant="destructive" class="text-[10px] font-normal">{{
            text.ui.cards.overlap
          }}</Badge>
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
          <p class="text-xs leading-4 text-muted-foreground">{{ text.ui.cards.heavyRunning }}</p>
        </div>
        <StatItem :label="text.ui.cards.memorySum" :value="formatBytes(heavyMemory)" />
        <ul v-if="heavyItems.length" class="mt-auto space-y-1.5 border-t border-border/60 pt-2.5">
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

    <!-- 남은 프로세스 -->
    <Card size="sm" class="h-60 gap-3">
      <PanelHeader
        :icon="Unplug"
        :title="text.ui.cards.leftovers"
        :hint="text.ui.cards.leftoversHelp"
        :color="freeLeftovers.length ? 'var(--peach)' : null"
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
          <p class="text-xs leading-4 text-muted-foreground">{{ text.ui.cards.leftoversSub }}</p>
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

    <!-- 디스크 정리 -->
    <Card size="sm" class="h-60 gap-3">
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
        <StatItem :label="text.ui.cards.diskInUse" :value="`${diskInUse}${text.ui.cards.count}`" />
        <div class="mt-auto flex items-center justify-between gap-2 border-t border-border/60 pt-2">
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
            <RefreshCw :class="{ 'animate-spin': disk?.scanning }" />{{ text.ui.cards.rescan }}
          </Button>
        </div>
      </CardContent>
    </Card>
  </section>
</template>
