<!--
  화면 뼈대는 Uptime Kuma (MIT) src/layouts/Layout.vue(헤더: 로고·제목 + 오른쪽 알약 메뉴)와
  src/pages/Dashboard.vue(왼쪽 목록 col-md-5/col-xl-4 + 오른쪽 내용 col-md-7/col-xl-8)를 따른다.
-->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import {
  faFlagCheckered,
  faGaugeHigh,
  faGear,
  faRotateRight
} from '@fortawesome/free-solid-svg-icons'
import type { DashboardSnapshot, KillResult, UpdateStatus } from '../../shared/types'
import { DEFAULT_SETTINGS, REFRESH_INTERVALS, type Settings } from '../../shared/settings'
import { describeKillResult } from '../../shared/format'
import { text } from '../../shared/text'
import { watchColorScheme } from './theme'
import { agentKey, appendSnapshot, emptyHistory, portKey, selectionKey } from './history'
import StatusBadge from './components/StatusBadge.vue'
import PortList from './components/PortList.vue'
import HomeView from './components/HomeView.vue'
import PortDetail from './components/PortDetail.vue'
import AgentDetail from './components/AgentDetail.vue'
import LeftoverDetail from './components/LeftoverDetail.vue'
import DiskDetail from './components/DiskDetail.vue'
import SettingsView from './components/SettingsView.vue'

const snapshot = ref<DashboardSnapshot | null>(null)
const history = ref(emptyHistory())
const selectedKey = ref<string | null>(null)
const busyPid = ref<number | null>(null)
const notice = ref<string | null>(null)
const refreshing = ref(false)
const actionError = ref<string | null>(null)
const hookBusy = ref(false)
const hookNotice = ref<{ text: string; failed: boolean } | null>(null)
const diskBusy = ref<string | null>(null)
const diskNotice = ref<string | null>(null)
const recommendBusy = ref(false)
const recommendNotice = ref<string | null>(null)
const settings = ref<Settings>(DEFAULT_SETTINGS)
const page = ref<'dashboard' | 'settings'>('dashboard')
const version = ref<string | null>(null)
const update = ref<UpdateStatus | null>(null)
const intervals = computed(() => REFRESH_INTERVALS[settings.value.refresh])

function receive(s: DashboardSnapshot): void {
  snapshot.value = s
  history.value = appendSnapshot(history.value, s)
}

let unsubscribe: () => void = () => {}
let unsubscribeSettings: () => void = () => {}
let unsubscribeNavigate: () => void = () => {}
let unsubscribeUpdate: () => void = () => {}
let stopTheme: () => void = () => {}

