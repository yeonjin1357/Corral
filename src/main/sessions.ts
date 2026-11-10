import type { AgentActivity, AgentState, AgentTool } from '../shared/types'
import type { ClaudeSessionFile } from './claudeSessionFiles'

/**
 * 에이전트 세션 하나(Claude Code·Codex). 훅 이벤트로만 알 수 있다. 이벤트에는 프로세스 정보가 없어서, 수집 때
 * 에이전트 프로세스와 짝지어(processKey — Claude 는 세션 파일로 정확히, 그 밖은 같은 워크트리·가까운 시작 시각으로)
 * 그 프로세스의 행에 붙이고 끝났는지 판단한다. 아직 짝이 없으면 작업 폴더의 워크트리로 그 워크트리의 짝 없는 행에 붙인다.
 */
export interface ClaudeSession {
  id: string
  cwd: string
  state: AgentState
  updatedAt: number
  /** 처음 소식이 온 시각. 어느 프로세스의 세션인지 짝지을 때 쓴다. */
  firstSeen: number
  /** 짝지은 Claude 프로세스(`pid:시작 시각`). 아직 모르면 null. */
  processKey: string | null
  /** 권한 대기 중이면 권한을 요청한 도구 이름(모르면 null). 다른 도구가 끝나도 대기를 유지하는 데 쓴다. */
  waitingTool?: string | null
  /** 마지막으로 응답이 끝난(Stop·StopFailure) 시각. 새 입력이 오면 지운다. */
  stoppedAt?: number | null
  /** 지금 상태가 된 이벤트 시각. 같은 상태 이벤트가 또 와도 그대로다. 없으면 firstSeen. */
  stateSince?: number
  /**
   * 마지막 활동 이벤트 시각(G2): SessionStart·UserPromptSubmit·PreToolUse·PostToolUse·PermissionRequest·Stop·
   * StopFailure·Interrupt, 권한·질문 알림. 응답이 끝나고 60초 뒤에 오는 idle 알림 같은 다른 알림은 활동이 아니다.
   */
  lastActivityAt: number
  /** 어느 도구의 세션인지(없으면 claude). */
  tool?: AgentTool
  /**
   * 세션 기록 파일(훅 이벤트의 transcript_path, .jsonl 만). Codex 는 그 프로세스의 기록을 정확히 고르는 데,
   * Claude 는 토큰 숫자(G6)를 읽는 데 쓴다.
   */
  transcriptPath?: string | null
  /**
   * 하는 일(G3b): 훅이 알려 준 세션 제목·마지막 요청 첫 줄·실행 중인 도구·권한을 기다리는 도구. 메모리에만 둔다.
   * 아는 것이 하나도 없거나 설정(showAgentActivity)이 꺼져 있으면 없다.
   */
  activity?: AgentActivity
}

/** 수집 때 본 최상위 에이전트 프로세스(Claude·Codex). */
export interface LiveClaude {
  key: string
  /** 워크트리 키(worktreeKey). */
  rootKey: string
  startedAt: number | null
  /** 없으면 claude. */
  tool?: AgentTool
}

const toolOf = (x: { tool?: AgentTool }): AgentTool => x.tool ?? 'claude'

export type Sessions = Map<string, ClaudeSession>

/** 이 시간 동안 소식이 없으면 끝난 세션으로 본다(SessionEnd 를 못 받은 경우 대비). */
export const SESSION_EXPIRE_MS = 6 * 60 * 60 * 1000
const MAX_SESSIONS = 500
const MAX_ID_LENGTH = 200
/** 이보다 긴 작업 폴더 값은 받지 않는다(세션 500개 × 큰 문자열로 메모리를 쓰지 않게). */
const MAX_CWD_LENGTH = 4096

/**
 * 응답이 끝난 뒤 이 시간 안에 온 도구 사용 이벤트(PostToolUse)는 늦게 도착한 것으로 보고 무시한다.
 * 훅은 따로따로 비동기로 보내져 Stop 보다 늦게 도착할 수 있다. 그대로 반영하면 다음 알림(약 60초 뒤)까지 작업 중으로 남는다.
 */
