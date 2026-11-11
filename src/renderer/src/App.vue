<!--
  화면 뼈대는 NeoHtop (MIT) routes/+page.svelte 를 따른다:
  제목줄 → 자원 카드 줄 → 도구줄(탭·검색) → 표 → 바닥 줄, 항목을 누르면 오른쪽에서 상세 패널이 나온다.
  끄기·지우기는 모두 메인 프로세스가 묻는 확인 창을 거친다(화면에서 바로 끄지 않는다). 확인 창은 메인이 보낸 요청을
  맨 바깥의 ConfirmDialog 가 그리고 누른 버튼 번호만 돌려준다(그리지 못하면 메인이 OS 창으로 묻는다).
-->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { RefreshCw, Trash2, X } from '@lucide/vue'
import type {
  ConfirmRequest,
  DashboardSnapshot,
  KillResult,
  UpdateStatus
} from '../../shared/types'
import {
  DEFAULT_SETTINGS,
  REFRESH_INTERVALS,
  type Settings,
  type ThemeChoice,
  hiddenLabel,
  hiddenMatches
} from '../../shared/settings'
import {
  describeKillResult,
  formatBytes,
  formatFreed,
  formatTimeOfDay,
  pressureText
} from '../../shared/format'
import { cleanupRecommendation } from '../../shared/recommend'
import type { QuickKind } from '../../shared/ipc'
import type { PitEvent } from '../../shared/events'
import { text } from '../../shared/text'
import { watchColorScheme } from './theme'
import { toIpc } from './ipc'
import { readSorts, resolveSort, writeSorts, type SortState, type Sorts } from './sortState'
import {
  POINT_LIMIT,
  RAM_KEEP_MS,
  agentKey,
  appendSnapshot,
  emptyHistory,
  seedGroups,
  seedRam,
  selectionKey
} from './history'
import { awaySummary, awayText, eventsTable, trimEvents, type AwaySummary } from './events'
import {
  TABS,
  filterRows,
  groupServers,
  groupWorkspaces,
  hiddenServerTable,
  leftoverIcon,
  memoryShareDenominator,
  otherPortsTable,
  serverIcon,
  tableFor,
  withMemoryShares,
  type ActionKind,
  type GroupedRows,
  type MemoryShareBase,
  type Row,
  type TabKey
} from './rows'
import { readServerView, writeServerView, type ServerView } from './viewState'
import {
  DEFAULT_CARDS,
  EXTRA_CARDS,
  TOP_HEIGHTS,
  addCard,
  readCardLayout,
  readTopMode,
  snapTopMode,
  withScrollbar,
  writeCardLayout,
  writeTopMode,
  type CardId,
  type CardLayout,
  type TopMode
} from './layoutState'
import logo from '../../../resources/icon.png'
import TitleBar from './components/TitleBar.vue'
import StatsBar from './components/StatsBar.vue'
import TopSplitter from './components/TopSplitter.vue'
import ToolBar from './components/ToolBar.vue'
import ItemTable from './components/ItemTable.vue'
import ItemSheet, { type Selected } from './components/ItemSheet.vue'
import MemorySheet from './components/MemorySheet.vue'
import NoticeCard from './components/NoticeCard.vue'
import ItemIcon from './components/ItemIcon.vue'
import IntegrationButton from './components/IntegrationButton.vue'
import SettingsView from './components/SettingsView.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import Button from './ui/Button.vue'

const snapshot = ref<DashboardSnapshot | null>(null)
const history = ref(emptyHistory())
/** 기록(G3g): 메인이 기억한 일어난 일(오래된 것부터). */
const events = ref<PitEvent[]>([])
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
/** 처음 켰을 때는 작업 공간 탭(G4). */
const tab = ref<TabKey>('workspaces')
const query = ref('')
const intervals = computed(() => REFRESH_INTERVALS[settings.value.refresh])
/** 추이 그래프 가로축: 창이 열려 있을 때 기록 한도만큼(보통 5초 × 120 = 10분). */
const windowMs = computed(() => intervals.value.openMs * POINT_LIMIT)
/**
 * 메모리 상세의 추이 가로축: 쌓인 RAM 기록만큼(작은 그래프 길이 ~ 앱이 기억하는 2시간). 막 켰을 때 2시간 축의
 * 오른쪽 끝에만 점이 있어 빈 그래프처럼 보이지 않게.
 */
