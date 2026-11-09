<!--
  트레이 요약 창(F10). NeoHtop (MIT) components/MenuBarOverview.svelte 를 따른다:
  둥근 카드 한 장(머리: 로고·이름·상태·앱 열기 / 지표 3칸 / 목록 / 바닥: 버튼).
  바꾼 점: CPU·메모리·GPU 대신 RAM·개발 서버·에이전트, 네트워크·디스크 칸 대신 정리 추천,
  CPU 상위 프로세스 대신 작업 공간별 서버와 에이전트. 끄기는 하지 않고 앱을 연다(확인 창은 앱에서).
-->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  ArrowUpRight,
  Bot,
  FolderGit2,
  Globe,
  MemoryStick,
  Power,
  Settings,
  Sparkles
} from '@lucide/vue'
import type { DashboardSnapshot } from '../../shared/types'
import { formatBytes, formatDuration, worktreeFolder } from '../../shared/format'
import { selectionKey } from '../../shared/keys'
import { cleanupRecommendation } from '../../shared/recommend'
import { text } from '../../shared/text'
import { watchColorScheme } from './theme'
import { agentIcon, workspaceSummary } from './rows'
import logo from '../../../resources/icon-small.png'
import Card from './ui/Card.vue'
import CardHeader from './ui/CardHeader.vue'
import CardTitle from './ui/CardTitle.vue'
import CardContent from './ui/CardContent.vue'
import Button from './ui/Button.vue'
import Badge from './ui/Badge.vue'
import Progress from './ui/Progress.vue'
import ItemIcon from './components/ItemIcon.vue'

const T = text.ui.trayView
const snapshot = ref<DashboardSnapshot | null>(null)
let stopTheme: (() => void) | null = null
let unsubscribe: (() => void) | null = null

const receive = (s: DashboardSnapshot): void => {
  if (!snapshot.value || s.takenAt >= snapshot.value.takenAt) snapshot.value = s
}
const act = (kind: 'open' | 'settings' | 'quit' | 'hide' | 'item', key?: string): void =>
  void (key === undefined
    ? window.pitwall.tray.action(kind)
    : window.pitwall.tray.action(kind, key))
const onKey = (event: KeyboardEvent): void => {
  if (event.key === 'Escape') act('hide')
}

onMounted(async () => {
  document.documentElement.classList.add('tray-view')
  stopTheme = watchColorScheme((q) => window.matchMedia(q), document.documentElement)
  window.addEventListener('keydown', onKey)
  unsubscribe = window.pitwall.onSnapshot(receive)
  const latest = await window.pitwall.getLatest()
  if (latest) receive(latest)
})
onUnmounted(() => {
  stopTheme?.()
  unsubscribe?.()
  window.removeEventListener('keydown', onKey)
})

const s = computed(() => snapshot.value)
const LEVEL_COLOR = { normal: 'var(--chart-2)', warn: 'var(--peach)', danger: 'var(--destructive)' }
const ram = computed(() => {
  const m = s.value?.memory
  if (!m || m.totalBytes <= 0) return null
  return {
    percent: Math.floor(m.usedPercent),
    value: m.usedPercent,
    color: LEVEL_COLOR[m.level],
    detail: T.ramDetail(formatBytes(m.usedBytes), formatBytes(m.totalBytes))
  }
})
const portCount = computed(() => s.value?.servers.reduce((n, r) => n + r.ports.length, 0) ?? 0)
const agentCounts = computed(() => {
  const agents = s.value?.agents ?? []
  return {
    working: agents.filter((a) => a.state === 'working').length,
    waiting: agents.filter((a) => a.state === 'waiting').length
  }
})
const recommendation = computed(() => (s.value ? cleanupRecommendation(s.value) : null))
const workspaces = computed(() => (s.value ? workspaceSummary(s.value).slice(0, 5) : []))
/** 사용자가 봐야 할 것(권한 대기·오류·작업 중)이 먼저. */
const ORDER = { waiting: 0, error: 1, working: 2, idle: 3, unknown: 4 }
const agents = computed(() =>
  [...(s.value?.agents ?? [])].sort((a, b) => ORDER[a.state] - ORDER[b.state]).slice(0, 4)
)
const agentState = (a: DashboardSnapshot['agents'][number]): string => {
  const label = text.ui.agent.states[a.state]
  return a.stateSince != null && a.state !== 'unknown' && s.value
    ? text.ui.rowStatus.withTime(label, formatDuration(Math.max(0, s.value.takenAt - a.stateSince)))
    : label
}
const subtitle = computed(() => (!s.value ? T.reading : s.value.stale ? T.stale : T.live))
</script>

