import { open, readdir, stat, type FileHandle } from 'fs/promises'
import { join } from 'path'
import type { AgentUsage, CodexLimits, LimitWindow } from '../shared/types'
import {
  cursorAt,
  isGone,
  jsonlInside,
  nonNegative,
  readLines,
  type LineCursor
} from './jsonlLines'

/**
 * Codex 세션 기록(rollout) 읽기(F7 기본). 사용자 설정을 바꾸지 않고 `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl`
 * 에서 작업 중·쉬는 중·오류를 안다. 응답 대기는 기록에 남지 않아 알 수 없다.
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

/** 줄 읽기가 이어 붙여 넘기는 줄의 표시(EVENT_HINT·USAGE_HINT 와 같은 이름들). */
const STATE_NEEDLES = [
  'task_started',
  'task_complete',
  'turn_started',
  'turn_complete',
  'turn_aborted'
].map((name) => Buffer.from(`"${name}"`))
const USAGE_NEEDLES = [...STATE_NEEDLES, Buffer.from('"token_count"')]
/** 처음 읽을 때(또는 처음부터 다시 읽을 때) 이보다 큰 기록은 끝 이만큼만 읽는다. */
const FIRST_READ_BYTES = 16 * 1024 * 1024

export function codexHome(env: Record<string, string | undefined>, homeDir: string): string {
  return env.CODEX_HOME || join(homeDir, '.codex')
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

/**
 * 파일마다 어디까지 읽었는지(커서 — 덜 쓴 마지막 줄은 들고 있지 않는다)와 그때까지 안 것.
 * withUsage: token_count 까지 읽었는지(G6).
 */
interface RolloutProgress {
  cursor: LineCursor
  info: CodexInfo
  withUsage: boolean
}

/**
 * 수집기용: 파일 첫 줄의 작업 폴더는 바뀌지 않으므로 기억해 두고, 상태는 파일마다 마지막으로 읽은 위치부터
 * 덧붙은 부분만 읽어 이어 간다. 긴 턴(도구 출력·추론이 64KB 를 넘음)에서도 task_started 를 잃지 않고,
 * 큰 파일도 매번 다시 읽지 않는다. 파일이 줄었으면(다시 쓴 경우) 처음부터 읽는다.
 * - 처음 읽을 때(처음부터 다시 읽을 때도) firstReadBytes(기본 16 MB)보다 큰 기록은 끝 그만큼만 읽는다(그 자리가 줄
 *   가운데면 잘린 첫 줄은 버린다). token_count 는 누적 값이고 상태는 마지막 이벤트로 정하므로 끝으로 충분하다 — 끝에
 *   상태 이벤트가 없으면 상태는 모른다.
 * - 줄 읽기는 jsonlLines 의 readLines: 이벤트 이름이 든 줄만 이어 붙여 해석하고, 32 MB 넘는 한 줄은 건너뛰고, 덜 쓴
 *   마지막 줄은 들고 있지 않는다(대화 내용이 든 줄 조각을 읽기 사이에 남기지 않는다).
 * - 잠깐 읽지 못하면(EBUSY·EPERM·EACCES 등) 알던 것과 읽던 위치를 두고, 파일이 없어지면 잊는다.
 * 토큰 숫자(G6)는 o.usage() 가 true 일 때만 읽는다(기본 true). 꺼져 있으면 token_count 줄을 읽지 않고 들고 있던
 * 숫자도 버린다(dropUsage 로 바로 버릴 수도 있다). 읽는 도중에 꺼지거나 dropUsage 가 있었으면 그 읽기가 얻은 숫자도
 * 담지 않는다. 다시 켜면 그 파일을 처음부터(끝 firstReadBytes) 다시 읽는다.
 */
export function createCodexReader(
  home: string,
  o: {
    usage?: () => boolean
    /** 처음 읽을 때 이보다 큰 기록은 끝 이만큼만 읽는다(기본 16 MB). */
    firstReadBytes?: number
    /** 한 번에 읽을 크기(기본 1 MB, 시험용). */
    chunkBytes?: number
    /** 이보다 긴 한 줄은 건너뛴다(기본 32 MB, 시험용). */
    maxLineBytes?: number
  } = {}
): {
  /** 세션 기록으로 안 상태. */
  stateFor(agent: CodexRolloutAgent, now: number): Promise<RolloutState | null>
  /** 세션 기록으로 안 상태·토큰 숫자·사용 한도(G6). 기록이 없으면 모두 null. */
  infoFor(agent: CodexRolloutAgent, now: number): Promise<CodexInfo>
  /** 들고 있던 토큰 숫자·한도를 지금 버린다(설정 readUsage 를 끌 때). 상태와 읽은 위치는 그대로다. */
  dropUsage(): void
} {
  const sessionsDir = join(home, 'sessions')
  const usageOn = o.usage ?? ((): boolean => true)
  const firstReadBytes = Math.max(1, o.firstReadBytes ?? FIRST_READ_BYTES)
  const progress = new Map<string, RolloutProgress>()
  /** dropUsage 를 부른 횟수. 읽기를 시작한 뒤 바뀌었으면 그 읽기가 얻은 숫자는 담지 않는다. */
  let drops = 0

  /** 읽지 못했을 때: 파일이 없어졌으면 잊고, 잠깐의 실패면 알던 것과 읽던 위치를 둔다. */
  function failed(path: string, known: RolloutProgress | undefined, err: unknown): CodexInfo {
    if (isGone(err)) {
      progress.delete(path)
      return NO_INFO
    }
    return known?.info ?? NO_INFO
  }

  /**
   * 그 파일을 읽던 위치부터 이어 읽는다. dropsSeen 은 withUsage 를 정할 때의 drops: 읽는 사이에 숫자 읽기가 꺼졌거나
   * dropUsage 가 있었으면 이 읽기가 얻은 숫자·한도는 담지 않는다(다시 필요하면 처음부터 읽는다).
   */
  async function follow(path: string, withUsage: boolean, dropsSeen: number): Promise<CodexInfo> {
    const known = progress.get(path)
    let size: number
    try {
      size = (await stat(path)).size
    } catch (err) {
      return failed(path, known, err)
    }
    // 처음 보거나 파일이 줄었거나, 숫자를 건너뛰고 읽었는데 이제 숫자가 필요하면 처음부터(끝 firstReadBytes).
    const restart = !known || size < known.cursor.size || (withUsage && !known.withUsage)
    if (!restart && size === known.cursor.size) return known.info
    let file: FileHandle
    try {
      file = await open(path, 'r')
    } catch (err) {
      return failed(path, known, err)
    }
    try {
      let info = restart ? NO_INFO : known.info
      const from = restart ? await cursorAt(file, Math.max(0, size - firstReadBytes)) : known.cursor
      const cursor = await readLines(
        file,
        from,
        size,
        {
          needles: withUsage ? USAGE_NEEDLES : STATE_NEEDLES,
          chunkBytes: o.chunkBytes,
          maxLineBytes: o.maxLineBytes
        },
        (line) => {
          info = readRollout([line.toString('utf8')], info, withUsage)
        }
      )
      const dropped = withUsage && (!usageOn() || drops !== dropsSeen)
      const p = dropped
        ? { cursor, info: { ...info, usage: null, limits: null }, withUsage: false }
        : { cursor, info, withUsage }
      if (progress.size > 50) progress.clear()
      progress.set(path, p)
      return p.info
    } catch (err) {
      return failed(path, known, err)
    } finally {
      await file.close()
    }
  }

  /** 들고 있던 토큰 숫자·한도를 버린다. 상태와 읽은 위치는 그대로다. */
  function dropUsage(): void {
    drops++
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
    const dropsSeen = drops
    // 훅이 알려 준 기록 파일은 sessions 폴더 안의 .jsonl 일 때만 쓴다(링크를 풀어도 안이어야 한다).
    const path =
      (await jsonlInside(agent.transcriptPath, sessionsDir)) ??
      (await findRollout(home, agent, now, cachedCwd))
    return path ? follow(path, withUsage, dropsSeen).catch(() => NO_INFO) : NO_INFO
  }

  return {
    infoFor,
    dropUsage,
    async stateFor(agent, now) {
      return (await infoFor(agent, now)).state
    }
  }
}
