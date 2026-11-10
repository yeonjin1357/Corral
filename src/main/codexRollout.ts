import { open, readdir, stat } from 'fs/promises'
import { join, resolve, sep } from 'path'

/**
 * Codex 세션 기록(rollout) 읽기(F7 기본). 사용자 설정을 바꾸지 않고 `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl`
 * 에서 작업 중·쉬는 중·오류를 안다. 권한 대기는 기록에 남지 않아 알 수 없다.
 * - 세션 폴더 안의 파일만 연다(`auth.json` 등 다른 파일은 열지 않는다).
 * - 줄에서 type·이벤트 이름·시각·cwd·error 여부만 꺼내고 대화 내용은 버린다(결과에 남기지 않는다).
 * - 근거가 없으면 null(지어내지 않음 — 화면은 CPU 추정을 쓴다).
 */

export type RolloutState = { state: 'working' | 'idle' | 'error'; since: number }

/** 파일 끝에서 읽을 크기(큰 기록 파일도 부하가 일정하게). */
const TAIL_BYTES = 64 * 1024
/** 첫 줄(session_meta)을 찾을 때 읽을 크기. 이보다 긴 첫 줄은 판단하지 않는다. */
const HEAD_BYTES = 64 * 1024
/** 파일 이름 시각은 초 단위라, 프로세스 시작과 같은 초에 만든 파일도 받게 둔 여유. */
const START_SLACK_MS = 2000
/** 시작한 날부터 오늘까지 볼 날짜 폴더 수 상한(7일 지난 기록은 Codex 가 압축한다). */
const MAX_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000

const ROLLOUT_NAME = /^rollout-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-.+\.jsonl$/
/** 이벤트 줄만 JSON 으로 읽는다(대화 줄은 열어 보지 않는다). */
const EVENT_HINT = /"(task_started|task_complete|turn_started|turn_complete|turn_aborted)"/

export function codexHome(env: Record<string, string | undefined>, homeDir: string): string {
  return env.CODEX_HOME || join(homeDir, '.codex')
}

/** 파일 이름의 시각(Codex 가 로컬 시각으로 쓴다). 형식이 다르면 null. */
function rolloutTime(name: string): number | null {
  const m = ROLLOUT_NAME.exec(name)
  if (!m) return null
  const [, y, mo, d, h, mi, s] = m.map(Number)
  const t = new Date(y, mo - 1, d, h, mi, s).getTime()
  return Number.isFinite(t) ? t : null
}

/** 경로 비교용: 구분자·끝 구분자·대소문자를 맞춘다(Windows·macOS 기본 파일 시스템은 대소문자 무시). */
export function cwdKey(p: string): string {
  return p
    .replace(/[\\/]+/g, '/')
    .replace(/\/$/, '')
    .toLowerCase()
}

async function readChunk(path: string, from: 'head' | 'tail', size: number): Promise<string> {
  const file = await open(path, 'r')
  try {
    const { size: total } = await file.stat()
    const length = Math.min(size, total)
    const position = from === 'head' ? 0 : total - length
    const buffer = Buffer.alloc(length)
    await file.read(buffer, 0, length, position)
    const text = buffer.toString('utf8')
    // 끝에서 읽었으면 첫 줄은 잘렸을 수 있어 버린다(파일 처음부터 읽은 경우는 그대로).
    return from === 'tail' && position > 0 ? text.slice(text.indexOf('\n') + 1) : text
  } finally {
    await file.close()
  }
}

/** 기록 첫 줄(session_meta)의 작업 폴더. 읽을 수 없으면 null. */
async function sessionCwd(path: string): Promise<string | null> {
  try {
    const head = await readChunk(path, 'head', HEAD_BYTES)
    const end = head.indexOf('\n')
    if (end < 0) return null
    const meta = JSON.parse(head.slice(0, end)) as { type?: unknown; payload?: { cwd?: unknown } }
    return meta.type === 'session_meta' && typeof meta.payload?.cwd === 'string'
      ? meta.payload.cwd
      : null
  } catch {
    return null
  }
}

