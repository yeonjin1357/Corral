/**
 * 표에 보일 행·칸을 스냅샷에서 만든다(화면 모양과 상관없는 순수 함수라 데이터 정확성을 따로 시험한다).
 * 표 모양은 NeoHtop (MIT) process/ProcessTable·ProcessRow 를 따른다: 첫 칸이 이름(누르면 상세), 숫자 칸은 오른쪽 정렬.
 */
import { agentsInWorkspace } from '../../shared/workspace'
import type {
  AgentRow,
  AgentTool,
  AppUsage,
  DashboardSnapshot,
  DiskRow,
  HeavyJobRow,
  LeftoverRow,
  Platform,
  ServerRow,
  AgentState,
  WorkspaceRow,
  WorktreeInfo
} from '../../shared/types'
import { selectionKey } from '../../shared/keys'
import {
  agentCovers,
  commitSum,
  displayCpuPercent,
  formatBytes,
  formatDuration,
  formatContext,
  portList,
  worktreeFolder,
  worktreeKey
} from '../../shared/format'
import { exePathOf } from '../../shared/exePath'
import { text } from '../../shared/text'
import { appBrand, devServerBrand, heavyBrand, leftoverBrand, type Brand } from './brand'
import { clamp01, tipPercent } from './memory'
import claudeCodeLogo from './assets/brands/claude-code.svg'
import codexLogo from './assets/brands/codex.svg'

export type TabKey =
  'workspaces' | 'ports' | 'agents' | 'leftovers' | 'heavy' | 'disk' | 'apps' | 'events'
export const TABS: TabKey[] = [
  'workspaces',
  'ports',
  'agents',
  'leftovers',
  'heavy',
  'disk',
  'apps',
  'events'
]
/** 스냅샷으로 표를 만드는 탭(기록은 따로 `eventsTable`). */
export type SnapshotTab = Exclude<TabKey, 'events'>

/** 상태 점 색: running 초록 · idle 회색 · stopped 빨강 · warn 주황(NeoHtop status-* 와 peach). */
export type Tone = 'running' | 'idle' | 'stopped' | 'warn'
/** 상태 점의 색(표·연동 상태가 같이 쓴다). */
export const TONE_COLOR: Record<Tone, string> = {
  running: 'var(--status-running)',
  idle: 'var(--status-idle)',
  stopped: 'var(--status-stopped)',
  warn: 'var(--peach)'
}

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
  /** 글자 옆 작은 표시(메모리 증가 등). */
  badge?: string
  /** 메모리 칸의 막대(G5): 그 표의 기준 대비 비중 0~1. withMemoryShares 가 채운다. */
  share?: number
}

export type ActionKind = 'open' | 'details' | 'kill' | 'remove' | 'unhide'
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
  /** 머리글 풍선말(메모리 칸에 막대의 기준). */
  hint?: string
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
/** 커밋 칸. 모르면 —(정렬에서는 맨 뒤). */
const commitCell = (bytes: number | null | undefined): Cell =>
  bytes == null
    ? { text: text.ui.none, sort: -1, muted: true }
    : { text: formatBytes(bytes), sort: bytes, mono: true }
const COMMIT_COLUMN: Column = { id: 'commit', label: c.commit, width: 96, align: 'right' }
/** 컨텍스트 칸(G6): "132k", 한도를 알면 "132k / 258k". 모르면 —(정렬에서는 맨 뒤). */
const CONTEXT_COLUMN: Column = { id: 'context', label: c.context, width: 90, align: 'right' }
function contextCell(usage: AgentRow['usage']): Cell {
  const used = usage?.contextTokens
  if (used == null) return { text: text.ui.none, sort: -1, muted: true }
  return {
    text: formatContext(used, usage?.contextWindow ?? null),
    sort: used,
    mono: true
  }
}
const runtimeCell = (now: number, startedAt: number | null): Cell =>
  startedAt == null
    ? { text: text.ui.none, sort: -1, muted: true }
    : { text: formatDuration(now - startedAt), sort: now - startedAt }
const searchOf = (...parts: (string | number | null | undefined)[]): string =>
  parts
    .filter((p) => p != null && p !== '')
    .join(' ')
    .toLowerCase()

/**
 * 서버 판단 칸. 덮는 에이전트가 모두 오래 쉬는 세션이면(G2) 확인해볼 것을 짧게("확인해볼 것 · 에이전트 쉼") 보이고
 * 에이전트가 쉰 기간은 title 에(160px 칸에서 기간이 잘리지 않게), 판단 전이면 "에이전트 오래 쉼".
 */
function judgedStatus(row: ServerRow, now: number): Cell {
  const idle = row.idleSince != null ? ` · ${formatDuration(now - row.idleSince)}` : ''
  if (row.unresolvable) return { text: st.unresolvable, dot: 'idle' }
  if (row.judgement === 'candidate') return { text: `${st.candidate}${idle}`, dot: 'stopped' }
  if (row.judgement === 'check')
    return row.parkedAgent && row.parkedSince != null
      ? {
          text: st.checkParked,
          title: st.checkParkedFor(formatDuration(Math.max(0, now - row.parkedSince))),
          dot: 'warn'
        }
      : { text: `${st.check}${idle}`, dot: 'warn' }
  if (row.clientCount > 0) return { text: st.inUse, dot: 'running' }
  if (row.parkedAgent) return { text: st.agentParked, dot: 'idle' }
  if (row.agentInWorktree) return { text: st.agent, dot: 'idle' }
  return { text: `${st.idle}${idle}`, dot: 'idle' }
}

