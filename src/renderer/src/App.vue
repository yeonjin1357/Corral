<!--
  화면 뼈대는 NeoHtop (MIT) routes/+page.svelte 를 따른다:
  제목줄 → 자원 카드 줄 → 도구줄(탭·검색) → 표 → 바닥 줄, 항목을 누르면 오른쪽에서 상세 패널이 나온다.
  끄기·지우기는 모두 메인 프로세스의 OS 확인 창을 거친다(화면에서 바로 끄지 않는다).
-->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { RefreshCw, X } from '@lucide/vue'
import type { DashboardSnapshot, KillResult, UpdateStatus } from '../../shared/types'
import {
  DEFAULT_SETTINGS,
  REFRESH_INTERVALS,
  type Settings,
  type ThemeChoice
} from '../../shared/settings'
import { describeKillResult, formatBytes } from '../../shared/format'
import { cleanupRecommendation } from '../../shared/recommend'
import { text } from '../../shared/text'
import { watchColorScheme } from './theme'
import { toIpc } from './ipc'
import { readSorts, resolveSort, writeSorts, type SortState, type Sorts } from './sortState'
import {
  POINT_LIMIT,
  agentKey,
  appendSnapshot,
  emptyHistory,
  seedRam,
  selectionKey
} from './history'
import { hookControls } from './hook'
import {
  TABS,
  filterRows,
  groupServers,
  hiddenServerTable,
  leftoverIcon,
  serverIcon,
  tableFor,
  type ActionKind,
  type GroupedRows,
  type Row,
  type TabKey
} from './rows'
import { readServerView, writeServerView, type ServerView } from './viewState'
import logo from '../../../resources/icon.png'
import TitleBar from './components/TitleBar.vue'
import StatsBar from './components/StatsBar.vue'
import ToolBar from './components/ToolBar.vue'
import ItemTable from './components/ItemTable.vue'
import ItemSheet, { type Selected } from './components/ItemSheet.vue'
import MemorySheet from './components/MemorySheet.vue'
import NoticeCard from './components/NoticeCard.vue'
import ItemIcon from './components/ItemIcon.vue'
import SettingsView from './components/SettingsView.vue'
import Button from './ui/Button.vue'

const snapshot = ref<DashboardSnapshot | null>(null)
const history = ref(emptyHistory())
const selectedKey = ref<string | null>(null)
const busyKey = ref<string | null>(null)
const refreshing = ref(false)
const hookBusy = ref(false)
const recommendBusy = ref(false)
const memoryOpen = ref(false)
const settings = ref<Settings>(DEFAULT_SETTINGS)
const page = ref<'dashboard' | 'settings'>('dashboard')
type SettingsPage =
  'general' | 'thresholds' | 'heavy' | 'notifications' | 'disk' | 'claude' | 'about'
const settingsPage = ref<SettingsPage>('general')
const version = ref<string | null>(null)
const update = ref<UpdateStatus | null>(null)
const tab = ref<TabKey>('ports')
const query = ref('')
const intervals = computed(() => REFRESH_INTERVALS[settings.value.refresh])
/** 추이 그래프 가로축: 창이 열려 있을 때 기록 한도만큼(보통 5초 × 120 = 10분). */
const windowMs = computed(() => intervals.value.openMs * POINT_LIMIT)
const isMac = navigator.userAgent.includes('Mac')

/** 제목줄 아래 한 줄 알림(NeoHtop TitleBar 의 actionError 줄). */
type Notice = { text: string; tone: 'error' | 'success' }
const notices = ref<Record<string, Notice>>({})
function say(slot: string, notice: Notice | null): void {
  const next = { ...notices.value }
  if (notice) next[slot] = notice
  else delete next[slot]
  notices.value = next
}
const noticeList = computed(() => Object.entries(notices.value))

function receive(s: DashboardSnapshot): void {
  snapshot.value = s
  history.value = appendSnapshot(history.value, s)
}

let unsubscribe: () => void = () => {}
let unsubscribeSettings: () => void = () => {}
let unsubscribeNavigate: () => void = () => {}
let unsubscribeUpdate: () => void = () => {}
let stopTheme: () => void = () => {}

