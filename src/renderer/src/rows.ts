/**
 * 표에 보일 행·칸을 스냅샷에서 만든다(화면 모양과 상관없는 순수 함수라 데이터 정확성을 따로 시험한다).
 * 표 모양은 NeoHtop (MIT) process/ProcessTable·ProcessRow 를 따른다: 첫 칸이 이름(누르면 상세), 숫자 칸은 오른쪽 정렬.
 */
import type {
  AgentRow,
  AgentTool,
  AppUsage,
  DashboardSnapshot,
  HeavyJobRow,
  LeftoverRow,
  Platform,
  ServerRow,
  WorktreeInfo
} from '../../shared/types'
import { selectionKey } from '../../shared/keys'
import {
  displayCpuPercent,
  formatBytes,
  formatDuration,
  portList,
  worktreeFolder
} from '../../shared/format'
import { exePathOf } from '../../shared/exePath'
import { text } from '../../shared/text'
import { appBrand, devServerBrand, heavyBrand, leftoverBrand, type Brand } from './brand'
import claudeCodeLogo from './assets/brands/claude-code.svg'
import codexLogo from './assets/brands/codex.svg'

export type TabKey = 'ports' | 'agents' | 'leftovers' | 'heavy' | 'disk' | 'apps'
export const TABS: TabKey[] = ['ports', 'agents', 'leftovers', 'heavy', 'disk', 'apps']

/** 상태 점 색: running 초록 · idle 회색 · stopped 빨강 · warn 주황(NeoHtop status-* 와 peach). */
export type Tone = 'running' | 'idle' | 'stopped' | 'warn'

/**
 * 행 아이콘(NeoHtop ProcessIcon 처럼). 넣어 둔 로고(image) → OS 앱 아이콘(exePath)·브랜드 로고(brand) 중 prefer 쪽 → 기본 아이콘.
 */
export interface RowIcon {
  /** 앱에 넣어 둔 로고(Claude Code·Codex). */
  image?: string | null
  brand?: Brand | null
  exePath?: string | null
  prefer?: 'native' | 'brand'
  fallback: 'globe' | 'terminal' | 'app' | 'folder' | 'hammer' | 'unplug'
  /** 아이콘이 뜻하는 것(알림 풍선·읽어 주기). */
  title?: string
}

export interface Cell {
  text: string
  icon?: RowIcon
  /** 정렬 기준(없으면 text). */
  sort?: number | string
  title?: string
  mono?: boolean
  muted?: boolean
  dot?: Tone
}

export type ActionKind = 'open' | 'details' | 'kill' | 'remove'
export interface RowAction {
  kind: ActionKind
  label: string
  disabled?: boolean
}

export interface Column {
  id: string
  label: string
  width: number
  align?: 'right'
}

export interface Row {
  /** 선택 키(상세 패널·알림 이동). 고를 수 없는 행(다른 앱)은 null. */
  key: string | null
  /** 행 고유 키(화면 그리기용). */
  id: string
  cells: Record<string, Cell>
  actions: RowAction[]
  /** 검색에 쓰는 글자(소문자). */
  search: string
}

export interface Table {
  columns: Column[]
  rows: Row[]
  /** 처음 정렬(칸 id, 방향). */
  sort: { id: string; dir: 'asc' | 'desc' }
}

const c = text.ui.columns
const st = text.ui.rowStatus
const ACTIONS = text.ui.actions

const folderOf = (w: WorktreeInfo | null): string =>
  w ? worktreeFolder(w) : text.ui.tags.noWorktree
const branchOf = (w: WorktreeInfo | null): Cell => ({
  text: w ? (w.branch ?? text.detached) : text.ui.none,
  title: w?.branch ?? undefined,
  muted: true
})
const memoryCell = (bytes: number): Cell => ({ text: formatBytes(bytes), sort: bytes, mono: true })
const runtimeCell = (now: number, startedAt: number | null): Cell =>
  startedAt == null
    ? { text: text.ui.none, sort: -1, muted: true }
    : { text: formatDuration(now - startedAt), sort: now - startedAt }
