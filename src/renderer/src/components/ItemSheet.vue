<!--
  NeoHtop (MIT) modals/ProcessDetailsModal.svelte 의 오른쪽 패널(아이콘 상자 + 제목, 두 숫자 카드, 정보 카드, 명령줄 카드).
  바꾼 점: 프로세스 하나 대신 pitwall 항목(포트·에이전트·남은 프로세스·무거운 작업·디스크 정리)을 보여 주고,
  제목 아래에 그 항목의 동작(브라우저로 열기·내리기·끄기·지우기) 버튼을 둔다. 모두 OS 확인 창을 거친다.
-->
<script setup lang="ts">
import { computed } from 'vue'
import {
  Cpu,
  ExternalLink,
  FolderGit2,
  HardDrive,
  MemoryStick,
  Plug,
  Terminal,
  Timer,
  Trash2,
  X
} from '@lucide/vue'
import type {
  AgentRow,
  ClaudeHookStatus,
  DiskRow,
  HeavyJobRow,
  LeftoverRow,
  Platform,
  PortRow,
  WorktreeInfo
} from '../../../shared/types'
import {
  displayCpuPercent,
  formatBytes,
  formatDuration,
  worktreeFolder
} from '../../../shared/format'
import { text } from '../../../shared/text'
import type { Point } from '../history'
import Sheet from '../ui/Sheet.vue'
import Card from '../ui/Card.vue'
import CardHeader from '../ui/CardHeader.vue'
import CardTitle from '../ui/CardTitle.vue'
import CardDescription from '../ui/CardDescription.vue'
import CardContent from '../ui/CardContent.vue'
import Button from '../ui/Button.vue'
import Badge from '../ui/Badge.vue'
import { TABLE } from '../ui/variants'
import ResourceTrend from './ResourceTrend.vue'
import ItemIcon from './ItemIcon.vue'
import { DISK_ICON, agentIcon, heavyIcon, leftoverIcon, portIcon, type RowIcon } from '../rows'

export type Selected =
  | { kind: 'port'; row: PortRow }
  | { kind: 'agent'; row: AgentRow }
  | { kind: 'leftover'; row: LeftoverRow }
  | { kind: 'heavy'; row: HeavyJobRow }
  | { kind: 'disk'; row: DiskRow }

const props = defineProps<{
  item: Selected | null
  now: number
  memoryHistory: Point[]
  windowMs: number
  busy: boolean
  hook: ClaudeHookStatus | null
  platform: Platform | null
  cpuCount: number
}>()
const emit = defineEmits<{ open: []; kill: []; remove: [] }>()
const open = defineModel<boolean>('open', { required: true })

