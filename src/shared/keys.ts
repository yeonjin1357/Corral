import type { AgentRow, LeftoverRow, PortRow, ServerRow } from './types'

/** 같은 포트를 다른 프로세스가 열면 다른 항목이 되도록 포트와 pid 를 함께 쓴다. */
export function portKey(row: Pick<PortRow, 'port' | 'pid'>): string {
  return `${row.port}:${row.pid}`
}

/** 같은 pid 가 다른 프로세스에 다시 쓰여도 섞이지 않게 시작 시각을 함께 쓴다. */
export function agentKey(row: Pick<AgentRow, 'pid' | 'startedAt'>): string {
  return `${row.pid}:${row.startedAt ?? ''}`
}

/**
 * 목록에서 고른 항목 키(화면 선택·정리 추천·알림 이동에 같이 쓴다).
 * 종류를 앞에 붙여 포트·에이전트·남은 프로세스·디스크가 서로 겹치지 않는다.
 */
export const selectionKey = {
  port: (row: Pick<PortRow, 'port' | 'pid'>): string => `port:${portKey(row)}`,
  server: (row: Pick<ServerRow, 'pid' | 'startedAt'>): string =>
    `server:${row.pid}:${row.startedAt ?? ''}`,
  agent: (row: Pick<AgentRow, 'pid' | 'startedAt'>): string => `agent:${agentKey(row)}`,
  leftover: (row: Pick<LeftoverRow, 'pid' | 'startedAt'>): string =>
    `leftover:${row.pid}:${row.startedAt ?? ''}`,
  disk: (worktreeRoot: string): string => `disk:${worktreeRoot}`
}
