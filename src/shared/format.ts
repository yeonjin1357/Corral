import type { KillResult, WorktreeInfo } from './types'
import { text } from './text'

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

export function worktreeLabel(worktree: WorktreeInfo | null): string {
  if (!worktree) return text.unresolvable
  const parts = worktree.root.split(/[\\/]+/).filter(Boolean)
  const folder = parts[parts.length - 1] ?? worktree.root
  return `${folder} · ${worktree.branch ?? text.detached}`
}