function shortcut(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && event.key === ',') {
    event.preventDefault()
    openSettings('general')
  }
}

onMounted(async () => {
  stopTheme = watchColorScheme((q) => window.matchMedia(q), document.documentElement)
  window.addEventListener('keydown', shortcut)
  unsubscribe = window.pitwall.onSnapshot(receive)
  unsubscribeSettings = window.pitwall.settings.onChange((s) => (settings.value = s))
  // 알림·트레이에서 온 이동 요청: 그 항목을 고르거나(없으면 대시보드) 다른 화면으로.
  unsubscribeNavigate = window.pitwall.onNavigate((target) => {
    if (target.page === 'settings') {
      openSettings('general')
      return
    }
    page.value = 'dashboard'
    if (target.key) select(target.key)
    else goHome()
  })
  void window.pitwall.settings.get().then((s) => (settings.value = s))
  void window.pitwall.appInfo().then((info) => (version.value = info.version))
  unsubscribeUpdate = window.pitwall.update.onChange((s) => (update.value = s))
  void window.pitwall.update.get().then((s) => (update.value = s))
  // 앱이 기억한 RAM 추이로 그래프를 채운다(창을 다시 열거나 앱을 다시 켜도 이어짐).
  void window.pitwall
    .historyRam()
    .then((points) => (history.value = seedRam(history.value, points)))
    .catch(() => {})
  const latest = await window.pitwall.getLatest()
  // 창이 늦게 열려 놓친 스냅샷만 채운다. 그 사이 받은 더 새 스냅샷은 덮어쓰지 않는다.
  if (!snapshot.value && latest) receive(latest)
})

onUnmounted(() => {
  unsubscribe()
  unsubscribeSettings()
  unsubscribeNavigate()
  unsubscribeUpdate()
  stopTheme()
  window.removeEventListener('keydown', shortcut)
})

const heavyKey = (j: DashboardSnapshot['heavyJobs'][number]): string =>
  `heavy:${j.pid}:${j.startedAt ?? ''}`

const selected = computed<Selected | null>(() => {
  const s = snapshot.value
  const key = selectedKey.value
  if (!s || !key) return null
  const server = s.servers.find((r) => selectionKey.server(r) === key)
  if (server) return { kind: 'server', row: server }
  const agent = s.agents.find((r) => selectionKey.agent(r) === key)
  if (agent) return { kind: 'agent', row: agent }
  const leftover = s.leftovers.find((r) => selectionKey.leftover(r) === key)
  if (leftover) return { kind: 'leftover', row: leftover }
  const heavy = s.heavyJobs.find((r) => heavyKey(r) === key)
  if (heavy) return { kind: 'heavy', row: heavy }
  const disk = s.disk?.rows.find((r) => selectionKey.disk(r.worktreeRoot) === key)
  if (disk) return { kind: 'disk', row: disk }
  return null
})

// 고른 항목이 사라지면(서버 종료·세션 끝 등) 상세 패널을 닫는다.
watch(selected, (item) => {
  if (!item && selectedKey.value) selectedKey.value = null
})
const sheetOpen = computed({
  get: () => selected.value != null,
  set: (open: boolean) => {
    if (!open) selectedKey.value = null
  }
})
const sheetHistory = computed(() => {
  const item = selected.value
  if (item?.kind === 'server')
    return history.value.servers[selectionKey.server(item.row)]?.memory ?? []
  if (item?.kind === 'agent') return history.value.agents[agentKey(item.row)]?.memory ?? []
  return []
})

const TAB_OF: Record<string, TabKey> = {
  server: 'ports',
  agent: 'agents',
  leftover: 'leftovers',
  heavy: 'heavy',
  disk: 'disk'
}
function select(key: string): void {
  const kind = key.split(':', 1)[0]
  if (TAB_OF[kind] && tab.value !== TAB_OF[kind]) {
    tab.value = TAB_OF[kind]
    query.value = ''
  }
  selectedKey.value = key
}

