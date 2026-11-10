import { closeSync, fstatSync, openSync, readSync } from 'node:fs'
import { isAbsolute, join, posix, win32 } from 'node:path'
import type { DashboardSnapshot } from '../shared/types'
import { pressureSource } from '../shared/format'
import { text } from '../shared/text'
import { heavyMatch } from './heavy'

/*
 * 무거운 작업이 겹치면 에이전트가 기다리게 하기(G7). Claude 의 동기 PreToolUse 훅이 셸 명령을 실행하기 전에 묻는다.
 * pitwall 이 에이전트의 일을 바꾸는 유일한 곳이라 보수적으로 판단한다: 조건이 하나라도 아니거나 모르거나 실패하면
 * 끼어들지 않는다(none). 에이전트에게 돌려주는 말에는 사용자가 정한 패턴 이름과 숫자 하나만 넣는다 — 명령·경로·
 * 다른 프로세스의 글자는 그 에이전트의 문맥에 들어가므로 넣지 않는다. 명령 글자는 판단하는 동안에만 쓰고 남기지 않는다.
 */

export type GuardVerdict =
  | { kind: 'none' }
  | { kind: 'defer'; pattern: string; reason: string }
  | { kind: 'note'; pattern: string; note: string }

/** 같은 세션·패턴은 10분 안에 두 번까지 미루게 하고, 그 뒤로는 참고 문구만 붙인다. */
export const GUARD_WINDOW_MS = 10 * 60 * 1000
export const GUARD_MAX_DEFERS = 2
/** 이보다 큰 package.json 은 읽지 않는다(요청 안에서 동기로 읽으므로). */
const PACKAGE_JSON_LIMIT = 1024 * 1024
/** 알릴 도는 작업 이름 수(나머지는 개수만). */
const RUNNING_LABELS = 3
/** 셸 명령을 실행하는 Claude 도구. */
const SHELL_TOOLS = new Set(['Bash', 'PowerShell'])

const none = (): GuardVerdict => ({ kind: 'none' })

/**
 * 히어독(`<<EOF`·`<<-'EOF'`) 본문을 건너뛴다. newline 은 히어독을 연 줄의 줄바꿈 위치. 마지막 끝 표시 줄의
 * 마지막 글자 위치를 돌려준다(끝 표시가 없으면 글 끝까지 본문).
 */
function skipHeredocs(
  command: string,
  newline: number,
  pending: { end: string; strip: boolean }[]
): number {
  let at = command[newline] === '\r' && command[newline + 1] === '\n' ? newline + 1 : newline
  for (const { end, strip } of pending.splice(0)) {
    for (let found = false; !found;) {
      if (at >= command.length) return command.length
      const nl = command.indexOf('\n', at + 1)
      const stop = nl < 0 ? command.length : nl
      const line = command.slice(at + 1, stop).replace(/\r$/, '')
      found = (strip ? line.replace(/^\t+/, '') : line) === end
      at = stop
    }
  }
  return at - 1
}

/**
 * 셸 명령을 따옴표 밖의 `&&`·`||`·`;`·`|`·줄바꿈으로 나눈다(앞뒤 공백을 떼고 빈 조각은 버린다). 나누기만 하고
 * 실행하거나 풀어 쓰지 않는다. 큰따옴표 안의 `\"` 는 따옴표를 닫지 않는다. 히어독 본문은 명령이 아니라 넣지 않는다.
 */
export function splitShell(command: string): string[] {
  const out: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  const heredocs: { end: string; strip: boolean }[] = []
  const push = (): void => {
    const piece = current.trim()
    if (piece) out.push(piece)
    current = ''
  }
  for (let i = 0; i < command.length; i++) {
    const c = command[i]
    if (quote) {
      current += c
      if (c === '\\' && quote === '"' && i + 1 < command.length) current += command[++i]
      else if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      current += c
      continue
    }
    if (c === '<' && command.startsWith('<<<', i)) {
      current += '<<<'
      i += 2
      continue
    }
    const heredoc =
      c === '<' ? /^<<(-?)[ \t]*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2/.exec(command.slice(i)) : null
    if (heredoc) {
      heredocs.push({ end: heredoc[3], strip: heredoc[1] === '-' })
      current += heredoc[0]
      i += heredoc[0].length - 1
      continue
    }
    if (c === '\n' || c === '\r') {
      push()
      if (heredocs.length) i = skipHeredocs(command, i, heredocs)
      continue
    }
    if (command.startsWith('&&', i) || command.startsWith('||', i)) {
      push()
      i++
      continue
    }
    if (c === ';' || c === '|') {
      push()
      continue
    }
    current += c
  }
  push()
  return out
}