const LATE_TOOL_EVENT_MS = 5000

/** 한 에이전트에 붙는 세션이 여럿이면 앞쪽 상태를 보인다. 사용자가 봐야 할 것이 먼저. */
const PRIORITY: AgentState[] = ['waiting', 'working', 'error', 'idle']
function rank(state: AgentState): number {
  const i = PRIORITY.indexOf(state)
  return i < 0 ? PRIORITY.length : i
}

/** 사용자나 에이전트가 무언가를 한 이벤트(마지막 활동 시각을 새로 한다). */
const ACTIVITY_EVENTS = new Set([
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PermissionRequest',
  'Stop',
  'StopFailure',
  'Interrupt'
])
/** 활동으로 치는 알림: 권한·질문(사용자의 답을 기다림). */
const ACTIVITY_NOTIFICATIONS = new Set(['permission_prompt', 'elicitation_dialog'])

function isActivity(ev: Record<string, unknown>): boolean {
  if (ev.hook_event_name === 'Notification')
    return ACTIVITY_NOTIFICATIONS.has(ev.notification_type as string)
  return ACTIVITY_EVENTS.has(ev.hook_event_name as string)
}

/** 이벤트가 정하는 다음 상태. null 은 "상태는 그대로(세션이 없으면 만들지 않음)". */
function nextState(
  ev: Record<string, unknown>,
  session: ClaudeSession | undefined,
  now: number
): AgentState | null {
  const current = session?.state
  switch (ev.hook_event_name) {
    case 'SessionStart':
      // 자동 압축 뒤에도 SessionStart 가 오지만 작업은 이어진다.
      return ev.source === 'compact' && current ? current : 'idle'
    case 'UserPromptSubmit':
      return 'working'
    // PreToolUse: 도구를 쓰기 시작함 = 작업 중.
    case 'PreToolUse':
    case 'PostToolUse':
      if (
        (current === 'idle' || current === 'error') &&
        session?.stoppedAt != null &&
        now - session.stoppedAt < LATE_TOOL_EVENT_MS
      )
        return null
      if (current === 'waiting' && session?.waitingTool) {
        // 권한을 기다리는 동안 병렬로 돌던 다른 도구가 끝나도 대기는 그대로다. 요청한 그 도구가 끝나야 승인된 것.
        // 도구의 시작(PreToolUse)은 승인이 아니다 — 그 도구의 PreToolUse 가 PermissionRequest 보다 늦게 도착할 수도 있다.
        if (ev.hook_event_name === 'PreToolUse' || ev.tool_name !== session.waitingTool)
          return 'waiting'
      }
      return 'working'
    case 'PermissionRequest':
      return 'waiting'
    case 'Notification':
      if (ev.notification_type === 'permission_prompt') return 'waiting'
      if (ev.notification_type === 'elicitation_dialog') return 'waiting'
      if (ev.notification_type === 'idle_prompt') return 'idle'
      return null
    // Interrupt: Codex 에서 사용자가 진행 중인 턴을 멈춤.
    case 'Stop':
    case 'Interrupt':
      return 'idle'
    case 'StopFailure':
      return 'error'
    default:
      return null
  }
}

/** 권한 요청이면 그 도구 이름, 이미 기다리던 중이면 그 도구를 이어 간다. */
function waitingToolOf(
  ev: Record<string, unknown>,
  existing: ClaudeSession | undefined
): string | null {
  if (ev.hook_event_name === 'PermissionRequest')
    return typeof ev.tool_name === 'string' && ev.tool_name ? ev.tool_name : null
  return existing?.state === 'waiting' ? (existing.waitingTool ?? null) : null
}

/** 하는 일(G3b)의 길이: 마지막 요청, Bash·PowerShell 명령, 그 밖(제목·도구 이름·파일 이름·패턴·설명·호스트). */
const PROMPT_MAX = 200
const COMMAND_MAX = 160
const SHORT_MAX = 80

