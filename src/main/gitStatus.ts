import { worktreeKey } from '../shared/format'
import { runCommand, type Runner } from './collect/runCommand'
import { GIT_ENV, GIT_TIMEOUT_MS } from './git'

/** 커밋 안 한 변경 수(G4): 워크트리마다 `git status --porcelain` 줄 수를 뒤에서 세어 기억한다. */

/** 같은 워크트리를 다시 세는 간격. */
const CHANGE_TTL_MS = 5 * 60 * 1000
/** 한 번에 도는 git 수. */
const CHANGE_CONCURRENCY = 2
/** 이만큼 찾지 않은 워크트리는 잊는다(기억이 끝없이 늘지 않게). */
const FORGET_MS = 30 * 60 * 1000
/** 네트워크 공유·WSL 경로(`\\server\…`): 응답이 느리거나 막힐 수 있어 세지 않는다. */
const NETWORK_PATH = /^[\\/]{2}/
/**
 * 저장소 설정(.git/config)이 git status 에서 프로그램을 띄우거나(fsmonitor 훅) 색인에 캐시를 쓰지 않게 끈다.
 * `-c` 는 git 이 하위 git 에도 넘긴다.
 */
const STATUS_CONFIG = ['-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false']

/**
 * 워크트리의 커밋 안 한 변경 수: `git status --porcelain` 의 빈 줄이 아닌 줄 수(바꾼 파일·새 파일, 새 폴더는 한 줄).
 * 저장소를 작업 폴더(cwd)로 쓰지 않고 `-C` 로 넘기며, 잠금 파일을 만들지 않는다(GIT_OPTIONAL_LOCKS=0). 제한 10초.
 * 저장소가 아니거나 실패·시간 초과면 null.
 */
export async function countChanges(root: string, run: Runner = runCommand): Promise<number | null> {
  try {
    const r = await run(['git', '-C', root, ...STATUS_CONFIG, 'status', '--porcelain'], {
      timeoutMs: GIT_TIMEOUT_MS,
      env: GIT_ENV
    })
    if (r.exitCode !== 0) return null
    return r.stdout.split(/\r?\n/).filter((line) => line.trim() !== '').length
  } catch {
    return null
  }
}

export interface ChangeCounter {
  /** 기억한 변경 수. 아직 세지 않았거나 실패했으면 null. 기다리지 않는다. */
  get(root: string): number | null
  /** 이 워크트리들을 쓴다: 처음 보거나 ttl 이 지난 것을 뒤에서 다시 센다. 오래 찾지 않은 것은 잊는다. */
  want(roots: string[]): void
}

interface Entry {
  root: string
  value: number | null
  /** 마지막으로 다 센(실패 포함) 시각. 아직이면 null. */
  countedAt: number | null
  /** 마지막으로 찾은 시각. */
  wantedAt: number
  /** 줄을 섰거나 세는 중. */
  pending: boolean
}

/**
 * 변경 수를 수집과 따로 센다: get 은 기억한 값을 바로 주고, want 가 처음 보거나 ttl(기본 5분)이 지난 워크트리를 뒤에서
 * 한 번에 concurrency(기본 2)개씩 센다. 세다가 실패하거나 시간이 넘으면 null 로 두고 ttl 뒤에 다시 센다.
 * 경로는 worktreeKey 로 견준다. 네트워크 경로는 세지 않는다. 30분 동안 찾지 않은 워크트리는 잊는다.
 */
export function createChangeCounter(deps: {
  run: (root: string) => Promise<number | null>
  now: () => number
  ttlMs?: number
  concurrency?: number
}): ChangeCounter {
  const ttl = deps.ttlMs ?? CHANGE_TTL_MS
  const limit = Math.max(1, deps.concurrency ?? CHANGE_CONCURRENCY)
  const entries = new Map<string, Entry>()
  const queue: Entry[] = []
  let running = 0

  async function count(entry: Entry): Promise<void> {
    let value: number | null
    try {
      value = await deps.run(entry.root)
    } catch {
      value = null
    }
    entry.value = value
    entry.countedAt = deps.now()
    entry.pending = false
  }

  function pump(): void {
    while (running < limit) {
      const entry = queue.shift()
      if (!entry) return
      running++
      void count(entry).finally(() => {
        running--
        pump()
      })
    }
  }

  /** 다시 셀 때가 됐나(시계가 뒤로 가도 다시 센다). */
  const due = (entry: Entry, now: number): boolean =>
    entry.countedAt === null || now < entry.countedAt || now - entry.countedAt >= ttl

  return {
    get: (root) => entries.get(worktreeKey(root))?.value ?? null,
    want(roots) {
      const now = deps.now()
      for (const root of roots) {
        if (NETWORK_PATH.test(root)) continue
        const key = worktreeKey(root)
        let entry = entries.get(key)
        if (!entry) {
          entry = { root, value: null, countedAt: null, wantedAt: now, pending: false }
          entries.set(key, entry)
        }
        entry.wantedAt = now
        if (!entry.pending && due(entry, now)) {
          entry.pending = true
          queue.push(entry)
        }
      }
      for (const [key, entry] of entries)
        if (!entry.pending && now - entry.wantedAt > FORGET_MS) entries.delete(key)
      pump()
    }
  }
}
