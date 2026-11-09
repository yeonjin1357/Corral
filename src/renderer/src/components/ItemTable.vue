<!--
  NeoHtop (MIT) process/ProcessTable.svelte · TableHeader.svelte · ProcessRow.svelte · ActionButtons.svelte.
  바꾼 점: 프로세스 하나 대신 pitwall 의 항목(포트·에이전트·…) 한 줄, 고정·트리 보기는 없다.
  동작 칸: 브라우저로 열기 · 자세히 · 내리기(끄기)/지우기. 끄고 지우는 것은 모두 OS 확인 창을 거친다.
-->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  CircleCheck,
  ExternalLink,
  Info,
  Search,
  Trash2,
  X
} from '@lucide/vue'
import type { ActionKind, Column, Row, Table, Tone } from '../rows'
import { sortRows } from '../rows'
import { text } from '../../../shared/text'
import Button from '../ui/Button.vue'
import { TABLE } from '../ui/variants'

const props = defineProps<{
  table: Table
  rows: Row[]
  selectedKey: string | null
  /** 검색 중이면 빈 화면 문구가 "찾는 항목이 없어요". */
  searching: boolean
  emptyText: string
  /** 처리 중인 행(버튼을 막는다). */
  busyKey: string | null
}>()
const emit = defineEmits<{
  select: [key: string]
  action: [kind: ActionKind, key: string]
  clearSearch: []
}>()

const sort = ref({ ...props.table.sort })
watch(
  () => props.table.sort,
  (next) => (sort.value = { ...next })
)
function toggleSort(column: Column): void {
  if (sort.value.id === column.id)
    sort.value = { id: column.id, dir: sort.value.dir === 'asc' ? 'desc' : 'asc' }
  else sort.value = { id: column.id, dir: column.align === 'right' ? 'desc' : 'asc' }
}
const sorted = computed(() => sortRows(props.rows, sort.value.id, sort.value.dir))
const hasActions = computed(() => props.table.rows.some((r) => r.actions.length > 0))
const width = computed(
  () => props.table.columns.reduce((sum, col) => sum + col.width, 0) + (hasActions.value ? 120 : 0)
)

const TONE: Record<Tone, string> = {
  running: 'var(--status-running)',
  idle: 'var(--status-idle)',
  stopped: 'var(--status-stopped)',
  warn: 'var(--peach)'
}
const ICON: Record<ActionKind, unknown> = {
  open: ExternalLink,
  details: Info,
  kill: X,
  remove: Trash2
}
const DANGER: ActionKind[] = ['kill', 'remove']
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
                v-for="col in table.columns"
                :key="col.id"
                data-slot="table-head"
                :class="[
                  TABLE.head,
                  { 'text-right': col.align === 'right', 'pl-4': col.id === 'name' }
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
            <tr
              v-for="row in sorted"
              :key="row.id"
              data-slot="table-row"
              :data-selected="row.key != null && row.key === selectedKey"
              :data-key="row.key ?? undefined"
              :class="TABLE.row"
            >
              <td
                v-for="col in table.columns"
                :key="col.id"
                data-slot="table-cell"
                :class="[
                  TABLE.cell,
                  {
                    'text-right': col.align === 'right',
                    'font-mono text-xs': row.cells[col.id]?.mono,
                    'pl-4': col.id === 'name'
                  }
                ]"
              >
                <template v-if="col.id === 'name'">
                  <Button
                    v-if="row.key"
                    variant="link"
                    class="h-auto min-w-0 max-w-full shrink justify-start truncate p-0 text-left text-[13px] font-normal text-foreground"
                    :title="row.cells.name.title ?? row.cells.name.text"
                    @click="emit('select', row.key)"
                  >
                    <span class="truncate">{{ row.cells.name.text }}</span>
                  </Button>
                  <span v-else class="block truncate text-[13px]">{{ row.cells.name.text }}</span>
                </template>
                <span
                  v-else-if="row.cells[col.id]?.dot"
                  class="flex items-center gap-1.5 text-xs text-muted-foreground"
                  :title="row.cells[col.id].title ?? row.cells[col.id].text"
                >
                  <span
                    class="size-1.5 shrink-0 rounded-full"
                    :style="{ background: TONE[row.cells[col.id].dot!] }"
                  ></span>
                  <span class="truncate">{{ row.cells[col.id].text }}</span>
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
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>