/** 로컬 날짜 폴더(`sessions/YYYY/MM/DD`). */
function dayDir(home: string, t: number): string {
  const d = new Date(t)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return join(home, 'sessions', String(d.getFullYear()), pad(d.getMonth() + 1), pad(d.getDate()))
}

/**
 * 프로세스의 기록 파일: 시작한 날부터 오늘까지(최대 7일)의 날짜 폴더에서, 파일 이름 시각이 프로세스 시작 이후이고
 * 첫 줄의 작업 폴더가 같은 것 중 가장 최근 것. 압축된 파일(.jsonl.zst)·첫 입력 전(파일 없음)·시작 시각을 모름은 null.
 * resume 한 세션은 예전 파일에 이어 쓰므로 찾지 않는다(모르면 CPU 추정).
 */
export async function findRollout(
  home: string,
  agent: {
    cwd: string
    startedAt: number | null
    /**
     * 같은 폴더의 다른 Codex 프로세스가 살아 있던 구간. 그 동안 만든 파일은 그 프로세스 것일 수 있어 고르지 않는다
     * (먼저 꺼진 다른 프로세스의 "작업 중"으로 끝난 파일을 지금 프로세스 것으로 읽지 않게).
     */
    exclude?: { from: number; to: number }[]
  },
  now: number,
  cwdOf: (path: string) => Promise<string | null> = sessionCwd
): Promise<string | null> {
  if (agent.startedAt == null || !Number.isFinite(agent.startedAt)) return null
  const want = cwdKey(agent.cwd)
  const earliest = agent.startedAt - START_SLACK_MS
  const days = new Set<string>()
  for (let t = Math.max(earliest, now - MAX_DAYS * DAY_MS); t <= now + DAY_MS; t += DAY_MS) {
    if (t > now) t = now
    days.add(dayDir(home, t))
    if (t === now) break
  }
  const candidates: { path: string; t: number }[] = []
  for (const dir of days) {
    let names: string[]
    try {
      names = await readdir(dir)
    } catch {
      continue
    }
    for (const name of names) {
      const t = rolloutTime(name)
      if (t == null || t < earliest) continue
      if ((agent.exclude ?? []).some((x) => t >= x.from - START_SLACK_MS && t <= x.to)) continue
      candidates.push({ path: join(dir, name), t })
    }
  }
  candidates.sort((a, b) => b.t - a.t)
  for (const c of candidates) {
    const cwd = await cwdOf(c.path)
    if (cwd != null && cwdKey(cwd) === want) return c.path
  }
  return null
}

/**
 * 기록 줄에서 지금 상태. 마지막 task_started 뒤에 task_complete·turn_aborted 가 없으면 작업 중,
 * task_complete 에 error 가 있으면 오류, 그 밖은 쉬는 중. since 는 그 이벤트 시각. 근거가 없으면 null.
 */
export function rolloutState(
  lines: string[],
  initial: RolloutState | null = null
): RolloutState | null {
  let state: RolloutState | null = initial
  for (const raw of lines) {
    if (!EVENT_HINT.test(raw)) continue
    let row: { type?: unknown; timestamp?: unknown; payload?: { type?: unknown; error?: unknown } }
    try {
      row = JSON.parse(raw)
    } catch {
      continue
    }
    if (row.type !== 'event_msg' || typeof row.timestamp !== 'string') continue
    const since = Date.parse(row.timestamp)
    if (!Number.isFinite(since)) continue
    const kind = row.payload?.type
    if (kind === 'task_started' || kind === 'turn_started') state = { state: 'working', since }
    else if (kind === 'task_complete' || kind === 'turn_complete')
      state = { state: row.payload?.error ? 'error' : 'idle', since }
    else if (kind === 'turn_aborted') state = { state: 'idle', since }
  }
  return state
}