/** 서버 상태 칸. 메모리가 계속 늘면 배지와 근거(F6, 판단 칸의 title 이 있으면 거기에 이어 붙인다). */
function serverStatus(row: ServerRow, now: number): Cell {
  const cell = judgedStatus(row, now)
  const g = row.memoryGrowth
  if (!g) return cell
  return {
    ...cell,
    badge: st.memoryGrowth,
    title: `${cell.title ?? cell.text} · ${st.memoryGrowthTitle(g.minutes, formatBytes(g.fromBytes), formatBytes(g.toBytes))}`
  }
}

/** CPU 칸(OS 도구와 같은 기준). 모르면 '-'. */
function cpuCell(cpuPercent: number | null, s: DashboardSnapshot): Cell {
  const cpu = displayCpuPercent(cpuPercent, s.platform, s.cpuCount)
  return cpu == null
    ? { text: text.ui.none, sort: -1, muted: true }
    : { text: `${cpu.toFixed(1)}%`, sort: cpu, mono: true }
}

/**
 * 에이전트 상태 칸: "작업 중 · 12분"(F3). 아직 모르는 상태는 시간 없이.
 * 오래 쉬는 세션(G2)은 130px 칸에 배지까지 넣으면 기간이 잘려, 쉬는 중·확인 중이면 글자 자체를
 * "오래 쉼 · 3시간"(마지막 활동부터)으로 하고(오류는 "오류 · 기간" 그대로), title 에 마지막 활동 시각.
 * 조용한 에이전트(G3c)도 같은 까닭으로 "조용함 · 18분"(조용해진 때부터, 주황 점)이고, title 에 실행 중인 도구와 까닭.
 * 트레이 요약 창의 에이전트 줄도 같은 글자를 쓴다.
 */
export function agentStatus(a: AgentRow, now: number): Cell {
  const label = text.ui.agent.states[a.state]
  const ago = (since: number): string => formatDuration(Math.max(0, now - since))
  if (a.quietSince != null) {
    const minutes = Math.floor(Math.max(0, now - a.quietSince) / 60_000)
    return {
      text: st.withTime(st.quiet, ago(a.quietSince)),
      title: st.quietFor(minutes, a.activity?.tool?.name ?? null),
      dot: 'warn'
    }
  }
  const parkedAt = a.parked ? a.lastActiveAt : null
  return {
    text:
      parkedAt != null && a.state !== 'error'
        ? st.withTime(st.parked, ago(parkedAt))
        : a.stateSince != null && a.state !== 'unknown'
          ? st.withTime(label, ago(a.stateSince))
          : label,
    ...(parkedAt != null ? { title: st.lastActive(ago(parkedAt)) } : {}),
    dot: AGENT_TONE[a.state]
  }
}

/**
 * 하는 일 칸(G3b): 권한 대기면 "권한: Bash · npm run build", 기다리는 도구를 모르고 세션 파일로 안 대기 이유가 있으면
 * 그 이유("질문에 답 대기" — 내용이 아니라 상태라 하는 일 보기를 꺼도 보인다), 도구 실행 중이면 "Bash · npm run build",
 * 아니면 세션 제목, 없으면 마지막 요청, 없으면 —. 칸이 좁아 잘리므로 전체 글은 title 에.
 */
