import { open, readdir, stat, type FileHandle } from 'fs/promises'
import type { Dirent } from 'fs'
import { join, resolve } from 'path'
import type { AgentUsage } from '../shared/types'
import {
  cursorAt,
  isGone,
  jsonlInside,
  nonNegative,
  readLines,
  type LineCursor
} from './jsonlLines'

/**
 * Claude Code 세션 기록에서 토큰 숫자 읽기(G6). Claude Code 는 세션마다
 * `<Claude 설정 폴더>/projects/<폴더 이름>/<세션 id>.jsonl` 에 대화를 한 줄에 하나씩 남긴다.
 * 문서화되지 않은 내부 형식이라 모든 칸을 의심하고, 모양이 다르면 버린다(지어내지 않음).
 * - projects 폴더 안의 .jsonl 만 연다(링크를 풀어도 안이어야 한다).
 * - `"usage"` 가 든 줄만 JSON 으로 읽고, 응답 줄(type assistant)의 type·isSidechain·message.id·message.model·
 *   usage 의 네 숫자만 꺼낸다. 대화 내용은 결과에도, 읽어 둔 집계에도 남기지 않는다.
 * - 덧붙은 만큼만 읽는다(파일이 줄면 처음부터). 큰 파일(64 MB 초과)은 끝 16 MB 만 읽고 출력 합은 모른다(null).
 * - 줄 읽기는 jsonlLines 의 readLines: 1 MB 씩, `"usage"` 가 든 줄만 이어 붙여 해석하고, 32 MB 넘는 한 줄은 건너뛰고,
 *   덜 쓴 마지막 줄은 들고 있지 않는다(다음에 그 처음부터 다시 읽는다).
 * - 잠깐 읽지 못하면(EBUSY·EPERM·EACCES 등) 알던 값과 읽던 위치를 두고, 파일이 없어지거나 경로를 거절하면 잊는다.
 */

const MB = 1024 * 1024
const MAX_FULL_BYTES = 64 * MB
const TAIL_BYTES = 16 * MB
/**
 * 출력 합을 셀 때 기억하는 message.id 수. 넘으면 가장 오래된 id 를 잊되 그 id 의 마지막 값은 합에 남긴다
 * (같은 응답의 줄은 이어져 있어 잊은 id 가 다시 나오지 않는다 — 다시 나오면 그 응답은 두 번 센다).
 */
const MAX_IDS = 50_000
const MAX_ID_LENGTH = 200
const MAX_MODEL_LENGTH = 100
/** 읽던 위치를 기억하는 파일 수(넘으면 가장 오래 안 읽은 것부터 잊는다). */
const MAX_FILES = 64
/** 세션 id → 찾은 기록 파일을 기억하는 수(못 찾은 세션 id 의 기억도 같은 수까지). */
const MAX_FOUND = 500
/** 기록 파일을 못 찾은 세션 id 는 이만큼 다시 찾지 않는다(수집마다 모든 프로젝트 폴더를 훑지 않게). */
const MISS_RETRY_MS = 60 * 1000
/** Claude Code 가 오류 등으로 직접 만든 응답의 모델 이름(실제 요청이 아니다 — 숫자가 0 이다). */
const SYNTHETIC_MODEL = '<synthetic>'
/** 세션 id 로 기록 파일을 찾을 때 받는 모양(경로 글자가 들어가지 않게). */
const SESSION_ID = /^[0-9a-fA-F-]{8,64}$/
const USAGE_KEY = '"usage"'
const USAGE_BYTES = Buffer.from(USAGE_KEY)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** 한 기록 파일에서 읽어 둔 숫자(메시지 id·숫자·모델 이름뿐 — 대화 내용은 담지 않는다). */
export interface UsageTally {
  /** 사이드체인이 아닌 마지막 요청의 입력 + 캐시 토큰. 모르면 null. */
  contextTokens: number | null
  /** 그 요청의 모델 이름. 모르면 null. */
  model: string | null
  /**
   * message.id → 그 id 의 마지막 output_tokens(최근 MAX_IDS 개). null 이면 출력 합을 세지 않는다(끝만 읽은 큰 파일).
   */
  outputs: Map<string, number> | null
  /** 센 출력 합(잊은 id 의 마지막 값 포함). */
  outputSum: number
}

