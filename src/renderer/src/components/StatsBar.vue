<!--
  NeoHtop (MIT) stats/StatsBar.svelte 와 CpuPanel·MemoryPanel·StoragePanel·SystemPanel 의 카드 모양을 가져옴.
  바꾼 점: CPU·GPU·저장소·시스템·네트워크 대신 pitwall 의 메모리·개발 서버·에이전트·무거운 작업·남은 프로세스·디스크 정리.
  넓은 첫 칸(NeoHtop CPU 칸 자리)은 메모리로, 코어별 막대 대신 묶음별(개발 서버·에이전트·…) 막대를 둔다.
  아래 칸 구분선 + 세 숫자(NeoHtop System 카드의 Load average)는 개발 서버 판단·에이전트 상태 개수에 쓴다.
-->
<script setup lang="ts">
import { computed } from 'vue'
import { Bot, Globe, Hammer, HardDrive, MemoryStick, RefreshCw, Unplug } from '@lucide/vue'
import type { DashboardSnapshot, ProcessGroup } from '../../../shared/types'
import { formatBytes } from '../../../shared/format'
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

export type TabKey = 'ports' | 'agents' | 'leftovers' | 'heavy' | 'disk' | 'apps'

const props = defineProps<{
  snapshot: DashboardSnapshot
  ramHistory: Point[]
  /** 추이 그래프 가로축(ms). */
  windowMs: number
}>()
const emit = defineEmits<{ memory: []; tab: [key: TabKey]; diskScan: [] }>()

const s = computed(() => props.snapshot)
const hasMemory = computed(() => s.value.memory.totalBytes > 0)
// 화면·트레이 공통 규칙: 내림해야 경고 기준과 표시가 어긋나지 않는다.
const ramPercent = computed(() => Math.floor(s.value.memory.usedPercent))
const level = computed(() => s.value.memory.level)

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
  candidate: s.value.ports.filter((p) => p.judgement === 'candidate').length,
  check: s.value.ports.filter((p) => p.judgement === 'check').length,
  // "확인해볼 것"(탭만 연결)도 연결이 있지만 거기서 셌으므로 겹치지 않게 뺀다.
  inUse: s.value.ports.filter((p) => p.clientCount > 0 && p.judgement !== 'check').length
}))
const portMemory = computed(() => s.value.ports.reduce((sum, p) => sum + p.memoryBytes, 0))

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
      : text.ui.cards.agentOthers
  }
})
const agentMemory = computed(() => s.value.agents.reduce((sum, a) => sum + a.memoryBytes, 0))
const hookOn = computed(() => s.value.hook?.state === 'on')

const heavyMemory = computed(() => s.value.heavyJobs.reduce((sum, j) => sum + j.memoryBytes, 0))

// 에이전트가 있는 워크트리의 남은 프로세스는 그 에이전트가 쓰고 있을 수 있어 개수에서 뺀다.
const freeLeftovers = computed(() => s.value.leftovers.filter((l) => !l.agentInWorktree))
const agentLeftovers = computed(() => s.value.leftovers.length - freeLeftovers.value.length)
const leftoverMemory = computed(() =>
  freeLeftovers.value.reduce((sum, l) => sum + l.memoryBytes, 0)
)

const disk = computed(() => s.value.disk)
const diskReady = computed(() => !!disk.value && disk.value.scannedAt != null)
const diskFree = computed(() => (disk.value?.rows ?? []).filter((r) => !r.inUse))
const diskBytes = computed(() => diskFree.value.reduce((sum, r) => sum + (r.totalBytes ?? 0), 0))
const diskInUse = computed(() => (disk.value?.rows.length ?? 0) - diskFree.value.length)
const scannedTime = computed(() =>
  disk.value?.scannedAt
    ? new Date(disk.value.scannedAt).toLocaleTimeString('ko-KR', {
        hour: '2-digit',
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
        </template>
      </PanelHeader>
      <CardContent class="min-h-0 flex-1 gap-2">
        <div>
          <div class="text-3xl leading-8 font-semibold tracking-tight tabular-nums">
            {{ hasMemory ? ramPercent : text.ui.none
            }}<span v-if="hasMemory" class="ml-0.5 text-lg font-normal text-muted-foreground"
              >%</span
            >
          </div>
          <p class="text-xs leading-4 text-muted-foreground">
            {{
              hasMemory
                ? text.ui.cards.memoryOf(
                    formatBytes(s.memory.usedBytes),
                    formatBytes(s.memory.totalBytes)
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
            {{ s.ports.length
            }}<span class="ml-0.5 text-lg font-normal text-muted-foreground">{{
              text.ui.cards.count
            }}</span>
          </div>
          <p class="text-xs leading-4 text-muted-foreground">{{ text.ui.cards.portsSub }}</p>
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
        :icon="Bot"
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
        <StatItem :label="text.ui.cards.memorySum" :value="formatBytes(agentMemory)" />
        <StatItem
          :label="text.ui.cards.stateSource"
          :value="hookOn ? text.ui.cards.sourceHook : text.ui.cards.sourceCpu"
        />
        <div class="mt-auto border-t border-border/60 pt-3">
          <p class="mb-2 text-[11px] text-muted-foreground">{{ text.ui.cards.agentStates }}</p>
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
          <p class="text-xs leading-4 text-muted-foreground">
            {{ s.heavyJobs.length ? text.ui.cards.heavyRunning : text.ui.cards.heavyNone }}
          </p>
        </div>
        <StatItem :label="text.ui.cards.memorySum" :value="formatBytes(heavyMemory)" />
        <p
          class="mt-auto border-t border-border/60 pt-3 text-[11px] leading-4"
          :class="s.heavyOverlap ? 'text-destructive' : 'text-muted-foreground'"
        >
          {{ s.heavyOverlap ? text.ui.cards.overlapNote(ramPercent) : text.ui.cards.heavyHelp }}
        </p>
      </CardContent>
    </Card>

    <!-- 남은 프로세스 -->
    <Card size="sm" class="h-60 gap-3">
      <PanelHeader
        :icon="Unplug"
        :title="text.ui.cards.leftovers"
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
        <p
          class="mt-auto border-t border-border/60 pt-3 text-[11px] leading-4 text-muted-foreground"
        >
          {{
            agentLeftovers > 0
              ? text.ui.cards.leftoversAgent(agentLeftovers)
              : text.ui.cards.leftoversHelp
          }}
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