function activityCell(a: AgentRow): Cell {
  const act = a.activity
  const ag = text.ui.agent
  const waiting = act?.waiting ? ag.activityTool(act.waiting.tool, act.waiting.summary) : ''
  const label = waiting
    ? ag.activityWaiting(waiting)
    : a.waitReason
      ? ag.waitReason[a.waitReason]
      : act?.tool
        ? ag.activityTool(act.tool.name, act.tool.summary)
        : (act?.title ?? act?.prompt ?? null)
  return label ? { text: label, title: label } : { text: text.ui.none, muted: true }
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
/** Claude Code·Codex 로고(에이전트 행·연동 상태·설정 화면이 같이 쓴다). */
export function toolIcon(tool: AgentTool): RowIcon {
  return {
    image: TOOL_LOGO[tool],
    fallback: 'terminal',
    title: text.ui.agent.toolNames[tool]
  }
}
export function agentIcon(row: AgentRow): RowIcon {
  return toolIcon(row.tool)
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
/** 디스크 행의 근거: 오래 안 쓴 워크트리는 날수까지("오래 안 씀(21일)"), 날수를 모르면 이름만. */
export function diskEvidenceText(r: DiskRow): string {
  return r.evidence === 'stale' && r.staleDays != null
    ? text.ui.disk.staleFor(r.staleDays)
    : text.ui.disk.evidence[r.evidence]
}
const withoutExe = (name: string): string => name.replace(/\.exe$/i, '')
/** 다른 앱 이름: `.exe` 를 떼고, 런타임은 띄운 앱까지("node (Cursor)", G5b). 다른 앱 탭·메모리 상세가 같이 쓴다. */
export function appName(app: AppUsage): string {
  const name = withoutExe(app.name)
  return app.owner ? text.ui.groups.withOwner(name, withoutExe(app.owner)) : name
}
/** 다른 앱 이름의 title: 프로세스 이름 그대로("node.exe — Cursor.exe"). */
export function appTitle(app: AppUsage): string {
  return app.owner ? text.ui.groups.withOwnerTitle(app.name, app.owner) : app.name
}
/** 다른 앱 행 키: 이름이 같아도 띄운 앱이 다르면 다른 행. */
export function appRowId(app: AppUsage): string {
  return `app:${app.name}:${app.owner ?? ''}`
}
/** 프로세스 이름으로 고른 로고와 OS 앱 아이콘(OS 아이콘을 먼저). */
function processIcon(name: string, exePath: string | null, title: string): RowIcon {
  return { brand: appBrand(name), exePath, prefer: 'native', fallback: 'app', title }
}
/** 다른 앱 아이콘. 띄운 앱이 있으면 exePath 가 띄운 앱의 것이라(메인이 담는다) 그 앱 아이콘이 보인다. */
export function appIcon(app: AppUsage): RowIcon {
  return processIcon(app.name, app.exePath, appTitle(app))
}

const AGENT_TONE: Record<AgentState, Tone> = {
  working: 'running',
  waiting: 'warn',
  idle: 'idle',
  error: 'stopped',
  unknown: 'idle'
}

/** 그 표의 모든 행이 커밋을 모르면 커밋 칸을 뺀다(일부만 모르면 그 칸은 —). */
function dropEmptyCommit(table: Table): Table {
  if (!table.columns.some((col) => col.id === 'commit')) return table
  if (table.rows.some((row) => row.cells.commit && row.cells.commit.sort !== -1)) return table
  return {
    ...table,
    columns: table.columns.filter((col) => col.id !== 'commit'),
    rows: table.rows.map((row) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { commit: _, ...cells } = row.cells
      return { ...row, cells }
    })
  }
}

/** 그 표의 모든 행이 컨텍스트를 모르면 컨텍스트 칸을 뺀다(일부만 모르면 그 칸은 —). */
function dropEmptyContext(table: Table): Table {
  if (!table.columns.some((col) => col.id === 'context')) return table
  if (table.rows.some((row) => row.cells.context && row.cells.context.sort !== -1)) return table
  return {
    ...table,
    columns: table.columns.filter((col) => col.id !== 'context'),
    rows: table.rows.map((row) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { context: _, ...cells } = row.cells
      return { ...row, cells }
    })
  }
}

// ── 항목 한 줄: 각 탭과 작업 공간 탭이 같이 쓴다(상태 문구·아이콘·검색·동작이 같게) ──

function serverLine(p: ServerRow, s: DashboardSnapshot): Row {
  const key = selectionKey.server(p)
  return {
    key,
    id: key,
    cells: {
      name: {
        text: folderOf(p.worktree),
        title: p.worktree?.root,
        icon: serverIcon(p, s.platform)
      },
      // 서버가 연 포트를 한 칸에. 정렬은 첫 포트로.
      port: { text: portList(p.ports), sort: p.ports[0], mono: true },
      branch: branchOf(p.worktree),
      status: serverStatus(p, s.takenAt),
      clients: { text: String(p.clientCount), sort: p.clientCount, mono: true },
      cpu: cpuCell(p.cpuPercent, s),
      memory: memoryCell(p.memoryBytes),
      commit: commitCell(p.commitBytes),
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
  }
}

function agentLine(a: AgentRow, s: DashboardSnapshot): Row {
  const key = selectionKey.agent(a)
  return {
    key,
    id: key,
    cells: {
      name: { text: folderOf(a.worktree), title: a.worktree?.root, icon: agentIcon(a) },
      branch: branchOf(a.worktree),
      status: agentStatus(a, s.takenAt),
      activity: activityCell(a),
      context: contextCell(a.usage),
      cpu: cpuCell(a.cpuPercent, s),
      memory: memoryCell(a.memoryBytes),
      commit: commitCell(a.commitBytes),
      runtime: runtimeCell(s.takenAt, a.startedAt)
    },
    actions: [{ kind: 'details', label: ACTIONS.details }],
    search: searchOf(
      folderOf(a.worktree),
      a.worktree?.branch,
      text.ui.agent.toolNames[a.tool],
      text.ui.agent.states[a.state],
      a.activity?.title
    )
  }
}

function leftoverLine(l: LeftoverRow, s: DashboardSnapshot): Row {
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
      commit: commitCell(l.commitBytes),
      runtime: runtimeCell(s.takenAt, l.startedAt),
      process: { text: l.processName, mono: true, muted: true }
    },
    actions: [
      { kind: 'details', label: ACTIONS.details },
      { kind: 'kill', label: ACTIONS.killLeftover }
    ],
    search: searchOf(l.label, l.processName, folderOf(l.worktree), l.worktree?.branch)
  }
}