/** 메모리 상세의 묶음에서 그 탭으로(숨긴 서버 보기·검색은 풀어 묶음 전체가 보이게). */
function goToTab(next: TabKey): void {
  memoryOpen.value = false
  page.value = 'dashboard'
  selectedKey.value = null
  showHidden.value = false
  query.value = ''
  tab.value = next
}

function goHome(): void {
  page.value = 'dashboard'
  selectedKey.value = null
  memoryOpen.value = false
}

function openSettings(next: SettingsPage): void {
  settingsPage.value = next
  page.value = 'settings'
  selectedKey.value = null
  memoryOpen.value = false
}

async function saveSettings(next: Settings): Promise<Settings> {
  // 설정 화면의 draft·제목줄의 settings 는 Vue 반응형이라 그대로 보내면 IPC 복제에 실패한다.
  const saved = await window.pitwall.settings.save(toIpc(next))
  settings.value = saved
  return saved
}

/** 제목줄 테마는 저장 버튼 없이 바로 바꾼다(NeoHtop 테마 선택처럼). */
async function chooseTheme(theme: ThemeChoice): Promise<void> {
  try {
    await saveSettings({ ...settings.value, theme })
  } catch (e) {
    say('action', { text: failureText(e), tone: 'error' })
  }
}

const pickFolder = (): Promise<string | null> => window.pitwall.settings.pickFolder()
const checkUpdate = (): void => void window.pitwall.update.check()
const installUpdate = (): void => void window.pitwall.update.install()

function failureText(e: unknown): string {
  return text.actionError(e instanceof Error ? e.message : String(e))
}

async function refresh(): Promise<void> {
  refreshing.value = true
  say('action', null)
  try {
    await window.pitwall.refreshNow()
  } catch (e) {
    say('action', { text: failureText(e), tone: 'error' })
  } finally {
    refreshing.value = false
  }
}

function resultNotice(result: KillResult): Notice | null {
  const message = describeKillResult(result)
  if (!message) return null
  return { text: message, tone: result.status === 'killed' ? 'success' : 'error' }
}

async function runAction(key: string, run: () => Promise<Notice | null>): Promise<void> {
  busyKey.value = key
  say('action', null)
  try {
    say('action', await run())
  } catch (e) {
    say('action', { text: failureText(e), tone: 'error' })
  } finally {
    busyKey.value = null
  }
}

async function act(kind: ActionKind, key: string): Promise<void> {
  const s = snapshot.value
  if (!s) return
  if (kind === 'details') {
    select(key)
    return
  }
  const server = s.servers.find((r) => selectionKey.server(r) === key)
  const leftover = s.leftovers.find((r) => selectionKey.leftover(r) === key)
  const disk = s.disk?.rows.find((r) => selectionKey.disk(r.worktreeRoot) === key)
  if (kind === 'open' && server) {
    try {
      // 서버가 연 포트 가운데 첫 포트(보통 화면을 내주는 포트)를 연다.
      if (!(await window.pitwall.openPort(server.ports[0])))
        say('action', { text: text.openFailed, tone: 'error' })
    } catch (e) {
      say('action', { text: failureText(e), tone: 'error' })
    }
  } else if (kind === 'kill' && server) {
    await runAction(key, async () => resultNotice(await window.pitwall.killServer(server.pid)))
  } else if (kind === 'unhide') {
    const hidden = s.hiddenServers.find((r) => selectionKey.server(r) === key)
    if (hidden) await runAction(key, () => unhide(hidden))
  } else if (kind === 'kill' && leftover) {
    await runAction(key, async () => resultNotice(await window.pitwall.killLeftover(leftover.pid)))
  } else if (kind === 'remove' && disk) {
    await runAction(key, async () => {
      const result = await window.pitwall.diskRemove(disk.worktreeRoot)
      if (result.status === 'killed')
        return result.message ? { text: result.message, tone: 'success' } : null
      if (result.status === 'gone') return { text: text.ui.disk.gone, tone: 'error' }
      return resultNotice(result)
    })
  }
}

function sheetAction(kind: ActionKind): void {
  if (selectedKey.value) void act(kind, selectedKey.value)
}