const memoryWindowMs = computed(() => {
  const ram = history.value.ram
  const span = ram.length ? ram[ram.length - 1].t - ram[0].t : 0
  return Math.min(RAM_KEEP_MS, Math.max(windowMs.value, span))
})
/** 기록 사이가 이보다 벌어지면 그래프를 잇지 않는다: 창을 닫아 둔 동안의 수집 간격(의 3배)보다 길면 앱이 꺼져 있던 것. */
const gapMs = computed(() => Math.max(60_000, 3 * intervals.value.closedMs))
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
let unsubscribeEvents: () => void = () => {}
let unsubscribeConfirm: () => void = () => {}
let unsubscribeWithdraw: () => void = () => {}
let stopTheme: () => void = () => {}

// ── 확인 창: 메인이 묻고(끄기·지우기·연동 바꾸기) 화면은 그려서 누른 버튼 번호만 돌려준다 ──
/** 지금 그리는 요청(한 번에 하나 — 메인이 차례로 보낸다). */
const confirmRequest = ref<ConfirmRequest | null>(null)
/** 그렸다고 알린 요청 id(같은 요청이 다시 오면 그렸다고 다시 알린다). */
let confirmDrawn: number | null = null
/** 답한 요청 가운데 가장 큰 id(늦게 다시 온 요청을 또 띄우지 않는다). */
let confirmAnswered = 0

/**
 * 메인이 보낸 요청(이벤트·pending). 같은 요청은 한 번만 띄우고, 더 새 요청(id 가 큼)이 오면 그것으로 바꾼다
 * (메인은 앞의 요청이 끝나야 다음을 보내므로, 새 요청이 왔다면 앞의 것은 메인에서 이미 끝났다).
 */
function receiveConfirm(request: ConfirmRequest): void {
  const current = confirmRequest.value
  if (request.id <= confirmAnswered || (current && request.id < current.id)) return
  if (current?.id === request.id) {
    if (confirmDrawn === request.id) window.pitwall.confirm.shown(request.id)
    return
  }
  confirmRequest.value = request
}

function confirmShown(): void {
  const request = confirmRequest.value
  if (!request) return
  confirmDrawn = request.id
  window.pitwall.confirm.shown(request.id)
}

/**
 * 메인이 그 요청을 거뒀다(OS 창으로 넘김·창을 닫아 취소): 답하지 않고 닫는다(초점은 열기 전으로). 늦게 다시 와도
 * 띄우지 않게 답한 것으로 센다(id 는 늘어만 가므로 아직 받지 못한 요청이어도 그렇다).
 */
function withdrawConfirm(id: number): void {
  confirmAnswered = Math.max(confirmAnswered, id)
  if (confirmRequest.value?.id !== id) return
  confirmRequest.value = null
  confirmDrawn = null
}

function answerConfirm(index: number): void {
  const request = confirmRequest.value
  if (!request) return
  confirmAnswered = Math.max(confirmAnswered, request.id)
  confirmRequest.value = null
  confirmDrawn = null
  window.pitwall.confirm.reply(request.id, index)
}

function shortcut(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && event.key === ',') {
    event.preventDefault()
    openSettings('general')
  }
}

/** 기록을 합친다(같은 id 는 한 번만, 오래된 것부터). */
function addEvents(added: PitEvent[]): void {
  const have = new Set(events.value.map((e) => e.id))
  const fresh = added.filter((e) => !have.has(e.id))
  if (fresh.length)
    events.value = trimEvents([...events.value, ...fresh].sort((a, b) => a.id - b.id))
}

