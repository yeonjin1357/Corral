import { freemem, totalmem } from 'os'
import type { Platform } from '../../shared/types'
import { COMMAND_TIMEOUT_MS } from '../../shared/defaults'
import { runCommand, type CommandResult } from './runCommand'

export const VM_STAT_ARGV = ['/usr/bin/vm_stat']

/**
 * macOS 의 os.freemem() 은 파일 캐시(inactive)를 빼고 세서 RAM 이 늘 거의 꽉 찬 것처럼 보인다.
 * 바로 돌려받을 수 있는 free + inactive + speculative + purgeable 을 "사용 가능"으로 본다.
 */
export function parseVmStat(out: string): { availableBytes: number } | null {
  const pageSize = /page size of (\d+) bytes/.exec(out)
  if (!pageSize) return null
  const pages = (label: string): number => {
    const m = new RegExp(`^Pages ${label}:\\s+(\\d+)\\.`, 'm').exec(out)
    return m ? Number(m[1]) : 0
  }
  const available = pages('free') + pages('inactive') + pages('speculative') + pages('purgeable')
  return { availableBytes: available * Number(pageSize[1]) }
}

export interface MemoryDeps {
  totalmem: () => number
  freemem: () => number
  run: (argv: string[], opts?: { timeoutMs?: number }) => Promise<CommandResult>
}

const defaultDeps: MemoryDeps = { totalmem, freemem, run: runCommand }

export async function readMemory(
  platform: Platform,
  deps: MemoryDeps = defaultDeps
): Promise<{ totalBytes: number; freeBytes: number }> {
  const totalBytes = deps.totalmem()
  if (platform === 'darwin') {
    try {
      const { stdout, exitCode } = await deps.run(VM_STAT_ARGV, { timeoutMs: COMMAND_TIMEOUT_MS })
      const parsed = exitCode === 0 ? parseVmStat(stdout) : null
      if (parsed) return { totalBytes, freeBytes: Math.min(totalBytes, parsed.availableBytes) }
    } catch {
      // vm_stat 을 못 쓰면 아래 OS 값으로 대신한다.
    }
  }
  return { totalBytes, freeBytes: deps.freemem() }
}
