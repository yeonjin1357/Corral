import type { KillResult, WorktreeInfo } from './types'
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
  const mb = Math.round(bytes / MiB)
  if (mb < 1024) return `${mb} MB`
  return `${(bytes / GiB).toFixed(1)} GB`
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

export function worktreeLabel(worktree: WorktreeInfo | null): string {
  if (!worktree) return text.unresolvable
  return `${worktreeFolder(worktree)} · ${worktree.branch ?? text.detached}`
}