// ── 묶음 보기·숨기기·별칭(F1·F2·F11) ──
/** 설정을 바꾸고 바로 다시 수집해 화면에 반영한다(숨김·별칭은 수집기가 적용). */
async function updateSettings(change: (s: Settings) => Settings): Promise<void> {
  await saveSettings(change(settings.value))
  await window.pitwall.refreshNow()
}

/** 상세 패널의 숨기기: 서버의 첫 포트로 숨긴다(포트 중 하나라도 맞으면 숨김). */
async function hideSelected(): Promise<void> {
  const item = selected.value
  if (item?.kind !== 'server') return
  const entry = `:${item.row.ports[0]}`
  const key = selectedKey.value!
  selectedKey.value = null
  await runAction(key, async () => {
    await updateSettings((s) => ({
      ...s,
      hiddenServers: s.hiddenServers.includes(entry) ? s.hiddenServers : [...s.hiddenServers, entry]
    }))
    return { text: text.ui.group.hiddenDone(entry), tone: 'success' }
  })
}

/** 숨김 풀기: 그 서버를 숨기게 한 항목(포트 또는 프로세스 이름)을 모두 뺀다. */
async function unhide(row: DashboardSnapshot['servers'][number]): Promise<Notice | null> {
  const matches = (h: string): boolean =>
    h.startsWith(':')
      ? row.ports.includes(Number(h.slice(1)))
      : h.toLowerCase() === row.processName.toLowerCase()
  await updateSettings((s) => ({ ...s, hiddenServers: s.hiddenServers.filter((h) => !matches(h)) }))
  return null
}

async function cleanupWorkspace(root: string): Promise<void> {
  await runAction(`group:${root}`, async () =>
    resultNotice(await window.pitwall.cleanupWorkspace(root))
  )
}

async function renameWorkspace(root: string, name: string): Promise<void> {
  try {
    await updateSettings((s) => {
      const aliases = { ...s.workspaceAliases }
      if (name) aliases[root] = name
      else delete aliases[root]
      return { ...s, workspaceAliases: aliases }
    })
  } catch (e) {
    say('action', { text: failureText(e), tone: 'error' })
  }
}

async function diskScan(): Promise<void> {
  say('action', null)
  try {
    await window.pitwall.diskScan()
  } catch (e) {
    say('action', { text: failureText(e), tone: 'error' })
  }
}

async function killMany(keys: string[]): Promise<void> {
  recommendBusy.value = true
  say('recommend', null)
  try {
    say('recommend', resultNotice(await window.pitwall.killMany(keys)))
  } catch (e) {
    say('recommend', { text: failureText(e), tone: 'error' })
  } finally {
    recommendBusy.value = false
  }
}

const codexHookBusy = ref(false)
/** Codex 연동 켜기·끄기(설정 > 에이전트 연동). 켜면 /hooks 승인 안내가 결과에 들어 있다. */
async function codexHookAction(action: 'enable' | 'disable'): Promise<void> {
  codexHookBusy.value = true
  say('hook', null)
  try {
    const result = await window.pitwall.codexHook[action]()
    if (result.status !== 'cancelled')
      say('hook', { text: result.message, tone: result.status === 'failed' ? 'error' : 'success' })
  } catch (e) {
    say('hook', { text: failureText(e), tone: 'error' })
  } finally {
    codexHookBusy.value = false
  }
}

async function hookAction(action: 'enable' | 'disable'): Promise<void> {
  hookBusy.value = true
  say('hook', null)
  try {
    const result = await window.pitwall.claudeHook[action]()
    if (result.status !== 'cancelled')
      say('hook', { text: result.message, tone: result.status === 'failed' ? 'error' : 'success' })
  } catch (e) {
    say('hook', { text: failureText(e), tone: 'error' })
  } finally {
    hookBusy.value = false
  }
}