<template>
  <div class="h-screen p-2">
    <Card
      size="sm"
      class="h-full gap-0 overflow-hidden rounded-2xl py-0 shadow-lg ring-1 ring-border"
    >
      <CardHeader class="grid-cols-[1fr_auto] items-center gap-2 border-b border-border py-3">
        <div class="flex items-center gap-2">
          <img :src="logo" alt="" width="28" height="28" class="size-7 shrink-0" />
          <div>
            <CardTitle>{{ text.appName }}</CardTitle>
            <p class="mt-0.5 text-xs text-muted-foreground">{{ subtitle }}</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          :aria-label="T.open"
          :title="T.open"
          data-action="open"
          @click="act('open')"
          ><ArrowUpRight
        /></Button>
      </CardHeader>

      <CardContent class="min-h-0 flex-1 gap-3 overflow-y-auto py-3">
        <div class="grid grid-cols-3 divide-x divide-border">
          <div class="min-w-0 space-y-2 pr-3" data-metric="ram">
            <div class="flex items-center gap-1.5 text-xs text-muted-foreground">
              <MemoryStick class="size-3.5" />{{ T.ram }}
            </div>
            <p class="text-xl font-semibold tabular-nums">
              {{ ram ? `${ram.percent}%` : text.ui.none }}
            </p>
            <Progress :value="ram?.value ?? 0" class="h-1.5" :style="{ '--primary': ram?.color }" />
            <p class="truncate text-[10px] text-muted-foreground" :title="ram?.detail">
              {{ ram?.detail ?? T.reading }}
            </p>
          </div>
          <div class="min-w-0 space-y-2 px-3" data-metric="servers">
            <div class="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Globe class="size-3.5" />{{ T.servers }}
            </div>
            <p class="text-xl font-semibold tabular-nums">
              {{ s?.servers.length ?? 0
              }}<span class="ml-0.5 text-sm font-normal text-muted-foreground">{{
                text.ui.cards.count
              }}</span>
            </p>
            <p class="truncate text-[10px] text-muted-foreground">{{ T.ports(portCount) }}</p>
          </div>
          <div class="min-w-0 space-y-2 pl-3" data-metric="agents">
            <div class="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Bot class="size-3.5" />{{ T.agents }}
            </div>
            <p class="text-xl font-semibold tabular-nums">
              {{ s?.agents.length ?? 0
              }}<span class="ml-0.5 text-sm font-normal text-muted-foreground">{{
                text.ui.cards.count
              }}</span>
            </p>
            <p
              class="truncate text-[10px]"
              :class="agentCounts.waiting ? 'text-[color:var(--peach)]' : 'text-muted-foreground'"
            >
              {{ T.agentStates(agentCounts.working, agentCounts.waiting) }}
            </p>
          </div>
        </div>

        <Button
          v-if="recommendation && recommendation.items.length"
          variant="outline"
          size="sm"
          class="justify-start"
          data-action="recommend"
          @click="act('open')"
        >
          <Sparkles />{{
            T.recommend(recommendation.items.length, formatBytes(recommendation.totalBytes))
          }}
        </Button>

        <section :aria-label="T.workspaces">
          <div class="mb-2 flex justify-between text-xs text-muted-foreground">
            <h2 class="font-medium text-foreground">{{ T.workspaces }}</h2>
            <span>{{ T.workspaceColumns }}</span>
          </div>
          <div class="divide-y divide-border overflow-hidden rounded-lg border border-border">
            <Button
              v-for="ws in workspaces"
              :key="ws.key"
              variant="ghost"
              class="h-auto w-full justify-start gap-2.5 rounded-none border-0 px-3 py-2 text-left font-normal focus-visible:ring-inset"
              :data-workspace="ws.key"
              :title="ws.title"
              @click="act('item', ws.firstKey)"
            >
              <FolderGit2 class="size-4 shrink-0 text-muted-foreground" />
              <span class="min-w-0 flex-1 truncate text-xs font-medium">{{ ws.name }}</span>
              <span
                v-for="a in ws.agents.slice(0, 2)"
                :key="selectionKey.agent(a)"
                class="flex shrink-0"
                :title="`${text.ui.agent.toolNames[a.tool]} · ${agentState(a)}`"
                ><ItemIcon :icon="agentIcon(a)" :size="14"
              /></span>
              <Badge variant="secondary" class="shrink-0 px-1.5 text-[10px] font-normal">{{
                ws.serverCount
              }}</Badge>
              <span class="w-14 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{{
                formatBytes(ws.memoryBytes)
              }}</span>
            </Button>
            <p v-if="!workspaces.length" class="p-4 text-xs text-muted-foreground">
              {{ s ? T.noServers : T.reading }}
            </p>
          </div>
        </section>

        <section v-if="agents.length" :aria-label="T.agents">
          <h2 class="mb-2 text-xs font-medium">{{ T.agents }}</h2>
          <div class="divide-y divide-border overflow-hidden rounded-lg border border-border">
            <Button
              v-for="a in agents"
              :key="selectionKey.agent(a)"
              variant="ghost"
              class="h-auto w-full justify-start gap-2.5 rounded-none border-0 px-3 py-2 text-left font-normal focus-visible:ring-inset"
              data-agent
              @click="act('item', selectionKey.agent(a))"
            >
              <ItemIcon :icon="agentIcon(a)" :size="16" />
              <span class="min-w-0 flex-1 truncate text-xs font-medium">{{
                worktreeFolder(a.worktree)
              }}</span>
              <span
                class="shrink-0 text-xs tabular-nums"
                :class="
                  a.state === 'waiting' ? 'text-[color:var(--peach)]' : 'text-muted-foreground'
                "
                >{{ agentState(a) }}</span
              >
            </Button>
          </div>
        </section>
      </CardContent>

      <div class="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
        <Button variant="outline" size="sm" data-action="settings" @click="act('settings')"
          ><Settings />{{ T.settings }}</Button
        >
        <Button variant="ghost" size="sm" @click="act('open')">{{ T.open }}<ArrowUpRight /></Button>
        <Button
          variant="ghost"
          size="icon-sm"
          :aria-label="T.quit"
          :title="T.quit"
          data-action="quit"
          @click="act('quit')"
          ><Power
        /></Button>
      </div>
    </Card>
  </div>
</template>
