import { text } from './text'
import {
  agentCovers,
  commitSum,
  displayCpuPercent,
  formatBytes,
  formatFreed,
  pressureSource,
  pressureText,
  worktreeLabel,
  worktreeFolder,
  describeKillResult,
  formatDuration,
  formatTokens,
  formatClock,
  formatTimeOfDay,
  limitWindowLabel,
  formatContext,
  codexLimitView,
  describeCollectError
} from './format'
import type { CodexLimits, CommitSummary, LimitWindow, MemoryLevel } from './types'

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

test('pressureText 는 커밋 단계가 더 높을 때만 커밋을, 아니면 RAM 을 말한다', () => {
  const commit = (percent: number, level: MemoryLevel): CommitSummary => ({
    usedBytes: percent,
    limitBytes: 100,
    percent,
    level
  })
  expect(pressureText({ usedPercent: 85.7, ramLevel: 'warn', commit: null })).toBe('RAM 85%')
  expect(
    pressureText({ usedPercent: 60.2, ramLevel: 'normal', commit: commit(86.9, 'warn') })
  ).toBe('커밋 86%')
  expect(
    pressureText({ usedPercent: 85.7, ramLevel: 'warn', commit: commit(96.1, 'danger') })
  ).toBe('커밋 96%')
  // 같은 단계거나 RAM 이 더 높으면 RAM.
  expect(pressureText({ usedPercent: 85.7, ramLevel: 'warn', commit: commit(88, 'warn') })).toBe(
    'RAM 85%'
  )
  expect(pressureText({ usedPercent: 93.6, ramLevel: 'danger', commit: commit(88, 'warn') })).toBe(
    'RAM 93%'
  )
  // 같은 고르기를 숫자로(G7 의 에이전트 안내 문구가 쓴다).
  expect(
    pressureSource({ usedPercent: 85.7, ramLevel: 'warn', commit: commit(96.1, 'danger') })
  ).toEqual({ source: 'commit', percent: 96 })
  expect(
    pressureSource({ usedPercent: 85.7, ramLevel: 'warn', commit: commit(88, 'warn') })
  ).toEqual({ source: 'ram', percent: 85 })
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

test('토큰 수: 850 · 12.3k · 132k · 1.2M, 경계는 올림이 한 단계 넘어가지 않게, 음수·NaN 은 —', () => {
  expect(formatTokens(0)).toBe('0')
  expect(formatTokens(850)).toBe('850')
  expect(formatTokens(999)).toBe('999')
  expect(formatTokens(1000)).toBe('1.0k')
  expect(formatTokens(12345)).toBe('12.3k')
  expect(formatTokens(99_949)).toBe('99.9k')
  expect(formatTokens(99_950)).toBe('100k')
  expect(formatTokens(132_000)).toBe('132k')
  expect(formatTokens(999_499)).toBe('999k')
  expect(formatTokens(999_950)).toBe('1.0M')
  expect(formatTokens(1_000_000)).toBe('1.0M')
  expect(formatTokens(1_234_567)).toBe('1.2M')
  expect(formatTokens(-1)).toBe('—')
  expect(formatTokens(NaN)).toBe('—')
  expect(formatTokens(Infinity)).toBe('—')
})

test('한도 창 이름: 10080분 주간 · 하루 단위 N일 · 시간 단위 N시간 · 그 밖은 N분', () => {
  expect(limitWindowLabel(10080)).toBe('주간')
  expect(limitWindowLabel(300)).toBe('5시간')
  expect(limitWindowLabel(1440)).toBe('1일')
  expect(limitWindowLabel(2880)).toBe('2일')
  expect(limitWindowLabel(90)).toBe('90분')
})

test('시각(절대): 월·일·오전/오후 시:분', () => {
  expect(formatClock(new Date(2026, 10, 10, 15, 0).getTime())).toBe('11월 10일 오후 3:00')
})

test('하루 안의 시각(측정 시각·추이 그래프 툴팁): 오전/오후 시:분:초', () => {
  expect(formatTimeOfDay(new Date(2026, 10, 10, 15, 4, 5).getTime())).toBe('오후 3:04:05')
  expect(formatTimeOfDay(new Date(2026, 10, 10, 9, 0, 0).getTime())).toBe('오전 9:00:00')
})

test('토큰 수: 반올림 경계 999,500 은 1.0M, 소수 입력은 내림·반올림이 같은 규칙', () => {
  expect(formatTokens(999_500)).toBe('1.0M')
  expect(formatTokens(850.7)).toBe('850')
  expect(formatTokens(12_345.6)).toBe('12.3k')
})

test('컨텍스트 글: 한도가 0 보다 큰 유한한 수일 때만 " / 한도", 컨텍스트를 모르면 —', () => {
  expect(formatContext(132_000, 258_400)).toBe('132k / 258k')
  expect(formatContext(132_000, null)).toBe('132k')
  expect(formatContext(132_000, 0)).toBe('132k')
  expect(formatContext(132_000, -5)).toBe('132k')
  expect(formatContext(132_000, NaN)).toBe('132k')
  expect(formatContext(132_000, Infinity)).toBe('132k')
  expect(formatContext(null, 258_400)).toBe('—')
})

describe('Codex 한도 보기(codexLimitView)', () => {
  const NOW = 10 * 3_600_000
  const w = (
    usedPercent: number,
    windowMinutes: number,
    resetsAt: number | null = null
  ): LimitWindow => ({
    usedPercent,
    windowMinutes,
    resetsAt
  })
  const lim = (
    primary: ReturnType<typeof w> | null,
    secondary: ReturnType<typeof w> | null,
    at = NOW - 3 * 60_000
  ): CodexLimits => ({ primary, secondary, planType: null, at })

  test('가장 높은 창이 설명 줄, 같으면 긴 창, 풍선말·값·상세는 모든 창', () => {
    const v = codexLimitView(lim(w(14.2, 300, NOW + 3_600_000), w(30.6, 10080, null)), NOW)!
    expect(v.caption).toBe('Codex 한도 주간 31%')
    expect(v.value).toBe('5시간 14% · 주간 31%')
    expect(v.tip.split('\n')).toHaveLength(3)
    expect(v.tip.endsWith('3분 전 기준')).toBe(true)
    // 상세 패널: 초기화 시각을 아는 창마다 한 줄, 마지막에 읽은 때.
    expect(v.lines).toHaveLength(2)
    expect(v.lines[0]).toMatch(/^5시간 · .+ 초기화$/)
    expect(v.lines[1]).toBe('3분 전 기준')
    expect(codexLimitView(lim(w(50, 300), w(50, 10080)), NOW)!.caption).toBe('Codex 한도 주간 50%')
    expect(codexLimitView(lim(w(80, 300), w(50, 10080)), NOW)!.caption).toBe('Codex 한도 5시간 80%')
  })

  test('초기화된 창·사용률이 숫자가 아닌 창은 빼고, 남은 것이 없으면 null', () => {
    expect(codexLimitView(lim(w(14, 300, NOW), w(31, 10080, NOW + 1)), NOW)!.value).toBe('주간 31%')
    expect(codexLimitView(lim(w(NaN, 300), w(31, 10080)), NOW)!.value).toBe('주간 31%')
    expect(codexLimitView(lim(w(Infinity, 300), null), NOW)).toBeNull()
    expect(codexLimitView(lim(w(14, 300, NOW - 1), w(31, 10080, NOW)), NOW)).toBeNull()
    expect(codexLimitView(lim(null, null), NOW)).toBeNull()
    expect(codexLimitView(null, NOW)).toBeNull()
  })

  test('사용률은 0–100 으로 맞추고, 읽은 때가 지금보다 뒤여도 음수 기간이 없다', () => {
    expect(codexLimitView(lim(w(140, 300), w(-5, 10080)), NOW)!.value).toBe('5시간 100% · 주간 0%')
    expect(codexLimitView(lim(w(10, 300), null, NOW + 60_000), NOW)!.tip).toMatch(/0초 전 기준$/)
  })
})