const searchOf = (...parts: (string | number | null | undefined)[]): string =>
  parts
    .filter((p) => p != null && p !== '')
    .join(' ')
    .toLowerCase()

function serverStatus(row: ServerRow, now: number): Cell {
  const idle = row.idleSince != null ? ` · ${formatDuration(now - row.idleSince)}` : ''
  if (row.unresolvable) return { text: st.unresolvable, dot: 'idle' }
  if (row.judgement === 'candidate') return { text: `${st.candidate}${idle}`, dot: 'stopped' }
  if (row.judgement === 'check') return { text: `${st.check}${idle}`, dot: 'warn' }
  if (row.clientCount > 0) return { text: st.inUse, dot: 'running' }
  if (row.agentInWorktree) return { text: st.agent, dot: 'idle' }
  return { text: `${st.idle}${idle}`, dot: 'idle' }
}

const TOOL_LOGO: Record<AgentTool, string> = { claude: claudeCodeLogo, codex: codexLogo }

export function serverIcon(row: ServerRow, platform: Platform | null): RowIcon {
  const brand = devServerBrand(row.commandLine)
  return {
    brand,
    exePath: exePathOf(row.commandLine, platform),
    prefer: 'brand',
    fallback: 'globe',
    title: brand?.title ?? row.processName
  }
}
export function agentIcon(row: AgentRow): RowIcon {
  return {
    image: TOOL_LOGO[row.tool],
    fallback: 'terminal',
    title: text.ui.agent.toolNames[row.tool]
  }
}
export function leftoverIcon(row: LeftoverRow, platform: Platform | null): RowIcon {
  const brand = leftoverBrand(row.label, row.commandLine)
  return {
    brand,
    exePath: exePathOf(row.commandLine, platform),
    prefer: 'brand',
    fallback: 'unplug',
    title: brand?.title ?? row.processName
  }
}
export function heavyIcon(row: HeavyJobRow, platform: Platform | null): RowIcon {
  const brand = heavyBrand(row.label, row.commandLine)
  return {
    brand,
    exePath: exePathOf(row.commandLine, platform),
    prefer: 'brand',
    fallback: 'hammer',
    title: brand?.title ?? row.processName
  }
}
export const DISK_ICON: RowIcon = { fallback: 'folder' }
export function appIcon(app: AppUsage): RowIcon {
  return {
    brand: appBrand(app.name),
    exePath: app.exePath,
    prefer: 'native',
    fallback: 'app',
    title: app.name
  }
}

const AGENT_TONE: Record<DashboardSnapshot['agents'][number]['state'], Tone> = {
  working: 'running',
  waiting: 'warn',
  idle: 'idle',
  error: 'stopped',
  unknown: 'idle'
}

