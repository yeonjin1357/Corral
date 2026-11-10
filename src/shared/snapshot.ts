import type { DashboardSnapshot } from './types'

/** 아무것도 없는 스냅샷(첫 수집 실패 시 화면에 보내는 바탕, 테스트 표본의 바탕). */
export function blankSnapshot(takenAt: number): DashboardSnapshot {
  return {
    takenAt,
    memory: {
      totalBytes: 0,
      usedBytes: 0,
      usedPercent: 0,
      availableBytes: 0,
      level: 'normal',
      ramLevel: 'normal',
      commit: null,
      kernelBytes: null
    },
    servers: [],
    hiddenServers: [],
    leftovers: [],
    heavyJobs: [],
    heavyOverlap: false,
    agents: [],
    workspaces: [],
    hook: null,
    codexHook: null,
    disk: null,
    groups: [],
    apps: [],
    agentProcessCount: 0,
    platform: null,
    cpuCount: 1,
    stale: false,
    error: null
  }
}