// ── 표 ──
/** 개발 서버 탭에서 숨긴 서버를 보는 중. */
const showHidden = ref(false)
const hiddenCount = computed(() => snapshot.value?.hiddenServers.length ?? 0)
watch(hiddenCount, (n) => {
  if (n === 0) showHidden.value = false
})
const table = computed(() => {
  const s = snapshot.value
  if (!s) return null
  return tab.value === 'ports' && showHidden.value ? hiddenServerTable(s) : tableFor(tab.value, s)
})
const rows = computed(() => (table.value ? filterRows(table.value.rows, query.value) : []))
/** 탭별 정렬. 데이터가 새로 와도·탭을 오가도·다시 켜도 유지한다. */
const storage = ((): Storage | null => {
  try {
    return window.localStorage
  } catch {
    return null
  }
})()
const sorts = ref<Sorts>(readSorts(storage))
const serverView = ref<ServerView>(readServerView(storage))
watch(serverView, (v) => writeServerView(storage, v))
/** 접은 작업 공간 묶음. 갱신해도 유지한다(앱을 다시 켜면 모두 펼침). */
const collapsedGroups = ref<string[]>([])
const grouping = computed<((rows: Row[]) => GroupedRows[]) | null>(() => {
  const s = snapshot.value
  if (!s || tab.value !== 'ports' || showHidden.value || serverView.value !== 'group') return null
  return (rows) => groupServers(rows, s.servers, s.agents, s.takenAt)
})
const NO_SORT: SortState = { id: 'name', dir: 'asc' }
const sort = computed<SortState>({
  get: () => (table.value ? resolveSort(sorts.value[tab.value], table.value) : NO_SORT),
  set: (next) => {
    sorts.value = { ...sorts.value, [tab.value]: next }
    writeSorts(storage, sorts.value)
  }
})
const counts = computed<Record<TabKey, number>>(() => {
  const s = snapshot.value
  const zero = Object.fromEntries(TABS.map((t) => [t, 0])) as Record<TabKey, number>
  if (!s) return zero
  return {
    ports: s.servers.length,
    agents: s.agents.length,
    leftovers: s.leftovers.length,
    heavy: s.heavyJobs.length,
    disk: s.disk?.rows.length ?? 0,
    apps: s.apps.length
  }
})
const emptyText = computed(() => {
  const L = text.ui.list
  switch (tab.value) {
    case 'ports':
      return L.empty
    case 'agents':
      return L.emptyAgents
    case 'leftovers':
      return L.emptyLeftovers
    case 'heavy':
      return L.emptyHeavy
    case 'apps':
      return L.emptyApps
    case 'disk': {
      const d = snapshot.value?.disk
      if (d?.error) return d.error
      if (d?.scanning) return text.ui.disk.scanning
      if (!d || d.scannedAt == null) return text.ui.disk.notYet
      return text.ui.disk.empty
    }
  }
  return ''
})
const hookButton = computed(() => hookControls(snapshot.value?.hook ?? null).button)

// ── 알림 카드 ──
const recommendation = computed(() =>
  snapshot.value ? cleanupRecommendation(snapshot.value) : { items: [], totalBytes: 0 }
)
/**
 * 정리 추천 카드를 닫으면(NeoHtop 알림 카드의 X) 그때의 상태를 기억해 둔다.
 * RAM 단계가 바뀌거나 끌 거리가 달라지면 다시 보인다(RAM 이 늘 높은 PC 에서 같은 카드가 자리를 차지하지 않게).
 */
const recommendState = computed(
  () =>
    `${snapshot.value?.memory.level}|${recommendation.value.items
      .map((i) => i.key)
      .sort()
      .join(',')}`
)
const recommendDismissed = ref<string | null>(null)
const showRecommend = computed(
  () =>
    !!snapshot.value &&
    snapshot.value.memory.totalBytes > 0 &&
    snapshot.value.memory.level !== 'normal' &&
    recommendation.value.items.length > 0 &&
    recommendDismissed.value !== recommendState.value
)
const RECOMMEND_SHOWN = 4
/** 추천 칩: 표와 같은 아이콘을 붙인다. */
const recommendChips = computed(() => {
  const s = snapshot.value
  return recommendation.value.items.slice(0, RECOMMEND_SHOWN).map((item) => {
    const server =
      item.kind === 'server' ? s?.servers.find((p) => selectionKey.server(p) === item.key) : null
    const leftover =
      item.kind === 'leftover'
        ? s?.leftovers.find((l) => selectionKey.leftover(l) === item.key)
        : null
    const icon = server
      ? serverIcon(server, s?.platform ?? null)
      : leftover
        ? leftoverIcon(leftover, s?.platform ?? null)
        : null
    return { ...item, icon }
  })
})

