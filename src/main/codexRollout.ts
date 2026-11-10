import { open, readdir, realpath, stat } from 'fs/promises'
import { join, resolve, sep } from 'path'
import type { AgentUsage, CodexLimits, LimitWindow } from '../shared/types'

/**
 * Codex 세션 기록(rollout) 읽기(F7 기본). 사용자 설정을 바꾸지 않고 `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl`
 * 에서 작업 중·쉬는 중·오류를 안다. 권한 대기는 기록에 남지 않아 알 수 없다.
 * - 세션 폴더 안의 파일만 연다(`auth.json` 등 다른 파일은 열지 않는다).
 * - 줄에서 type·이벤트 이름·시각·cwd·error 여부만 꺼내고 대화 내용은 버린다(결과에 남기지 않는다).
 * - 토큰 숫자를 읽을 때(G6, 설정 readUsage)는 token_count 이벤트의 숫자·사용 한도·요금제 이름도 꺼낸다.
 * - 근거가 없으면 null(지어내지 않음 — 화면은 CPU 추정을 쓴다).
 */

/** since: 지금 상태가 된 이벤트 시각, lastEventAt: 읽은 이벤트 가운데 가장 늦은 시각(마지막 활동, G2). */
export type RolloutState = {
  state: 'working' | 'idle' | 'error'
  since: number
  lastEventAt: number
}

/** 세션 기록으로 안 것: 상태, 토큰 숫자(G6), 사용 한도(G6). 모르면 각각 null. */
export interface CodexInfo {
  state: RolloutState | null
  usage: AgentUsage | null
  limits: CodexLimits | null
}

const NO_INFO: CodexInfo = { state: null, usage: null, limits: null }

/** 기록을 고를 Codex 프로세스. */
export interface CodexRolloutAgent {
  cwd: string
  startedAt: number | null
  /** 같은 폴더의 다른 Codex 프로세스가 살아 있던 구간(findRollout). */
  exclude?: { from: number; to: number }[]
  /** 훅이 알려 준 그 세션의 기록 파일. sessions 폴더 안이면 찾지 않고 이 파일을 읽는다. */
  transcriptPath?: string | null
}

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
/** 토큰 숫자를 읽을 때(G6)는 token_count 줄도 읽는다. */
const USAGE_HINT =
  /"(task_started|task_complete|turn_started|turn_complete|turn_aborted|token_count)"/
/** 요금제 이름은 이 길이까지만 받는다(아니면 모름). */
const MAX_PLAN_LENGTH = 40

export function codexHome(env: Record<string, string | undefined>, homeDir: string): string {
  return env.CODEX_HOME || join(homeDir, '.codex')
}

/** Windows·macOS 는 경로 대소문자를 가리지 않는다. */
const SAME_CASE = process.platform === 'win32' || process.platform === 'darwin'

/** path 가 dir 안인지(dir 자신은 아니다). 대소문자는 플랫폼 규칙을 따른다. */
function insideDir(path: string, dir: string): boolean {
  const prefix = dir.endsWith(sep) ? dir : dir + sep
  return SAME_CASE ? path.toLowerCase().startsWith(prefix.toLowerCase()) : path.startsWith(prefix)
}

/**
 * 받은 경로가 dir 안의 .jsonl 이면 그 실제 경로(링크를 풀어도 dir 의 실제 경로 안의 .jsonl 이어야 한다). 아니거나
 * 없으면 null. Windows 의 `\\?\` 앞머리는 뗀다. 상대 경로는 이 프로세스의 작업 폴더 기준이라 보통 밖이다.
 */
export async function jsonlInside(
  given: string | null | undefined,
  dir: string
): Promise<string | null> {
  const path = given?.replace(/^\\\\\?\\/, '')
  if (!path || !/\.jsonl$/i.test(path) || !insideDir(resolve(path), resolve(dir))) return null
  const [real, realDir] = await Promise.all([
    realpath(path).catch(() => null),
    realpath(dir).catch(() => null)
  ])
  return real && realDir && /\.jsonl$/i.test(real) && insideDir(real, realDir) ? real : null
}

/** 0 이상의 유한한 숫자만 그 값, 아니면 null(없음 — 0 으로 보지 않는다). */
export function nonNegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

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
 * task_complete 에 error 가 있으면 오류, 그 밖은 쉬는 중. since 는 그 이벤트 시각, lastEventAt 은 읽은 이벤트
 * 가운데 가장 늦은 시각(앞서 읽은 상태에서 이어 간다). 근거가 없으면 null.
 */