const t = text.ui
/** 11월 9일 오전 9:10 */
const time = (ms: number): string =>
  new Date(ms).toLocaleString('ko-KR', {
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
const folder = (w: WorktreeInfo | null): string => (w ? worktreeFolder(w) : t.tags.noWorktree)
const branchKind = (w: WorktreeInfo | null): string =>
  w?.isLinkedWorktree ? t.sheet.linked : t.sheet.main
const runtime = (startedAt: number | null): string =>
  startedAt == null ? t.none : formatDuration(props.now - startedAt)

interface Fact {
  label: string
  value: string
}
interface View {
  icon: RowIcon
  title: string
  description: string
  badge?: { text: string; variant: 'secondary' | 'destructive' } | null
  cards: { icon: unknown; label: string; value: string; sub?: string; trend?: boolean }[]
  facts: Fact[]
  command?: string | null
  note?: string | null
  folders?: DiskRow['folders']
}

const view = computed<View | null>(() => {
  const item = props.item
  if (!item) return null
  switch (item.kind) {
    case 'port': {
      const r = item.row
      const status = r.unresolvable
        ? t.rowStatus.unresolvable
        : r.judgement === 'candidate'
          ? t.rowStatus.candidate
          : r.judgement === 'check'
            ? t.rowStatus.check
            : r.clientCount > 0
              ? t.rowStatus.inUse
              : r.agentInWorktree
                ? t.rowStatus.agent
                : t.rowStatus.idle
      return {
        icon: portIcon(r, props.platform),
        title: r.unresolvable ? `:${r.port}` : folder(r.worktree),
        description: `${t.detail.url(r.port)} · ${r.processName} · PID ${r.pid}`,
        badge: {
          text: status,
          variant: r.judgement === 'candidate' ? 'destructive' : 'secondary'
        },
        cards: [
          {
            icon: MemoryStick,
            label: t.detail.memory,
            value: formatBytes(r.memoryBytes),
            trend: true
          },
          {
            icon: Plug,
            label: t.sheet.clients,
            value: String(r.clientCount),
            sub:
              r.idleSince != null && r.clientCount === 0
                ? `${t.sheet.clientsNow(0)} · ${formatDuration(props.now - r.idleSince)}`
                : t.sheet.clientsNow(r.clientCount)
          }
        ],
        facts: [
          { label: t.columns.port, value: `:${r.port}` },
          { label: t.columns.branch, value: r.worktree?.branch ?? text.detached },
          { label: t.sheet.branchKind, value: r.worktree ? branchKind(r.worktree) : t.none },
          { label: t.sheet.path, value: r.worktree?.root ?? t.none },
          { label: t.columns.process, value: r.processName },
          { label: t.sheet.pid, value: String(r.pid) },
          { label: t.sheet.children, value: `${r.descendantPids.length}${t.cards.count}` },
          { label: t.sheet.startedAt, value: r.startedAt == null ? t.none : time(r.startedAt) }
        ],
        command: r.commandLine
      }
    }
    case 'agent': {
      const r = item.row
      const cpu = displayCpuPercent(r.cpuPercent, props.platform, props.cpuCount)
      const note =
        r.tool === 'codex'
          ? t.agent.codexNote
          : r.stateSource === 'cpu' && props.hook?.state !== 'on'
            ? t.agent.noHookNote
            : null
      return {
        icon: agentIcon(r),
        title: folder(r.worktree),
        description: `${t.agent.toolNames[r.tool]} · PID ${r.pid}`,
        badge: {
          text: t.agent.states[r.state],
          variant: r.state === 'error' ? 'destructive' : 'secondary'
        },
        cards: [
          {
            icon: MemoryStick,
            label: t.detail.memory,
            value: formatBytes(r.memoryBytes),
            trend: true
          },
          {
            icon: Cpu,
            label: t.agent.cpu,
            value: cpu == null ? t.none : `${cpu.toFixed(1)}%`,
            sub: props.platform === 'win32' ? t.agent.cpuSubWindows : t.agent.cpuSub
          }
        ],
        facts: [
          { label: t.columns.tool, value: t.agent.toolNames[r.tool] },
          { label: t.agent.stateSource, value: t.agent.sources[r.stateSource] },
          {
            label: t.columns.branch,
            value: r.worktree?.branch ?? (r.worktree ? text.detached : t.none)
          },
          { label: t.sheet.path, value: r.worktree?.root ?? t.tags.noWorktree },
          { label: t.sheet.children, value: `${r.descendantCount}${t.cards.count}` },
          { label: t.sheet.runtime, value: runtime(r.startedAt) }
        ],
        note
      }
    }
    case 'leftover': {
      const r = item.row
      return {
        icon: leftoverIcon(r, props.platform),
        title: r.label,
        description: `${r.processName} · PID ${r.pid}`,
        badge: r.agentInWorktree ? { text: t.rowStatus.leftoverAgent, variant: 'secondary' } : null,
        cards: [
          { icon: MemoryStick, label: t.detail.memory, value: formatBytes(r.memoryBytes) },
          {
            icon: Timer,
            label: t.sheet.runtime,
            value: runtime(r.startedAt),
            sub: r.startedAt == null ? undefined : time(r.startedAt)
          }
        ],
        facts: [
          { label: t.columns.project, value: folder(r.worktree) },
          {
            label: t.columns.branch,
            value: r.worktree?.branch ?? (r.worktree ? text.detached : t.none)
          },
          { label: t.sheet.path, value: r.worktree?.root ?? t.tags.noWorktree },
          { label: t.sheet.children, value: `${r.descendantPids.length}${t.cards.count}` }
        ],
        command: r.commandLine,
        note: t.leftover.why
      }
    }
    case 'heavy': {
      const r = item.row
      return {
        icon: heavyIcon(r, props.platform),
        title: r.label,
        description: `${r.processName} · PID ${r.pid}`,
        cards: [
          { icon: MemoryStick, label: t.detail.memory, value: formatBytes(r.memoryBytes) },
          {
            icon: Timer,
            label: t.sheet.runtime,
            value: runtime(r.startedAt),
            sub: r.startedAt == null ? undefined : time(r.startedAt)
          }
        ],
        facts: [
          { label: t.columns.project, value: folder(r.worktree) },
          {
            label: t.columns.branch,
            value: r.worktree?.branch ?? (r.worktree ? text.detached : t.none)
          },
          { label: t.sheet.path, value: r.worktree?.root ?? t.tags.noWorktree },
          { label: t.sheet.children, value: `${r.descendantPids.length}${t.cards.count}` }
        ],
        command: r.commandLine,
        note: t.settings.heavyHelp
      }
    }
    case 'disk': {
      const r = item.row
      const name =
        r.worktreeRoot
          .split(/[\\/]+/)
          .filter(Boolean)
          .pop() ?? r.worktreeRoot
      return {
        icon: DISK_ICON,
        title: name,
        description: r.worktreeRoot,
        badge: r.inUse ? { text: t.disk.inUse, variant: 'secondary' } : null,
        cards: [
          {
            icon: HardDrive,
            label: t.disk.size,
            value: r.totalBytes == null ? t.disk.measuring : formatBytes(r.totalBytes),
            sub: t.disk.sizeSub
          },
          {
            icon: FolderGit2,
            label: t.disk.evidenceTitle,
            value: t.disk.evidence[r.evidence],
            sub: t.disk.evidenceSub
          }
        ],
        facts: [
          { label: t.columns.branch, value: r.branch ?? text.detached },
          { label: t.sheet.branchKind, value: t.sheet.linked },
          { label: t.sheet.path, value: r.worktreeRoot }
        ],
        folders: r.folders,
        note: r.inUse ? t.disk.inUseNote : t.disk.evidenceNote[r.evidence]
      }
    }
  }
  return null
})

const folderSize = (f: DiskRow['folders'][number]): string =>
  f.skipped === 'link'
    ? t.disk.link
    : f.skipped === 'unreadable'
      ? t.disk.unreadable
      : f.bytes == null
        ? t.disk.measuring
        : formatBytes(f.bytes)
</script>

<template>
  <Sheet
    v-model:open="open"
    :close-label="t.sheet.done"
    :aria-label="view?.title"
    class="gap-6 overflow-y-auto p-6 *:shrink-0 w-full sm:max-w-3xl"
  >
    <template v-if="view && item">
      <div data-slot="sheet-header" class="flex flex-col gap-1.5">
        <div class="flex items-start gap-3 pr-8">
          <div
            class="flex size-12 shrink-0 items-center justify-center rounded-xl border border-border bg-muted"
          >
            <ItemIcon :icon="view.icon" :size="28" />
          </div>
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <h2 data-slot="sheet-title" class="break-all text-xl font-medium text-foreground">
                {{ view.title }}
              </h2>
              <Badge v-if="view.badge" :variant="view.badge.variant" class="font-normal">{{
                view.badge.text
              }}</Badge>
            </div>
            <p
              data-slot="sheet-description"
              class="break-all text-sm text-muted-foreground"
              data-selectable
            >
              {{ view.description }}
            </p>
          </div>
        </div>
      </div>

      <div
        v-if="item.kind === 'port' || item.kind === 'leftover' || item.kind === 'disk'"
        class="flex flex-wrap gap-2"
      >
        <Button
          v-if="item.kind === 'port'"
          variant="outline"
          size="sm"
          data-action="open"
          @click="emit('open')"
        >
          <ExternalLink />{{ t.actions.open }}
        </Button>
        <Button
          v-if="item.kind === 'port' && !item.row.unresolvable"
          variant="destructive"
          size="sm"
          data-action="kill"
          :disabled="busy"
          @click="emit('kill')"
        >
          <X />{{ t.actions.kill }}
        </Button>
        <Button
          v-if="item.kind === 'leftover'"
          variant="destructive"
          size="sm"
          data-action="kill"
          :disabled="busy"
          @click="emit('kill')"
        >
          <X />{{ t.actions.killLeftover }}
        </Button>
        <Button
          v-if="item.kind === 'disk'"
          variant="destructive"
          size="sm"
          data-action="remove"
          :disabled="busy || item.row.inUse"
          @click="emit('remove')"
        >
          <Trash2 />{{ t.actions.remove }}
        </Button>
      </div>

      <div class="grid grid-cols-2 gap-4">
        <Card v-for="card in view.cards" :key="card.label" size="sm" class="gap-2">
          <CardHeader>
            <CardDescription class="flex items-center gap-2">
              <component :is="card.icon" class="size-4" />{{ card.label }}
            </CardDescription>
          </CardHeader>
          <CardContent class="flex-1 justify-between gap-3">
            <p class="text-2xl font-semibold tabular-nums">{{ card.value }}</p>
            <ResourceTrend
              v-if="card.trend"
              :points="memoryHistory"
              :window-ms="windowMs"
              color="var(--chart-3)"
              :label="card.label"
              :format="formatBytes"
            />
            <p v-else-if="card.sub" class="text-xs text-muted-foreground">{{ card.sub }}</p>
          </CardContent>
        </Card>
      </div>

      <Card size="sm">
        <CardHeader
          ><CardTitle class="text-sm">{{ t.sheet.info }}</CardTitle></CardHeader
        >
        <CardContent class="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
          <div v-for="fact in view.facts" :key="fact.label" class="min-w-0">
            <p class="text-xs text-muted-foreground">{{ fact.label }}</p>
            <p class="mt-1 break-all" data-selectable>{{ fact.value }}</p>
          </div>
        </CardContent>
      </Card>

      <Card v-if="view.folders" size="sm">
        <CardHeader>
          <CardTitle class="flex items-center gap-2 text-sm">
            <FolderGit2 class="size-4" />{{ t.disk.folders
            }}<Badge variant="secondary">{{ view.folders.length }}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div :class="TABLE.container">
            <table :class="TABLE.table">
              <thead :class="TABLE.header">
                <tr :class="TABLE.row">
                  <th :class="TABLE.head">{{ t.disk.folders }}</th>
                  <th :class="[TABLE.head, 'text-right']">{{ t.disk.size }}</th>
                </tr>
              </thead>
              <tbody :class="TABLE.body">
                <tr v-for="f in view.folders" :key="f.path" :class="TABLE.row">
                  <td :class="[TABLE.cell, 'whitespace-normal']">
                    <p class="text-xs">{{ f.name }}</p>
                    <p
                      class="break-all font-mono text-[11px] text-muted-foreground"
                      data-selectable
                    >
                      {{ f.path }}
                    </p>
                  </td>
                  <td :class="[TABLE.cell, 'text-right font-mono text-xs']">{{ folderSize(f) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card v-if="view.command" size="sm">
        <CardHeader>
          <CardTitle class="flex items-center gap-2 text-sm">
            <Terminal class="size-4" />{{ t.sheet.commandLine }}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <pre
            class="max-h-44 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border bg-background p-3 font-mono text-xs"
            data-selectable
            >{{ view.command }}</pre>
        </CardContent>
      </Card>

      <p v-if="view.note" class="text-xs leading-relaxed text-muted-foreground">{{ view.note }}</p>
    </template>
  </Sheet>
</template>
