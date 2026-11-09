import { cleanupRecommendation } from './recommend'
import { blankSnapshot } from './snapshot'
import type { LeftoverRow, PortRow, WorktreeInfo } from './types'

const MB = 1024 * 1024
const W1: WorktreeInfo = { root: 'C:\\work\\shop-web', branch: 'develop', isLinkedWorktree: false }

function port(over: Partial<PortRow>): PortRow {
  return {
    port: 3000,
    pid: 4100,
    processName: 'node.exe',
    commandLine: 'node vite',
    worktree: W1,
    unresolvable: false,
    memoryBytes: 100 * MB,
    descendantPids: [],
    clientCount: 0,
    startedAt: 1,
    judgement: 'candidate',
    idleSince: 0,
    agentInWorktree: false,
    ...over
  }
}

function leftover(over: Partial<LeftoverRow>): LeftoverRow {
  return {
    pid: 7100,
    processName: 'java.exe',
    label: 'Gradle 데몬',
    commandLine: 'java GradleDaemon',
    worktree: null,
    workspace: null,
    memoryBytes: 1100 * MB,
    descendantPids: [],
    startedAt: 5,
    agentInWorktree: false,
    ...over
  }
}

test('정리 후보 포트와 에이전트 없는 워크트리의 남은 프로세스를 메모리 큰 순으로, 합계와 함께(작업 폴더를 모르면 뺀다)', () => {
  const r = cleanupRecommendation({
    ...blankSnapshot(1),
    ports: [
      port({ port: 3000, pid: 4100, memoryBytes: 800 * MB }),
      port({ port: 3002, pid: 4200, judgement: 'check' }),
      port({ port: 3003, pid: 4300, judgement: null }),
      port({ port: 8080, pid: 6000, unresolvable: true, worktree: null })
    ],
    leftovers: [
      leftover({ pid: 7100, worktree: W1 }),
      leftover({ pid: 7200, label: 'Vitest', agentInWorktree: true, worktree: W1 }),
      // 작업 폴더를 모르면 에이전트가 띄운 것인지 알 수 없어 한꺼번에 끄는 추천에서는 뺀다.
      leftover({ pid: 7300, label: 'Vitest', worktree: null, memoryBytes: 5000 * MB })
    ]
  })
  expect(r.items).toEqual([
    {
      kind: 'leftover',
      key: 'leftover:7100:5',
      pid: 7100,
      title: 'Gradle 데몬',
      where: 'shop-web · develop',
      memoryBytes: 1100 * MB
    },
    {
      kind: 'port',
      key: 'port:3000:4100',
      pid: 4100,
      title: ':3000',
      where: 'shop-web · develop',
      memoryBytes: 800 * MB
    }
  ])
  expect(r.totalBytes).toBe(1900 * MB)
})

test('추천할 것이 없으면 빈 목록과 0', () => {
  expect(cleanupRecommendation(blankSnapshot(1))).toEqual({ items: [], totalBytes: 0 })
})