/** 줄의 끝으로 보는 글자: 줄바꿈과 제어 문자(탭은 공백으로 본다), 유니코드 줄·문단 구분자. */
function isLineBreak(code: number): boolean {
  return (
    (code < 0x20 && code !== 0x09) ||
    (code >= 0x7f && code <= 0x9f) ||
    code === 0x2028 ||
    code === 0x2029
  )
}

/** 앞의 공백·빈 줄을 건너뛴 첫 줄(줄바꿈·제어 문자 앞까지). 공백은 하나로 줄인다. */
function firstLine(value: string): string {
  const text = value.trimStart()
  let end = 0
  while (end < text.length && !isLineBreak(text.charCodeAt(end))) end++
  return text.slice(0, end).replace(/\s+/g, ' ').trim()
}

/** max 자까지(넘으면 끝을 … 로). 빈 글은 null. 서로게이트 쌍(이모지 등)을 반으로 자르지 않는다. */
function clip(line: string, max: number): string | null {
  if (!line) return null
  if (line.length <= max) return line
  let cut = line.slice(0, max - 1)
  const last = cut.charCodeAt(cut.length - 1)
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1)
  return cut.trimEnd() + '…'
}

/**
 * 화면에 보일 한 줄. 문자열이 아니면 null, 줄바꿈·제어 문자 뒤는 버리고(첫 줄만 — 앞의 빈 줄은 건너뛴다) 공백을 정리해
 * max 자로 자른다(넘으면 끝에 …). 빈 글은 null.
 */
export function oneLine(value: unknown, max: number): string | null {
  return typeof value === 'string' ? clip(firstLine(value), max) : null
}

/** 경로의 파일 이름(끝의 구분자는 무시). 큰 입력에서도 정규식 되짚기 없이 끝에서 찾는다. */
function fileNameOf(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const path = firstLine(value)
  let end = path.length
  while (end > 0 && (path[end - 1] === '/' || path[end - 1] === '\\')) end--
  const start = Math.max(path.lastIndexOf('/', end - 1), path.lastIndexOf('\\', end - 1)) + 1
  return clip(path.slice(start, end), SHORT_MAX)
}

/** URL 의 호스트(포트 포함, 사용자 정보·경로·쿼리는 빼고). URL 이 아니면 null. */
function hostOf(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    return clip(new URL(firstLine(value)).host, SHORT_MAX)
  } catch {
    return null
  }
}

/**
 * 도구 입력의 짧은 요약(G3b). Bash·PowerShell: 명령 첫 줄 160자, 파일 도구: 파일 이름, Grep·Glob: 패턴 80자,
 * WebFetch: 호스트, Task·Agent: 설명 80자. 그 밖의 도구·형식이 다른 입력은 null(내용을 지어내지 않는다).
 */
export function toolSummary(name: string, input: unknown): string | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const o = input as Record<string, unknown>
  switch (name) {
    case 'Bash':
    case 'PowerShell':
      return oneLine(o.command, COMMAND_MAX)
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
    case 'NotebookEdit':
      return fileNameOf(o.file_path ?? o.notebook_path)
    case 'Grep':
    case 'Glob':
      return oneLine(o.pattern, SHORT_MAX)
    case 'WebFetch':
      return hostOf(o.url)
    case 'Task':
    case 'Agent':
      return oneLine(o.description, SHORT_MAX)
    default:
      return null
  }
}

/** 실행 중인 도구를 비우는 이벤트(같은 이름의 PostToolUse·PermissionRequest 와 함께): 응답 끝·오류·중단·새 입력. */
const ENDS_TOOL = new Set(['Stop', 'StopFailure', 'Interrupt', 'UserPromptSubmit'])

/**
 * 이벤트를 반영한 하는 일(G3b). 제목은 session_title 이 오면 덮어쓰고, 마지막 요청은 UserPromptSubmit 마다 새로 정한다
 * (프롬프트가 없으면 모름). 실행 중인 도구는 PreToolUse 에 담고(상태에 반영하지 않은 늦은 이벤트는 빼고) 같은 이름의
 * PostToolUse·PermissionRequest(권한을 기다림 = 아직 돌지 않음)·응답 끝·오류·중단·새 입력에 비운다. 권한을 기다리는
 * 도구는 PermissionRequest 에 담고 권한 대기를 벗어나면 비운다. 아는 것이 하나도 없으면 undefined.
 */
