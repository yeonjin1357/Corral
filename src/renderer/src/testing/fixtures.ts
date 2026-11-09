// 렌더러 테스트용 데이터(앱 코드에서는 import 하지 않는다).
import type { AgentRow, DashboardSnapshot, LeftoverRow, PortRow } from '../../../shared/types'

export const MB = 1024 * 1024
export const GB = 1024 * MB

export function portRow(over: Partial<PortRow> = {}): PortRow {
  return {
    port: 3000,
    pid: 4100,
    processName: 'node.exe',
    commandLine: 'node vite',
    worktree: { root: 'C:\\work\\shop-web', branch: 'develop', isLinkedWorktree: false },
    unresolvable: false,
    memoryBytes: 1200 * MB,
    descendantPids: [4101],
    clientCount: 1,
    startedAt: 200,
    judgement: null,
    idleSince: null,
    agentInWorktree: false,
    ...over
  }
}

export function agentRow(over: Partial<AgentRow> = {}): AgentRow {
  return {
    pid: 5000,
    tool: 'claude',
    worktree: { root: 'C:\\work\\wt-a', branch: 'feat/a', isLinkedWorktree: true },
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
    memoryBytes: 900 * MB,
    descendantPids: [7001, 7002],
    startedAt: 300,
    agentInWorktree: false,
    ...over
  }
}

export const threePorts: PortRow[] = [
  portRow(),
  portRow({
    port: 3003,
    pid: 5100,
    clientCount: 0,
    worktree: { root: '/Users/dev/wt-a', branch: 'feat/a', isLinkedWorktree: true }
  }),
  portRow({
    port: 8080,
    pid: 6000,
    processName: 'wslrelay.exe',
    worktree: null,
    unresolvable: true,
    clientCount: 0
  })
]

export function snapshot(over: Partial<DashboardSnapshot> = {}): DashboardSnapshot {
  return {
    takenAt: 1,
    memory: {
      totalBytes: 32 * GB,
      usedBytes: Math.round(26.3 * GB),
      usedPercent: 82.2,
      level: 'warn'
    },
    ports: threePorts,
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
      { name: 'chrome.exe', memoryBytes: 5 * GB, processCount: 40 },
      { name: 'Code.exe', memoryBytes: 2 * GB, processCount: 12 }
    ],
    agentProcessCount: 2,
    platform: 'win32',
    cpuCount: 8,
    stale: false,
    error: null,
    ...over
  }
}
