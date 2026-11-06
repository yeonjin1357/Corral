// 렌더러 테스트용 데이터(앱 코드에서는 import 하지 않는다).
import type { DashboardSnapshot, PortRow } from '../../../shared/types'

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
    groups: [
      { group: 'devServer', memoryBytes: 2200 * MB, processCount: 5 },
      { group: 'agent', memoryBytes: 500 * MB, processCount: 4 },
      { group: 'other', memoryBytes: 20 * GB, processCount: 300 }
    ],
    agentProcessCount: 2,
    stale: false,
    error: null,
    ...over
  }
}