/** 기록 파일 끝 64KB 로 지금 상태. 읽을 수 없으면 null. */
export async function readRolloutState(path: string): Promise<RolloutState | null> {
  try {
    return rolloutState((await readChunk(path, 'tail', TAIL_BYTES)).split('\n'))
  } catch {
    return null
  }
}

/** 한 번에 읽을 크기(처음 읽는 큰 파일도 메모리에 다 올리지 않는다). */
const READ_CHUNK = 1024 * 1024
const NEWLINE = 0x0a

/**
 * 수집기용: 파일 첫 줄의 작업 폴더는 바뀌지 않으므로 기억해 두고, 상태는 파일마다 마지막으로 읽은 위치부터
 * 덧붙은 부분만 읽어 이어 간다. 긴 턴(도구 출력·추론이 64KB 를 넘음)에서도 task_started 를 잃지 않고,
 * 큰 파일도 매번 다시 읽지 않는다. 파일이 줄었으면(다시 쓴 경우) 처음부터 읽는다.
 */
export function createCodexReader(home: string): {
  stateFor(
    agent: {
      cwd: string
      startedAt: number | null
      exclude?: { from: number; to: number }[]
      /** 훅이 알려 준 그 세션의 기록 파일. sessions 폴더 안이면 찾지 않고 이 파일을 읽는다. */
      transcriptPath?: string | null
    },
    now: number
  ): Promise<RolloutState | null>
} {
  const sessionsDir = resolve(home, 'sessions') + sep
  const insideSessions = (path: string): boolean => {
    const full = resolve(path)
    return process.platform === 'win32' || process.platform === 'darwin'
      ? full.toLowerCase().startsWith(sessionsDir.toLowerCase())
      : full.startsWith(sessionsDir)
  }
  const progress = new Map<string, { offset: number; rest: Buffer; state: RolloutState | null }>()

  async function follow(path: string): Promise<RolloutState | null> {
    let size: number
    try {
      size = (await stat(path)).size
    } catch {
      progress.delete(path)
      return null
    }
    let p = progress.get(path)
    if (!p || size < p.offset) p = { offset: 0, rest: Buffer.alloc(0), state: null }
    if (size > p.offset) {
      const file = await open(path, 'r')
      try {
        let offset = p.offset
        let rest = p.rest
        let state = p.state
        while (offset < size) {
          const length = Math.min(READ_CHUNK, size - offset)
          const chunk = Buffer.alloc(length)
          const { bytesRead } = await file.read(chunk, 0, length, offset)
          if (bytesRead <= 0) break
          offset += bytesRead
          // 줄 단위로만 해석한다(UTF-8 글자가 덩어리 경계에서 잘리지 않게 바이트로 들고 있다가 줄 끝에서 자른다).
          const data = Buffer.concat([rest, chunk.subarray(0, bytesRead)])
          const end = data.lastIndexOf(NEWLINE)
          if (end < 0) {
            rest = data
            continue
          }
          state = rolloutState(data.subarray(0, end).toString('utf8').split('\n'), state)
          rest = Buffer.from(data.subarray(end + 1))
        }
        p = { offset, rest, state }
      } finally {
        await file.close()
      }
    }
    if (progress.size > 50) progress.clear()
    progress.set(path, p)
    return p.state
  }

  const cwdCache = new Map<string, string | null>()
  const cachedCwd = async (path: string): Promise<string | null> => {
    if (cwdCache.has(path)) return cwdCache.get(path)!
    const cwd = await sessionCwd(path)
    if (cwdCache.size > 500) cwdCache.clear()
    cwdCache.set(path, cwd)
    return cwd
  }
  return {
    async stateFor(agent, now) {
      const given = agent.transcriptPath
      const path =
        given && /\.jsonl$/i.test(given) && insideSessions(given)
          ? resolve(given)
          : await findRollout(home, agent, now, cachedCwd)
      return path ? follow(path).catch(() => null) : null
    }
  }
}
