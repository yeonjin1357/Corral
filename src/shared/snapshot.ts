import type { DashboardSnapshot } from './types'

/** 아무것도 없는 스냅샷(첫 수집 실패 시 화면에 보내는 바탕, 테스트 표본의 바탕). */
export function blankSnapshot(takenAt: number): DashboardSnapshot {
  return {
    takenAt,
    memory: { totalBytes: 0, usedBytes: 0, usedPercent: 0, level: 'normal' },
    ports: [],
    leftovers: [],
    heavyJobs: [],
    heavyOverlap: false,
    agents: [],
    hook: null,
    disk: null,
    groups: [],
    topApps: [],
    agentProcessCount: 0,
    platform: null,
    cpuCount: 1,
    stale: false,
    error: null
  }
}