/** 빈 집계. countOutputs 가 false 면 출력 합을 세지 않는다. */
export function createTally(countOutputs: boolean): UsageTally {
  return {
    contextTokens: null,
    model: null,
    outputs: countOutputs ? new Map() : null,
    outputSum: 0
  }
}

/**
 * 기록 한 줄을 집계에 더한다. `"usage"` 가 든 줄만 JSON 으로 읽고, 응답 줄(type assistant)이고 message.usage 가
 * 객체일 때만 쓴다. 숫자가 빠졌거나 0 이상의 유한한 숫자가 아니면 그 값에는 그 줄을 쓰지 않는다(0 으로 보지 않는다).
 * - 출력: message.id 마다 마지막 output_tokens(한 응답이 내용 블록마다 여러 줄로 되풀이된다). id 가 없으면 세지 않는다.
 * - 컨텍스트: 사이드체인이 아닌 줄의 input_tokens + cache_creation_input_tokens + cache_read_input_tokens 와
 *   그 줄의 모델 이름(100자까지).
 * Claude Code 가 직접 만든 응답(<synthetic>)은 실제 요청이 아니라 건너뛴다.
 */
export function addUsageLine(tally: UsageTally, line: string, maxIds = MAX_IDS): void {
  if (!line.includes(USAGE_KEY)) return
  let row: unknown
  try {
    row = JSON.parse(line)
  } catch {
    return
  }
  if (!isRecord(row) || row.type !== 'assistant') return
  const message = row.message
  if (!isRecord(message) || !isRecord(message.usage)) return
  const usage = message.usage
  const model =
    typeof message.model === 'string' && message.model && message.model.length <= MAX_MODEL_LENGTH
      ? message.model
      : null
  if (model === SYNTHETIC_MODEL) return

  const id = message.id
  const output = nonNegative(usage.output_tokens)
  if (
    tally.outputs &&
    typeof id === 'string' &&
    id &&
    id.length <= MAX_ID_LENGTH &&
    output !== null
  ) {
    const previous = tally.outputs.get(id)
    tally.outputSum += output - (previous ?? 0)
    tally.outputs.set(id, output)
    if (previous === undefined && tally.outputs.size > maxIds) {
      // 가장 오래된 id 를 잊는다(그 마지막 값은 합에 남는다).
      const oldest = tally.outputs.keys().next().value
      if (oldest !== undefined) tally.outputs.delete(oldest)
    }
  }

  if (row.isSidechain === true) return
  const input = nonNegative(usage.input_tokens)
  const created = nonNegative(usage.cache_creation_input_tokens)
  const read = nonNegative(usage.cache_read_input_tokens)
  if (input === null || created === null || read === null) return
  tally.contextTokens = input + created + read
  tally.model = model
}

/** 집계의 토큰 숫자(컨텍스트 한도·합계는 Claude 기록에 없어 null). 아는 값이 없으면 null. */
export function tallyUsage(tally: UsageTally): AgentUsage | null {
  const outputTokens = tally.outputs && tally.outputs.size > 0 ? tally.outputSum : null
  if (tally.contextTokens === null && outputTokens === null) return null
  return {
    contextTokens: tally.contextTokens,
    contextWindow: null,
    outputTokens,
    totalTokens: null,
    model: tally.model
  }
}

/** 파일 하나를 어디까지 읽었는지(커서)와 그때까지의 집계. */
interface Progress {
  cursor: LineCursor
  tally: UsageTally
}

