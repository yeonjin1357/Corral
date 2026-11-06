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
import type { DashboardSnapshot } from '../../shared/types'
import { DEFAULT_INTERVALS } from '../../shared/defaults'
import { describeKillResult } from '../../shared/format'
import { text } from '../../shared/text'
import { watchColorScheme } from './theme'
import { appendSnapshot, emptyHistory, portKey } from './history'
import StatusBadge from './components/StatusBadge.vue'
import PortList from './components/PortList.vue'
import HomeView from './components/HomeView.vue'
import PortDetail from './components/PortDetail.vue'

const snapshot = ref<DashboardSnapshot | null>(null)
const history = ref(emptyHistory())
const selectedKey = ref<string | null>(null)
const busyPid = ref<number | null>(null)
const notice = ref<string | null>(null)
const refreshing = ref(false)
const actionError = ref<string | null>(null)

function receive(s: DashboardSnapshot): void {
  snapshot.value = s
  history.value = appendSnapshot(history.value, s)
}

let unsubscribe: () => void = () => {}
let stopTheme: () => void = () => {}

onMounted(async () => {
  stopTheme = watchColorScheme((q) => window.matchMedia(q), document.body)
  unsubscribe = window.pitwall.onSnapshot(receive)
  const latest = await window.pitwall.getLatest()
  // 창이 늦게 열려 놓친 스냅샷만 채운다. 그 사이 받은 더 새 스냅샷은 덮어쓰지 않는다.
  if (!snapshot.value && latest) receive(latest)
})

onUnmounted(() => {
  unsubscribe()
  stopTheme()
})

const selectedRow = computed(
  () => snapshot.value?.ports.find((row) => portKey(row) === selectedKey.value) ?? null
)

// 고른 포트가 사라지면(서버 종료 등) 한눈에 보기로 돌아간다.
watch(selectedRow, (row) => {
  if (!row && selectedKey.value) {
    selectedKey.value = null
    notice.value = null
  }
})

function goHome(): void {
  selectedKey.value = null
  notice.value = null
}

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
  const row = selectedRow.value
  if (!row) return
  try {
    if (!(await window.pitwall.openPort(row.port))) notice.value = text.openFailed
  } catch (e) {
    notice.value = failureText(e)
  }
}

async function killSelected(): Promise<void> {
  const row = selectedRow.value
  if (!row) return
  busyPid.value = row.pid
  notice.value = null
  try {
    notice.value = describeKillResult(await window.pitwall.killPort(row.port, row.pid))
  } catch (e) {
    notice.value = failureText(e)
  } finally {
    busyPid.value = null
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
        <a href="#" class="nav-link active" @click.prevent="goHome">
          <FontAwesomeIcon :icon="faGaugeHigh" /> {{ text.ui.nav.dashboard }}
        </a>
      </li>
      <li class="nav-item">
        <a
          href="#"
          class="nav-link disabled"
          aria-disabled="true"
          :title="text.ui.settingsLater"
          @click.prevent
        >
          <FontAwesomeIcon :icon="faGear" /> {{ text.ui.nav.settings }}
        </a>
      </li>
    </ul>
  </header>

  <main class="container-fluid">
    <p v-if="snapshot?.error" class="text-danger small">{{ snapshot.error }}</p>
    <p v-if="actionError" class="action-error text-danger small">{{ actionError }}</p>
    <p v-if="!snapshot" class="text-secondary">{{ text.ui.loading }}</p>
    <div v-else class="row">
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
          :history="history.ports"
          :selected-key="selectedKey"
          @select="select"
        />
      </div>
      <div class="col-12 col-md-7 col-xl-8 mb-3 gx-0">
        <PortDetail
          v-if="selectedRow"
          :row="selectedRow"
          :history="history.ports[portKey(selectedRow)]"
          :busy="busyPid === selectedRow.pid"
          :notice="notice"
          :intervals="DEFAULT_INTERVALS"
          @open="openSelected"
          @kill="killSelected"
        />
        <HomeView v-else :snapshot="snapshot" :ram-history="history.ram" />
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