function heavyLine(j: HeavyJobRow, s: DashboardSnapshot): Row {
  const key = selectionKey.heavy(j)
  return {
    key,
    id: key,
    cells: {
      name: { text: j.label, title: j.commandLine, icon: heavyIcon(j, s.platform) },
      project: { text: folderOf(j.worktree), title: j.worktree?.root },
      memory: memoryCell(j.memoryBytes),
      commit: commitCell(j.commitBytes),
      runtime: runtimeCell(s.takenAt, j.startedAt),
      process: { text: j.processName, mono: true, muted: true }
    },
    actions: [{ kind: 'details', label: ACTIONS.details }],
    search: searchOf(j.label, j.processName, folderOf(j.worktree), j.worktree?.branch)
  }
}

// ── 작업 공간 탭(G4) ──

type MemberKind = keyof typeof text.ui.workspaces.kinds
const NONE: Cell = { text: text.ui.none, sort: -1, muted: true }

/**
 * 작업 공간 탭의 한 줄: 그 항목의 탭과 같은 줄(이름·상태·아이콘·동작·검색)에서 칸을 골라 종류 칸을 더한다.
 * 그 탭에 없는 칸(무거운 작업의 상태, 서버가 아닌 것의 포트, 서버·에이전트가 아닌 것의 CPU)은 —.
 */
function memberLine(line: Row, kind: MemberKind): Row {
  const label = text.ui.workspaces.kinds[kind]
  const pick = (id: string): Cell => line.cells[id] ?? NONE
  return {
    ...line,
    cells: {
      name: line.cells.name,
      kind: { text: label, muted: true },
      status: pick('status'),
      port: pick('port'),
      cpu: pick('cpu'),
      memory: line.cells.memory,
      commit: line.cells.commit
    },
    search: searchOf(line.search, label)
  }
}

/** 작업 공간 줄에 든 구성원만(스냅샷에 없는 키는 건너뛰고, 어느 작업 공간에도 없는 항목은 넣지 않는다). */
function workspaceRows(s: DashboardSnapshot): Row[] {
  const members = new Set(
    s.workspaces.flatMap((w) => [
      ...w.agentKeys,
      ...w.serverKeys,
      ...w.heavyKeys,
      ...w.leftoverKeys
    ])
  )
  return [
    ...s.agents.map((a) => memberLine(agentLine(a, s), 'agent')),
    ...s.servers.map((p) => memberLine(serverLine(p, s), 'server')),
    ...s.heavyJobs.map((j) => memberLine(heavyLine(j, s), 'heavy')),
    ...s.leftovers.map((l) => memberLine(leftoverLine(l, s), 'leftover'))
  ].filter((row) => row.key != null && members.has(row.key))
}

export function tableFor(tab: SnapshotTab, s: DashboardSnapshot): Table {
  return dropEmptyContext(dropEmptyCommit(buildTable(tab, s)))
}

/** 작업 공간 탭의 표(G4): 구성원 한 줄씩. 머리는 groupWorkspaces 가 붙인다. */
export function workspaceTable(s: DashboardSnapshot): Table {
  return tableFor('workspaces', s)
}