export interface ClaudeUsageReader {
  /** 그 기록 파일의 토큰 숫자. projects 폴더 안의 .jsonl 만 연다. 읽을 수 없거나 아는 값이 없으면 null. */
  usageFor(transcriptPath: string): Promise<AgentUsage | null>
  /**
   * 세션 id 의 기록 파일(`<projects>/<폴더>/<id>.jsonl`, projects 바로 아래 폴더들에서 찾는다). 찾은 경로는 기억하고
   * 그 파일이 없어지면 다시 찾는다. 훑어도 못 찾은 id 는 60초 동안 다시 찾지 않는다. id 모양이 다르거나 없으면 null.
   */
  transcriptFor(sessionId: string): Promise<string | null>
  /** 그 파일의 읽던 위치·집계를 잊는다. */
  forget(transcriptPath: string): void
  /**
   * 들고 있던 것을 모두 버린다(설정 readUsage 를 끌 때 — 찾은·못 찾은 세션 id 의 기억도). 그 전에 시작한 읽기는 아직
   * 파일을 열지 않았으면 열지 않고, 읽던 중이면 결과를 남기지 않는다.
   */
  clear(): void
}

/** Claude 세션 기록 읽기. 크기 한도는 시험에서 작게 줄 수 있다. */
export function createClaudeUsageReader(o: {
  projectsDir: string
  /** 이보다 큰 파일은 끝만 읽는다(기본 64 MB). */
  maxFullBytes?: number
  /** 큰 파일에서 읽을 끝 크기(기본 16 MB). */
  tailBytes?: number
  /** 한 번에 읽을 크기(기본 1 MB). */
  chunkBytes?: number
  /** 이보다 긴 한 줄은 건너뛴다(기본 32 MB). */
  maxLineBytes?: number
  /** 기억할 message.id 수(기본 5만). */
  maxIds?: number
  /** 읽던 위치를 기억하는 파일 수(기본 64). */
  maxFiles?: number
  /** 시계(못 찾은 세션 id 를 다시 찾을 때를 잰다). 기본 Date.now. */
  now?: () => number
}): ClaudeUsageReader {
  const maxFullBytes = o.maxFullBytes ?? MAX_FULL_BYTES
  const tailBytes = o.tailBytes ?? TAIL_BYTES
  const maxIds = Math.max(1, o.maxIds ?? MAX_IDS)
  const maxFiles = Math.max(1, o.maxFiles ?? MAX_FILES)
  const lineOptions = {
    needles: [USAGE_BYTES],
    chunkBytes: o.chunkBytes,
    maxLineBytes: o.maxLineBytes
  }
  const progress = new Map<string, Progress>()
  const inflight = new Map<string, Promise<AgentUsage | null>>()
  const found = new Map<string, string>()
  /** 훑어도 기록 파일을 못 찾은 세션 id → 그때 시각. */
  const missed = new Map<string, number>()
  const now = o.now ?? Date.now
  /** clear 할 때마다 는다: 그 전에 시작한 읽기는 파일을 열지 않고 결과를 남기지 않는다. */
  let generation = 0

  const keyOf = (path: string): string => resolve(path.replace(/^\\\\\?\\/, ''))

  /**
   * 처음(또는 파일이 줄어 다시) 읽을 자리: 큰 파일은 끝 tailBytes 부터(그 자리가 줄 가운데면 잘린 첫 줄은 버린다) —
   * 출력 합은 세지 않는다.
   */
  async function fresh(file: FileHandle, size: number): Promise<Progress> {
    const partial = size > maxFullBytes
    return {
      cursor: await cursorAt(file, partial ? Math.max(0, size - tailBytes) : 0),
      tally: createTally(!partial)
    }
  }

  /** 최근에 쓴 파일로 기억한다(넘치면 가장 오래 안 쓴 것부터 잊는다). */
  function remember(key: string, p: Progress): void {
    progress.delete(key)
    progress.set(key, p)
    if (progress.size > maxFiles) {
      const oldest = progress.keys().next().value
      if (oldest !== undefined) progress.delete(oldest)
    }
  }

  /** 읽지 못했을 때: 파일이 없어졌으면 잊고 null, 잠깐의 실패면 알던 값과 읽던 위치를 둔다. */
  function failed(key: string, known: Progress | undefined, err: unknown): AgentUsage | null {
    if (isGone(err)) {
      progress.delete(key)
      return null
    }
    return known ? tallyUsage(known.tally) : null
  }

  async function readUsage(transcriptPath: string, key: string): Promise<AgentUsage | null> {
    const started = generation
    /** 그 사이 clear 했으면 파일을 열지 않고 결과도 남기지 않는다(기다림마다 본다). */
    const cleared = (): boolean => started !== generation
    const real = await jsonlInside(transcriptPath, o.projectsDir)
    if (cleared()) return null
    if (!real) {
      // 없거나 거절한 경로.
      progress.delete(key)
      return null
    }
    const known = progress.get(key)
    let size: number
    try {
      size = (await stat(real)).size
    } catch (err) {
      return cleared() ? null : failed(key, known, err)
    }
    if (cleared()) return null
    // 크기가 같으면 열지 않는다(방금 쓴 파일로는 기억해 둔다).
    if (known && size === known.cursor.size) {
      remember(key, known)
      return tallyUsage(known.tally)
    }
    let file: FileHandle
    try {
      file = await open(real, 'r')
    } catch (err) {
      return cleared() ? null : failed(key, known, err)
    }
    try {
      const p = known && size > known.cursor.size ? known : await fresh(file, size)
      // 도중에 실패하면 커서는 그대로다(다음에 같은 줄을 다시 받아도 집계는 같다 — id 마다 마지막 값, 마지막 줄의 컨텍스트).
      p.cursor = await readLines(file, p.cursor, size, lineOptions, (line) =>
        addUsageLine(p.tally, line.toString('utf8'), maxIds)
      )
      if (cleared()) return null
      remember(key, p)
      return tallyUsage(p.tally)
    } catch (err) {
      return cleared() ? null : failed(key, known, err)
    } finally {
      await file.close()
    }
  }

  const isFile = (path: string): Promise<boolean> =>
    stat(path).then(
      (s) => s.isFile(),
      () => false
    )

  return {
    usageFor(transcriptPath) {
      // 같은 파일을 동시에 읽지 않는다(같은 집계에 두 번 더하지 않게).
      const key = keyOf(transcriptPath)
      const running = inflight.get(key)
      if (running) return running
      const job = readUsage(transcriptPath, key).finally(() => {
        if (inflight.get(key) === job) inflight.delete(key)
      })
      inflight.set(key, job)
      return job
    },
    async transcriptFor(sessionId) {
      if (!SESSION_ID.test(sessionId)) return null
      const known = found.get(sessionId)
      if (known && (await isFile(known))) return known
      found.delete(sessionId)
      // 얼마 전에 훑어도 못 찾았으면 다시 훑지 않는다(시계가 뒤로 갔으면 다시 찾는다).
      const missedAt = missed.get(sessionId)
      const t = now()
      if (missedAt !== undefined && t >= missedAt && t - missedAt < MISS_RETRY_MS) return null
      missed.delete(sessionId)
      const started = generation
      let dirs: Dirent[]
      try {
        dirs = await readdir(o.projectsDir, { withFileTypes: true })
      } catch {
        return null
      }
      for (const dir of dirs) {
        if (!dir.isDirectory()) continue
        const path = join(o.projectsDir, dir.name, `${sessionId}.jsonl`)
        if (!(await isFile(path))) continue
        if (found.size >= MAX_FOUND) found.clear()
        found.set(sessionId, path)
        return path
      }
      // 훑는 사이 clear 했으면 기억하지 않는다.
      if (started === generation) {
        if (missed.size >= MAX_FOUND) missed.clear()
        missed.set(sessionId, t)
      }
      return null
    },
    forget(transcriptPath) {
      progress.delete(keyOf(transcriptPath))
    },
    clear() {
      generation++
      progress.clear()
      inflight.clear()
      found.clear()
      missed.clear()
    }
  }
}

