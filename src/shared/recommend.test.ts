import { cleanupRecommendation } from './recommend'
import { blankSnapshot } from './snapshot'
import type { LeftoverRow, ServerRow, WorktreeInfo } from './types'

const MB = 1024 * 1024
const W1: WorktreeInfo = { root: 'C:\\work\\shop-web', branch: 'develop', isLinkedWorktree: false }

function server(over: Partial<ServerRow>): ServerRow {
  return {
    ports: [3000],
    pid: 4100,
    processName: 'node.exe',
    commandLine: 'node vite',
    worktree: W1,
    workspace: null,
    unresolvable: false,
    memoryBytes: 100 * MB,
    commitBytes: null,
    descendantPids: [],
    processes: [],
    clientCount: 0,
    startedAt: 1,
    judgement: 'candidate',
    idleSince: 0,
    agentInWorktree: false,
    cpuPercent: null,
    memoryGrowth: null,
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
    commitBytes: null,
    descendantPids: [],
    processes: [],
    startedAt: 5,
    agentInWorktree: false,
    ...over
  }
}

test('정리 후보 서버와 에이전트 없는 워크트리의 남은 프로세스를 메모리 큰 순으로, 합계와 함께(작업 폴더를 모르면 뺀다)', () => {
  const r = cleanupRecommendation({
    ...blankSnapshot(1),
    servers: [
      server({ ports: [3000], pid: 4100, memoryBytes: 800 * MB }),
      server({ ports: [3002], pid: 4200, judgement: 'check' }),
      server({ ports: [3003], pid: 4300, judgement: null }),
      server({ ports: [8080], pid: 6000, unresolvable: true, worktree: null })
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
      memoryBytes: 1100 * MB,
      commitBytes: null
    },
    {
      kind: 'server',
      key: 'server:4100:1',
      pid: 4100,
      title: ':3000',
      where: 'shop-web · develop',
      memoryBytes: 800 * MB,
      commitBytes: null
    }
  ])
  expect(r.totalBytes).toBe(1900 * MB)
})

test('추천할 것이 없으면 빈 목록과 0', () => {
  expect(cleanupRecommendation(blankSnapshot(1))).toEqual({
    items: [],
    totalBytes: 0,
    totalCommitBytes: null
  })
})

test('커밋 큰 순으로, 커밋을 모르면 RAM 큰 순', () => {
  const r = cleanupRecommendation({
    ...blankSnapshot(1),
    servers: [
      server({ ports: [3000], pid: 4100, memoryBytes: 800 * MB, commitBytes: 4000 * MB }),
      server({ ports: [3001], pid: 4200, memoryBytes: 500 * MB, commitBytes: 2000 * MB }),
      // 같으면 pid 순.
      server({ ports: [3002], pid: 4050, memoryBytes: 100 * MB, commitBytes: 2000 * MB })
    ],
    leftovers: [
      leftover({ pid: 7100, worktree: W1, memoryBytes: 3000 * MB, commitBytes: null }),
      leftover({ pid: 7200, worktree: W1, memoryBytes: 1100 * MB, commitBytes: null })
    ]
  })
  expect(r.items.map((i) => [i.pid, i.commitBytes == null ? null : i.commitBytes / MB])).toEqual([
    [4100, 4000],
    [7100, null],
    [4050, 2000],
    [4200, 2000],
    [7200, null]
  ])
})

test('totalCommitBytes 는 아는 것의 합, 하나도 모르면 null', () => {
  const some = cleanupRecommendation({
    ...blankSnapshot(1),
    servers: [server({ pid: 4100, memoryBytes: 800 * MB, commitBytes: 4000 * MB })],
    leftovers: [leftover({ pid: 7100, worktree: W1, commitBytes: null })]
  })
  expect(some.totalBytes).toBe(1900 * MB)
  expect(some.totalCommitBytes).toBe(4000 * MB)
  const none = cleanupRecommendation({
    ...blankSnapshot(1),
    servers: [server({ pid: 4100, commitBytes: null })],
    leftovers: [leftover({ pid: 7100, worktree: W1, commitBytes: null })]
  })
  expect(none.totalCommitBytes).toBeNull()
})

test('포트가 둘인 서버는 추천에 한 번, 메모리도 한 번', () => {
  const r = cleanupRecommendation({
    ...blankSnapshot(1),
    servers: [server({ ports: [3000, 3001], pid: 4100, memoryBytes: 800 * MB })]
  })
  expect(r.items).toEqual([
    {
      kind: 'server',
      key: 'server:4100:1',
      pid: 4100,
      title: ':3000 · :3001',
      where: 'shop-web · develop',
      memoryBytes: 800 * MB,
      commitBytes: null
    }
  ])
  expect(r.totalBytes).toBe(800 * MB)
})
