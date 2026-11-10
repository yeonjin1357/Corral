<!--
  NeoHtop (MIT) modals/ProcessDetailsModal.svelte 의 오른쪽 패널(아이콘 상자 + 제목, 두 숫자 카드, 정보 카드, 명령줄 카드).
  바꾼 점: 프로세스 하나 대신 pitwall 항목(포트·에이전트·남은 프로세스·무거운 작업·디스크 정리)을 보여 주고,
  제목 아래에 그 항목의 동작(브라우저로 열기·내리기·끄기·지우기) 버튼을 둔다. 모두 OS 확인 창을 거친다.
-->
<script setup lang="ts">
import { computed } from 'vue'
import {
  Cpu,
  EyeOff,
  ExternalLink,
  FolderGit2,
  HardDrive,
  Layers,
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
  ServerRow,
  WorktreeInfo
} from '../../../shared/types'
import {
  displayCpuPercent,
  formatBytes,
  formatDuration,
  portList,
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
import { DISK_ICON, agentIcon, heavyIcon, leftoverIcon, serverIcon, type RowIcon } from '../rows'

export type Selected =
  | { kind: 'server'; row: ServerRow }
  | { kind: 'agent'; row: AgentRow }
  | { kind: 'leftover'; row: LeftoverRow }
  | { kind: 'heavy'; row: HeavyJobRow }
  | { kind: 'disk'; row: DiskRow }

const props = defineProps<{
  item: Selected | null
  now: number
  memoryHistory: Point[]
  windowMs: number
  /** 기록이 이보다 끊기면 그래프를 잇지 않는다(앱이 꺼져 있었음). */
  gapMs?: number | null
  busy: boolean
  hook: ClaudeHookStatus | null
  platform: Platform | null
  cpuCount: number
}>()
const emit = defineEmits<{ open: [port: number]; kill: []; remove: []; hide: [] }>()
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
const cpuText = (cpuPercent: number | null): string => {
  const cpu = displayCpuPercent(cpuPercent, props.platform, props.cpuCount)
  return cpu == null ? t.none : `${cpu.toFixed(1)}%`
}
/** 메모리 카드 보조 줄에 붙일 커밋(모르면 없음). */
const commitSub = (commitBytes: number | null | undefined): string | undefined =>
  commitBytes == null ? undefined : t.detail.commitSub(formatBytes(commitBytes))
const workspaceText = (ws: { name: string; root: string } | null): string =>
  ws ? `${ws.name} · ${ws.root}` : t.none

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

/** 메모리에 센 프로세스(자기 포함)를 이름별로. 한도로 잘린 나머지는 개수만. */
const processes = computed(() => {
  const item = props.item
  if (!item || item.kind === 'disk') return null
  const total =
    1 + (item.kind === 'agent' ? item.row.descendantCount : item.row.descendantPids.length)
  const list = item.row.processes
  const shown = list.reduce((n, p) => n + p.count, 0)
  return { list, total, rest: Math.max(0, total - shown) }
})

const view = computed<View | null>(() => {
  const item = props.item
  if (!item) return null
  switch (item.kind) {
    case 'server': {
      const r = item.row
      // 덮는 에이전트가 모두 오래 쉬는 세션이면(G2) 확인해볼 것에 에이전트가 쉰 기간을 붙인다(표의 상태 칸과 같은 규칙).
      const parkedFor =
        r.parkedAgent && r.parkedSince != null
          ? formatDuration(Math.max(0, props.now - r.parkedSince))
          : null
      const status = r.unresolvable
        ? t.rowStatus.unresolvable
        : r.judgement === 'candidate'
          ? t.rowStatus.candidate
          : r.judgement === 'check'
            ? parkedFor != null
              ? t.rowStatus.checkParked(parkedFor)
              : t.rowStatus.check
            : r.clientCount > 0
              ? t.rowStatus.inUse
              : r.parkedAgent
                ? t.rowStatus.agentParked
                : r.agentInWorktree
                  ? t.rowStatus.agent
                  : t.rowStatus.idle
      return {
        icon: serverIcon(r, props.platform),
        title: r.unresolvable ? portList(r.ports) : folder(r.worktree),
        description: `${t.detail.url(r.ports[0])} · ${r.processName} · PID ${r.pid}`,
        badge: {
          text: status,
          variant: r.judgement === 'candidate' ? 'destructive' : 'secondary'
        },
        cards: [
          {
            icon: MemoryStick,
            label: t.detail.memory,
            value: formatBytes(r.memoryBytes),
            sub: commitSub(r.commitBytes),
            trend: true
          },
          {
            icon: Cpu,
            label: t.agent.cpu,
            value: cpuText(r.cpuPercent),
            sub: props.platform === 'win32' ? t.agent.cpuSubWindows : t.agent.cpuSub
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
          { label: t.columns.port, value: portList(r.ports) },
          { label: t.sheet.workspace, value: workspaceText(r.workspace) },
          { label: t.columns.branch, value: r.worktree?.branch ?? text.detached },
          { label: t.sheet.branchKind, value: r.worktree ? branchKind(r.worktree) : t.none },
          { label: t.sheet.path, value: r.worktree?.root ?? t.none },
          { label: t.columns.process, value: r.processName },
          { label: t.sheet.pid, value: String(r.pid) },
          { label: t.sheet.startedAt, value: r.startedAt == null ? t.none : time(r.startedAt) }
        ],
        command: r.commandLine
      }
    }
    case 'agent': {
      const r = item.row
      const note =
        r.tool === 'codex'
          ? r.stateSource === 'cpu'
            ? t.agent.codexNote
            : r.stateSource === 'rollout'
              ? t.agent.codexRolloutNote
              : null
          : props.hook?.state === 'on'
            ? null
            : r.stateSource === 'file'
              ? t.agent.fileNote
              : r.stateSource === 'cpu'
                ? t.agent.noHookNote
                : null
      const state = t.agent.states[r.state]
      return {
        icon: agentIcon(r),
        title: folder(r.worktree),
        description: `${t.agent.toolNames[r.tool]} · PID ${r.pid}`,
        badge: {
          text:
            r.stateSince != null && r.state !== 'unknown'
              ? t.rowStatus.withTime(state, formatDuration(Math.max(0, props.now - r.stateSince)))
              : state,
          variant: r.state === 'error' ? 'destructive' : 'secondary'
        },
        cards: [
          {
            icon: MemoryStick,
            label: t.detail.memory,
            value: formatBytes(r.memoryBytes),
            sub: commitSub(r.commitBytes),
            trend: true
          },
          {
            icon: Cpu,
            label: t.agent.cpu,
            value: cpuText(r.cpuPercent),
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
          { label: t.sheet.workspace, value: workspaceText(r.workspace) },
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
          {
            icon: MemoryStick,
            label: t.detail.memory,
            value: formatBytes(r.memoryBytes),
            sub: commitSub(r.commitBytes)
          },
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
          { label: t.sheet.path, value: r.worktree?.root ?? t.tags.noWorktree }
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
          {
            icon: MemoryStick,
            label: t.detail.memory,
            value: formatBytes(r.memoryBytes),
            sub: commitSub(r.commitBytes)
          },
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
          { label: t.sheet.path, value: r.worktree?.root ?? t.tags.noWorktree }
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
      : f.skipped === 'tracked'
        ? t.disk.tracked
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
        v-if="item.kind === 'server' || item.kind === 'leftover' || item.kind === 'disk'"
        class="flex flex-wrap gap-2"
      >
        <template v-if="item.kind === 'server'">
          <!-- 포트가 여럿이면 포트마다(화면을 내주는 포트가 첫 포트가 아닐 수 있다). -->
          <Button
            v-for="port in item.row.ports"
            :key="port"
            variant="outline"
            size="sm"
            data-action="open"
            :title="t.detail.url(port)"
            @click="emit('open', port)"
          >
            <ExternalLink />{{ item.row.ports.length > 1 ? `:${port}` : t.actions.open }}
          </Button>
        </template>
        <Button
          v-if="item.kind === 'server' && !item.row.unresolvable"
          variant="destructive"
          size="sm"
          data-action="kill"
          :disabled="busy"
          @click="emit('kill')"
        >
          <X />{{ t.actions.kill }}
        </Button>
        <Button
          v-if="item.kind === 'server'"
          variant="outline"
          size="sm"
          data-action="hide"
          :title="t.group.hideHint"
          @click="emit('hide')"
        >
          <EyeOff />{{ t.actions.hide }}
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
            <div>
              <p class="text-2xl font-semibold tabular-nums">{{ card.value }}</p>
              <p v-if="card.trend && card.sub" class="text-xs text-muted-foreground">
                {{ card.sub }}
              </p>
            </div>
            <ResourceTrend
              v-if="card.trend"
              :points="memoryHistory"
              :window-ms="windowMs"
              :gap-ms="gapMs"
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

      <Card v-if="processes && processes.list.length" size="sm" data-processes>
        <CardHeader>
          <CardTitle class="flex items-center gap-2 text-sm">
            <Layers class="size-4" />{{ t.sheet.processes(processes.total) }}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div :class="TABLE.container">
            <table :class="TABLE.table">
              <tbody :class="TABLE.body">
                <tr
                  v-for="p in processes.list"
                  :key="`${p.name}:${p.hint ?? ''}`"
                  data-process-row
                  :class="TABLE.row"
                >
                  <td :class="[TABLE.cell, 'whitespace-normal']">
                    <span class="font-mono text-xs" data-selectable>{{ p.name }}</span
                    >{{ p.hint ? ' ' : ''
                    }}<span v-if="p.hint" class="text-xs text-muted-foreground" data-selectable>{{
                      p.hint
                    }}</span>
                  </td>
                  <td
                    :class="[TABLE.cell, 'text-right text-xs text-muted-foreground tabular-nums']"
                  >
                    ×{{ p.count }}
                  </td>
                  <td :class="[TABLE.cell, 'text-right font-mono text-xs']">
                    {{ formatBytes(p.memoryBytes) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-if="processes.rest" data-process-rest class="mt-2 text-xs text-muted-foreground">
            {{ t.sheet.processRest(processes.rest) }}
          </p>
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
