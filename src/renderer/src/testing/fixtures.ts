// 렌더러 테스트용 데이터(앱 코드에서는 import 하지 않는다).
import type {
  AgentRow,
  DashboardSnapshot,
  DiskRow,
  HeavyJobRow,
  LeftoverRow,
  ServerRow
} from '../../../shared/types'
import { blankSnapshot } from '../../../shared/snapshot'

export const MB = 1024 * 1024
export const GB = 1024 * MB

export function serverRow(over: Partial<ServerRow> = {}): ServerRow {
  return {
    ports: [3000],
    pid: 4100,
    processName: 'node.exe',
    commandLine: 'node vite',
    worktree: { root: 'C:\\work\\shop-web', branch: 'develop', isLinkedWorktree: false },
    workspace: null,
    unresolvable: false,
    memoryBytes: 1200 * MB,
    descendantPids: [4101],
    clientCount: 1,
    startedAt: 200,
    judgement: null,
    idleSince: null,
    agentInWorktree: false,
    cpuPercent: null,
    memoryGrowth: null,
    ...over
  }
}

export function agentRow(over: Partial<AgentRow> = {}): AgentRow {
  return {
    pid: 5000,
    tool: 'claude',
    worktree: { root: 'C:\\work\\wt-a', branch: 'feat/a', isLinkedWorktree: true },
    workspace: null,
    startedAt: 100,
    memoryBytes: 600 * MB,
    descendantCount: 3,
    state: 'working',
    stateSource: 'hook',
    cpuPercent: 12.5,
    ...over
  }
}

export function leftoverRow(over: Partial<LeftoverRow> = {}): LeftoverRow {
  return {
    pid: 7000,
    processName: 'chrome.exe',
    label: 'Playwright 브라우저',
    commandLine: 'chrome.exe --remote-debugging-pipe --headless',
    worktree: null,
    workspace: null,
    memoryBytes: 900 * MB,
    descendantPids: [7001, 7002],
    startedAt: 300,
    agentInWorktree: false,
    ...over
  }
}

export function heavyJob(over: Partial<HeavyJobRow> = {}): HeavyJobRow {
  return {
    pid: 8000,
    label: 'vue-tsc',
    processName: 'node.exe',
    commandLine: 'node vue-tsc.js --noEmit',
    worktree: { root: 'C:\\work\\shop-web', branch: 'develop', isLinkedWorktree: false },
    workspace: null,
    memoryBytes: 6 * GB,
    descendantPids: [],
    startedAt: 0,
    ...over
  }
}

export function diskRow(over: Partial<DiskRow> = {}): DiskRow {
  return {
    worktreeRoot: 'C:\\work\\old-feature',
    commonDir: 'C:\\work\\shop-web\\.git',
    branch: 'feat/old',
    evidence: 'upstreamGone',
    folders: [
      { name: 'node_modules', path: 'C:\\work\\old-feature\\node_modules', bytes: 1.5 * GB }
    ],
    totalBytes: 1.5 * GB,
    inUse: false,
    ...over
  }
}

export const threeServers: ServerRow[] = [
  serverRow(),
  serverRow({
    ports: [3003],
    pid: 5100,
    clientCount: 0,
    worktree: { root: '/Users/dev/wt-a', branch: 'feat/a', isLinkedWorktree: true }
  }),
  serverRow({
    ports: [8080],
    pid: 6000,
    processName: 'wslrelay.exe',
    worktree: null,
    unresolvable: true,
    clientCount: 0
  })
]

export function snapshot(over: Partial<DashboardSnapshot> = {}): DashboardSnapshot {
  return {
    ...blankSnapshot(1),
    memory: {
      totalBytes: 32 * GB,
      usedBytes: Math.round(26.3 * GB),
      usedPercent: 82.2,
      level: 'warn'
    },
    servers: threeServers,
    leftovers: [],
    agents: [],
    hook: null,
    groups: [
      { group: 'devServer', memoryBytes: 2200 * MB, processCount: 5 },
      { group: 'agent', memoryBytes: 500 * MB, processCount: 4 },
      { group: 'heavy', memoryBytes: 0, processCount: 0 },
      { group: 'otherApps', memoryBytes: 18 * GB, processCount: 300 },
      { group: 'system', memoryBytes: 2 * GB, processCount: 0 }
    ],
    topApps: [
      {
        name: 'chrome.exe',
        memoryBytes: 5 * GB,
        processCount: 40,
        exePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
      },
      { name: 'Code.exe', memoryBytes: 2 * GB, processCount: 12, exePath: null }
    ],
    agentProcessCount: 2,
    platform: 'win32',
    cpuCount: 8,
    stale: false,
    error: null,
    ...over
  }
}