function buildTable(tab: SnapshotTab, s: DashboardSnapshot): Table {
  switch (tab) {
    case 'workspaces':
      // 동작 칸(120px)까지 기본 창(1280px)에 들어가게.
      return {
        columns: [
          { id: 'name', label: c.name, width: 220 },
          { id: 'kind', label: c.kind, width: 100 },
          { id: 'status', label: c.status, width: 170 },
          { id: 'port', label: c.port, width: 124 },
          { id: 'cpu', label: c.cpu, width: 64, align: 'right' },
          { id: 'memory', label: c.memory, width: 88, align: 'right' },
          { ...COMMIT_COLUMN, width: 88 }
        ],
        sort: { id: 'memory', dir: 'desc' },
        rows: workspaceRows(s)
      }
    case 'ports':
      return {
        columns: [
          { id: 'name', label: c.project, width: 220 },
          { id: 'port', label: c.port, width: 124 },
          { id: 'branch', label: c.branch, width: 170 },
          { id: 'status', label: c.status, width: 160 },
          { id: 'clients', label: c.clients, width: 64, align: 'right' },
          { id: 'cpu', label: c.cpu, width: 72, align: 'right' },
          { id: 'memory', label: c.memory, width: 96, align: 'right' },
          COMMIT_COLUMN,
          { id: 'process', label: c.process, width: 110 }
        ],
        sort: { id: 'port', dir: 'asc' },
        rows: s.servers.map((p) => serverLine(p, s))
      }
    case 'agents':
      // 하는 일 칸을 더해도 기본 창(1280px)에 들어가게 다른 칸을 줄였다.
      return {
        columns: [
          { id: 'name', label: c.project, width: 200 },
          { id: 'branch', label: c.branch, width: 150 },
          { id: 'status', label: c.status, width: 130 },
          { id: 'activity', label: c.activity, width: 200 },
          CONTEXT_COLUMN,
          { id: 'cpu', label: c.cpu, width: 64, align: 'right' },
          { id: 'memory', label: c.memory, width: 88, align: 'right' },
          { ...COMMIT_COLUMN, width: 88 },
          { id: 'runtime', label: c.runtime, width: 90, align: 'right' }
        ],
        sort: { id: 'name', dir: 'asc' },
        rows: s.agents.map((a) => agentLine(a, s))
      }
    case 'leftovers':
      return {
        columns: [
          { id: 'name', label: c.name, width: 200 },
          { id: 'project', label: c.project, width: 200 },
          { id: 'status', label: c.status, width: 140 },
          { id: 'memory', label: c.memory, width: 96, align: 'right' },
          COMMIT_COLUMN,
          { id: 'runtime', label: c.runtime, width: 110, align: 'right' },
          { id: 'process', label: c.process, width: 160 }
        ],
        sort: { id: 'memory', dir: 'desc' },
        rows: s.leftovers.map((l) => leftoverLine(l, s))
      }
    case 'heavy':
      return {
        columns: [
          { id: 'name', label: c.command, width: 180 },
          { id: 'project', label: c.project, width: 220 },
          { id: 'memory', label: c.memory, width: 96, align: 'right' },
          COMMIT_COLUMN,
          { id: 'runtime', label: c.runtime, width: 110, align: 'right' },
          { id: 'process', label: c.process, width: 160 }
        ],
        sort: { id: 'memory', dir: 'desc' },
        rows: s.heavyJobs.map((j) => heavyLine(j, s))
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
              evidence: { text: diskEvidenceText(r) },
              folders: {
                text: r.folders.map((f) => f.name).join(', ') || text.ui.none,
                muted: true
              },
              size:
                r.totalBytes == null
                  ? { text: text.ui.disk.measuring, sort: -1, muted: true }
                  : { text: formatBytes(r.totalBytes), sort: r.totalBytes, mono: true },
              // 오래 안 쓴 워크트리는 끝났다는 근거가 없어 "확인해볼 것"까지만(G5d).
              status: r.inUse
                ? { text: st.diskInUse, dot: 'warn' as const }
                : r.evidence === 'stale'
                  ? { text: st.check, dot: 'warn' as const }
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
          COMMIT_COLUMN,
          { id: 'processes', label: c.processes, width: 110, align: 'right' }
        ],
        sort: { id: 'memory', dir: 'desc' },
        rows: s.apps.map((a) => ({
          key: null,
          id: appRowId(a),
          cells: {
            name: { text: appName(a), title: appTitle(a), icon: appIcon(a) },
            memory: memoryCell(a.memoryBytes),
            commit: commitCell(a.commitBytes),
            processes: {
              text: text.ui.groups.processes(a.processCount),
              sort: a.processCount
            }
          },
          actions: [],
          search: searchOf(a.name, a.owner)
        }))
      }
  }
}

/** 다른 포트(G5c, 개발 서버 탭 바닥 "다른 포트 n개"). 보기만 한다: 고를 수 없고 동작이 없다. */
export function otherPortsTable(s: DashboardSnapshot): Table {
  return dropEmptyCommit({
    // 동작 칸이 없어 기본 창(1280px)에 넉넉히 들어간다.
    columns: [
      { id: 'port', label: c.port, width: 110 },
      { id: 'name', label: c.process, width: 300 },
      { id: 'pid', label: c.pid, width: 90, align: 'right' },
      { id: 'memory', label: c.memory, width: 96, align: 'right' },
      COMMIT_COLUMN
    ],
    sort: { id: 'port', dir: 'asc' },
    rows: s.otherPorts.map((p) => ({
      key: null,
      id: `other:${p.port}:${p.pid}`,
      cells: {
        port: { text: portList([p.port]), sort: p.port, mono: true },
        name: {
          text: p.processName,
          title: p.exePath ?? p.processName,
          icon: processIcon(p.processName, p.exePath, p.processName)
        },
        pid: { text: String(p.pid), sort: p.pid, mono: true },
        memory: memoryCell(p.memoryBytes),
        commit: commitCell(p.commitBytes)
      },
      actions: [],
      search: searchOf(portList([p.port]), p.port, p.processName)
    }))
  })
}

// ── 메모리 막대(G5) ──

/**
 * 메모리 막대의 기준. rows: 그 표 줄들의 메모리 합(개발 서버·숨긴 서버·에이전트·남은 프로세스·무거운 작업·다른 앱),
 * used: 사용 중인 RAM(작업 공간 탭 — 줄끼리 더하면 같은 프로세스를 두 번 셀 수 있다),
 * none: 막대 없음(다른 포트 보기 — 한 프로세스가 여러 줄에 나온다).
 */
export type MemoryShareBase = { kind: 'rows' } | { kind: 'used'; bytes: number } | { kind: 'none' }

const memoryOf = (row: Row): number => {
  const bytes = row.cells.memory?.sort
  return typeof bytes === 'number' && bytes > 0 ? bytes : 0
}

/**
 * 막대의 분모. 메모리 칸이 없는 표(디스크 정리·기록)·막대 없는 기준·0 이하면 null.
 * 검색으로 거르기 전 표로 구하고, 묶음 머리(groupServers·groupWorkspaces)도 이 값으로 나눈다.
 */
export function memoryShareDenominator(table: Table, base: MemoryShareBase): number | null {
  if (base.kind === 'none' || !table.columns.some((col) => col.id === 'memory')) return null
  const total =
    base.kind === 'used' ? base.bytes : table.rows.reduce((sum, row) => sum + memoryOf(row), 0)
  return total > 0 ? total : null
}