const takenAt = computed(() =>
  snapshot.value
    ? new Date(snapshot.value.takenAt).toLocaleTimeString('ko-KR', {
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit'
      })
    : ''
)
</script>

<template>
  <div class="app-container flex h-screen flex-col">
    <TitleBar
      :stale="!!snapshot?.stale"
      :refreshing="refreshing"
      :live-sec="intervals.openMs / 1000"
      :theme="settings.theme"
      :is-mac="isMac"
      @home="goHome"
      @refresh="refresh"
      @theme="chooseTheme"
      @settings="openSettings('general')"
      @about="openSettings('about')"
      @check-update="(openSettings('about'), checkUpdate())"
    />

    <div
      v-if="snapshot?.error"
      role="alert"
      class="snapshot-error flex shrink-0 items-center gap-3 border-b border-border bg-card px-4 py-2 text-xs text-destructive"
    >
      {{ snapshot.error }}
    </div>
    <div
      v-for="[slot, notice] in noticeList"
      :key="slot"
      role="status"
      :data-notice="slot"
      class="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-4 py-2 text-xs"
      :class="notice.tone === 'error' ? 'text-destructive' : ''"
      :style="notice.tone === 'success' ? { color: 'var(--status-running)' } : undefined"
    >
      <span>{{ notice.text }}</span>
      <Button variant="ghost" size="sm" class="h-6 px-2 text-xs" @click="say(slot, null)">
        {{ text.ui.bar.dismiss }}
      </Button>
    </div>

    <!-- 저장하지 않은 설정을 대시보드에 다녀와도 잃지 않게 화면을 치워 두었다가 그대로 되살린다. -->
    <KeepAlive>
      <SettingsView
        v-if="page === 'settings'"
        v-model:page="settingsPage"
        :settings="settings"
        :hook="snapshot?.hook ?? null"
        :hook-busy="hookBusy"
        :codex-hook="snapshot?.codexHook ?? null"
        :codex-hook-busy="codexHookBusy"
        :version="version"
        :save="saveSettings"
        :pick-folder="pickFolder"
        :update="update"
        @hook="hookAction"
        @codex-hook="codexHookAction"
        @update-check="checkUpdate"
        @update-install="installUpdate"
        @back="goHome"
      />
    </KeepAlive>

    <main
      v-if="page === 'dashboard'"
      class="dashboard-main flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    >
      <div
        v-if="!snapshot"
        class="flex flex-1 items-center justify-center"
        :aria-label="text.ui.loading"
      >
        <img
          :src="logo"
          alt=""
          class="size-24 opacity-90"
          style="filter: drop-shadow(0 0 18px color-mix(in srgb, var(--primary) 35%, transparent))"
        />
      </div>
      <template v-else>
        <StatsBar
          :snapshot="snapshot"
          :ram-history="history.ram"
          :window-ms="windowMs"
          @memory="memoryOpen = true"
          @tab="(key) => ((tab = key), (query = ''))"
          @disk-scan="diskScan"
          @select="select"
        />

        <NoticeCard
          v-if="showRecommend"
          class="recommend-box"
          dismissible
          :title="text.ui.home.recommendTitle"
          @dismiss="recommendDismissed = recommendState"
        >
          {{
            text.ui.home.recommendSummary(
              recommendation.items.length,
              formatBytes(recommendation.totalBytes)
            )
          }}
          <template #below>
            <div class="mt-2 flex flex-wrap gap-1.5">
              <Button
                v-for="item in recommendChips"
                :key="item.key"
                variant="secondary"
                size="xs"
                class="recommend-item max-w-80 font-normal"
                :title="item.where"
                @click="select(item.key)"
              >
                <ItemIcon v-if="item.icon" :icon="item.icon" :size="12" />
                <span>{{ item.title }}</span>
                <span class="truncate text-muted-foreground">{{ item.where }}</span>
                <span class="tabular-nums">{{ formatBytes(item.memoryBytes) }}</span>
              </Button>
              <span
                v-if="recommendation.items.length > RECOMMEND_SHOWN"
                class="self-center text-xs text-muted-foreground"
                >{{ text.ui.recommend.more(recommendation.items.length - RECOMMEND_SHOWN) }}</span
              >
            </div>
          </template>
          <template #actions>
            <Button
              variant="destructive"
              size="sm"
              data-action="kill-many"
              :disabled="recommendBusy"
              @click="killMany(recommendation.items.map((i) => i.key))"
            >
              <X />{{ text.ui.home.killAll }}
            </Button>
          </template>
        </NoticeCard>

        <NoticeCard
          v-if="snapshot.heavyOverlap"
          class="heavy-box"
          :title="text.ui.recommend.overlapTitle"
        >
          {{
            text.ui.home.heavyOverlap(
              Math.floor(snapshot.memory.usedPercent),
              snapshot.heavyJobs.length
            )
          }}
          <template #actions>
            <Button variant="outline" size="sm" @click="((tab = 'heavy'), (query = ''))">
              {{ text.ui.cards.showList }}
            </Button>
          </template>
        </NoticeCard>

        <ToolBar
          v-model:tab="tab"
          v-model:query="query"
          v-model:view="serverView"
          :counts="counts"
          :matching="rows.length"
        >
          <template #actions>
            <Button
              v-if="tab === 'agents' && hookButton"
              variant="outline"
              size="sm"
              data-action="hook"
              :disabled="hookBusy"
              @click="hookAction(hookButton.action)"
            >
              {{ hookButton.label }}
            </Button>
            <Button
              v-if="tab === 'disk'"
              variant="outline"
              size="sm"
              data-action="disk-scan"
              :disabled="!!snapshot.disk?.scanning"
              @click="diskScan"
            >
              <RefreshCw :class="{ 'animate-spin': snapshot.disk?.scanning }" />{{
                text.ui.disk.rescan
              }}
            </Button>
          </template>
        </ToolBar>

        <ItemTable
          v-if="table"
          v-model:sort="sort"
          v-model:collapsed="collapsedGroups"
          :table="table"
          :rows="rows"
          :selected-key="selectedKey"
          :searching="!!query.trim()"
          :empty-text="emptyText"
          :busy-key="busyKey"
          :group="grouping"
          @select="select"
          @action="act"
          @clear-search="query = ''"
          @group-action="(_, root) => cleanupWorkspace(root)"
          @rename="renameWorkspace"
        />

        <footer
          class="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border bg-card px-4 py-3"
        >
          <span class="flex items-center gap-2 text-xs text-muted-foreground">
            {{ text.ui.footer.count(text.ui.tabs[tab], rows.length) }}
            <Button
              v-if="tab === 'ports' && hiddenCount > 0"
              variant="ghost"
              size="sm"
              class="h-6 px-2 text-xs"
              data-action="toggle-hidden"
              @click="showHidden = !showHidden"
            >
              {{ showHidden ? text.ui.group.hiddenBack : text.ui.group.hiddenToggle(hiddenCount) }}
            </Button>
          </span>
          <span class="text-xs text-muted-foreground tabular-nums">{{
            text.ui.footer.takenAt(takenAt)
          }}</span>
        </footer>
      </template>
    </main>

    <ItemSheet
      v-model:open="sheetOpen"
      :item="selected"
      :now="snapshot?.takenAt ?? 0"
      :memory-history="sheetHistory"
      :window-ms="windowMs"
      :busy="busyKey != null && busyKey === selectedKey"
      :hook="snapshot?.hook ?? null"
      :platform="snapshot?.platform ?? null"
      :cpu-count="snapshot?.cpuCount ?? 1"
      @open="sheetAction('open')"
      @kill="sheetAction('kill')"
      @remove="sheetAction('remove')"
      @hide="hideSelected"
    />
    <MemorySheet
      v-if="snapshot"
      v-model:open="memoryOpen"
      :snapshot="snapshot"
      :ram-history="history.ram"
      :window-ms="windowMs"
      :refreshing="refreshing"
      @refresh="refresh"
      @go="goToTab"
    />
  </div>
</template>
