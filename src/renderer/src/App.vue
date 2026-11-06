<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { faGear } from '@fortawesome/free-solid-svg-icons'
import type { DashboardSnapshot } from '../../shared/types'
import { describeKillResult, formatBytes } from '../../shared/format'
import { text } from '../../shared/text'
import { watchColorScheme } from './theme'
import StatusBadge from './components/StatusBadge.vue'
import RamBar from './components/RamBar.vue'
import DashCard from './components/DashCard.vue'
import PortsCard from './components/PortsCard.vue'
import MemoryGroupsCard from './components/MemoryGroupsCard.vue'

type CardId = 'ports' | 'memory' | 'agents' | 'leftovers' | 'heavy' | 'disk'

const snapshot = ref<DashboardSnapshot | null>(null)
const expanded = ref<CardId | null>(null)
const busyPid = ref<number | null>(null)
const killNotice = ref<string | null>(null)

let unsubscribe: () => void = () => {}
let stopTheme: () => void = () => {}

onMounted(async () => {
  stopTheme = watchColorScheme((q) => window.matchMedia(q), document.body)
  unsubscribe = window.pitwall.onSnapshot((s) => (snapshot.value = s))
  const latest = await window.pitwall.getLatest()
  // 창이 늦게 열려 놓친 스냅샷만 채운다. 그 사이 받은 더 새 스냅샷은 덮어쓰지 않는다.
  if (!snapshot.value && latest) snapshot.value = latest
})

onUnmounted(() => {
  unsubscribe()
  stopTheme()
})

function toggle(id: CardId): void {
  expanded.value = expanded.value === id ? null : id
}

async function kill(port: number, pid: number): Promise<void> {
  busyPid.value = pid
  killNotice.value = null
  try {
    killNotice.value = describeKillResult(await window.pitwall.killPort(port, pid))
  } finally {
    busyPid.value = null
  }
}

const devWorkBytes = computed(() =>
  (snapshot.value?.groups ?? [])
    .filter((g) => g.group !== 'other')
    .reduce((sum, g) => sum + g.memoryBytes, 0)
)
</script>

<template>
  <header class="app-header d-flex align-items-center py-3 mb-3 border-bottom px-4">
    <span class="fs-4 title">{{ text.appName }}</span>
    <StatusBadge v-if="snapshot?.stale" class="ms-3" tone="warning" :text="text.ui.stale" />
    <button type="button" class="btn btn-normal ms-auto" disabled :title="text.ui.settingsLater">
      <FontAwesomeIcon :icon="faGear" />
    </button>
  </header>

  <main class="px-4 pb-4">
    <p v-if="!snapshot" class="text-secondary">{{ text.ui.loading }}</p>
    <template v-else>
      <p v-if="snapshot.error" class="text-danger small">{{ snapshot.error }}</p>
      <RamBar :memory="snapshot.memory" />

      <div class="cards">
        <DashCard
          :title="text.ui.cards.ports"
          :summary="text.ui.count(snapshot.ports.length)"
          :tone="snapshot.ports.length ? 'primary' : 'secondary'"
          :expanded="expanded === 'ports'"
          @toggle="toggle('ports')"
        >
          <template #detail>
            <p v-if="killNotice" class="kill-notice text-warning small">{{ killNotice }}</p>
            <PortsCard :ports="snapshot.ports" :busy-pid="busyPid" @kill="kill" />
          </template>
        </DashCard>

        <DashCard
          :title="text.ui.cards.memory"
          :summary="formatBytes(devWorkBytes)"
          :expanded="expanded === 'memory'"
          @toggle="toggle('memory')"
        >
          <template #detail>
            <MemoryGroupsCard :groups="snapshot.groups" />
          </template>
        </DashCard>

        <DashCard
          :title="text.ui.cards.agents"
          :summary="text.ui.count(snapshot.agentProcessCount)"
          :tone="snapshot.agentProcessCount ? 'primary' : 'secondary'"
          :expanded="false"
          pending
        />
        <DashCard :title="text.ui.cards.leftovers" :summary="text.ui.none" tone="secondary" :expanded="false" pending />
        <DashCard :title="text.ui.cards.heavy" :summary="text.ui.none" tone="secondary" :expanded="false" pending />
        <DashCard :title="text.ui.cards.disk" :summary="text.ui.none" tone="secondary" :expanded="false" pending />
      </div>
    </template>
  </main>
</template>

<style scoped>
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 1rem;
  align-items: start;
}

/* 펼친 카드는 그 자리에서 한 줄 전체를 차지하고, 나머지 카드는 아래로 밀린다. */
.cards > .expanded {
  grid-column: 1 / -1;
}
</style>