/**
 * 메모리 칸에 그 표 안에서의 비중(0~1 로 자름)과 풍선말(표 합 대비·전체 RAM 대비, 작업 공간 탭은 사용 중 RAM 대비)을,
 * 메모리 머리글에 기준을 채운다. 분모가 없으면 표를 그대로 돌려준다. 검색으로 거르기 전 표에 쓴다(검색해도 막대가 그대로).
 */
export function withMemoryShares(
  table: Table,
  base: MemoryShareBase,
  totalRamBytes: number
): Table {
  const total = memoryShareDenominator(table, base)
  if (total == null) return table
  const T = text.ui.table
  const used = base.kind === 'used'
  const title = (label: string, bytes: number, share: number): string =>
    used
      ? T.memoryShareUsed(label, tipPercent(share))
      : T.memoryShareRows(
          label,
          tipPercent(share),
          totalRamBytes > 0 ? tipPercent(clamp01(bytes / totalRamBytes)) : null
        )
  return {
    ...table,
    columns: table.columns.map((col) =>
      col.id === 'memory' ? { ...col, hint: used ? T.memoryHintUsed : T.memoryHintRows } : col
    ),
    rows: table.rows.map((row) => {
      const cell = row.cells.memory
      // 모르는 값(—)은 막대가 없다.
      if (!cell || typeof cell.sort !== 'number' || cell.sort < 0) return row
      const share = clamp01(cell.sort / total)
      return {
        ...row,
        cells: {
          ...row.cells,
          memory: { ...cell, share, title: title(cell.text, cell.sort, share) }
        }
      }
    })
  }
}

/** 묶음 머리의 막대: 표와 같은 분모로(없으면 막대 없음). */
const headShare = (bytes: number, total: number | null): Pick<GroupHead, 'memoryShare'> =>
  total != null && total > 0 ? { memoryShare: clamp01(bytes / total) } : {}

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

export type GroupAction = 'rename' | 'cleanup' | 'folder'

/** 묶음 머리: 개발 서버 탭의 작업 공간 묶음(F1)과 작업 공간 탭의 작업 공간(G4). */
export interface GroupHead {
  /**
   * 화면 키. 개발 서버 탭은 `group:<작업 공간 키>`, 작업 공간 탭은 WorkspaceRow.key(`ws:…`)라 서로 겹치지 않는다.
   * 접은 묶음을 이 키로 기억한다.
   */
  key: string
  /** 작업 공간 경로. 작업 공간을 모르는 묶음(`ws:?`)은 null. */
  root: string | null
  name: string
  outer: boolean
  /** 구성원 수(개발 서버 탭은 서버 수). */
  count: number
  /** 메모리 합(개발 서버 탭은 서버마다 한 번, 작업 공간 탭은 프로세스마다 한 번). */
  memoryBytes: number
  /** 메모리 막대(G5): 표와 같은 분모 대비 0~1. 분모가 없으면 없다. */
  memoryShare?: number
  /** 커밋 합. 하나도 모르면 null. */
  commitBytes: number | null
  /** 머리에 보일 에이전트 로고와 설명(도구 · 상태 · 경과 시간). */
  agentBadges: { key: string; icon: RowIcon; title: string }[]
  /** 상태 요약. 보일 것이 없으면 글자가 비어 있다. */
  status: Cell
  /** 작업 공간 탭 머리의 요약("서버 3 · 무거운 작업 1 · 변경 12"). 개발 서버 탭 머리에는 없다. */
  summary?: string
  /** 머리 동작. 작업 공간을 모르는 묶음은 없다. */
  actions: GroupAction[]
}
/** 개발 서버 탭의 작업 공간 묶음 머리(F1). */
export type ServerGroup = GroupHead

export interface GroupedRows {
  /** null 이면 머리 없이 서버 줄만(개발 서버 탭에서 혼자인 작업 공간·작업 공간을 모르는 서버). */
  group: GroupHead | null
  rows: Row[]
}

function agentBadge(a: AgentRow, now: number): GroupHead['agentBadges'][number] {
  return {
    key: selectionKey.agent(a),
    icon: agentIcon(a),
    title: `${text.ui.agent.toolNames[a.tool]} · ${agentStatus(a, now).text}`
  }
}

/**
 * 정렬·검색을 거친 서버 줄을 작업 공간별로 묶는다. 묶음 순서는 그 묶음의 줄이 처음 나온 순서라 정렬을 따른다.
 * 서버가 하나뿐인 작업 공간과 작업 공간을 모르는 서버는 머리 없이 그대로 둔다(NeoHtop 트리 보기의 family 처럼).
 * 에이전트는 작업 공간이 같거나, 묶음 안 서버의 워크트리를 덮는(같거나 상위 폴더) 것을 붙인다.
 */
