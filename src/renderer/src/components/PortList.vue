<!--
  Uptime Kuma (MIT) src/components/MonitorList.vue 의 목록 상자(검색창이 있는 머리 + 스크롤 목록)와
  MonitorListItem.vue 의 그룹(접기)을 가져옴.
  바꾼 점: 감시 대상 대신 "개발 서버 포트 · 에이전트 · 남은 프로세스 · 디스크 정리" 그룹을 보여 주고, 필터·선택 모드·끌어 놓기는 없다.
  검색은 모든 그룹에 적용한다. 에이전트 그룹 머리에 Claude 연동 버튼을, 디스크 정리 그룹 머리에 다시 찾기 버튼을 둔다.
-->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { faMagnifyingGlass, faXmark } from '@fortawesome/free-solid-svg-icons'
import type {
  AgentRow,
  ClaudeHookStatus,
  DiskReport,
  LeftoverRow,
  PortRow
} from '../../../shared/types'
import { worktreeFolder, worktreeLabel } from '../../../shared/format'
import { text } from '../../../shared/text'
import { agentKey, portKey, selectionKey, type History } from '../history'
import { hookControls } from '../hook'
import ListGroup from './ListGroup.vue'
import PortListItem from './PortListItem.vue'
import AgentListItem from './AgentListItem.vue'
import LeftoverListItem from './LeftoverListItem.vue'
import DiskListItem from './DiskListItem.vue'

const props = withDefaults(
  defineProps<{
    ports: PortRow[]
    agents: AgentRow[]
    leftovers: LeftoverRow[]
    history: History
    selectedKey: string | null
    hook: ClaudeHookStatus | null
    hookBusy?: boolean
    disk?: DiskReport | null
  }>(),
  { hookBusy: false, disk: null }
)
const emit = defineEmits<{
  select: [key: string]
  hook: [action: 'enable' | 'disable']
  diskScan: []
}>()

const search = ref('')
const query = computed(() => search.value.trim().toLowerCase())

function matches(q: string, ...fields: (string | null | undefined)[]): boolean {
  return fields.some((f) => !!f && f.toLowerCase().includes(q))
}

const visiblePorts = computed(() => {
  const q = query.value
  if (!q) return props.ports
  const portQuery = q.replace(/^:/, '')
  return props.ports.filter(
    (row) =>
      matches(q, worktreeLabel(row.worktree), row.processName) ||
      String(row.port).includes(portQuery)
  )
})

const visibleAgents = computed(() => {
  const q = query.value
  if (!q) return props.agents
  return props.agents.filter((row) =>
    matches(
      q,
      row.worktree ? worktreeLabel(row.worktree) : text.ui.tags.noWorktree,
      text.ui.agent.toolNames[row.tool],
      text.ui.agent.states[row.state]
    )
  )
})

const visibleLeftovers = computed(() => {
  const q = query.value
  if (!q) return props.leftovers
  return props.leftovers.filter((row) =>
    matches(
      q,
      row.label,
      row.processName,
      row.worktree ? worktreeFolder(row.worktree) : text.ui.tags.noWorktree
    )
  )
})

const diskRows = computed(() => props.disk?.rows ?? [])
const visibleDisk = computed(() => {
  const q = query.value
  if (!q) return diskRows.value
  return diskRows.value.filter((row) => matches(q, row.worktreeRoot, row.branch))
})
const diskEmpty = computed(() => {
  const d = props.disk
  if (d?.error) return d.error
  if (d?.scanning) return text.ui.disk.scanning
  if (!d || d.scannedAt == null) return text.ui.disk.notYet
  return text.ui.disk.empty
})

const noMatch = computed(
  () =>
    !!query.value &&
    visiblePorts.value.length +
      visibleAgents.value.length +
      visibleLeftovers.value.length +
      visibleDisk.value.length ===
      0
)

/** 그룹 알약 색은 그룹 안에서 가장 급한 상태(Uptime Kuma 그룹처럼). */
const portsPill = computed(() => {
  if (props.ports.some((p) => p.judgement === 'candidate')) return 'bg-danger'
  if (props.ports.some((p) => p.judgement === 'check')) return 'bg-warning'
  if (props.ports.some((p) => p.clientCount > 0 && !p.unresolvable)) return 'bg-primary'
  return 'bg-secondary'
})
const agentsPill = computed(() => {
  const states = new Set(props.agents.map((a) => a.state))
  if (states.has('waiting')) return 'bg-warning'
  if (states.has('error')) return 'bg-danger'
  if (states.has('working')) return 'bg-primary'
  return 'bg-secondary'
})
const leftoversPill = computed(() => (props.leftovers.length ? 'bg-warning' : 'bg-secondary'))
const diskPill = computed(() =>
  diskRows.value.some((r) => !r.inUse) ? 'bg-warning' : 'bg-secondary'
)

const hookButton = computed(() => hookControls(props.hook).button)
</script>