function nextActivity(
  ev: Record<string, unknown>,
  prev: AgentActivity | undefined,
  state: AgentState | null,
  next: AgentState,
  now: number
): AgentActivity | undefined {
  const event = ev.hook_event_name as string
  const toolName = oneLine(ev.tool_name, SHORT_MAX)
  const title = oneLine(ev.session_title, SHORT_MAX) ?? prev?.title ?? null
  const prompt =
    event === 'UserPromptSubmit' ? oneLine(ev.prompt, PROMPT_MAX) : (prev?.prompt ?? null)
  let tool = prev?.tool ?? null
  if (event === 'PreToolUse') {
    if (state !== null)
      tool = toolName
        ? { name: toolName, summary: toolSummary(toolName, ev.tool_input), since: now }
        : null
  } else if (
    ENDS_TOOL.has(event) ||
    // Claude 는 권한을 묻기 전에 PreToolUse 를 보낸다: 권한을 기다리는 그 도구는 아직 돌고 있지 않다.
    // 승인돼도 다시 담지 않는다(그 뒤의 이벤트가 알려 줄 때만).
    ((event === 'PostToolUse' || event === 'PermissionRequest') &&
      toolName &&
      tool?.name === toolName)
  )
    tool = null
  let waiting = next === 'waiting' ? (prev?.waiting ?? null) : null
  if (event === 'PermissionRequest')
    waiting = toolName ? { tool: toolName, summary: toolSummary(toolName, ev.tool_input) } : null
  return title || prompt || tool || waiting ? { title, prompt, tool, waiting } : undefined
}

/**
 * 훅 이벤트 하나를 반영한다. 바뀐 것이 있으면 true. 형식이 이상한 입력은 무시한다.
 * opts.activity 가 false 면(설정 showAgentActivity 끔) 하는 일 내용을 담지 않고, 그 세션이 들고 있던 것도 버린다.
 */
export function applyHookEvent(
  sessions: Sessions,
  input: unknown,
  now: number,
  tool: AgentTool = 'claude',
  opts: { activity: boolean } = { activity: true }
): boolean {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false
  const ev = input as Record<string, unknown>
  const id = ev.session_id
  if (typeof id !== 'string' || !id || id.length > MAX_ID_LENGTH) return false
  if (typeof ev.hook_event_name !== 'string') return false

  const existing = sessions.get(id)
  if (ev.hook_event_name === 'SessionEnd') return sessions.delete(id)

  const given =
    typeof ev.cwd === 'string' && ev.cwd && ev.cwd.length <= MAX_CWD_LENGTH ? ev.cwd : null
  const cwd = given ?? existing?.cwd
  const state = nextState(ev, existing, now)
  const transcript =
    typeof ev.transcript_path === 'string' &&
    ev.transcript_path.length <= MAX_CWD_LENGTH &&
    /\.jsonl$/i.test(ev.transcript_path)
      ? ev.transcript_path
      : null
  if (!cwd || (!existing && !state)) return false

  const next = state ?? existing!.state
  const activity = opts.activity
    ? nextActivity(ev, existing?.activity, state, next, now)
    : undefined
  // 최근 소식 순서를 유지해 넘칠 때 가장 오래된 것부터 버린다.
  sessions.delete(id)
  sessions.set(id, {
    id,
    cwd,
    state: next,
    updatedAt: now,
    firstSeen: existing?.firstSeen ?? now,
    processKey: existing?.processKey ?? null,
    ...(tool === 'claude' ? {} : { tool }),
    transcriptPath: transcript ?? existing?.transcriptPath ?? null,
    stateSince:
      existing && existing.state === next ? (existing.stateSince ?? existing.firstSeen) : now,
    // 처음 소식이 활동이 아닌 알림이어도 그 전은 모르므로 지금으로 둔다(오래 쉰다고 단정하지 않게).
    lastActivityAt: existing && !isActivity(ev) ? existing.lastActivityAt : now,
    ...(next === 'waiting' ? { waitingTool: waitingToolOf(ev, existing) } : {}),
    stoppedAt:
      ev.hook_event_name === 'Stop' ||
      ev.hook_event_name === 'StopFailure' ||
      ev.hook_event_name === 'Interrupt'
        ? now
        : ev.hook_event_name === 'UserPromptSubmit'
          ? null
          : (existing?.stoppedAt ?? null),
    ...(activity ? { activity } : {})
  })
  while (sessions.size > MAX_SESSIONS) {
    const oldest = sessions.keys().next().value
    if (oldest === undefined) break
    sessions.delete(oldest)
  }
  return true
}

