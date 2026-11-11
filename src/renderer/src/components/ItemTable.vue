<!--
  NeoHtop (MIT) process/ProcessTable.svelte · TableHeader.svelte · ProcessRow.svelte · ActionButtons.svelte.
  바꾼 점: 프로세스 하나 대신 pitwall 의 항목(서버·에이전트·…) 한 줄. 고정 줄은 없다.
  트리 보기는 NeoHtop 의 family 줄(펼치기 화살표·들여쓰기·묶음 합계)을 작업 공간 묶음에 쓴다
  (개발 서버 탭의 묶음 보기, 작업 공간 탭).
  동작 칸: 브라우저로 열기 · 자세히 · 내리기(끄기)/지우기 · 숨김 풀기, 묶음 머리는 이름 바꾸기 · 폴더 열기 · 작업 공간 정리.
  끄고 지우는 것은 모두 OS 확인 창을 거친다.
-->
<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import {
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  Eraser,
  ExternalLink,
  Eye,
  FolderGit2,
  FolderOpen,
  Info,
  Pencil,
  Search,
  Trash2,
  X
} from '@lucide/vue'
import type { ActionKind, Column, GroupHead, GroupedRows, Row, Table, Tone } from '../rows'
import { TONE_COLOR, sortRows } from '../rows'
import type { SortState } from '../sortState'
import { formatBytes } from '../../../shared/format'
import { text } from '../../../shared/text'
import Button from '../ui/Button.vue'
import Badge from '../ui/Badge.vue'
import ItemIcon from './ItemIcon.vue'
import { INPUT_CLASS, TABLE } from '../ui/variants'
import { cn } from '../ui/cn'

const props = defineProps<{
  table: Table
  rows: Row[]
  selectedKey: string | null
  /** 검색 중이면 빈 화면 문구가 "찾는 항목이 없어요". */
  searching: boolean
  emptyText: string
  /** 처리 중인 행(버튼을 막는다). */
  busyKey: string | null
  /** 묶음 보기: 정렬된 줄을 작업 공간별로 묶는다. 없으면 목록 보기. */
  group?: ((sorted: Row[]) => GroupedRows[]) | null
}>()
const emit = defineEmits<{
  select: [key: string]
  action: [kind: ActionKind, key: string]
  clearSearch: []
  /** 묶음 머리 동작: 작업 공간 정리·폴더 열기. */
  groupAction: [kind: 'cleanup' | 'folder', root: string]
  /** 작업 공간 이름 바꾸기(빈 글자면 원래 이름으로). */
  rename: [root: string, name: string]
}>()

/**
 * 정렬은 화면(App)이 탭별로 들고 있다. 표 객체는 스냅샷마다 새로 만들어지므로
 * 여기서 표의 기본 정렬로 되돌리면 사용자가 고른 정렬이 갱신 때마다 풀린다.
 */
const sort = defineModel<SortState>('sort', { required: true })
/** 접은 묶음(묶음 키). 화면(App)이 들고 있어 갱신 때도 유지된다. */
const collapsed = defineModel<string[]>('collapsed', { default: () => [] })

function toggleSort(column: Column): void {
  if (sort.value.id === column.id)
    sort.value = { id: column.id, dir: sort.value.dir === 'asc' ? 'desc' : 'asc' }
  else sort.value = { id: column.id, dir: column.align === 'right' ? 'desc' : 'asc' }
}
const sorted = computed(() => sortRows(props.rows, sort.value.id, sort.value.dir))

interface Block {
  key: string
  group: GroupHead | null
  open: boolean
  rows: Row[]
}
const blocks = computed<Block[]>(() => {
  if (!props.group) return [{ key: 'all', group: null, open: true, rows: sorted.value }]
  return props.group(sorted.value).map((g, i) => {
    const open = !g.group || !collapsed.value.includes(g.group.key)
    return {
      key: g.group?.key ?? `solo:${g.rows[0]?.id ?? i}`,
      group: g.group,
      open,
      rows: open ? g.rows : []
    }
  })
})

function toggleGroup(key: string): void {
  collapsed.value = collapsed.value.includes(key)
    ? collapsed.value.filter((k) => k !== key)
    : [...collapsed.value, key]
}