/** 폴더를 바꾸는 명령(bash·PowerShell). */
const CHANGES_DIR = /^(?:cd|chdir|pushd|popd|set-location|sl|push-location|pop-location)(?:\s|$)/i
/** `cd <폴더>` — 폴더는 따옴표 하나로 감싼 것이나 공백·따옴표 없는 글자 하나. */
const CD_PLAIN = /^(?:cd|chdir|pushd|set-location)\s+(?:"([^"]*)"|'([^']*)'|([^\s"'`]+))$/i
/** 셸이 풀어 쓰는 글자(변수·명령 치환·홈·와일드카드). 이런 폴더는 어디인지 모른다. */
const EXPANDS = /[$`~%*?]/

/** `cd <폴더>` 의 폴더. 다른 모양이거나 풀어 쓰는 글자가 있으면 null(모름). */
function cdTarget(segment: string): string | null {
  const m = CD_PLAIN.exec(segment)
  const dir = m ? (m[1] ?? m[2] ?? m[3]) : null
  return dir && !EXPANDS.test(dir) && !dir.startsWith('-') ? dir : null
}

/** 작업 폴더 표기(Windows·POSIX)에 맞춰 폴더를 푼다. 작업 폴더가 절대 경로가 아니면 null. */
function resolveIn(cwd: string, dir: string): string | null {
  const flavor = /^[A-Za-z]:[\\/]|^\\\\/.test(cwd) ? win32 : posix
  return flavor.isAbsolute(cwd) ? flavor.resolve(cwd, dir) : null
}

/** 따옴표로 묶인 구간을 한 낱말로(따옴표는 뗀다). */
function words(segment: string): string[] {
  return (segment.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((w) =>
    w.replace(/^(["'])([\s\S]*)\1$/, '$2')
  )
}

/** 실행 파일 이름(경로·확장자 제외, 소문자): `C:\nodejs\npm.cmd` → `npm`. */
function programName(word: string): string {
  return (word.split(/[\\/]/).pop() ?? '').replace(/\.(exe|cmd|bat|ps1)$/i, '').toLowerCase()
}

/**
 * 패키지 스크립트 실행이면 그 스크립트 이름: `npm run|run-script <s>`·`npm test`·`npm start`, `pnpm|yarn|bun run <s>`,
 * `pnpm|yarn|bun <s>`. 옵션(`-` 로 시작, `--` 뒤 스크립트 인자는 빼고)이 있으면 폴더·작업 공간을 바꾸는 것일 수 있어
 * 어느 scripts 인지 몰라 null.
 */
function scriptName(segment: string): string | null {
  const all = words(segment)
  const cut = all.indexOf('--')
  const w = cut < 0 ? all : all.slice(0, cut)
  const pm = programName(w[0] ?? '')
  let at: number
  if (pm === 'npm') {
    if (w[1] === 'run' || w[1] === 'run-script') at = 2
    else if (w[1] === 'test' || w[1] === 'start') at = 1
    else return null
  } else if (pm === 'pnpm' || pm === 'yarn' || pm === 'bun') {
    at = w[1] === 'run' ? 2 : 1
  } else return null
  const name = w[at]
  if (!name || w.slice(1).some((x) => x.startsWith('-'))) return null
  return name
}

/**
 * 명령을 조각(splitShell)으로 나누고, 패키지 스크립트 실행 조각 뒤에는 그 스크립트 본문의 조각을 **한 단계만** 더한다
 * (스크립트가 다시 부르는 스크립트는 풀지 않는다). 스크립트는 cwd(맨 앞 조각이 `cd <폴더>` 면 그 폴더 — 상대 경로는
 * cwd 기준)의 package.json scripts 에서 찾는다. cwd 를 모르거나, 처음이 아닌 곳에서 폴더를 바꾸거나, 폴더에 풀어 쓰는
 * 글자가 있으면 그 뒤로는 찾지 않는다(조각 자체는 그대로 둔다).
 */
export function commandSegments(
  command: string,
  cwd: string | null,
  readScripts: (dir: string) => Record<string, string> | null
): string[] {
  let dir: string | null = cwd
  const cache = new Map<string, Record<string, string> | null>()
  const out: string[] = []
  splitShell(command).forEach((segment, index) => {
    out.push(segment)
    if (CHANGES_DIR.test(segment)) {
      const target = index === 0 && dir ? cdTarget(segment) : null
      dir = dir && target ? resolveIn(dir, target) : null
      return
    }
    const name = dir ? scriptName(segment) : null
    if (!dir || !name) return
    if (!cache.has(dir)) cache.set(dir, readScripts(dir))
    const scripts = cache.get(dir)
    const body = scripts && Object.hasOwn(scripts, name) ? scripts[name] : null
    if (typeof body === 'string') out.push(...splitShell(body))
  })
  return out
}

/**
 * `<dir>/package.json` 의 scripts 가운데 문자열 값만. dir 은 절대 경로여야 하고(네트워크 공유는 느리거나 막힐 수
 * 있어 읽지 않는다), 1 MB 를 넘거나 없거나 깨졌거나 scripts 가 객체가 아니면 null. 이 파일 하나만 읽는다.
 */
export function readPackageScripts(dir: string): Record<string, string> | null {
  if (!isAbsolute(dir) || /^[\\/]{2}/.test(dir)) return null
  let fd: number | null = null
  try {
    fd = openSync(join(dir, 'package.json'), 'r')
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.size > PACKAGE_JSON_LIMIT) return null
    const buffer = Buffer.alloc(stat.size)
    let read = 0
    while (read < buffer.length) {
      const n = readSync(fd, buffer, read, buffer.length - read, read)
      if (n === 0) break
      read += n
    }
    const json: unknown = JSON.parse(buffer.toString('utf8', 0, read).replace(/^\uFEFF/, ''))
    const scripts = (json as { scripts?: unknown } | null)?.scripts
    if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) return null
    return Object.fromEntries(
      Object.entries(scripts).filter((e): e is [string, string] => typeof e[1] === 'string')
    )
  } catch {
    return null
  } finally {
    if (fd !== null)
      try {
        closeSync(fd)
      } catch {
        // 닫기 실패는 판단과 상관없다.
      }
  }
}

/** 도는 무거운 작업의 패턴 이름(겹치지 않게, 셋까지, 나머지는 개수). */
function runningText(snapshot: DashboardSnapshot): string {
  const labels = [...new Set(snapshot.heavyJobs.map((j) => j.label))]
  return text.guard.running(labels.slice(0, RUNNING_LABELS), labels.length - RUNNING_LABELS)
}

export interface GuardInput {
  /** 훅 이벤트(Claude 가 보낸 그대로). */
  event: Record<string, unknown>
  /** 마지막 스냅샷. */
  snapshot: DashboardSnapshot | null
  /** 설정의 무거운 명령 패턴. */
  patterns: string[]
  now: number
  /** 이보다 오래된 스냅샷으로는 판단하지 않는다. */
  maxAgeMs: number
}

/**
 * 판단(G7). 모두 맞을 때만 끼어든다: PreToolUse, 도구가 Bash·PowerShell, 세션이 있음, tool_input.command 가
 * 문자열이고 그 조각(commandSegments) 가운데 하나가 무거운 명령 패턴에 맞음, 스냅샷이 있고 지연되지 않았고
 * maxAgeMs 안에 찍힘, 이미 도는 무거운 작업이 있음, 메모리 단계가 정상이 아님. 같은 (세션, 패턴)을 windowMs 안에
 * maxDefers 번 미루게 했으면 참고 문구(note)만, 아니면 미루게 한다(defer). 아니면·실패하면 none.
 */
export function createHeavyGuard(
  o: {
    windowMs?: number
    maxDefers?: number
    readScripts?: (dir: string) => Record<string, string> | null
  } = {}
): { decide(input: GuardInput): GuardVerdict } {
  const windowMs = o.windowMs ?? GUARD_WINDOW_MS
  const maxDefers = o.maxDefers ?? GUARD_MAX_DEFERS
  const readScripts = o.readScripts ?? readPackageScripts
  /** (세션, 패턴)마다 미루게 한 시각. */
  const deferred = new Map<string, number[]>()

  function forget(now: number): void {
    for (const [key, times] of deferred) {
      const kept = times.filter((t) => now - t < windowMs)
      if (kept.length) deferred.set(key, kept)
      else deferred.delete(key)
    }
  }

  function judge({ event, snapshot, patterns, now, maxAgeMs }: GuardInput): GuardVerdict {
    if (event.hook_event_name !== 'PreToolUse') return none()
    if (typeof event.tool_name !== 'string' || !SHELL_TOOLS.has(event.tool_name)) return none()
    const session = event.session_id
    if (typeof session !== 'string' || !session) return none()
    const input = event.tool_input
    const command =
      input && typeof input === 'object' ? (input as { command?: unknown }).command : undefined
    if (typeof command !== 'string') return none()
    // 명령을 보기 전에 스냅샷 조건부터(대부분 여기서 끝나 package.json 을 읽지 않는다).
    if (!snapshot || snapshot.stale || now - snapshot.takenAt > maxAgeMs) return none()
    if (snapshot.heavyJobs.length === 0 || snapshot.memory.level === 'normal') return none()
    const cwd = typeof event.cwd === 'string' && event.cwd ? event.cwd : null
    let pattern: string | null = null
    for (const segment of commandSegments(command, cwd, readScripts)) {
      pattern = heavyMatch(segment, patterns)
      if (pattern) break
    }
    if (!pattern) return none()

    const running = runningText(snapshot)
    const { percent } = pressureSource(snapshot.memory)
    const key = JSON.stringify([session, pattern])
    forget(now)
    const times = deferred.get(key) ?? []
    if (times.length >= maxDefers)
      return { kind: 'note', pattern, note: text.guard.note(running, percent) }
    deferred.set(key, [...times, now])
    return { kind: 'defer', pattern, reason: text.guard.defer(running, percent) }
  }

  return {
    decide(input) {
      try {
        return judge(input)
      } catch {
        return none()
      }
    }
  }
}

/** JSON 을 ASCII 로만(그 밖의 글자는 \uXXXX). 훅 출력이 어느 셸·코드 페이지를 지나도 깨지지 않게. */
function asciiJson(value: unknown): string {
  return JSON.stringify(value).replace(
    /[\u007f-\uffff]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`
  )
}

/**
 * 훅 표준출력으로 보낼 답. defer: 실행하지 않게(deny — 이유가 Claude 에게 보인다), note: 그대로 실행하고 참고
 * 문구만 붙인다, none: 답 없음(null — 훅은 아무것도 찍지 않는다).
 */
export function guardResponse(v: GuardVerdict): string | null {
  if (v.kind === 'none') return null
  const output =
    v.kind === 'defer'
      ? {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: v.reason
        }
      : { hookEventName: 'PreToolUse', additionalContext: v.note }
  return asciiJson({ hookSpecificOutput: output })
}

/** 기록(heavy-defer)에 쓸 작업 폴더 이름: 이벤트 cwd 의 마지막 이름. 모르면 null. 전체 경로는 쓰지 않는다. */
export function cwdFolder(event: Record<string, unknown>): string | null {
  if (typeof event.cwd !== 'string') return null
  return (
    event.cwd
      .split(/[\\/]+/)
      .filter(Boolean)
      .at(-1) ?? null
  )
}
