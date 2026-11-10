import { text } from './text'
import {
  agentCovers,
  commitSum,
  displayCpuPercent,
  formatBytes,
  formatFreed,
  worktreeLabel,
  worktreeFolder,
  describeKillResult,
  formatDuration,
  describeCollectError
} from './format'

test('수집 오류를 한국어로: 시간 초과·결과 해석 실패·macOS 명령 실패·실행 불가, 이미 한국어면 그대로', () => {
  expect(describeCollectError('timeout')).toBe('수집 명령이 시간 안에 끝나지 않았어요.')
  expect(describeCollectError('empty output')).toBe('수집 결과를 읽지 못했어요.')
  expect(describeCollectError('invalid JSON: Get-CimInstance : x')).toBe(
    '수집 결과를 읽지 못했어요.'
  )
  expect(describeCollectError('ps exited with 1')).toBe(
    'macOS 프로세스 정보를 가져오지 못했어요 (ps 종료 코드 1).'
  )
  expect(describeCollectError('lsof exited with 2')).toBe(
    'macOS 프로세스 정보를 가져오지 못했어요 (lsof 종료 코드 2).'
  )
  expect(describeCollectError('spawn /bin/ps ENOENT')).toBe(
    '수집 명령을 실행하지 못했어요: spawn /bin/ps ENOENT'
  )
  expect(describeCollectError('Windows 정보를 가져오지 못했어요 (PowerShell 종료 코드 1)')).toBe(
    'Windows 정보를 가져오지 못했어요 (PowerShell 종료 코드 1)'
  )
  expect(describeCollectError('boom')).toBe('수집 중 문제가 생겼어요: boom')
})

test('내리기 결과 문구: 성공·취소는 없음, 실패는 메시지 우선', () => {
  expect(describeKillResult({ status: 'killed' })).toBeNull()
  // 한꺼번에 끄기는 몇 개를 껐는지 알려 준다.
  expect(describeKillResult({ status: 'killed', message: '2개를 껐어요.' })).toBe('2개를 껐어요.')
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

test('1MB 미만은 KB(최소 1 KB)', () => {
  expect(formatBytes(3000)).toBe('3 KB')
  expect(formatBytes(10)).toBe('1 KB')
  expect(formatBytes(1024 * 1024 - 600)).toBe('1023 KB')
})

test('확보 예상: 커밋을 알면 RAM·커밋 둘 다, 모르면 RAM 만', () => {
  expect(formatFreed(1.2 * GB, 4.2 * GB)).toBe('RAM 약 1.2 GB · 커밋 약 4.2 GB')
  expect(formatFreed(1.2 * GB, null)).toBe('약 1.2 GB')
})

test('커밋 합: 아는 것만 더하고, 하나도 모르면 null', () => {
  expect(commitSum([{ commitBytes: 3 }, { commitBytes: null }, {}, { commitBytes: 4 }])).toBe(7)
  expect(commitSum([{ commitBytes: 0 }])).toBe(0)
  expect(commitSum([{ commitBytes: null }, {}])).toBeNull()
  expect(commitSum([])).toBeNull()
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

test('실행 시간: 초·분·시간·일, 음수·NaN 은 —', () => {
  expect(formatDuration(30 * 1000)).toBe('30초')
  expect(formatDuration(45 * 60 * 1000)).toBe('45분')
  expect(formatDuration((3 * 60 + 12) * 60 * 1000)).toBe('3시간 12분')
  expect(formatDuration((2 * 24 + 5) * 60 * 60 * 1000)).toBe('2일 5시간')
  expect(formatDuration(-1)).toBe('—')
  expect(formatDuration(Number.NaN)).toBe('—')
})

test('에이전트 워크트리가 같거나 상위 폴더면 그 워크트리를 덮는다(대소문자·구분자·끝 구분자 무시, 폴더 경계)', () => {
  const roots = ['C:\\work\\workspace']
  expect(agentCovers(roots, 'C:\\work\\workspace')).toBe(true)
  expect(agentCovers(roots, 'c:/WORK/workspace/source/shop-web/')).toBe(true)
  expect(agentCovers(roots, 'C:\\work\\workspace-2')).toBe(false)
  expect(agentCovers(roots, 'C:\\work')).toBe(false)
  expect(agentCovers([], 'C:\\work\\workspace')).toBe(false)
  expect(agentCovers(['/Users/dev/workspace'], '/Users/dev/workspace/apps/web')).toBe(true)
  expect(agentCovers(['/Users/dev/workspace'], '/Users/dev/workspacex')).toBe(false)
})

test('CPU 표시: Windows 는 작업 관리자처럼 전체 CPU 대비, macOS 는 활성 상태 보기처럼 코어 1개 = 100%', () => {
  expect(displayCpuPercent(17.2, 'win32', 20)).toBe(0.9)
  expect(displayCpuPercent(250, 'win32', 8)).toBe(31.3)
  expect(displayCpuPercent(17.2, 'darwin', 10)).toBe(17.2)
  expect(displayCpuPercent(null, 'win32', 8)).toBeNull()
  expect(displayCpuPercent(5, 'win32', 0)).toBe(5)
  expect(displayCpuPercent(5, null, 8)).toBe(5)
})

test('추이 그래프 길이 문구: 초·분·시간(분이 남으면 함께)', () => {
  expect(text.ui.trend.window(30_000)).toBe('30초')
  expect(text.ui.trend.window(10 * 60_000)).toBe('10분')
  expect(text.ui.trend.window(120 * 60_000)).toBe('2시간')
  expect(text.ui.trend.window(90 * 60_000)).toBe('1시간 30분')
})