/** 읽을 세션 기록: 훅이 알려 준 기록 파일, 모르면(null) 세션 id 로 찾는다(transcriptFor). */
export interface UsageTarget {
  sessionId: string
  transcriptPath: string | null
}

/** 수집기가 쓰는 토큰 숫자 기억(수집을 기다리게 하지 않는다). */
export interface UsageCache {
  /** 기억한 토큰 숫자. 아직 읽지 않았거나 모르면 null. 기다리지 않는다. */
  get(sessionId: string): AgentUsage | null
  /**
   * 이 세션들을 쓴다: 읽는 중이거나 줄 서 있지 않으면 뒤에서 다시 읽는다(한 번에 하나씩 — 수집마다 부르므로 한 수집
   * 주기에 한 번까지, 파일 크기가 그대로면 읽기 도구가 열지 않는다). 30분 동안 찾지 않은 세션은 잊는다.
   */
  want(targets: UsageTarget[]): void
  /**
   * 기억과 줄을 모두 버리고 읽기 도구도 비운다(설정 readUsage 를 끌 때). 읽던 중인 것은 기록 파일을 더 열게 하지 않고
   * 결과도 남기지 않는다.
   */
  clear(): void
}

interface CacheEntry {
  sessionId: string
  /** 훅이 알려 준 기록 파일(모르면 null — 세션 id 로 찾는다). */
  given: string | null
  /** 마지막으로 읽은 기록 파일(잊을 때 읽기 도구에도 알린다). */
  path: string | null
  value: AgentUsage | null
  wantedAt: number
  /** 줄을 섰거나 읽는 중. */
  pending: boolean
}