export function tableFor(tab: TabKey, s: DashboardSnapshot): Table {
  const now = s.takenAt
  switch (tab) {
    case 'ports':
      return {
        columns: [
          { id: 'name', label: c.project, width: 220 },
          { id: 'port', label: c.port, width: 124 },
          { id: 'branch', label: c.branch, width: 240 },
          { id: 'status', label: c.status, width: 180 },
          { id: 'clients', label: c.clients, width: 64, align: 'right' },
          { id: 'memory', label: c.memory, width: 96, align: 'right' },
          { id: 'process', label: c.process, width: 160 }
        ],
        sort: { id: 'port', dir: 'asc' },
        rows: s.servers.map((p) => ({
          key: selectionKey.server(p),
          id: selectionKey.server(p),
          cells: {
            name: {
              text: folderOf(p.worktree),
              title: p.worktree?.root,
              icon: serverIcon(p, s.platform)
            },
            // 서버가 연 포트를 한 칸에. 정렬은 첫 포트로.
            port: { text: portList(p.ports), sort: p.ports[0], mono: true },
            branch: branchOf(p.worktree),
            status: serverStatus(p, now),
            clients: { text: String(p.clientCount), sort: p.clientCount, mono: true },
            memory: memoryCell(p.memoryBytes),
            process: { text: p.processName, mono: true, muted: true }
          },
          actions: [
            { kind: 'open', label: ACTIONS.open },
            { kind: 'details', label: ACTIONS.details },
            ...(p.unresolvable ? [] : [{ kind: 'kill' as const, label: ACTIONS.kill }])
          ],
          search: searchOf(
            folderOf(p.worktree),
            p.worktree?.branch,
            p.processName,
            portList(p.ports),
            p.ports.join(' ')
          )
        }))
      }
    case 'agents':
      return {
        columns: [
          { id: 'name', label: c.project, width: 220 },
          { id: 'branch', label: c.branch, width: 240 },
          { id: 'status', label: c.status, width: 120 },
          { id: 'cpu', label: c.cpu, width: 72, align: 'right' },
          { id: 'memory', label: c.memory, width: 96, align: 'right' },
          { id: 'runtime', label: c.runtime, width: 110, align: 'right' }
        ],
        sort: { id: 'name', dir: 'asc' },
        rows: s.agents.map((a) => {
          const cpu = displayCpuPercent(a.cpuPercent, s.platform, s.cpuCount)
          return {
            key: selectionKey.agent(a),
            id: selectionKey.agent(a),
            cells: {
              name: { text: folderOf(a.worktree), title: a.worktree?.root, icon: agentIcon(a) },
              branch: branchOf(a.worktree),
              status: { text: text.ui.agent.states[a.state], dot: AGENT_TONE[a.state] },
              cpu:
                cpu == null
                  ? { text: text.ui.none, sort: -1, muted: true }
                  : { text: `${cpu.toFixed(1)}%`, sort: cpu, mono: true },
              memory: memoryCell(a.memoryBytes),
              runtime: runtimeCell(now, a.startedAt)
            },
            actions: [{ kind: 'details', label: ACTIONS.details }],
            search: searchOf(
              folderOf(a.worktree),
              a.worktree?.branch,
              text.ui.agent.toolNames[a.tool],
              text.ui.agent.states[a.state]
            )
          }
        })
      }
    case 'leftovers':
      return {
        columns: [
          { id: 'name', label: c.name, width: 200 },
          { id: 'project', label: c.project, width: 200 },
          { id: 'status', label: c.status, width: 140 },
          { id: 'memory', label: c.memory, width: 96, align: 'right' },
          { id: 'runtime', label: c.runtime, width: 110, align: 'right' },
          { id: 'process', label: c.process, width: 160 }
        ],
        sort: { id: 'memory', dir: 'desc' },
        rows: s.leftovers.map((l) => {
          const key = selectionKey.leftover(l)
          return {
            key,
            id: key,
            cells: {
              name: { text: l.label, title: l.commandLine, icon: leftoverIcon(l, s.platform) },
              project: { text: folderOf(l.worktree), title: l.worktree?.root },
              status: l.agentInWorktree
                ? { text: st.leftoverAgent, dot: 'idle' as const }
                : { text: st.leftoverFree, dot: 'warn' as const },
              memory: memoryCell(l.memoryBytes),
              runtime: runtimeCell(now, l.startedAt),
              process: { text: l.processName, mono: true, muted: true }
            },
            actions: [
              { kind: 'details', label: ACTIONS.details },
              { kind: 'kill', label: ACTIONS.killLeftover }
            ],
            search: searchOf(l.label, l.processName, folderOf(l.worktree), l.worktree?.branch)
          }
        })
      }
    case 'heavy':
      return {
        columns: [
          { id: 'name', label: c.command, width: 180 },
          { id: 'project', label: c.project, width: 220 },
          { id: 'memory', label: c.memory, width: 96, align: 'right' },
          { id: 'runtime', label: c.runtime, width: 110, align: 'right' },
          { id: 'process', label: c.process, width: 160 }
        ],
        sort: { id: 'memory', dir: 'desc' },
        rows: s.heavyJobs.map((j) => ({
          key: `heavy:${j.pid}:${j.startedAt ?? ''}`,
          id: `heavy:${j.pid}:${j.startedAt ?? ''}`,
          cells: {
            name: { text: j.label, title: j.commandLine, icon: heavyIcon(j, s.platform) },
            project: { text: folderOf(j.worktree), title: j.worktree?.root },
            memory: memoryCell(j.memoryBytes),
            runtime: runtimeCell(now, j.startedAt),
            process: { text: j.processName, mono: true, muted: true }
          },
          actions: [{ kind: 'details', label: ACTIONS.details }],
          search: searchOf(j.label, j.processName, folderOf(j.worktree), j.worktree?.branch)
        }))
      }
    case 'disk':
      return {
        columns: [
          { id: 'name', label: c.worktree, width: 220 },
          { id: 'branch', label: c.branch, width: 240 },
          { id: 'evidence', label: c.evidence, width: 110 },
          { id: 'folders', label: c.folders, width: 180 },
          { id: 'size', label: c.size, width: 96, align: 'right' },
          { id: 'status', label: c.status, width: 120 }
        ],
        sort: { id: 'size', dir: 'desc' },
        rows: (s.disk?.rows ?? []).map((r) => {
          const key = selectionKey.disk(r.worktreeRoot)
          const folder =
            r.worktreeRoot
              .split(/[\\/]+/)
              .filter(Boolean)
              .pop() ?? r.worktreeRoot
          return {
            key,
            id: key,
            cells: {
              name: { text: folder, title: r.worktreeRoot, icon: DISK_ICON },
              branch: {
                text: r.branch ?? text.detached,
                title: r.branch ?? undefined,
                muted: true
              },
              evidence: { text: text.ui.disk.evidence[r.evidence] },
              folders: {
                text: r.folders.map((f) => f.name).join(', ') || text.ui.none,
                muted: true
              },
              size:
                r.totalBytes == null
                  ? { text: text.ui.disk.measuring, sort: -1, muted: true }
                  : { text: formatBytes(r.totalBytes), sort: r.totalBytes, mono: true },
              status: r.inUse
                ? { text: st.diskInUse, dot: 'warn' as const }
                : { text: st.diskFree, dot: 'running' as const }
            },
            actions: [
              { kind: 'details', label: ACTIONS.details },
              { kind: 'remove', label: ACTIONS.remove, disabled: r.inUse }
            ],
            search: searchOf(folder, r.branch, r.worktreeRoot)
          }
        })
      }
    case 'apps':
      return {
        columns: [
          { id: 'name', label: c.app, width: 260 },
          { id: 'memory', label: c.memory, width: 110, align: 'right' },
          { id: 'processes', label: c.processes, width: 110, align: 'right' }
        ],
        sort: { id: 'memory', dir: 'desc' },
        rows: s.topApps.map((a) => ({
          key: null,
          id: `app:${a.name}`,
          cells: {
            name: { text: a.name.replace(/\.exe$/i, ''), title: a.name, icon: appIcon(a) },
            memory: memoryCell(a.memoryBytes),
            processes: {
              text: text.ui.groups.processes(a.processCount),
              sort: a.processCount
            }
          },
          actions: [],
          search: searchOf(a.name)
        }))
      }
  }
}

/** 검색어로 거르기. `:3000` 처럼 앞에 콜론을 붙여도 포트를 찾는다. */
export function filterRows(rows: Row[], query: string): Row[] {
  const q = query.trim().toLowerCase()
  if (!q) return rows
  return rows.filter((r) => r.search.includes(q) || r.search.includes(q.replace(/^:/, '')))
}

export function sortRows(rows: Row[], id: string, dir: 'asc' | 'desc'): Row[] {
  const value = (r: Row): number | string => {
    const cell = r.cells[id]
    return cell?.sort ?? cell?.text ?? ''
  }
  const sign = dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const x = value(a)
    const y = value(b)
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * sign
    return String(x).localeCompare(String(y), 'ko') * sign
  })
}