// ── 자리 비운 사이(G3g) ──
/** 창을 이만큼 안 보다가 다시 보면 그 사이 일을 요약해 준다. */
const AWAY_MS = 10 * 60_000
let hiddenAt: number | null = null
/** 창을 숨긴 적이 있는지. 없으면(트레이로만 시작한 뒤 처음 연 창) 앱이 시작된 때(appStartedAt)부터 센다. */
let everHidden = false
let appStartedAt: number | null = null
const away = ref<AwaySummary | null>(null)
function showAway(since: number | null): void {
  const now = Date.now()
  if (since == null || now - since < AWAY_MS) return
  away.value = awaySummary(events.value, history.value.ram, since, now)
}
function onVisibility(): void {
  if (document.visibilityState === 'hidden') {
    hiddenAt = Date.now()
    everHidden = true
    away.value = null
    return
  }
  const since = hiddenAt ?? (everHidden ? null : appStartedAt)
  hiddenAt = null
  showAway(since)
}
function showEvents(): void {
  away.value = null
  goToTab('events')
}

onMounted(async () => {
  // 확인 요청을 먼저 받는다: 구독한 뒤 그 사이(창이 뜨는 동안) 보낸 요청도 pending 으로 받아 간다.
  unsubscribeConfirm = window.pitwall.confirm.onRequest(receiveConfirm)
  // 예전 preload(거두기가 없음)여도 화면은 뜬다.
  unsubscribeWithdraw = window.pitwall.confirm.onWithdraw?.(withdrawConfirm) ?? (() => {})
  void window.pitwall.confirm
    .pending()
    .then((requests) => requests.forEach(receiveConfirm))
    .catch(() => {})
  stopTheme = watchColorScheme((q) => window.matchMedia(q), document.documentElement)
  window.addEventListener('keydown', shortcut)
  unsubscribe = window.pitwall.onSnapshot(receive)
  document.addEventListener('visibilitychange', onVisibility)
  unsubscribeEvents = window.pitwall.events.onAdded(addEvents)
  const eventsLoaded = window.pitwall.events
    .get()
    .then(addEvents)
    .catch(() => {})
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
  const info = window.pitwall.appInfo().then((i) => {
    version.value = i.version
    appStartedAt = i.startedAt
  })
  unsubscribeUpdate = window.pitwall.update.onChange((s) => (update.value = s))
  void window.pitwall.update.get().then((s) => (update.value = s))
  // 앱이 기억한 RAM 추이로 그래프를 채운다(창을 다시 열거나 앱을 다시 켜도 이어짐).
  const ramLoaded = window.pitwall
    .historyRam()
    .then((points) => (history.value = seedRam(history.value, points)))
    .catch(() => {})
  // 묶음별 추이도 같은 방식으로(G6). 이 IPC 가 없는 예전 메인이나 실패여도 화면은 그대로 뜬다.
  void window.pitwall
    .historyGroups?.()
    .then((points) => (history.value = seedGroups(history.value, points)))
    .catch(() => {})
  // 트레이로만 시작한 뒤 처음 연 창은 숨긴 적이 없어도 앱이 시작된 때부터의 일을 요약한다(기록·RAM 추이를 받은 뒤).
  void Promise.all([info, eventsLoaded, ramLoaded])
    .then(() => {
      if (!everHidden && document.visibilityState === 'visible') showAway(appStartedAt)
    })
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
  unsubscribeEvents()
  unsubscribeConfirm()
  unsubscribeWithdraw()
  document.removeEventListener('visibilitychange', onVisibility)
  stopTheme()
  window.removeEventListener('keydown', shortcut)
})

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
  const heavy = s.heavyJobs.find((r) => selectionKey.heavy(r) === key)
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
/** 다른 곳(알림·트레이·추천 칩·자원 카드·기록 탭)에서 온 이동: 그 항목의 탭으로 옮기고 상세를 연다. */
function select(key: string): void {
  const kind = key.split(':', 1)[0]
  if (TAB_OF[kind] && tab.value !== TAB_OF[kind]) {
    tab.value = TAB_OF[kind]
    query.value = ''
  }
  selectedKey.value = key
}

/** 표에서 고른 항목: 작업 공간 탭에서는 탭을 그대로 두고 상세 패널만 연다. */
function pick(key: string): void {
  if (tab.value === 'workspaces') selectedKey.value = key
  else select(key)
}

/** 메모리 지도에서 고른 줄(G6): 메모리 상세를 닫고 그 줄의 탭·상세 패널로. */
function selectFromMap(key: string): void {
  memoryOpen.value = false
  select(key)
}