const hasActions = computed(
  () => props.table.rows.some((r) => r.actions.length > 0) || !!props.group
)
const width = computed(
  () => props.table.columns.reduce((sum, col) => sum + col.width, 0) + (hasActions.value ? 120 : 0)
)

// ── 작업 공간 이름 바꾸기(그 자리에서) ──
const renaming = ref<string | null>(null)
const draftName = ref('')
const nameInput = ref<HTMLInputElement[] | HTMLInputElement | null>(null)
async function startRename(group: GroupHead): Promise<void> {
  renaming.value = group.key
  draftName.value = group.name
  await nextTick()
  const el = Array.isArray(nameInput.value) ? nameInput.value[0] : nameInput.value
  el?.focus()
  el?.select()
}
function finishRename(group: GroupHead, save: boolean): void {
  if (renaming.value !== group.key) return
  renaming.value = null
  if (save && group.root) emit('rename', group.root, draftName.value.trim())
}
function groupAct(kind: 'cleanup' | 'folder', group: GroupHead): void {
  if (group.root) emit('groupAction', kind, group.root)
}

// ── 묶음 머리 줄 ──
/** 머리가 채우는 칸. 나머지(종류·포트·CPU 등)는 머리에서 비어 있다. */
const HEAD_FILLED = ['name', 'memory', 'commit', 'branch']
/**
 * 머리 줄의 칸. 요약이 있는 머리(작업 공간 탭)는 상태 칸이 뒤따르는 빈 칸(포트·CPU)까지 차지해
 * 한 줄 요약이 덜 잘린다. 개발 서버 탭의 머리는 칸마다 그대로.
 */
function headCells(group: GroupHead): { col: Column; first: boolean; span: number }[] {
  const columns = props.table.columns
  const cells: { col: Column; first: boolean; span: number }[] = []
  let i = 0
  while (i < columns.length) {
    let span = 1
    if (group.summary != null && columns[i].id === 'status')
      while (i + span < columns.length && !HEAD_FILLED.includes(columns[i + span].id)) span++
    cells.push({ col: columns[i], first: i === 0, span })
    i += span
  }
  return cells
}
/** 작업 공간 탭 머리(요약이 있음)는 구성원·작업 공간 전체 합계, 개발 서버 탭 머리는 서버 수·서버 합계. */
const countTitle = (group: GroupHead): string =>
  group.summary != null ? text.ui.workspaces.members(group.count) : G.servers(group.count)
const memoryHint = (group: GroupHead): string =>
  group.summary != null ? text.ui.workspaces.memoryHint : G.memoryHint
const commitHint = (group: GroupHead): string =>
  group.summary != null ? text.ui.workspaces.commitHint : G.commitHint
const statusTitle = (group: GroupHead): string =>
  [group.status.text, group.summary].filter(Boolean).join(' · ')

/**
 * 메모리 막대(G5)의 길이. 막대는 칸 배경(app.css 의 .memory-bar)이라 글자 뒤에 있고 칸 너비를 바꾸지 않는다.
 * 비중이 없는 칸(다른 포트 보기 등)은 막대가 없다.
 */
const barStyle = (share: number | undefined): Record<string, string> | undefined =>
  share == null ? undefined : { '--memory-share': `${Math.round(share * 1000) / 10}%` }

const TONE: Record<Tone, string> = TONE_COLOR
const ICON: Record<ActionKind, unknown> = {
  open: ExternalLink,
  details: Info,
  kill: X,
  remove: Trash2,
  unhide: Eye
}
const DANGER: ActionKind[] = ['kill', 'remove']
const G = text.ui.group
</script>