<template>
  <div class="shadow-box mb-3 list-box">
    <div class="list-header">
      <div class="search-wrapper">
        <a
          v-if="search"
          href="#"
          class="search-icon"
          :title="text.ui.list.clearSearch"
          @click.prevent="search = ''"
        >
          <FontAwesomeIcon :icon="faXmark" />
        </a>
        <span v-else class="search-icon"><FontAwesomeIcon :icon="faMagnifyingGlass" /></span>
        <input
          v-model="search"
          class="form-control search-input"
          :placeholder="text.ui.list.search"
        />
      </div>
    </div>
    <div class="monitor-list scrollbar">
      <p v-if="noMatch" class="text-secondary px-3">{{ text.ui.list.noMatch }}</p>

      <ListGroup
        group-id="ports"
        :title="text.ui.list.groups.ports"
        :count="visiblePorts.length"
        :pill-class="portsPill"
      >
        <p v-if="ports.length === 0" class="empty text-secondary">{{ text.ui.list.empty }}</p>
        <PortListItem
          v-for="row in visiblePorts"
          :key="portKey(row)"
          :row="row"
          :beats="history.ports[portKey(row)]?.beats ?? []"
          :active="selectedKey === selectionKey.port(row)"
          @select="emit('select', selectionKey.port(row))"
        />
      </ListGroup>

      <ListGroup
        group-id="agents"
        :title="text.ui.list.groups.agents"
        :count="visibleAgents.length"
        :pill-class="agentsPill"
      >
        <template v-if="hookButton" #actions>
          <button
            type="button"
            class="btn btn-sm btn-normal btn-hook"
            :disabled="hookBusy"
            @click="emit('hook', hookButton.action)"
          >
            {{ hookButton.label }}
          </button>
        </template>
        <p v-if="agents.length === 0" class="empty text-secondary">
          {{ text.ui.list.emptyAgents }}
        </p>
        <AgentListItem
          v-for="row in visibleAgents"
          :key="agentKey(row)"
          :row="row"
          :beats="history.agents[agentKey(row)]?.beats ?? []"
          :active="selectedKey === selectionKey.agent(row)"
          @select="emit('select', selectionKey.agent(row))"
        />
      </ListGroup>

      <ListGroup
        group-id="leftovers"
        :title="text.ui.list.groups.leftovers"
        :count="visibleLeftovers.length"
        :pill-class="leftoversPill"
      >
        <p v-if="leftovers.length === 0" class="empty text-secondary">
          {{ text.ui.list.emptyLeftovers }}
        </p>
        <LeftoverListItem
          v-for="row in visibleLeftovers"
          :key="selectionKey.leftover(row)"
          :row="row"
          :active="selectedKey === selectionKey.leftover(row)"
          @select="emit('select', selectionKey.leftover(row))"
        />
      </ListGroup>

      <ListGroup
        group-id="disk"
        :title="text.ui.list.groups.disk"
        :count="visibleDisk.length"
        :pill-class="diskPill"
      >
        <template #actions>
          <button
            type="button"
            class="btn btn-sm btn-normal btn-disk-scan"
            :disabled="!!disk?.scanning"
            @click="emit('diskScan')"
          >
            {{ disk?.scanning ? text.ui.disk.scanning : text.ui.disk.rescan }}
          </button>
        </template>
        <p v-if="diskRows.length === 0" class="empty text-secondary disk-empty">
          {{ diskEmpty }}
        </p>
        <DiskListItem
          v-for="row in visibleDisk"
          :key="row.worktreeRoot"
          :row="row"
          :active="selectedKey === selectionKey.disk(row.worktreeRoot)"
          @select="emit('select', selectionKey.disk(row.worktreeRoot))"
        />
      </ListGroup>
    </div>
  </div>
</template>

<style scoped lang="scss">
@import '../styles/vars.scss';

/* Uptime Kuma MonitorList.vue */
.shadow-box {
  height: calc(100vh - 150px);
  position: sticky;
  top: 10px;
}

.list-header {
  border-bottom: 1px solid #dee2e6;
  border-radius: 10px 10px 0 0;
  margin-bottom: 10px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;

  .dark & {
    background-color: $dark-header-bg;
    border-bottom: 0;
  }
}

.search-wrapper {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-left: auto;
  width: 100%;
  max-width: 300px;
}

.search-icon {
  color: #c0c0c0;
  cursor: pointer;
  transition: all ease-in-out 0.1s;

  &:hover {
    opacity: 0.5;
  }
}

.search-input {
  width: 100%;
  transition: none !important;
}

.monitor-list.scrollbar {
  height: calc(100% - 70px);
  overflow-y: auto;
}

.empty {
  font-size: 13px;
  margin: 4px 0 8px 10px;
}

.btn-hook,
.btn-disk-scan {
  white-space: nowrap;
  font-size: 12px;
  padding: 2px 10px;
}
</style>