/** 들고 있던 하는 일(G3b)을 모두 지운다(설정 showAgentActivity 를 끌 때). 상태는 그대로다. */
export function clearActivity(sessions: Sessions): void {
  for (const s of sessions.values()) delete s.activity
}

/**
 * 세션을 살아 있는 Claude 프로세스와 짝짓고, 끝난 세션을 버린다(SessionEnd 를 못 받은 경우 대비).
 * - 짝 없는 세션은 6시간 동안 소식이 없으면 버린다. 살아 있는 프로세스와 짝지은 세션은 소식이 없어도 남긴다
 *   (며칠째 쉬는 세션의 마지막 활동을 잃지 않게).
 * - 짝지은 프로세스가 이번 샘플에 없으면(꺼짐) 버린다. 같은 워크트리에 다른 Claude 가 살아 있어도 마찬가지.
 * - 아직 짝이 없고 샘플 전에 소식이 온 세션(그 프로세스는 이번 샘플에 있어야 함)은 같은 워크트리의 짝 없는
 *   Claude 중 시작 시각이 세션보다 앞서고 가장 가까운 것과 짝짓는다.
 *   - 그 워크트리에 Claude 가 하나도 없으면 버린다.
 *   - 모두 짝이 있으면, 이 세션보다 먼저 소식이 끊긴 세션 중 가장 오래된 것의 프로세스가 새 세션으로
 *     넘어온 것으로 보고(/clear 등) 그 예전 세션을 버린다.
 * - 샘플 뒤에 온 세션은 다음 샘플까지 두고, 워크트리를 모르는 세션은 어느 행에도 연결되지 않으니 만료까지 둔다.
 * - 세션 파일로 지금 세션을 아는 프로세스(exact)는 추측의 후보가 아니다(빈 자리로도, 바꿔치기로도 넘기지 않는다).
 *   그 워크트리에 그런 프로세스만 있으면 짝짓지도 버리지도 않고 둔다.
 */
export function reconcileSessions(
  sessions: Sessions,
  opts: {
    now: number
    sampledAt: number
    live: LiveClaude[]
    rootOfCwd: (cwd: string) => string | null
    /** 세션 파일로 지금 세션을 아는 프로세스 키(pairBySessionFile 이 이미 이었다). */
    exact?: Set<string>
  }
): void {
  const liveKeys = new Set(opts.live.map((l) => l.key))
  for (const [id, s] of sessions) {
    if (s.processKey) {
      if (!liveKeys.has(s.processKey)) sessions.delete(id)
    } else if (opts.now - s.updatedAt >= SESSION_EXPIRE_MS) sessions.delete(id)
  }

  const unlinked = [...sessions.values()]
    .filter((s) => !s.processKey && s.firstSeen < opts.sampledAt)
    .sort((a, b) => a.firstSeen - b.firstSeen)
  for (const session of unlinked) {
    const root = opts.rootOfCwd(session.cwd)
    if (!root) continue
    const candidates = opts.live.filter((l) => l.rootKey === root && toolOf(l) === toolOf(session))
    if (candidates.length === 0) {
      sessions.delete(session.id)
      continue
    }
    const guessable = candidates.filter((c) => !opts.exact?.has(c.key))
    if (guessable.length === 0) continue
    const owner = new Map<string, ClaudeSession>()
    for (const s of sessions.values()) if (s.processKey) owner.set(s.processKey, s)

    const free = guessable.filter((c) => !owner.has(c.key))
    if (free.length) {
      session.processKey = closestBefore(free, session.firstSeen).key
      continue
    }
    const replaced = guessable
      .map((c) => owner.get(c.key)!)
      .filter((s) => s.updatedAt <= session.firstSeen)
      .sort((a, b) => a.updatedAt - b.updatedAt)[0]
    if (!replaced) continue
    sessions.delete(replaced.id)
    session.processKey = replaced.processKey
  }
}