export function rolloutState(
  lines: string[],
  initial: RolloutState | null = null
): RolloutState | null {
  return readRollout(lines, { ...NO_INFO, state: initial }, false).state
}

/**
 * 기록 줄을 읽어 앞서 안 것(initial)에 더한다. 상태는 rolloutState 와 같다. withUsage 면 token_count 이벤트에서
 * 토큰 숫자(마지막 이벤트의 값)와 사용 한도(이벤트 시각이 가장 늦은 값)를 꺼낸다 — 값이 빈 이벤트는 알던 값을 지우지
 * 않는다. withUsage 가 아니면 token_count 줄은 JSON 으로 읽어 보지도 않는다.
 */
function readRollout(lines: string[], initial: CodexInfo, withUsage: boolean): CodexInfo {
  let { state, usage, limits } = initial
  const hint = withUsage ? USAGE_HINT : EVENT_HINT
  for (const raw of lines) {
    if (!hint.test(raw)) continue
    let row: {
      type?: unknown
      timestamp?: unknown
      payload?: { type?: unknown; error?: unknown; info?: unknown; rate_limits?: unknown } | null
    }
    try {
      row = JSON.parse(raw)
    } catch {
      continue
    }
    if (row.type !== 'event_msg' || typeof row.timestamp !== 'string') continue
    const at = Date.parse(row.timestamp)
    if (withUsage && row.payload?.type === 'token_count') {
      usage = tokenUsage(row.payload.info) ?? usage
      const next = Number.isFinite(at) ? rateLimits(row.payload.rate_limits, at) : null
      if (next && (limits === null || next.at >= limits.at)) limits = next
      continue
    }
    if (!Number.isFinite(at)) continue
    const next = eventState(row.payload)
    if (next === null) continue
    state = { state: next, since: at, lastEventAt: Math.max(state?.lastEventAt ?? at, at) }
  }
  return { state, usage, limits }
}

/**
 * token_count 의 info 에서 토큰 숫자: 합계·출력 합은 total_token_usage, 컨텍스트는 last_token_usage 의 합계,
 * 한도는 model_context_window. 모델 이름은 이 이벤트에 없다. 아는 값이 하나도 없으면 null.
 */
function tokenUsage(info: unknown): AgentUsage | null {
  if (!isRecord(info)) return null
  const total = isRecord(info.total_token_usage) ? info.total_token_usage : {}
  const last = isRecord(info.last_token_usage) ? info.last_token_usage : {}
  const usage: AgentUsage = {
    contextTokens: nonNegative(last.total_tokens),
    contextWindow: nonNegative(info.model_context_window),
    outputTokens: nonNegative(total.output_tokens),
    totalTokens: nonNegative(total.total_tokens),
    model: null
  }
  return Object.values(usage).some((v) => v !== null) ? usage : null
}

/** 한도 창 하나: 사용률·창 길이를 모르면 null. 초기화 시각은 초 → ms(모르면 null). */
function limitWindow(value: unknown): LimitWindow | null {
  if (!isRecord(value)) return null
  const usedPercent = nonNegative(value.used_percent)
  const windowMinutes = nonNegative(value.window_minutes)
  if (usedPercent === null || windowMinutes === null) return null
  const resetsAt = nonNegative(value.resets_at)
  return {
    usedPercent,
    windowMinutes,
    resetsAt: resetsAt !== null && Number.isFinite(resetsAt * 1000) ? resetsAt * 1000 : null
  }
}

/** token_count 의 rate_limits. 아는 창이 하나도 없으면 null. */
function rateLimits(value: unknown, at: number): CodexLimits | null {
  if (!isRecord(value)) return null
  const primary = limitWindow(value.primary)
  const secondary = limitWindow(value.secondary)
  if (!primary && !secondary) return null
  const plan = value.plan_type
  return {
    primary,
    secondary,
    planType: typeof plan === 'string' && plan && plan.length <= MAX_PLAN_LENGTH ? plan : null,
    at
  }
}

