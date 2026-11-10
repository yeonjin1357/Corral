import type { KillResult, Platform, WorktreeInfo } from './types'
import { text } from './text'

/** 수집 실패 이유를 화면·트레이에 보일 한국어 문장으로 바꾼다(이미 한국어면 그대로). */
export function describeCollectError(message: string): string {
  if (/[가-힣]/.test(message)) return message
  if (message === 'timeout') return text.collectErrors.timeout
  if (message === 'empty output' || message.startsWith('invalid JSON'))
    return text.collectErrors.unreadable
  const exited = /^(ps|lsof) exited with (-?\d+)/.exec(message)
  if (exited) return text.collectErrors.darwinCommand(exited[1], Number(exited[2]))
  if (/ENOENT|EACCES|EPERM/.test(message)) return text.collectErrors.cannotRun(message)
  return text.collectErrors.other(message)
}

/** 화면에 남길 내리기 결과 문구. 성공·취소는 따로 알릴 것이 없어 null. */
export function describeKillResult(result: KillResult): string | null {
  switch (result.status) {
    case 'killed':
      // 하나를 끈 것은 목록에서 사라지는 것으로 충분하다. 한꺼번에 끄기는 몇 개를 껐는지 알린다.
      return result.message ?? null
    case 'cancelled':
      return null
    case 'gone':
      return text.killResult.gone
    case 'changed':
      return text.killResult.changed
    case 'failed':
      return result.message ?? text.killResult.failed
  }
}

const MiB = 1024 * 1024
const GiB = 1024 * MiB

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB'
  // 작은 폴더·프로세스가 "0 MB" 로 보이지 않게 1MB 미만은 KB 로.
  if (bytes < MiB - 512) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  const mb = Math.round(bytes / MiB)
  if (mb < 1024) return `${mb} MB`
  return `${(bytes / GiB).toFixed(1)} GB`
}

/**
 * 커밋 크기 합(바이트). 아는 값만 더하고(모르는 값을 0 으로 지어내지 않는다), 하나도 모르면 null.
 * 프로세스 목록·행·추천 항목 모두에 쓴다.
 */
export function commitSum(items: Iterable<{ commitBytes?: number | null }>): number | null {
  let sum: number | null = null
  for (const item of items) if (item.commitBytes != null) sum = (sum ?? 0) + item.commitBytes
  return sum
}

/** 끄면 확보할 메모리(확인 창·결과·알림): 커밋을 알면 "RAM 약 1.2 GB · 커밋 약 4.2 GB", 모르면 "약 1.2 GB". */
export function formatFreed(memoryBytes: number, commitBytes: number | null): string {
  return commitBytes == null
    ? text.freed.ramOnly(formatBytes(memoryBytes))
    : text.freed.withCommit(formatBytes(memoryBytes), formatBytes(commitBytes))
}

/** 실행 시간 같은 길이를 짧게: 30초, 45분, 3시간 12분, 2일 5시간. 알 수 없으면 —. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return text.ui.none
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}초`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}분`
  const hour = Math.floor(min / 60)
  if (hour < 24) return min % 60 ? `${hour}시간 ${min % 60}분` : `${hour}시간`
  const day = Math.floor(hour / 24)
  return hour % 24 ? `${day}일 ${hour % 24}시간` : `${day}일`
}

/** worktree 의 폴더 이름(경로 마지막 부분). 판별되지 않았으면 '판별 불가'. */
export function worktreeFolder(worktree: WorktreeInfo | null): string {
  if (!worktree) return text.unresolvable
  const parts = worktree.root.split(/[\\/]+/).filter(Boolean)
  return parts[parts.length - 1] ?? worktree.root
}

/**
 * 워크트리 경로 비교용 키. Windows·macOS 는 경로 대소문자를 가리지 않고,
 * 판별 경로(명령줄·작업 폴더)에 따라 표기가 다를 수 있다.
 */
export function worktreeKey(root: string): string {
  return root.replace(/[\\/]+$/, '').toLowerCase()
}

/**
 * 에이전트의 워크트리가 이 워크트리와 같거나 그 상위 폴더면 true.
 * 예: 상위 저장소(여러 저장소를 묶은 작업 공간 등)에서 일하는 에이전트가 그 안에 든 하위 저장소의 개발 서버를 다룬다.
 * 불확실하면 정리 후보에서 빼는 쪽으로 기운다(스펙 §10).
 */
export function agentCovers(agentRoots: Iterable<string>, root: string): boolean {
  const key = (p: string): string => worktreeKey(p).replace(/\\/g, '/')
  const target = key(root)
  for (const r of agentRoots) {
    const a = key(r)
    if (a && (target === a || target.startsWith(a + '/'))) return true
  }
  return false
}

/** 서버가 연 포트 목록(`:6176 · :8081 · :9091`). */
export function portList(ports: readonly number[]): string {
  return ports.map((p) => `:${p}`).join(' · ')
}

export function worktreeLabel(worktree: WorktreeInfo | null): string {
  if (!worktree) return text.unresolvable
  return `${worktreeFolder(worktree)} · ${worktree.branch ?? text.detached}`
}

/**
 * 화면에 보일 CPU 사용률. 수집 값은 코어 1개 = 100% 기준이다.
 * Windows 는 작업 관리자처럼 전체 CPU 대비(÷ 논리 코어 수), macOS 는 활성 상태 보기처럼 그대로.
 * 사용자가 OS 도구와 나란히 비교할 때 같은 숫자가 보이게 한다. 소수 1자리.
 */
export function displayCpuPercent(
  cpuPercent: number | null,
  platform: Platform | null,
  cpuCount: number
): number | null {
  if (cpuPercent == null) return null
  const value = platform === 'win32' && cpuCount > 0 ? cpuPercent / cpuCount : cpuPercent
  return Math.round(value * 10) / 10
}
