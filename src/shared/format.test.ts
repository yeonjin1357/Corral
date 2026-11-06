import { formatBytes, worktreeLabel, worktreeFolder, describeKillResult } from './format'

test('내리기 결과 문구: 성공·취소는 없음, 실패는 메시지 우선', () => {
  expect(describeKillResult({ status: 'killed' })).toBeNull()
  expect(describeKillResult({ status: 'cancelled' })).toBeNull()
  expect(describeKillResult({ status: 'gone' })).toBe('이미 종료된 프로세스예요.')
  expect(describeKillResult({ status: 'changed' })).toBe(
    '그 사이 다른 프로세스로 바뀌어서 내리지 않았어요.'
  )
  expect(describeKillResult({ status: 'failed' })).toBe('내리지 못했어요.')
  expect(describeKillResult({ status: 'failed', message: '권한이 없어요' })).toBe('권한이 없어요')
})

const MB = 1024 * 1024
const GB = 1024 * MB

test('1GiB 이상은 소수 1자리 GB, 미만은 정수 MB', () => {
  expect(formatBytes(1288490188)).toBe('1.2 GB')
  expect(formatBytes(536870912)).toBe('512 MB')
  expect(formatBytes(32 * GB)).toBe('32.0 GB')
})

test('반올림해서 1024MB 가 되면 GB 로 표시', () => {
  expect(formatBytes(1024 * MB - 1)).toBe('1.0 GB')
})

test('0·음수·NaN 은 0 MB', () => {
  expect(formatBytes(0)).toBe('0 MB')
  expect(formatBytes(-5)).toBe('0 MB')
  expect(formatBytes(Number.NaN)).toBe('0 MB')
})

test('worktree 폴더 이름: 마지막 폴더, 끝 슬래시 무시, 없으면 판별 불가', () => {
  expect(worktreeFolder({ root: 'C:\\work\\shop-web', branch: 'x', isLinkedWorktree: false })).toBe(
    'shop-web'
  )
  expect(worktreeFolder({ root: '/Users/dev/wt-a/', branch: null, isLinkedWorktree: true })).toBe(
    'wt-a'
  )
  expect(worktreeFolder(null)).toBe('판별 불가')
})

test('worktree 라벨: 폴더 이름 · 브랜치', () => {
  expect(
    worktreeLabel({ root: 'C:\\work\\shop-web', branch: 'develop', isLinkedWorktree: false })
  ).toBe('shop-web · develop')
  expect(
    worktreeLabel({ root: '/Users/dev/work/wt-a/', branch: 'feat/a', isLinkedWorktree: true })
  ).toBe('wt-a · feat/a')
  expect(worktreeLabel({ root: 'C:\\work\\x', branch: null, isLinkedWorktree: false })).toBe(
    'x · (detached)'
  )
  expect(worktreeLabel(null)).toBe('판별 불가')
})