/** 이만큼 찾지 않은 세션은 잊는다(기억이 끝없이 늘지 않게). */
const FORGET_MS = 30 * 60 * 1000

/**
 * 토큰 숫자를 수집과 따로 읽는다(처음 읽는 큰 기록은 몇 초 걸린다): get 은 기억한 값을 바로 주고, want 가 뒤에서 한 번에
 * 하나씩 읽는다(gitStatus 의 변경 수 세기와 같은 모양). 키는 세션 id.
 */
export function createUsageCache(deps: {
  reader: ClaudeUsageReader
  now: () => number
  forgetMs?: number
}): UsageCache {
  const forgetMs = deps.forgetMs ?? FORGET_MS
  let entries = new Map<string, CacheEntry>()
  let queue: CacheEntry[] = []
  let running = false
  /** clear 할 때마다 는다: 그 전에 시작한 읽기는 기록 파일을 열게 하지 않고 결과를 남기지 않는다. */
  let generation = 0

  /** 한 세션을 다시 읽는다. 기다림마다 clear 여부를 보고, 던지면(잠깐의 실패) 알던 값을 둔다. */
  async function refresh(entry: CacheEntry): Promise<void> {
    const started = generation
    try {
      const path = entry.given ?? (await deps.reader.transcriptFor(entry.sessionId))
      if (started !== generation) return
      if (entry.path !== null && entry.path !== path) deps.reader.forget(entry.path)
      entry.path = path
      if (!path) {
        entry.value = null
        return
      }
      const value = await deps.reader.usageFor(path)
      if (started !== generation) return
      entry.value = value
    } catch {
      // 잠깐의 실패: 알던 값을 둔다.
    }
  }

  function pump(): void {
    if (running) return
    const entry = queue.shift()
    if (!entry) return
    running = true
    void refresh(entry).finally(() => {
      entry.pending = false
      running = false
      pump()
    })
  }

  return {
    get: (sessionId) => entries.get(sessionId)?.value ?? null,
    want(targets) {
      const now = deps.now()
      for (const target of targets) {
        let entry = entries.get(target.sessionId)
        if (!entry) {
          entry = {
            sessionId: target.sessionId,
            given: null,
            path: null,
            value: null,
            wantedAt: now,
            pending: false
          }
          entries.set(target.sessionId, entry)
        }
        entry.given = target.transcriptPath
        entry.wantedAt = now
        if (!entry.pending) {
          entry.pending = true
          queue.push(entry)
        }
      }
      for (const [id, entry] of entries) {
        if (entry.pending || now - entry.wantedAt <= forgetMs) continue
        entries.delete(id)
        if (entry.path) deps.reader.forget(entry.path)
      }
      pump()
    },
    clear() {
      generation++
      entries = new Map()
      queue = []
      deps.reader.clear()
    }
  }
}