/**
 * Claude 세션 파일(G3a)로 세션과 프로세스를 정확히 잇는다(reconcileSessions 의 추측보다 먼저). 파일의 세션 id 와 같은
 * Claude 세션이 있으면 processKey 를 그 파일의 프로세스(keyOfPid)로 고치고, 같은 processKey 를 가진 다른 Claude 세션은
 * 버린다(그 프로세스가 /clear 등으로 새 세션으로 넘어감). 모두 고친 뒤에 버려서, 추측이 엇갈린 두 짝을 서로 바꿔도
 * 잃지 않는다. 이번 샘플의 Claude 가 아닌 pid(keyOfPid 가 null)와 아직 훅 소식이 없는 세션은 건너뛰고,
 * Codex 세션은 건드리지 않는다.
 */
export function pairBySessionFile(
  sessions: Sessions,
  files: Map<number, ClaudeSessionFile>,
  keyOfPid: (pid: number) => string | null
): void {
  const owner = new Map<string, string>()
  for (const [pid, file] of files) {
    const key = keyOfPid(pid)
    const session = sessions.get(file.sessionId)
    if (!key || !session || toolOf(session) !== 'claude') continue
    session.processKey = key
    owner.set(key, session.id)
  }
  for (const [id, s] of sessions) {
    if (toolOf(s) !== 'claude' || !s.processKey) continue
    const mine = owner.get(s.processKey)
    if (mine !== undefined && mine !== id) sessions.delete(id)
  }
}

/** 세션보다 먼저 시작한 것 중 가장 늦게 시작한 프로세스. 없으면 가장 늦게 시작한 것. */
function closestBefore(candidates: LiveClaude[], firstSeen: number): LiveClaude {
  const started = (c: LiveClaude): number => c.startedAt ?? Number.NEGATIVE_INFINITY
  const before = candidates.filter((c) => started(c) <= firstSeen)
  const pool = before.length ? before : candidates
  return pool.reduce((best, c) => (started(c) > started(best) ? c : best))
}

/** 에이전트 행 하나가 훅 세션으로 아는 것. */
export interface HookView {
  state: AgentState
  /** 그 상태가 된 이벤트 시각. */
  since: number
  /** 그 에이전트에 붙은 세션들의 마지막 활동 시각 가운데 가장 최근. */
  lastActivityAt: number
  /** 상태를 보인 세션. */
  sessionId: string
  /** 상태를 보인 세션의 하는 일(G3b). 모르면 null. */
  activity: AgentActivity | null
}

/**
 * 에이전트 프로세스 하나의 훅 상태(G3a). 그 프로세스(`pid:시작 시각`)와 짝지은 세션이 있으면 그 세션들에서,
 * 없으면 아직 짝이 없는 같은 워크트리·같은 도구 세션에서 고른다(다른 프로세스와 짝지은 세션은 쓰지 않는다).
 * 여럿이면 권한 대기 > 작업 중 > 오류 > 쉬는 중, 같은 상태면 가장 오래 이어진 것(가장 오래 기다린 권한 대기 등).
 * 세션 파일로 그 프로세스의 세션(sessionId)을 알면 그 세션만 본다: 그 프로세스와 짝지었거나 아직 짝이 없는(수집
 * 사이에 처음 소식이 온) 그 id 의 세션. 워크트리의 다른 짝 없는 세션은 빌리지 않는다(남의 세션 상태로 오가지 않게).
 * 붙는 세션이 없으면 null.
 */