export function groupServers(
  rows: Row[],
  servers: ServerRow[],
  agents: AgentRow[],
  now: number = Date.now(),
  /** 작업 공간의 남은 프로세스(정리 버튼이 같이 끈다). 그 워크트리를 감싸는 에이전트도 머리에 보인다. */
  leftovers: Pick<LeftoverRow, 'workspace' | 'worktree'>[] = [],
  /** 메모리 막대의 분모(검색 전 표의 memoryShareDenominator). 없으면 머리에 막대가 없다. */
  memoryTotal: number | null = null
): GroupedRows[] {
  const byKey = new Map(servers.map((r) => [selectionKey.server(r), r]))
  const buckets = new Map<string, { rows: Row[]; servers: ServerRow[] }>()
  const order: string[] = []
  rows.forEach((row, i) => {
    const server = row.key ? byKey.get(row.key) : undefined
    const id = server?.workspace ? `group:${worktreeKey(server.workspace.root)}` : `solo:${i}`
    let bucket = buckets.get(id)
    if (!bucket) {
      bucket = { rows: [], servers: [] }
      buckets.set(id, bucket)
      order.push(id)
    }
    bucket.rows.push(row)
    if (server) bucket.servers.push(server)
  })
  return order.map((id) => {
    const bucket = buckets.get(id)!
    const ws = bucket.servers[0]?.workspace
    // 머리의 수치는 검색으로 걸러진 줄이 아니라 작업 공간 전체(정리 버튼이 끄는 범위)로 센다.
    const key = ws ? worktreeKey(ws.root) : null
    const all = servers.filter((r) => r.workspace && worktreeKey(r.workspace.root) === key)
    if (!ws || all.length < 2) return { group: null, rows: bucket.rows }
    const members = [
      ...all,
      ...leftovers.filter((r) => r.workspace && worktreeKey(r.workspace.root) === key)
    ]
    const inside = agentsInWorkspace(
      agents,
      ws.root,
      members.flatMap((r) => (r.worktree ? [r.worktree.root] : []))
    )
    const memoryBytes = all.reduce((sum, r) => sum + r.memoryBytes, 0)
    return {
      group: {
        key: id,
        root: ws.root,
        name: ws.name,
        outer: ws.outer,
        count: all.length,
        memoryBytes,
        ...headShare(memoryBytes, memoryTotal),
        commitBytes: commitSum(all),
        agentBadges: inside.map((a) => agentBadge(a, now)),
        status: groupStatus(all),
        actions: ['rename', 'cleanup']
      },
      rows: bucket.rows
    }
  })
}

/**
 * 작업 공간 탭(G4): 정렬·검색을 거친 구성원 줄을 작업 공간별로 묶는다. 묶음 순서는 스냅샷의 workspaces 순서(메모리 큰 순,
 * 작업 폴더 모름은 맨 끝)이고 정렬은 묶음 안 줄의 순서만 바꾼다. 구성원이 하나여도 머리를 두고, 보일 줄이 없는 작업 공간
 * (검색에 맞는 구성원이 없음)은 뺀다. 머리의 수치는 걸러진 줄이 아니라 작업 공간 전체다.
 * 작업 공간끼리는 더하지 않는다(드물게 한 프로세스가 두 작업 공간에 든다).
 * memoryTotal: 메모리 막대의 분모(검색 전 표의 memoryShareDenominator, 사용 중 RAM). 없으면 머리에 막대가 없다.
 */
export function groupWorkspaces(
  rows: Row[],
  s: DashboardSnapshot,
  now: number,
  memoryTotal: number | null = null
): GroupedRows[] {
  const agents = new Map(s.agents.map((a) => [selectionKey.agent(a), a]))
  const servers = new Map(s.servers.map((r) => [selectionKey.server(r), r]))
  const heavy = new Set(s.heavyJobs.map((j) => selectionKey.heavy(j)))
  const leftovers = new Set(s.leftovers.map((l) => selectionKey.leftover(l)))
  return s.workspaces.flatMap((ws) => {
    const keys = new Set([...ws.agentKeys, ...ws.serverKeys, ...ws.heavyKeys, ...ws.leftoverKeys])
    const mine = rows.filter((r) => r.key != null && keys.has(r.key))
    if (mine.length === 0) return []
    const members = {
      agents: ws.agentKeys.flatMap((k) => agents.get(k) ?? []),
      servers: ws.serverKeys.flatMap((k) => servers.get(k) ?? []),
      heavy: ws.heavyKeys.filter((k) => heavy.has(k)).length,
      leftovers: ws.leftoverKeys.filter((k) => leftovers.has(k)).length
    }
    return [{ group: workspaceHead(ws, members, now, memoryTotal), rows: mine }]
  })
}