/** 이벤트 종류가 정하는 상태. 상태와 상관없는 이벤트는 null. */
function eventState(
  payload: { type?: unknown; error?: unknown } | null | undefined
): RolloutState['state'] | null {
  switch (payload?.type) {
    case 'task_started':
    case 'turn_started':
      return 'working'
    case 'task_complete':
    case 'turn_complete':
      return payload.error ? 'error' : 'idle'
    case 'turn_aborted':
      return 'idle'
    default:
      return null
  }
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

/** 파일마다 읽은 위치와 그때까지 안 것. withUsage: token_count 까지 읽었는지(G6). */
interface RolloutProgress {
  offset: number
  rest: Buffer
  info: CodexInfo
  withUsage: boolean
}

/**
 * 수집기용: 파일 첫 줄의 작업 폴더는 바뀌지 않으므로 기억해 두고, 상태는 파일마다 마지막으로 읽은 위치부터
 * 덧붙은 부분만 읽어 이어 간다. 긴 턴(도구 출력·추론이 64KB 를 넘음)에서도 task_started 를 잃지 않고,
 * 큰 파일도 매번 다시 읽지 않는다. 파일이 줄었으면(다시 쓴 경우) 처음부터 읽는다.
 * 토큰 숫자(G6)는 o.usage() 가 true 일 때만 읽는다(기본 true). 꺼져 있으면 token_count 줄을 읽지 않고 들고 있던
 * 숫자도 버린다. 다시 켜면 그 파일을 처음부터 다시 읽는다(꺼진 동안 건너뛴 숫자를 알기 위해).
 */
export function createCodexReader(
  home: string,
  o: { usage?: () => boolean } = {}
): {
  /** 세션 기록으로 안 상태. */
  stateFor(agent: CodexRolloutAgent, now: number): Promise<RolloutState | null>
  /** 세션 기록으로 안 상태·토큰 숫자·사용 한도(G6). 기록이 없으면 모두 null. */
  infoFor(agent: CodexRolloutAgent, now: number): Promise<CodexInfo>
} {
  const sessionsDir = join(home, 'sessions')
  const usageOn = o.usage ?? ((): boolean => true)
  const progress = new Map<string, RolloutProgress>()

  async function follow(path: string, withUsage: boolean): Promise<CodexInfo> {
    let size: number
    try {
      size = (await stat(path)).size
    } catch {
      progress.delete(path)
      return NO_INFO
    }
    let p = progress.get(path)
    // 처음 보거나 파일이 줄었거나, 숫자를 건너뛰고 읽었는데 이제 숫자가 필요하면 처음부터.
    if (!p || size < p.offset || (withUsage && !p.withUsage))
      p = { offset: 0, rest: Buffer.alloc(0), info: NO_INFO, withUsage }
    if (size > p.offset) {
      const file = await open(path, 'r')
      try {
        let offset = p.offset
        let rest = p.rest
        let info = p.info
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
          info = readRollout(data.subarray(0, end).toString('utf8').split('\n'), info, withUsage)
          rest = Buffer.from(data.subarray(end + 1))
        }
        p = { offset, rest, info, withUsage }
      } finally {
        await file.close()
      }
    }
    if (progress.size > 50) progress.clear()
    progress.set(path, p)
    return p.info
  }

  /** 들고 있던 토큰 숫자·한도를 버린다(설정이 꺼져 있을 때). 상태와 읽은 위치는 그대로다. */
  function dropUsage(): void {
    for (const [path, p] of progress)
      if (p.withUsage)
        progress.set(path, {
          ...p,
          info: { ...p.info, usage: null, limits: null },
          withUsage: false
        })
  }

  const cwdCache = new Map<string, string | null>()
  const cachedCwd = async (path: string): Promise<string | null> => {
    if (cwdCache.has(path)) return cwdCache.get(path)!
    const cwd = await sessionCwd(path)
    if (cwdCache.size > 500) cwdCache.clear()
    cwdCache.set(path, cwd)
    return cwd
  }

  async function infoFor(agent: CodexRolloutAgent, now: number): Promise<CodexInfo> {
    const withUsage = usageOn()
    if (!withUsage) dropUsage()
    // 훅이 알려 준 기록 파일은 sessions 폴더 안의 .jsonl 일 때만 쓴다(링크를 풀어도 안이어야 한다).
    const path =
      (await jsonlInside(agent.transcriptPath, sessionsDir)) ??
      (await findRollout(home, agent, now, cachedCwd))
    return path ? follow(path, withUsage).catch(() => NO_INFO) : NO_INFO
  }

  return {
    infoFor,
    async stateFor(agent, now) {
      return (await infoFor(agent, now)).state
    }
  }
}