export function hookViewForAgent(
  sessions: Sessions,
  agent: { key: string; rootKey: string | null; tool: AgentTool; sessionId?: string | null },
  rootOfCwd: (cwd: string) => string | null
): HookView | null {
  const mine = [...sessions.values()].filter((s) => toolOf(s) === agent.tool)
  const poolOf = (): ClaudeSession[] => {
    const known = agent.sessionId
    if (known)
      return mine.filter(
        (s) => s.id === known && (s.processKey === null || s.processKey === agent.key)
      )
    const paired = mine.filter((s) => s.processKey === agent.key)
    if (paired.length) return paired
    return agent.rootKey === null
      ? []
      : mine.filter((s) => !s.processKey && rootOfCwd(s.cwd) === agent.rootKey)
  }
  const pool = poolOf()
  const sinceOf = (s: ClaudeSession): number => s.stateSince ?? s.firstSeen
  let best: ClaudeSession | null = null
  let lastActivityAt = Number.NEGATIVE_INFINITY
  for (const s of pool) {
    lastActivityAt = Math.max(lastActivityAt, s.lastActivityAt)
    if (
      best === null ||
      rank(s.state) < rank(best.state) ||
      (s.state === best.state && sinceOf(s) < sinceOf(best))
    )
      best = s
  }
  return (
    best && {
      state: best.state,
      since: sinceOf(best),
      lastActivityAt,
      sessionId: best.id,
      activity: best.activity ?? null
    }
  )
}

/** 그 프로세스(`pid:시작 시각`)와 짝지은 그 도구의 세션 가운데 기록 파일을 알고 가장 최근 소식이 온 세션. */
function latestPairedWithTranscript(
  sessions: Sessions,
  processKey: string,
  tool: AgentTool
): ClaudeSession | null {
  let best: ClaudeSession | null = null
  for (const s of sessions.values()) {
    if (toolOf(s) !== tool || !s.transcriptPath || s.processKey !== processKey) continue
    if (!best || s.updatedAt > best.updatedAt) best = s
  }
  return best
}

/**
 * 그 Codex 프로세스(`pid:시작 시각`)와 짝지은 세션 가운데 가장 최근 소식이 온 세션의 기록 파일. 없으면 null.
 * 같은 워크트리의 다른 Codex(다른 하위 폴더에서 돈 것)의 기록을 고르지 않도록 프로세스로 고른다.
 */
export function codexTranscriptFor(sessions: Sessions, processKey: string): string | null {
  return latestPairedWithTranscript(sessions, processKey, 'codex')?.transcriptPath ?? null
}

/**
 * 그 Claude 프로세스의 세션 기록을 찾을 단서(G6 토큰 숫자). 짝지은 세션의 기록만 읽는다(짝이 없으면 null).
 * - 세션 파일로 그 프로세스의 세션 id 를 알면 그 세션만 본다: 그 id 의 훅 세션(그 프로세스와 짝지었거나 아직 짝 전)이
 *   기록 파일을 알려 줬으면 그 경로, 아니면 id 만(읽는 쪽이 projects 폴더에서 찾는다 — 훅 연동이 없어도 읽게).
 * - 모르면 그 프로세스와 짝지은 세션 가운데 기록 파일을 아는 가장 최근 것.
 */
export function claudeTranscriptFor(
  sessions: Sessions,
  processKey: string,
  fileSessionId: string | null
): { sessionId: string; transcriptPath: string | null } | null {
  if (fileSessionId !== null) {
    const s = sessions.get(fileSessionId)
    const mine =
      s !== undefined &&
      toolOf(s) === 'claude' &&
      (s.processKey === null || s.processKey === processKey)
    return { sessionId: fileSessionId, transcriptPath: mine ? (s.transcriptPath ?? null) : null }
  }
  const paired = latestPairedWithTranscript(sessions, processKey, 'claude')
  return paired ? { sessionId: paired.id, transcriptPath: paired.transcriptPath ?? null } : null
}