/** 작업 공간 탭의 머리. 구성원은 스냅샷에 있는 것만(없는 키는 건너뛴다), 합계는 메인이 pid 마다 한 번 센 값. */
function workspaceHead(
  ws: WorkspaceRow,
  m: { agents: AgentRow[]; servers: ServerRow[]; heavy: number; leftovers: number },
  now: number,
  memoryTotal: number | null
): GroupHead {
  const K = text.ui.workspaces.kinds
  const counts: [string, number][] = [
    [K.server, m.servers.length],
    [K.heavy, m.heavy],
    [K.leftover, m.leftovers],
    [text.ui.workspaces.changed, ws.changedFiles ?? 0]
  ]
  const parts = counts.filter(([, n]) => n > 0).map(([label, n]) => st.groupCount(label, n))
  // 작업 중·응답 대기인 에이전트가 있으면 마지막 활동은 "지금"이라 붙이지 않는다.
  const busy = m.agents.some((a) => a.state === 'working' || a.state === 'waiting')
  if (!busy && ws.lastActiveAt != null)
    parts.push(st.lastActive(formatDuration(Math.max(0, now - ws.lastActiveAt))))
  return {
    key: ws.key,
    root: ws.root,
    name: ws.name,
    outer: ws.outer,
    count: m.agents.length + m.servers.length + m.heavy + m.leftovers,
    memoryBytes: ws.memoryBytes,
    ...headShare(ws.memoryBytes, memoryTotal),
    commitBytes: ws.commitBytes,
    agentBadges: m.agents.map((a) => agentBadge(a, now)),
    status: workspaceStatus(m.agents, m.servers),
    summary: parts.join(' · '),
    actions: ws.root ? ['rename', 'folder', 'cleanup'] : []
  }
}

/**
 * 작업 공간 머리 상태: 에이전트가 응답 대기 > 조용함 > 작업 중, 아니면 서버 요약.
 * 서버가 없으면 비운다(서버 요약의 "연결 없음"은 서버가 있을 때의 말이라).
 */
function workspaceStatus(agents: AgentRow[], servers: ServerRow[]): Cell {
  const states = text.ui.agent.states
  if (agents.some((a) => a.state === 'waiting')) return { text: states.waiting, dot: 'warn' }
  if (agents.some((a) => a.quietSince != null)) return { text: st.quiet, dot: 'warn' }
  if (agents.some((a) => a.state === 'working')) return { text: states.working, dot: 'running' }
  return servers.length ? groupStatus(servers) : { text: '' }
}

/** 묶음 상태 요약: 정리 후보·확인해볼 것·사용 중 수, 점 색은 가장 급한 것. */
function groupStatus(servers: ServerRow[]): Cell {
  const candidate = servers.filter((r) => r.judgement === 'candidate').length
  const check = servers.filter((r) => r.judgement === 'check').length
  const inUse = servers.filter((r) => r.clientCount > 0 && r.judgement !== 'check').length
  const parts = [
    candidate ? st.groupCount(st.candidate, candidate) : null,
    check ? st.groupCount(st.check, check) : null,
    inUse ? st.groupCount(st.inUse, inUse) : null
  ].filter((p): p is string => p != null)
  const dot: Tone = candidate ? 'stopped' : check ? 'warn' : inUse ? 'running' : 'idle'
  return { text: parts.length ? parts.join(' · ') : st.idle, dot }
}

/** 설정에서 숨긴 서버(표 바닥 "숨김 n개"를 누르면 보인다). 숨김 풀기만 할 수 있다. */
export function hiddenServerTable(s: DashboardSnapshot): Table {
  const base = tableFor('ports', { ...s, servers: s.hiddenServers })
  return {
    ...base,
    rows: base.rows.map((row) => ({
      ...row,
      cells: { ...row.cells, status: { text: st.hidden, dot: 'idle' as const } },
      actions: [{ kind: 'unhide' as const, label: ACTIONS.unhide }]
    }))
  }
}

/** 트레이 요약 창의 작업 공간 한 줄(F10). */
export interface WorkspaceSummary {
  key: string
  name: string
  title: string
  serverCount: number
  memoryBytes: number
  commitBytes: number | null
  agents: AgentRow[]
  /** 누르면 열 서버(메모리가 가장 큰 것). */
  firstKey: string
  status: Cell
}

/**
 * 서버를 작업 공간별로 묶은 요약(혼자인 작업 공간·작업 공간을 모르는 서버도 한 줄). 메모리 큰 순.
 * 에이전트는 묶음 보기와 같은 규칙으로 붙인다.
 */
export function workspaceSummary(s: DashboardSnapshot): WorkspaceSummary[] {
  const groups = new Map<string, ServerRow[]>()
  for (const r of s.servers) {
    const id = r.workspace ? `group:${worktreeKey(r.workspace.root)}` : selectionKey.server(r)
    groups.set(id, [...(groups.get(id) ?? []), r])
  }
  return [...groups]
    .map(([key, servers]): WorkspaceSummary => {
      const ws = servers[0].workspace
      const roots = servers.flatMap((r) => (r.worktree ? [r.worktree.root] : []))
      const agents = s.agents.filter(
        (a) =>
          (ws && a.workspace && worktreeKey(a.workspace.root) === worktreeKey(ws.root)) ||
          (a.worktree && roots.some((root) => agentCovers([a.worktree!.root], root)))
      )
      const largest = servers.reduce((a, b) => (b.memoryBytes > a.memoryBytes ? b : a))
      return {
        key,
        name: ws?.name ?? (largest.worktree ? folderOf(largest.worktree) : portList(largest.ports)),
        title: ws?.root ?? largest.worktree?.root ?? portList(largest.ports),
        serverCount: servers.length,
        memoryBytes: servers.reduce((sum, r) => sum + r.memoryBytes, 0),
        commitBytes: commitSum(servers),
        agents,
        firstKey: selectionKey.server(largest),
        status: groupStatus(servers)
      }
    })
    .sort((a, b) => b.memoryBytes - a.memoryBytes || a.name.localeCompare(b.name))
}