onMounted(async () => {
  stopTheme = watchColorScheme((q) => window.matchMedia(q), document.body)
  unsubscribe = window.pitwall.onSnapshot(receive)
  unsubscribeSettings = window.pitwall.settings.onChange((s) => (settings.value = s))
  // 알림·트레이에서 온 이동 요청: 그 항목을 고르거나(없으면 한눈에 보기) 다른 화면으로.
  unsubscribeNavigate = window.pitwall.onNavigate((target) => {
    if (target.page === 'settings') {
      page.value = 'settings'
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
})

const selectedPort = computed(
  () => snapshot.value?.ports.find((row) => selectionKey.port(row) === selectedKey.value) ?? null
)
const selectedAgent = computed(
  () => snapshot.value?.agents.find((row) => selectionKey.agent(row) === selectedKey.value) ?? null
)
const selectedLeftover = computed(
  () =>
    snapshot.value?.leftovers.find((row) => selectionKey.leftover(row) === selectedKey.value) ??
    null
)
const selectedDisk = computed(
  () =>
    snapshot.value?.disk?.rows.find(
      (row) => selectionKey.disk(row.worktreeRoot) === selectedKey.value
    ) ?? null
)
const hasSelection = computed(
  () =>
    !!(selectedPort.value || selectedAgent.value || selectedLeftover.value || selectedDisk.value)
)

// 고른 항목이 사라지면(서버 종료·세션 끝 등) 한눈에 보기로 돌아간다.
watch(hasSelection, (has) => {
  if (!has && selectedKey.value) {
    selectedKey.value = null
    notice.value = null
  }
})

function goHome(): void {
  page.value = 'dashboard'
  selectedKey.value = null
  notice.value = null
}

async function saveSettings(next: Settings): Promise<Settings> {
  const saved = await window.pitwall.settings.save(next)
  settings.value = saved
  return saved
}

const pickFolder = (): Promise<string | null> => window.pitwall.settings.pickFolder()
const checkUpdate = (): void => void window.pitwall.update.check()
const installUpdate = (): void => void window.pitwall.update.install()

function select(key: string): void {
  if (key !== selectedKey.value) notice.value = null
  selectedKey.value = key
}

function failureText(e: unknown): string {
  return text.actionError(e instanceof Error ? e.message : String(e))
}

async function refresh(): Promise<void> {
  refreshing.value = true
  actionError.value = null
  try {
    await window.pitwall.refreshNow()
  } catch (e) {
    actionError.value = failureText(e)
  } finally {
    refreshing.value = false
  }
}

async function openSelected(): Promise<void> {
  const row = selectedPort.value
  if (!row) return
  try {
    if (!(await window.pitwall.openPort(row.port))) notice.value = text.openFailed
  } catch (e) {
    notice.value = failureText(e)
  }
}

async function runKill(pid: number, kill: () => Promise<KillResult>): Promise<void> {
  busyPid.value = pid
  notice.value = null
  try {
    notice.value = describeKillResult(await kill())
  } catch (e) {
    notice.value = failureText(e)
  } finally {
    busyPid.value = null
  }
}

async function killSelectedPort(): Promise<void> {
  const row = selectedPort.value
  if (row) await runKill(row.pid, () => window.pitwall.killPort(row.port, row.pid))
}

async function killSelectedLeftover(): Promise<void> {
  const row = selectedLeftover.value
  if (row) await runKill(row.pid, () => window.pitwall.killLeftover(row.pid))
}

/** 지우고 나면 그 행이 목록에서 사라져 한눈에 보기로 돌아가므로, 성공 문구는 화면 위에 남긴다. */
async function removeSelectedDisk(): Promise<void> {
  const row = selectedDisk.value
  if (!row) return
  diskBusy.value = row.worktreeRoot
  notice.value = null
  diskNotice.value = null
  try {
    const result = await window.pitwall.diskRemove(row.worktreeRoot)
    if (result.status === 'killed') diskNotice.value = result.message ?? null
    else if (result.status === 'gone') notice.value = text.ui.disk.gone
    else notice.value = describeKillResult(result)
  } catch (e) {
    notice.value = failureText(e)
  } finally {
    diskBusy.value = null
  }
}

async function diskScan(): Promise<void> {
  actionError.value = null
  try {
    await window.pitwall.diskScan()
  } catch (e) {
    actionError.value = failureText(e)
  }
}

async function killMany(keys: string[]): Promise<void> {
  recommendBusy.value = true
  recommendNotice.value = null
  try {
    recommendNotice.value = describeKillResult(await window.pitwall.killMany(keys))
  } catch (e) {
    recommendNotice.value = failureText(e)
  } finally {
    recommendBusy.value = false
  }
}

async function hookAction(action: 'enable' | 'disable'): Promise<void> {
  hookBusy.value = true
  hookNotice.value = null
  try {
    const result = await window.pitwall.claudeHook[action]()
    if (result.status !== 'cancelled')
      hookNotice.value = { text: result.message, failed: result.status === 'failed' }
  } catch (e) {
    hookNotice.value = { text: failureText(e), failed: true }
  } finally {
    hookBusy.value = false
  }
}
</script>

<template>
  <header class="app-header d-flex flex-wrap align-items-center py-3 mb-3 border-bottom">
    <a
      href="#"
      class="brand d-flex align-items-center me-auto text-decoration-none"
      @click.prevent="goHome"
    >
      <span class="logo me-2 ms-4"><FontAwesomeIcon :icon="faFlagCheckered" /></span>
      <span class="fs-4 title">{{ text.appName }}</span>
    </a>
    <StatusBadge v-if="snapshot?.stale" class="me-3" tone="warning" :text="text.ui.stale" />
    <ul class="nav nav-pills me-4">
      <li class="nav-item me-2">
        <a
          href="#"
          class="nav-link nav-dashboard"
          :class="{ active: page === 'dashboard' }"
          @click.prevent="goHome"
        >
          <FontAwesomeIcon :icon="faGaugeHigh" /> {{ text.ui.nav.dashboard }}
        </a>
      </li>
      <li class="nav-item">
        <a
          href="#"
          class="nav-link nav-settings"
          :class="{ active: page === 'settings' }"
          @click.prevent="page = 'settings'"
        >
          <FontAwesomeIcon :icon="faGear" /> {{ text.ui.nav.settings }}
        </a>
      </li>
    </ul>
  </header>

  <main class="container-fluid">
    <p v-if="snapshot?.error" class="text-danger small">{{ snapshot.error }}</p>
    <p v-if="actionError" class="action-error text-danger small">{{ actionError }}</p>
    <p
      v-if="hookNotice"
      class="hook-notice small"
      :class="hookNotice.failed ? 'text-danger' : 'text-success'"
    >
      {{ hookNotice.text }}
    </p>
    <p v-if="diskNotice" class="disk-notice small text-success">{{ diskNotice }}</p>
    <!-- 저장하지 않은 설정을 대시보드에 다녀와도 잃지 않게 화면을 치워 두었다가 그대로 되살린다. -->
    <KeepAlive>
      <SettingsView
        v-if="page === 'settings'"
        :settings="settings"
        :hook="snapshot?.hook ?? null"
        :hook-busy="hookBusy"
        :version="version"
        :save="saveSettings"
        :pick-folder="pickFolder"
        :update="update"
        @hook="hookAction"
        @update-check="checkUpdate"
        @update-install="installUpdate"
      />
    </KeepAlive>
    <p v-if="page === 'dashboard' && !snapshot" class="text-secondary">{{ text.ui.loading }}</p>
    <div v-else-if="page === 'dashboard' && snapshot" class="row">
      <div class="col-12 col-md-5 col-xl-4 ps-0">
        <div>
          <button
            type="button"
            class="btn btn-primary mb-3 btn-refresh"
            :disabled="refreshing"
            @click="refresh"
          >
            <FontAwesomeIcon :icon="faRotateRight" :spin="refreshing" /> {{ text.ui.refresh }}
          </button>
        </div>
        <PortList
          :ports="snapshot.ports"
          :agents="snapshot.agents"
          :leftovers="snapshot.leftovers"
          :history="history"
          :selected-key="selectedKey"
          :hook="snapshot.hook"
          :hook-busy="hookBusy"
          :disk="snapshot.disk"
          @select="select"
          @hook="hookAction"
          @disk-scan="diskScan"
        />
      </div>
      <div class="col-12 col-md-7 col-xl-8 mb-3 gx-0">
        <PortDetail
          v-if="selectedPort"
          :row="selectedPort"
          :history="history.ports[portKey(selectedPort)]"
          :busy="busyPid === selectedPort.pid"
          :notice="notice"
          :intervals="intervals"
          @open="openSelected"
          @kill="killSelectedPort"
        />
        <AgentDetail
          v-else-if="selectedAgent"
          :row="selectedAgent"
          :history="history.agents[agentKey(selectedAgent)]"
          :now="snapshot.takenAt"
          :hook="snapshot.hook"
          :platform="snapshot.platform"
          :cpu-count="snapshot.cpuCount"
          :intervals="intervals"
        />
        <LeftoverDetail
          v-else-if="selectedLeftover"
          :row="selectedLeftover"
          :busy="busyPid === selectedLeftover.pid"
          :notice="notice"
          :now="snapshot.takenAt"
          @kill="killSelectedLeftover"
        />
        <DiskDetail
          v-else-if="selectedDisk"
          :row="selectedDisk"
          :busy="diskBusy === selectedDisk.worktreeRoot"
          :notice="notice"
          @remove="removeSelectedDisk"
        />
        <HomeView
          v-else
          :snapshot="snapshot"
          :ram-history="history.ram"
          :hook-busy="hookBusy"
          :recommend-busy="recommendBusy"
          :recommend-notice="recommendNotice"
          @hook="hookAction"
          @select="select"
          @kill-many="killMany"
        />
      </div>
    </div>
  </main>
</template>

<style scoped lang="scss">
@import './styles/vars.scss';

/* Uptime Kuma Dashboard.vue */
.container-fluid {
  width: 98%;
}

/* Uptime Kuma Layout.vue 의 nav-link hover */
.nav-link {
  &:hover {
    background-color: $primary;
    color: #fff;

    .dark & {
      color: #000;
    }
  }

  &.active:hover {
    background-color: $highlight;
  }
}

.brand {
  color: inherit;
}

/* 로고 자리: Uptime Kuma 로고 대신 pitwall 아이콘(초록 원 + 체커기) */
.logo {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background-color: $primary;
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
}
</style>