<template>
  <section
    class="table-section flex min-h-0 min-w-0 flex-1 flex-col"
    :aria-label="text.ui.tabs.label"
  >
    <div class="process-table-region" role="region" tabindex="0">
      <div data-slot="table-container" :class="TABLE.container">
        <table data-slot="table" :class="TABLE.table" :style="{ width: `max(100%, ${width}px)` }">
          <thead data-slot="table-header" :class="TABLE.header">
            <tr data-slot="table-row" :class="[TABLE.row, 'hover:bg-transparent']">
              <th
                v-for="(col, ci) in table.columns"
                :key="col.id"
                data-slot="table-head"
                :class="[
                  TABLE.head,
                  { 'text-right': col.align === 'right', 'pl-4': ci === 0 || col.id === 'name' }
                ]"
                :style="{ width: `${col.width}px` }"
                :aria-sort="
                  sort.id === col.id ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'
                "
              >
                <Button
                  variant="ghost"
                  size="sm"
                  :class="[
                    'h-8 max-w-full px-1 text-xs',
                    sort.id === col.id ? 'text-primary' : 'text-muted-foreground'
                  ]"
                  :title="col.hint"
                  @click="toggleSort(col)"
                >
                  <span>{{ col.label }}</span>
                  <template v-if="sort.id === col.id">
                    <ArrowUp v-if="sort.dir === 'asc'" class="size-3" />
                    <ArrowDown v-else class="size-3" />
                  </template>
                  <ArrowDownUp v-else class="size-3 opacity-50" />
                </Button>
              </th>
              <th
                v-if="hasActions"
                data-slot="table-head"
                :class="[
                  TABLE.head,
                  'actions-heading w-28 pr-4 text-right text-xs text-muted-foreground'
                ]"
              >
                {{ text.ui.columns.actions }}
              </th>
            </tr>
          </thead>
          <tbody data-slot="table-body" :class="TABLE.body">
            <template v-for="block in blocks" :key="block.key">
              <!-- 작업 공간 머리(NeoHtop family 줄): 펼치기 · 이름 · 구성원 수 · 에이전트 · 상태·요약 · 합계 -->
              <tr
                v-if="block.group"
                data-slot="table-row"
                :data-group="block.group.key"
                :class="[TABLE.row, 'group-head bg-muted/40']"
              >
                <td
                  v-for="{ col, first, span } in headCells(block.group)"
                  :key="col.id"
                  data-slot="table-cell"
                  :colspan="span > 1 ? span : undefined"
                  :class="[
                    TABLE.cell,
                    {
                      'text-right': col.align === 'right',
                      'pl-4': first || col.id === 'name',
                      'memory-bar': col.id === 'memory' && block.group.memoryShare != null
                    }
                  ]"
                  :style="col.id === 'memory' ? barStyle(block.group.memoryShare) : undefined"
                >
                  <div v-if="col.id === 'name'" class="flex min-w-0 items-center gap-1.5">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      class="-ml-1 shrink-0 text-muted-foreground"
                      :aria-expanded="block.open"
                      :aria-label="
                        block.open ? G.collapse(block.group.name) : G.expand(block.group.name)
                      "
                      :title="
                        block.open ? G.collapse(block.group.name) : G.expand(block.group.name)
                      "
                      @click="toggleGroup(block.group.key)"
                    >
                      <ChevronDown v-if="block.open" />
                      <ChevronRight v-else />
                    </Button>
                    <FolderGit2 class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <input
                      v-if="renaming === block.group.key"
                      ref="nameInput"
                      v-model="draftName"
                      :class="cn(INPUT_CLASS, 'h-7 max-w-48 px-2 py-0 text-[13px]')"
                      :aria-label="G.renameLabel"
                      :title="G.renameHint"
                      maxlength="40"
                      @keydown.enter.prevent="finishRename(block.group, true)"
                      @keydown.esc.prevent="finishRename(block.group, false)"
                      @blur="finishRename(block.group, true)"
                    />
                    <span
                      v-else
                      class="truncate text-[13px] font-medium"
                      :title="block.group.root ?? block.group.name"
                      >{{ block.group.name }}</span
                    >
                    <Badge
                      variant="secondary"
                      class="shrink-0 px-1.5 text-[10px] font-normal"
                      :title="countTitle(block.group)"
                      >{{ block.group.count }}</Badge
                    >
                    <span
                      v-for="agent in block.group.agentBadges.slice(0, 3)"
                      :key="agent.key"
                      class="flex shrink-0"
                      :title="agent.title"
                    >
                      <ItemIcon :icon="agent.icon" :size="14" />
                    </span>
                  </div>
                  <span
                    v-else-if="col.id === 'status'"
                    class="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
                    :title="statusTitle(block.group)"
                  >
                    <template v-if="block.group.status.text">
                      <span
                        class="size-1.5 shrink-0 rounded-full"
                        :style="{ background: TONE[block.group.status.dot ?? 'idle'] }"
                      ></span>
                      <span :class="block.group.summary ? 'shrink-0' : 'truncate'">{{
                        block.group.status.text
                      }}</span>
                    </template>
                    <!-- 작업 공간 탭: 서버 3 · 무거운 작업 1 · 변경 12 · 마지막 활동(한 줄, 넘치면 잘리고 title 에 전부) -->
                    <span
                      v-if="block.group.summary"
                      data-summary
                      class="ml-1 min-w-0 truncate opacity-80"
                      >{{ block.group.summary }}</span
                    >
                  </span>
                  <span
                    v-else-if="col.id === 'memory'"
                    class="font-mono text-xs"
                    :title="memoryHint(block.group)"
                    >{{ formatBytes(block.group.memoryBytes) }}</span
                  >
                  <span
                    v-else-if="col.id === 'commit' && block.group.commitBytes != null"
                    class="font-mono text-xs"
                    :title="commitHint(block.group)"
                    >{{ formatBytes(block.group.commitBytes) }}</span
                  >
                  <span
                    v-else-if="col.id === 'branch' && block.group.outer"
                    class="truncate text-muted-foreground"
                    >{{ G.workspaceRepo }}</span
                  >
                </td>
                <td
                  v-if="hasActions"
                  data-slot="table-cell"
                  :class="[TABLE.cell, 'actions-cell w-28 pr-3']"
                >
                  <!-- 작업 공간을 모르는 묶음(ws:?)은 동작이 없다(actions 가 비어 있음). -->
                  <div class="flex items-center justify-end gap-1">
                    <Button
                      v-if="block.group.actions.includes('rename')"
                      variant="ghost"
                      size="icon-xs"
                      class="text-muted-foreground"
                      :aria-label="text.ui.actions.rename"
                      :title="text.ui.actions.rename"
                      data-action="rename"
                      @click="startRename(block.group)"
                    >
                      <Pencil />
                    </Button>
                    <Button
                      v-if="block.group.actions.includes('folder')"
                      variant="ghost"
                      size="icon-xs"
                      class="text-muted-foreground"
                      :aria-label="text.ui.quick.folder"
                      :title="text.ui.quick.folder"
                      data-action="folder"
                      @click="groupAct('folder', block.group)"
                    >
                      <FolderOpen />
                    </Button>
                    <Button
                      v-if="block.group.actions.includes('cleanup')"
                      variant="ghost"
                      size="icon-xs"
                      class="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      :aria-label="text.ui.actions.cleanup"
                      :title="text.ui.actions.cleanup"
                      data-action="cleanup"
                      :disabled="busyKey === `group:${block.group.root}`"
                      @click="groupAct('cleanup', block.group)"
                    >
                      <Eraser />
                    </Button>
                  </div>
                </td>
              </tr>
              <tr
                v-for="row in block.rows"
                :key="row.id"
                data-slot="table-row"
                :data-selected="row.key != null && row.key === selectedKey"
                :data-key="row.key ?? undefined"
                :data-depth="block.group ? 1 : undefined"
                :class="TABLE.row"
              >
                <td
                  v-for="(col, ci) in table.columns"
                  :key="col.id"
                  data-slot="table-cell"
                  :class="[
                    TABLE.cell,
                    {
                      'text-right': col.align === 'right',
                      'font-mono text-xs': row.cells[col.id]?.mono,
                      'pl-4': ci === 0 || col.id === 'name',
                      'memory-bar': row.cells[col.id]?.share != null
                    }
                  ]"
                  :style="barStyle(row.cells[col.id]?.share)"
                >
                  <div
                    v-if="col.id === 'name'"
                    class="flex min-w-0 items-center gap-2"
                    :style="block.group ? { paddingLeft: '28px' } : undefined"
                  >
                    <span
                      v-if="row.cells.name.icon"
                      class="flex shrink-0"
                      :title="row.cells.name.icon.title"
                    >
                      <ItemIcon :icon="row.cells.name.icon" />
                    </span>
                    <Button
                      v-if="row.key"
                      variant="link"
                      class="h-auto min-w-0 shrink justify-start truncate p-0 text-left text-[13px] font-normal text-foreground"
                      :title="row.cells.name.title ?? row.cells.name.text"
                      @click="emit('select', row.key)"
                    >
                      <span class="truncate">{{ row.cells.name.text }}</span>
                    </Button>
                    <span
                      v-else
                      class="truncate text-[13px]"
                      :title="row.cells.name.title ?? row.cells.name.text"
                      >{{ row.cells.name.text }}</span
                    >
                  </div>
                  <Button
                    v-else-if="col.id === 'target' && row.key"
                    variant="link"
                    class="h-auto min-w-0 max-w-full justify-start truncate p-0 text-left text-[13px] font-normal text-foreground"
                    :title="row.cells.target.title ?? row.cells.target.text"
                    @click="emit('select', row.key)"
                  >
                    <span class="truncate">{{ row.cells.target.text }}</span>
                  </Button>
                  <span
                    v-else-if="row.cells[col.id]?.dot"
                    class="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
                    :title="row.cells[col.id].title ?? row.cells[col.id].text"
                  >
                    <span
                      class="size-1.5 shrink-0 rounded-full"
                      :style="{ background: TONE[row.cells[col.id].dot!] }"
                    ></span>
                    <span class="truncate">{{ row.cells[col.id].text }}</span>
                    <Badge
                      v-if="row.cells[col.id].badge"
                      variant="outline"
                      class="shrink-0 border-[color:var(--peach)] px-1.5 text-[10px] font-normal text-[color:var(--peach)]"
                      >{{ row.cells[col.id].badge }}</Badge
                    >
                  </span>
                  <div
                    v-else
                    class="truncate"
                    :class="{ 'text-muted-foreground': row.cells[col.id]?.muted }"
                    :title="row.cells[col.id]?.title ?? row.cells[col.id]?.text"
                  >
                    {{ row.cells[col.id]?.text ?? text.ui.none }}
                  </div>
                </td>
                <td
                  v-if="hasActions"
                  data-slot="table-cell"
                  :class="[TABLE.cell, 'actions-cell w-28 pr-3']"
                >
                  <div class="flex items-center justify-end gap-1">
                    <Button
                      v-for="action in row.actions"
                      :key="action.kind"
                      variant="ghost"
                      size="icon-xs"
                      :class="
                        DANGER.includes(action.kind)
                          ? 'text-muted-foreground hover:bg-destructive/10 hover:text-destructive'
                          : 'text-muted-foreground'
                      "
                      :aria-label="action.label"
                      :title="action.label"
                      :disabled="action.disabled || (busyKey != null && busyKey === row.key)"
                      :data-action="action.kind"
                      @click="row.key && emit('action', action.kind, row.key)"
                    >
                      <component :is="ICON[action.kind]" />
                    </Button>
                  </div>
                </td>
              </tr>
            </template>
            <tr v-if="sorted.length === 0" data-slot="table-row" :class="TABLE.row">
              <td
                data-slot="table-cell"
                :colspan="table.columns.length + (hasActions ? 1 : 0)"
                :class="[TABLE.cell, 'h-48 text-center whitespace-normal']"
              >
                <Search v-if="searching" class="mx-auto mb-3 size-6 text-muted-foreground" />
                <CircleCheck v-else class="mx-auto mb-3 size-6 text-muted-foreground" />
                <p class="text-sm font-medium">
                  {{ searching ? text.ui.search.none : emptyText }}
                </p>
                <p v-if="searching" class="mt-1 text-xs text-muted-foreground">
                  {{ text.ui.search.noneHint }}
                </p>
                <Button v-if="searching" variant="link" size="sm" @click="emit('clearSearch')">
                  {{ text.ui.search.clearAll }}
                </Button>
                <!-- 화면이 더하는 권유(개발 서버 탭의 "다른 포트에서 찾기"). -->
                <slot name="empty-actions" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>