/** 메모리 상세의 묶음에서 그 탭으로(숨긴 서버·다른 포트 보기와 검색은 풀어 묶음 전체가 보이게). */
function goToTab(next: TabKey): void {
  memoryOpen.value = false
  page.value = 'dashboard'
  selectedKey.value = null
  showHidden.value = false
  showOther.value = false
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

async function act(kind: ActionKind, key: string, port?: number): Promise<void> {
  const s = snapshot.value
  if (!s) return
  if (kind === 'details') {
    pick(key)
    return
  }
  const server = s.servers.find((r) => selectionKey.server(r) === key)
  const leftover = s.leftovers.find((r) => selectionKey.leftover(r) === key)
  const disk = s.disk?.rows.find((r) => selectionKey.disk(r.worktreeRoot) === key)
  if (kind === 'open' && server) {
    try {
      // 고른 포트(상세 패널), 아니면 서버가 연 포트 가운데 첫 포트(보통 화면을 내주는 포트)를 연다.
      const target = port != null && server.ports.includes(port) ? port : server.ports[0]
      if (!(await window.pitwall.openPort(target)))
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
    await runAction(key, async () => diskNotice(await window.pitwall.diskRemove(disk.worktreeRoot)))
  }
}

/** 디스크 정리 결과 알림: 지울 것이 없어졌으면 프로세스 문구 대신 디스크 정리 문구로. */
function diskNotice(result: KillResult): Notice | null {
  if (result.status === 'gone') return { text: text.ui.disk.gone, tone: 'error' }
  return resultNotice(result)
}

function sheetAction(kind: ActionKind, port?: number): void {
  if (selectedKey.value) void act(kind, selectedKey.value, port)
}

/**
 * 바로 가기(경로 복사·폴더 열기·터미널 열기). 메인은 지금 스냅샷에 있는 폴더만 다룬다.
 * 폴더·터미널은 열리는 것으로 충분하고, 복사는 눈에 보이지 않아 한 줄로 알린다.
 */
async function quick(kind: QuickKind, path: string): Promise<void> {
  say('action', null)
  try {
    if (!(await window.pitwall.quick(kind, path)))
      say('action', { text: text.ui.quick.failed, tone: 'error' })
    else if (kind === 'copy') say('action', { text: text.ui.quick.copied, tone: 'success' })
  } catch (e) {
    say('action', { text: failureText(e), tone: 'error' })
  }
}

/** 창으로 가기(G3f): 그 에이전트가 떠 있는 터미널·에디터 창을 앞으로. 창이 앞으로 오는 것으로 충분하고, 못 하면 알린다. */
async function focusAgent(key: string): Promise<void> {
  say('action', null)
  try {
    if (!(await window.pitwall.focusAgent(key)))
      say('action', { text: text.ui.quick.focusFailed, tone: 'error' })
  } catch (e) {
    say('action', { text: failureText(e), tone: 'error' })
  }
}

// ── 묶음 보기·숨기기·별칭(F1·F2·F11) ──
/** 설정을 바꾸고 바로 다시 수집해 화면에 반영한다(숨김·별칭은 수집기가 적용). */
async function updateSettings(change: (s: Settings) => Settings): Promise<void> {
  await saveSettings(change(settings.value))
  await window.pitwall.refreshNow()
}

/**
 * 상세 패널의 숨기기: 그 워크트리의 첫 포트로 숨긴다(다른 프로젝트가 같은 포트를 열면 그대로 보인다).
 * 워크트리를 모르는 서버(판별 불가)는 포트로.
 */
async function hideSelected(): Promise<void> {
  const item = selected.value
  if (item?.kind !== 'server') return
  const port = item.row.ports[0]
  const entry = item.row.worktree ? `${item.row.worktree.root}:${port}` : `:${port}`
  const key = selectedKey.value!
  selectedKey.value = null
  await runAction(key, async () => {
    await updateSettings((s) => ({
      ...s,
      hiddenServers: s.hiddenServers.includes(entry) ? s.hiddenServers : [...s.hiddenServers, entry]
    }))
    return { text: text.ui.group.hiddenDone(hiddenLabel(entry)), tone: 'success' }
  })
}

/** 숨김 풀기: 그 서버를 숨기게 한 항목(포트·프로세스 이름·워크트리의 포트)을 모두 뺀다. */
async function unhide(row: DashboardSnapshot['servers'][number]): Promise<Notice | null> {
  await updateSettings((s) => ({
    ...s,
    hiddenServers: s.hiddenServers.filter((h) => !hiddenMatches(h, row))
  }))
  return null
}

async function cleanupWorkspace(root: string): Promise<void> {
  await runAction(`group:${root}`, async () =>
    resultNotice(await window.pitwall.cleanupWorkspace(root))
  )
}

/** 묶음 머리 동작: 작업 공간 정리, 폴더 열기(작업 공간 탭). */
function groupAction(kind: 'cleanup' | 'folder', root: string): void {
  if (kind === 'folder') void quick('folder', root)
  else void cleanupWorkspace(root)
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

/** 모두 정리가 지울 줄: 검색과 상관없이 사용 중이 아닌 줄 전부. 크기는 마지막으로 찾은 때의 값. */
const diskCleanable = computed(() => (snapshot.value?.disk?.rows ?? []).filter((r) => !r.inUse))
const diskCleanableBytes = computed(() =>
  diskCleanable.value.reduce((sum, r) => sum + (r.totalBytes ?? 0), 0)
)
const diskRemovingAll = ref(false)
async function diskRemoveAll(): Promise<void> {
  diskRemovingAll.value = true
  say('action', null)
  try {
    say('action', diskNotice(await window.pitwall.diskRemoveAll()))
  } catch (e) {
    say('action', { text: failureText(e), tone: 'error' })
  } finally {
    diskRemovingAll.value = false
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
/** 개발 서버 탭에서 다른 포트(개발 서버가 아닌 LISTEN 포트, G5c)를 보는 중. 숨긴 서버 보기와 하나만 켜진다. */
const showOther = ref(false)
const otherCount = computed(() => snapshot.value?.otherPorts.length ?? 0)
watch(otherCount, (n) => {
  if (n === 0) showOther.value = false
})
const otherView = computed(() => tab.value === 'ports' && showOther.value)
function toggleHidden(): void {
  showHidden.value = !showHidden.value
  if (showHidden.value) showOther.value = false
}
function toggleOther(): void {
  showOther.value = !showOther.value
  if (showOther.value) showHidden.value = false
}
// 탭을 바꾸면 개발 서버 탭은 다시 개발 서버 목록부터.
watch(tab, () => {
  showHidden.value = false
  showOther.value = false
})
/**
 * 메모리 막대의 기준(G5): 작업 공간 탭은 사용 중인 RAM(구성원끼리 더하면 같은 프로세스를 두 번 셀 수 있다),
 * 다른 포트 보기는 없음(한 프로세스가 여러 줄에 나온다), 나머지(숨긴 서버 보기 포함)는 그 표 줄들의 합.
 */
const memoryBase = computed<MemoryShareBase>(() => {
  if (otherView.value) return { kind: 'none' }
  if (tab.value === 'workspaces')
    return { kind: 'used', bytes: snapshot.value?.memory.usedBytes ?? 0 }
  return { kind: 'rows' }
})
/** 지금 보는 표. 메모리 막대는 검색으로 거르기 전 표에 채운다(검색해도 막대 길이가 그대로). */
const table = computed(() => {
  const s = snapshot.value
  if (!s) return null
  const view =
    tab.value === 'events'
      ? eventsTable(events.value, s)
      : otherView.value
        ? otherPortsTable(s)
        : tab.value === 'ports' && showHidden.value
          ? hiddenServerTable(s)
          : tableFor(tab.value, s)
  return withMemoryShares(view, memoryBase.value, s.memory.totalBytes)
})
/** 묶음 머리 막대의 분모: 표와 같은 기준·같은 검색 전 표(막대는 숫자·정렬 값을 바꾸지 않아 같은 값이다). */
const memoryTotal = computed(() =>
  table.value ? memoryShareDenominator(table.value, memoryBase.value) : null
)
const rows = computed(() => (table.value ? filterRows(table.value.rows, query.value) : []))
/** 검색어가 포트 번호면 그 번호(앞의 `:` 는 떼고), 아니면 null. */
const queryPort = computed(() => {
  const q = query.value.trim().replace(/^:/, '')
  return /^\d+$/.test(q) ? Number(q) : null
})
/** 찾는 포트가 개발 서버에 없고 다른 포트에 있으면 빈 화면에서 다른 포트 보기를 권한다(G5c). */
const suggestOther = computed(
  () =>
    tab.value === 'ports' &&
    !showHidden.value &&
    !showOther.value &&
    rows.value.length === 0 &&
    queryPort.value != null &&
    !!snapshot.value?.otherPorts.some((p) => p.port === queryPort.value)
)
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
/** 카드 영역 단계(G2): 자세히·간단히·접기. 다시 켜도 기억한다. */
const topMode = ref<TopMode>(readTopMode(storage))
watch(topMode, (m) => writeTopMode(storage, m))
/** 손잡이를 끄는 동안의 카드 영역 높이(px). 끌지 않을 때는 null(카드 영역은 제 높이). */
const topDrag = ref<number | null>(null)
/** 카드 줄의 가로 스크롤바 높이(px). 카드가 한 줄에 다 들어가면 0(StatsBar 가 잰다). */
const cardScrollbar = ref(0)
/** 끄는 높이·붙는 높이: 단계 높이(TOP_HEIGHTS)에 카드 줄의 스크롤바만큼 더한 실제 카드 영역 높이. */
const topHeights = computed(() => withScrollbar(TOP_HEIGHTS, cardScrollbar.value))
const showCards = computed(() =>
  topDrag.value != null ? topDrag.value > 0 : topMode.value !== 'collapsed'
)
/** 끄는 동안은 놓으면 붙을 단계의 모양으로 미리 보인다(자세히가 아니면 간단히 카드를 잘라 보인다). */
const compactCards = computed(() =>
  topDrag.value != null
    ? snapTopMode(topDrag.value, topHeights.value) !== 'full'
    : topMode.value === 'compact'
)
/** 카드 배치(G3): 순서·숨김·더한 새 카드. 다시 켜도 기억한다. */
const cardLayout = ref<CardLayout>(readCardLayout(storage))
watch(cardLayout, (l) => writeCardLayout(storage, l))
/** 카드 편집 중. 편집 막대(더할 카드·기본값으로·완료)는 손잡이 줄에 있다. */
const editingCards = ref(false)
/** 편집 막대의 칩: 카드 줄에 아직 없는 새 카드. */
const addableCards = computed(() =>
  EXTRA_CARDS.filter((id) => !cardLayout.value.order.includes(id))
)
/** 카드 편집 시작·끝. 접혀 있으면 카드가 보이게 자세히로. */
function toggleCardEdit(): void {
  editingCards.value = !editingCards.value
  if (editingCards.value && topMode.value === 'collapsed') topMode.value = 'full'
}
// 편집 중에 접으면(손잡이 더블클릭·끌기) 편집할 카드가 없으니 편집도 끝낸다.
watch(topMode, (m) => {
  if (m === 'collapsed') editingCards.value = false
})
function addCardToRow(id: CardId): void {
  cardLayout.value = addCard(cardLayout.value, id)
}
function resetCards(): void {
  cardLayout.value = { order: [...DEFAULT_CARDS], hidden: [] }
}
/** 접은 작업 공간 묶음. 갱신해도 유지한다(앱을 다시 켜면 모두 펼침). */
const collapsedGroups = ref<string[]>([])
const grouping = computed<((rows: Row[]) => GroupedRows[]) | null>(() => {
  const s = snapshot.value
  if (!s) return null
  // 머리 막대는 걸러진 줄이 아니라 검색 전 표와 같은 분모로.
  const total = memoryTotal.value
  // 작업 공간 탭은 늘 묶음(작업 공간 하나에 머리 하나).
  if (tab.value === 'workspaces') return (rows) => groupWorkspaces(rows, s, s.takenAt, total)
  // 숨긴 서버·다른 포트는 묶음 보기여도 평평한 표.
  if (tab.value !== 'ports' || showHidden.value || showOther.value || serverView.value !== 'group')
    return null
  return (rows) => groupServers(rows, s.servers, s.agents, s.takenAt, s.leftovers, total)
})
/**
 * 검색에 맞는 수(도구줄의 "n개 중 m개"·바닥 줄). 작업 공간 탭은 탭 숫자처럼 작업 공간으로 센다
 * (맞는 구성원이 있는 작업 공간).
 */
const shown = computed(() =>
  tab.value === 'workspaces' && grouping.value
    ? grouping.value(rows.value).length
    : rows.value.length
)
/**
 * 도구줄 "n개 중 m개"의 전체 수: 다른 포트·숨긴 서버 보기는 그 표의 수(탭 숫자는 그대로 개발 서버 수),
 * 다른 화면은 탭의 수(작업 공간 탭은 작업 공간 수).
 */
const searchTotal = computed(() => {
  if (otherView.value) return otherCount.value
  if (tab.value === 'ports' && showHidden.value) return hiddenCount.value
  return undefined
})
const NO_SORT: SortState = { id: 'name', dir: 'asc' }
/** 다른 포트 보기의 정렬. 칸이 달라 개발 서버 정렬과 따로 두고 저장하지 않는다(처음은 포트 순). */
const otherSort = ref<SortState | undefined>(undefined)
const sort = computed<SortState>({
  get: () =>
    table.value
      ? resolveSort(otherView.value ? otherSort.value : sorts.value[tab.value], table.value)
      : NO_SORT,
  set: (next) => {
    if (otherView.value) {
      otherSort.value = next
      return
    }
    sorts.value = { ...sorts.value, [tab.value]: next }
    writeSorts(storage, sorts.value)
  }
})
const counts = computed<Record<TabKey, number>>(() => {
  const s = snapshot.value
  const zero = Object.fromEntries(TABS.map((t) => [t, 0])) as Record<TabKey, number>
  zero.events = events.value.length
  if (!s) return zero
  return {
    workspaces: s.workspaces.length,
    ports: s.servers.length,
    agents: s.agents.length,
    leftovers: s.leftovers.length,
    heavy: s.heavyJobs.length,
    disk: s.disk?.rows.length ?? 0,
    apps: s.apps.length,
    events: events.value.length
  }
})
const emptyText = computed(() => {
  const L = text.ui.list
  switch (tab.value) {
    case 'workspaces':
      return L.emptyWorkspaces
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
    case 'events':
      return L.emptyEvents
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

// ── 알림 카드 ──
const recommendation = computed(() =>
  snapshot.value
    ? cleanupRecommendation(snapshot.value)
    : { items: [], totalBytes: 0, totalCommitBytes: null }
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

const takenAt = computed(() => (snapshot.value ? formatTimeOfDay(snapshot.value.takenAt) : ''))
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
      :data-top-mode="topMode"
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
        <!-- 카드 영역: 끄는 동안만 그 높이로 자르고, 아니면 고른 단계의 제 높이. 접기면 카드가 없다. -->
        <div
          v-if="showCards"
          class="min-w-0 shrink-0"
          :class="{ 'overflow-hidden': topDrag != null }"
          :style="topDrag != null ? { height: `${topDrag}px` } : undefined"
        >
          <StatsBar
            v-model:layout="cardLayout"
            :snapshot="snapshot"
            :ram-history="history.ram"
            :window-ms="windowMs"
            :gap-ms="gapMs"
            :compact="compactCards"
            :editing="editingCards"
            :events="events"
            @memory="memoryOpen = true"
            @tab="(key) => ((tab = key), (query = ''))"
            @disk-scan="diskScan"
            @select="select"
            @scrollbar="(px) => (cardScrollbar = px)"
          />
        </div>
        <TopSplitter
          v-model:mode="topMode"
          :heights="topHeights"
          :editing="editingCards"
          :addable="addableCards"
          @drag="(h) => (topDrag = h)"
          @edit="toggleCardEdit"
          @add="addCardToRow"
          @reset="resetCards"
        />

        <NoticeCard
          v-if="away"
          data-away
          dismissible
          :title="text.ui.away.title"
          @dismiss="away = null"
        >
          {{ awayText(away) }}
          <template #actions>
            <Button variant="outline" size="sm" @click="showEvents">
              {{ text.ui.away.show }}
            </Button>
          </template>
        </NoticeCard>

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
              formatFreed(recommendation.totalBytes, recommendation.totalCommitBytes)
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
                <span class="tabular-nums">{{
                  item.commitBytes == null
                    ? formatBytes(item.memoryBytes)
                    : text.ui.home.chipSize(
                        formatBytes(item.memoryBytes),
                        formatBytes(item.commitBytes)
                      )
                }}</span>
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
          {{ text.ui.home.heavyOverlap(pressureText(snapshot.memory), snapshot.heavyJobs.length) }}
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
          :matching="shown"
          :total="searchTotal"
        >
          <template #actions>
            <IntegrationButton
              v-if="tab === 'agents'"
              :claude="snapshot.hook ?? null"
              :codex="snapshot.codexHook ?? null"
              @open="openSettings('claude')"
            />
            <Button
              v-if="tab === 'disk'"
              variant="outline"
              size="sm"
              data-action="disk-remove-all"
              :disabled="!diskCleanable.length || !!snapshot.disk?.scanning || diskRemovingAll"
              @click="diskRemoveAll"
            >
              <Trash2 />{{
                text.ui.disk.removeAll(
                  diskCleanableBytes > 0 ? formatBytes(diskCleanableBytes) : null
                )
              }}
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
          @select="pick"
          @action="act"
          @clear-search="query = ''"
          @group-action="groupAction"
          @rename="renameWorkspace"
        >
          <template #empty-actions>
            <Button
              v-if="suggestOther"
              variant="link"
              size="sm"
              data-action="find-other"
              @click="toggleOther"
            >
              {{ text.ui.group.findOther }}
            </Button>
          </template>
        </ItemTable>

        <footer
          class="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border bg-card px-4 py-3"
        >
          <span class="flex items-center gap-2 text-xs text-muted-foreground">
            {{
              text.ui.footer.count(otherView ? text.ui.group.otherPorts : text.ui.tabs[tab], shown)
            }}
            <Button
              v-if="tab === 'ports' && hiddenCount > 0"
              variant="ghost"
              size="sm"
              class="h-6 px-2 text-xs"
              data-action="toggle-hidden"
              @click="toggleHidden"
            >
              {{ showHidden ? text.ui.group.hiddenBack : text.ui.group.hiddenToggle(hiddenCount) }}
            </Button>
            <Button
              v-if="tab === 'ports' && otherCount > 0"
              variant="ghost"
              size="sm"
              class="h-6 px-2 text-xs"
              data-action="toggle-other"
              @click="toggleOther"
            >
              {{ showOther ? text.ui.group.otherBack : text.ui.group.otherToggle(otherCount) }}
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
      :gap-ms="gapMs"
      :busy="busyKey != null && busyKey === selectedKey"
      :hook="snapshot?.hook ?? null"
      :platform="snapshot?.platform ?? null"
      :collect-mode="snapshot?.collectMode ?? null"
      :cpu-count="snapshot?.cpuCount ?? 1"
      :codex-limits="snapshot?.codexLimits ?? null"
      @open="(port) => sheetAction('open', port)"
      @kill="sheetAction('kill')"
      @remove="sheetAction('remove')"
      @hide="hideSelected"
      @quick="quick"
      @focus="focusAgent"
    />
    <MemorySheet
      v-if="snapshot"
      v-model:open="memoryOpen"
      :snapshot="snapshot"
      :ram-history="history.ram"
      :group-history="history.groups"
      :window-ms="memoryWindowMs"
      :gap-ms="gapMs"
      :refreshing="refreshing"
      @refresh="refresh"
      @go="goToTab"
      @select="selectFromMap"
    />
    <!-- 확인 창은 맨 바깥(대시보드·설정·상세 패널 어디서든 위에 보인다). -->
    <ConfirmDialog
      v-if="confirmRequest"
      :key="confirmRequest.id"
      :request="confirmRequest"
      @shown="confirmShown"
      @answer="answerConfirm"
    />
  </div>
</template>
