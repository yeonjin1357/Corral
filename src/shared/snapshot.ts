import type { DashboardSnapshot, GroupPoint, GroupUsage, ProcessGroup } from './types'

/** 스냅샷의 묶음 사용량을 묶음 추이의 한 점으로(메인 기록·화면 기록이 같이 쓴다). 없는 묶음은 0. */
export function groupPoint(t: number, groups: GroupUsage[]): GroupPoint {
  const bytes = (group: ProcessGroup): number =>
    Math.max(0, groups.find((g) => g.group === group)?.memoryBytes ?? 0)
  return {
    t,
    devServer: bytes('devServer'),
    agent: bytes('agent'),
    heavy: bytes('heavy'),
    otherApps: bytes('otherApps'),
    system: bytes('system')
  }
}

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
    codexLimits: null,
    disk: null,
    groups: [],
    apps: [],
    otherPorts: [],
    agentProcessCount: 0,
    platform: null,
    cpuCount: 1,
    stale: false,
    error: null
  }
}
