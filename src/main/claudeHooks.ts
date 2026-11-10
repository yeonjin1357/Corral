import {
  chmod,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import { join } from 'node:path'
import {
  findNodeAtLocation,
  getNodeValue,
  parse,
  parseTree,
  type Node as JsonNode,
  type ParseError
} from 'jsonc-parser'
import type { Platform } from '../shared/types'
import { GUARD_PATH, HOOK_PATH } from './hookServer'

/**
 * pitwall 이 넣은 훅인지 알아보는 표시: 명령 안의 `127.0.0.1:<포트>/pitwall-hook/<도구>` 주소(그 아래 경로 —
 * 질문 훅의 `/pitwall-hook/claude/guard` — 도 포함).
 * 'pitwall-hook' 글자만 보면 다른 도구의 훅(예: 이름이 비슷한 스크립트)을 pitwall 것으로 알고 지울 수 있다.
 */
function hookUrlPattern(path: string): RegExp {
  return new RegExp(`127\\.0\\.0\\.1:\\d{1,5}${path.replace(/\//g, '\\/')}(?![\\w-])`)
}

/**
 * pitwall 이 받는 Claude 훅 이벤트. PreToolUse 는 지금 실행 중인 도구(G3b)를 알려고 넣는다(비동기라 도구 실행을 기다리게
 * 하지 않는다). 이벤트가 늘면 예전에 켠 설정은 partial(다시 켜 주세요)이 된다 — 자동으로 고치지 않는다.
 */
export const CLAUDE_HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PermissionRequest',
  'Notification',
  'PostToolUse',
  'Stop',
  'StopFailure',
  'SessionEnd'
] as const

export interface ClaudeHookEntry {
  type: 'command'
  command: string
  /** Windows 에서 대신 쓸 명령(Codex). */
  commandWindows?: string
  /** 알림 훅은 비동기(도구 실행을 기다리게 하지 않는다). 질문 훅(G7)은 답을 받아야 해서 없음(동기). */
  async?: true
  timeout: number
}

/**
 * pitwall 훅을 넣는 설정 파일(Claude `settings.json`, Codex `hooks.json`). 둘 다
 * `{ "hooks": { "<이벤트>": [ { "matcher"?: …, "hooks": [ { "type": "command", ... } ] } ] } }` 모양이다.
 */
export interface HookFileSpec {
  file: string
  /** 훅 서버 경로(`/pitwall-hook/claude` 등). pitwall 항목을 알아보는 표시. */
  path: string
}

/**
 * 넣을 훅 하나: 그 이벤트에 `{ matcher?, hooks: [entry] }` 그룹 하나로 들어간다. matcher 가 없으면 모든 도구
 * (알림 훅 — 예전과 같은 모양).
 */
export interface HookItem {
  event: string
  entry: ClaudeHookEntry
  matcher?: string
}

/** 질문 훅(G7)이 묻는 도구: 셸 명령을 실행하는 도구만. */
export const GUARD_MATCHER = 'Bash|PowerShell'

/** 이벤트마다 같은 명령 하나(알림 훅). */
export function hookItems(events: readonly string[], entry: ClaudeHookEntry): HookItem[] {
  return events.map((event) => ({ event, entry }))
}

/** Claude 알림 훅들과, guard 가 있으면(G7 을 켰으면) PreToolUse 의 질문 훅 하나. */
export function claudeHookItems(
  entry: ClaudeHookEntry,
  guard: ClaudeHookEntry | null = null
): HookItem[] {
  const items = hookItems(CLAUDE_HOOK_EVENTS, entry)
  if (guard) items.push({ event: 'PreToolUse', matcher: GUARD_MATCHER, entry: guard })
  return items
}

/**
 * parse: JSON 으로 읽을 수 없음, shape: hooks 형식이 예상과 다름, busy: 쓰는 동안 계속 바뀜,
 * encoding: UTF-8 이 아닌 글자가 있음(다시 쓰면 그 글자가 깨지므로 고치지 않는다).
 */
export class ClaudeSettingsError extends Error {
  constructor(
    readonly code: 'parse' | 'shape' | 'busy' | 'encoding',
    message: string
  ) {
    super(message)
    this.name = 'ClaudeSettingsError'
  }
}

export const CLAUDE_HOOK_FILE: HookFileSpec = {
  file: 'settings.json',
  path: HOOK_PATH
}

export function claudeConfigDir(env: Record<string, string | undefined>, home: string): string {
  const custom = env.CLAUDE_CONFIG_DIR?.trim()
  return custom ? custom : join(home, '.claude')
}

const TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/
/** 공백·따옴표·셸 특수 문자가 없는 Windows 폴더 경로만 그대로 쓴다. */
const SAFE_WINDOWS_DIR = /^[A-Za-z]:\\[A-Za-z0-9_.\\-]*$/

/** 포트·토큰을 확인하고(따옴표를 깨는 값 차단) 따옴표로 감싼 훅 서버 주소를 만든다. */
function hookUrl(port: number, token: string, path: string): string {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`invalid port ${port}`)
  if (!TOKEN_PATTERN.test(token)) throw new Error('invalid hook token')
  return `'http://127.0.0.1:${port}${path}?t=${token}'`
}

/** Windows 의 curl.exe 경로(SystemRoot 가 공백·특수 문자 없는 경로일 때). 쓸 수 없으면 null. */
function windowsCurl(systemRoot?: string): string | null {
  return systemRoot && SAFE_WINDOWS_DIR.test(systemRoot)
    ? `${systemRoot.replace(/\\/g, '/').replace(/\/$/, '')}/System32/curl.exe`
    : null
}

/**
 * 셸 형식(문자열 하나)으로 만든다. Claude Code 는 이 문자열을 macOS 에서 `sh -c`, Windows 에서 Git Bash
 * (없으면 PowerShell)로 실행하는데, 아래 한 줄은 그 셋 모두에서 같게 동작한다.
 * - 표준입력(훅 이벤트 JSON)은 curl 이 직접 읽는다. 셸이 표준입력을 명령으로 읽는 형태(`args` 를 쓰는
 *   실행 형식을 모르는 예전 버전에서 `cmd.exe`·`/bin/sh` 만 실행되는 경우)를 피하려고 셸 없는 형식을 쓰지 않는다.
 * - pitwall 이 꺼져 있어도 Claude 에 오류가 보이지 않게 항상 `exit 0`.
 * - 사용자 경로가 들어가지 않아 사용자 이름에 공백·한글이 있어도 상관없다.
 */
export function hookCommand(
  platform: Platform,
  port: number,
  token: string,
  systemRoot?: string
): ClaudeHookEntry {
  const url = hookUrl(port, token, HOOK_PATH)
  const command =
    platform === 'win32'
      ? `${windowsCurl(systemRoot) ?? 'curl.exe'} -s -m 2 -o NUL --data-binary '@-' ${url}; exit 0`
      : `/usr/bin/curl -s -m 2 -o /dev/null --data-binary '@-' ${url}; exit 0`
  return { type: 'command', command, async: true, timeout: 5 }
}

/**
 * 질문 훅(G7): Claude 가 Bash·PowerShell 명령을 실행하기 전에 동기로 돌아 pitwall 의 답을 표준출력으로 넘긴다
 * (답이 없으면 아무것도 찍지 않는다 — 명령은 그대로 실행된다). hookCommand 와 같은 한 줄이되 출력을 버리지 않는다.
 * - 연결 0.3초·전체 2초 제한: pitwall 이 꺼져 있으면 Windows 는 닫힌 로컬 포트 연결에 2초쯤 걸리므로 0.3초에 끊는다.
 *   `-s` 라 실패해도 아무것도 찍지 않고, 항상 `exit 0`. 훅 제한(timeout)은 3초.
 * - Windows 는 언제나 curl.exe 의 절대 경로(SystemRoot 를 쓸 수 없으면 기본 위치) — 출력이 Claude 에 들어가므로
 *   PATH 에서 찾은 다른 프로그램을 실행하지 않는다.
 */
export function guardCommand(
  platform: Platform,
  port: number,
  token: string,
  systemRoot?: string
): ClaudeHookEntry {
  const url = hookUrl(port, token, GUARD_PATH)
  const curl =
    platform === 'win32'
      ? (windowsCurl(systemRoot) ?? 'C:/Windows/System32/curl.exe')
      : '/usr/bin/curl'
  return {
    type: 'command',
    command: `${curl} -s --connect-timeout 0.3 -m 2 --data-binary '@-' ${url}; exit 0`,
    timeout: 3
  }
}

function isPitwallHook(hook: unknown, url: RegExp): boolean {
  if (!hook || typeof hook !== 'object') return false
  const h = hook as { command?: unknown; commandWindows?: unknown; args?: unknown }
  if (typeof h.command === 'string' && url.test(h.command)) return true
  if (typeof h.commandWindows === 'string' && url.test(h.commandWindows)) return true
  return Array.isArray(h.args) && h.args.some((a) => typeof a === 'string' && url.test(a))
}

type Json = Record<string, unknown>

/** 주석·후행 쉼표를 허용해 읽는다. 빈 글은 빈 객체. 읽을 수 없으면 거절한다. */
function readSettings(text: string, file = 'settings.json'): Json {
  if (!text.trim()) return {}
  const errors: ParseError[] = []
  const value: unknown = parse(text, errors, { allowTrailingComma: true, disallowComments: false })
  if (errors.length) throw new ClaudeSettingsError('parse', `${file} 을 읽을 수 없어요`)
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ClaudeSettingsError('shape', `${file} 의 최상위가 객체가 아니에요`)
  const hooks = (value as Json).hooks
  if (hooks === undefined) return value as Json
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks))
    throw new ClaudeSettingsError('shape', `${file} 의 hooks 가 객체가 아니에요`)
  for (const [event, groups] of Object.entries(hooks as Json))
    if (!Array.isArray(groups))
      throw new ClaudeSettingsError('shape', `${file} 의 hooks.${event} 가 배열이 아니에요`)
  return value as Json
}

interface Style {
  eol: string
  /** 들여쓰기 한 단계(공백 n개 또는 탭). */
  unit: string
}

function styleOf(text: string): Style {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const indent = /^([ \t]+)\S/m.exec(text)?.[1]
  if (indent?.startsWith('\t')) return { eol, unit: '\t' }
  return { eol, unit: ' '.repeat(indent ? indent.length : 2) }
}

function lineStart(text: string, offset: number): number {
  return text.lastIndexOf('\n', offset - 1) + 1
}

/** offset 이 있는 줄의 앞쪽 공백. */
function lineIndent(text: string, offset: number): string {
  return /^[ \t]*/.exec(text.slice(lineStart(text, offset), offset))![0]
}

/** 컨테이너 안 항목의 들여쓰기: 첫 항목이 줄 맨 앞에 있으면 그 들여쓰기, 아니면 컨테이너 줄 + 한 단계. */
function childIndent(text: string, container: JsonNode, style: Style): string {
  const first = container.children?.[0]
  if (first) {
    const prefix = text.slice(lineStart(text, first.offset), first.offset)
    if (/^[ \t]*$/.test(prefix)) return prefix
  }
  return lineIndent(text, container.offset) + style.unit
}

/** 값을 JSON 으로 쓰고, 둘째 줄부터 indent 를 붙인다(첫 줄은 넣을 자리에 이어 쓴다). */
function serialize(value: unknown, indent: string, style: Style): string {
  return JSON.stringify(value, null, style.unit)
    .split('\n')
    .join(style.eol + indent)
}

function treeOf(text: string): JsonNode {
  const root = parseTree(text, [], { allowTrailingComma: true, disallowComments: false })
  if (!root) throw new ClaudeSettingsError('parse', 'settings.json 을 읽을 수 없어요')
  return root
}

/**
 * 컨테이너(객체·배열) 끝에 항목 하나를 더한다. piece 는 배열이면 값, 객체면 `"키": 값`.
 * 앞 항목은 글자 그대로 두고(다른 도구가 한 줄로 쓴 항목을 다시 정렬하지 않음) 바로 뒤에 `,` 와 새 항목을 잇는다.
 */
function appendChild(
  text: string,
  container: JsonNode,
  piece: (indent: string) => string,
  style: Style
): string {
  const indent = childIndent(text, container, style)
  const children = container.children ?? []
  const last = children[children.length - 1]
  if (last) {
    const at = last.offset + last.length
    return text.slice(0, at) + ',' + style.eol + indent + piece(indent) + text.slice(at)
  }
  const open = container.offset + 1
  const close = container.offset + container.length - 1
  const inner = text.slice(open, close)
  // 빈 컨테이너. 안에 주석만 있으면 주석은 두고 앞에 넣는다.
  if (inner.trim())
    return text.slice(0, open) + style.eol + indent + piece(indent) + text.slice(open)
  return (
    text.slice(0, open) +
    style.eol +
    indent +
    piece(indent) +
    style.eol +
    lineIndent(text, container.offset) +
    text.slice(close)
  )
}

/** 컨테이너의 index 번째 항목을 앞뒤 쉼표와 함께 뺀다. 마지막 하나면 안을 비운다. */
function removeChild(text: string, container: JsonNode, index: number): string {
  const children = container.children ?? []
  const child = children[index]
  const prev = children[index - 1]
  const next = children[index + 1]
  if (prev)
    return text.slice(0, prev.offset + prev.length) + text.slice(child.offset + child.length)
  if (next) return text.slice(0, child.offset) + text.slice(next.offset)
  return text.slice(0, container.offset + 1) + text.slice(container.offset + container.length - 1)
}

/** 객체 노드에서 키의 property 노드 위치. */
function propertyIndex(object: JsonNode, key: string): number {
  return (object.children ?? []).findIndex((p) => p.children?.[0]?.value === key)
}

/** 처음 보이는 pitwall 훅 하나를 뺀다(그룹에 pitwall 훅만 있으면 그룹째). 없으면 null. */
function removeOnePitwallHook(text: string, url: RegExp): { text: string; event: string } | null {
  const hooks = findNodeAtLocation(treeOf(text), ['hooks'])
  for (const property of hooks?.children ?? []) {
    const event = property.children?.[0]?.value as string
    const groups = property.children?.[1]
    for (const [gi, group] of (groups?.children ?? []).entries()) {
      if (group.type !== 'object') continue
      const list = findNodeAtLocation(group, ['hooks'])
      if (list?.type !== 'array') continue
      const ours = (list.children ?? []).map((h) => isPitwallHook(getNodeValue(h), url))
      const hi = ours.indexOf(true)
      if (hi < 0) continue
      return {
        text: ours.every(Boolean) ? removeChild(text, groups!, gi) : removeChild(text, list, hi),
        event
      }
    }
  }
  return null
}

/** pitwall 이 넣은 훅만 뺀다. 그 때문에 빈 이벤트·hooks 가 되면 그것도 지운다. 나머지는 글자 그대로. */
export function removePitwallHooks(text: string, spec: HookFileSpec = CLAUDE_HOOK_FILE): string {
  if (!readSettings(text, spec.file).hooks) return text
  const url = hookUrlPattern(spec.path)
  let next = text
  const touched = new Set<string>()
  for (
    let removed = removeOnePitwallHook(next, url);
    removed;
    removed = removeOnePitwallHook(next, url)
  ) {
    next = removed.text
    touched.add(removed.event)
  }
  for (const event of touched) {
    const hooks = findNodeAtLocation(treeOf(next), ['hooks'])!
    const index = propertyIndex(hooks, event)
    const value = hooks.children?.[index]?.children?.[1]
    if (index >= 0 && value?.type === 'array' && !value.children?.length)
      next = removeChild(next, hooks, index)
  }
  if (touched.size) {
    const root = treeOf(next)
    const index = propertyIndex(root, 'hooks')
    const hooks = root.children?.[index]?.children?.[1]
    if (index >= 0 && hooks?.type === 'object' && !hooks.children?.length)
      next = removeChild(next, root, index)
  }
  readSettings(next, spec.file)
  return next
}

/** 항목 하나의 그룹. matcher 가 없으면 예전과 같은 `{ hooks: [entry] }` 모양. */
function groupOf(item: HookItem): Record<string, unknown> {
  return item.matcher === undefined
    ? { hooks: [item.entry] }
    : { matcher: item.matcher, hooks: [item.entry] }
}

/**
 * 기존 pitwall 훅을 모두 빼고 항목마다 그 이벤트 끝에 새 그룹을 더한다(두 번 켜도 하나, 포트가 바뀌면 교체,
 * 목록에서 빠진 항목은 사라진다).
 */
export function addPitwallHooks(
  text: string,
  items: readonly HookItem[],
  spec: HookFileSpec = CLAUDE_HOOK_FILE
): string {
  const base = removePitwallHooks(text, spec)
  const style = styleOf(text)
  let next = base.trim() ? base : '{}' + style.eol
  for (const item of items) {
    const root = treeOf(next)
    const hooks = findNodeAtLocation(root, ['hooks'])
    if (!hooks) {
      // hooks 가 아직 없으면 모든 항목을 이벤트별로 묶어 한 번에 쓴다.
      const value: Record<string, unknown[]> = {}
      for (const each of items) (value[each.event] ??= []).push(groupOf(each))
      next = appendChild(next, root, (i) => `"hooks": ${serialize(value, i, style)}`, style)
      break
    }
    const groups = findNodeAtLocation(hooks, [item.event])
    next = groups
      ? appendChild(next, groups, (i) => serialize(groupOf(item), i, style), style)
      : appendChild(
          next,
          hooks,
          (i) => `${JSON.stringify(item.event)}: ${serialize([groupOf(item)], i, style)}`,
          style
        )
  }
  readSettings(next, spec.file)
  return next
}

export interface PitwallHookInspection {
  /**
   * on: 항목마다 그 이벤트에 같은 matcher·명령의 pitwall 훅이 정확히 하나 있고 다른 pitwall 훅이 없음,
   * partial: 일부만 있거나 다른 포트·토큰이거나 남는 pitwall 훅이 있음(G7 설정과 파일이 다를 때 포함),
   * off: pitwall 훅이 없음, error: 파일을 읽을 수 없음.
   */
  state: 'on' | 'partial' | 'off' | 'error'
  /** 사용자가 disableAllHooks 로 훅을 모두 끈 상태. 켜져 있어도 이벤트가 오지 않는다. */
  allHooksDisabled: boolean
}

export function inspectPitwallHooks(
  text: string,
  items: readonly HookItem[],
  spec: HookFileSpec = CLAUDE_HOOK_FILE
): PitwallHookInspection {
  const url = hookUrlPattern(spec.path)
  let settings: Json
  try {
    settings = readSettings(text, spec.file)
  } catch {
    return { state: 'error', allHooksDisabled: false }
  }
  const allHooksDisabled = settings.disableAllHooks === true
  const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>
  // 파일의 모든 pitwall 훅(어느 이벤트에 있든): 이벤트, 그룹의 matcher, 명령.
  const ours: { event: string; matcher: unknown; command: unknown }[] = []
  for (const [event, groups] of Object.entries(hooks))
    for (const group of groups) {
      const g = group as { matcher?: unknown; hooks?: unknown } | null
      if (!Array.isArray(g?.hooks)) continue
      for (const h of g.hooks)
        if (isPitwallHook(h, url))
          ours.push({ event, matcher: g.matcher, command: (h as { command?: unknown }).command })
    }
  if (ours.length === 0) return { state: 'off', allHooksDisabled }
  const exact = items.every(
    (item) =>
      ours.filter(
        (o) =>
          o.event === item.event && o.matcher === item.matcher && o.command === item.entry.command
      ).length === 1
  )
  return { state: exact && ours.length === items.length ? 'on' : 'partial', allHooksDisabled }
}

const BOM = String.fromCharCode(0xfeff)

async function readBytes(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw e
  }
}

/** UTF-8 로 읽는다. 해석할 수 없는 바이트가 있으면(다른 인코딩으로 저장됨) 거절한다. */
function decodeUtf8(bytes: Buffer, file = 'settings.json'): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch {
    throw new ClaudeSettingsError('encoding', `${file} 에 UTF-8 이 아닌 글자가 있어요`)
  }
}

function stamp(now: number): string {
  const d = new Date(now)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  )
}

/**
 * 원본 바이트를 그대로, 원본과 같은 권한으로 백업한다(settings.json 의 env 에 키가 있을 수 있어 0600 등을 지킨다).
 * 같은 초에 여러 번 바꿔도 덮이지 않게 번호를 붙인다.
 */
async function writeBackup(
  dir: string,
  file: string,
  content: Buffer,
  mode: number | null,
  now: number
): Promise<string> {
  const base = join(dir, `${file}.pitwall-backup-${stamp(now)}`)
  for (let i = 0; i < 100; i++) {
    const path = i === 0 ? base : `${base}-${i}`
    try {
      await writeFile(path, content, { flag: 'wx', mode: mode ?? 0o600 })
      if (mode !== null) await chmod(path, mode)
      return path
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
    }
  }
  throw new Error('too many backups')
}

/** Claude Code 가 같은 파일을 읽는 중이면 Windows 에서 잠깐 바꾸기가 막힐 수 있다. */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to)
      return
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (attempt >= 9 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw e
      await new Promise((r) => setTimeout(r, 50 * (attempt + 1)))
    }
  }
}

export interface HookFileResult {
  path: string
  backupPath: string | null
  changed: boolean
}

/**
 * settings.json 을 안전하게 고친다: 백업 → 읽은 뒤 다른 프로그램이 바꿨는지 확인 → 임시 파일에 쓰고 바꿔치기.
 * 링크(dotfiles 관리)면 링크는 두고 가리키는 파일을 고친다. BOM·파일 권한을 지킨다.
 */
async function rewriteSettings(
  dir: string,
  transform: (text: string) => string,
  now: number,
  file = 'settings.json'
): Promise<HookFileResult> {
  const path = join(dir, file)
  for (let attempt = 0; attempt < 3; attempt++) {
    const original = await readBytes(path)
    const text = original === null ? '' : decodeUtf8(original, file)
    const hasBom = text.startsWith(BOM)
    const body = hasBom ? text.slice(1) : text
    const next = transform(body)
    if (next === body) return { path, backupPath: null, changed: false }

    let target = path
    let mode: number | null = null
    if (original === null) {
      await mkdir(dir, { recursive: true })
    } else {
      if ((await lstat(path)).isSymbolicLink()) target = await realpath(path)
      mode = (await stat(target)).mode & 0o777
    }
    const backupPath = original === null ? null : await writeBackup(dir, file, original, mode, now)

    const again = await readBytes(path)
    if (again === null ? original !== null : original === null || !again.equals(original)) {
      if (backupPath) await rm(backupPath, { force: true })
      continue
    }
    const tmp = `${target}.pitwall-tmp-${process.pid}`
    try {
      await writeFile(tmp, (hasBom ? BOM : '') + next, { flag: 'w' })
      if (mode !== null) await chmod(tmp, mode)
      await renameWithRetry(tmp, target)
    } catch (e) {
      await rm(tmp, { force: true })
      throw e
    }
    return { path, backupPath, changed: true }
  }
  throw new ClaudeSettingsError('busy', `${file} 이 계속 바뀌고 있어요`)
}

export function installPitwallHooks(opts: {
  dir: string
  items: readonly HookItem[]
  now: number
  spec: HookFileSpec
}): Promise<HookFileResult> {
  return rewriteSettings(
    opts.dir,
    (text) => addPitwallHooks(text, opts.items, opts.spec),
    opts.now,
    opts.spec.file
  )
}

export function uninstallPitwallHooks(opts: {
  dir: string
  now: number
  spec: HookFileSpec
}): Promise<HookFileResult> {
  return rewriteSettings(
    opts.dir,
    (text) => removePitwallHooks(text, opts.spec),
    opts.now,
    opts.spec.file
  )
}

export async function readPitwallHookState(
  dir: string,
  items: readonly HookItem[],
  spec: HookFileSpec
): Promise<PitwallHookInspection> {
  try {
    const bytes = await readBytes(join(dir, spec.file))
    const text = bytes === null ? '' : decodeUtf8(bytes, spec.file)
    return inspectPitwallHooks(text.startsWith(BOM) ? text.slice(1) : text, items, spec)
  } catch {
    return { state: 'error', allHooksDisabled: false }
  }
}

export function installClaudeHooks(opts: {
  dir: string
  items: readonly HookItem[]
  now: number
}): Promise<HookFileResult> {
  return installPitwallHooks({ ...opts, spec: CLAUDE_HOOK_FILE })
}

/** pitwall 이 넣은 Claude 훅을 모두 뺀다(질문 훅 포함). */
export function uninstallClaudeHooks(opts: { dir: string; now: number }): Promise<HookFileResult> {
  return uninstallPitwallHooks({ ...opts, spec: CLAUDE_HOOK_FILE })
}

export function readClaudeHookState(
  dir: string,
  items: readonly HookItem[]
): Promise<PitwallHookInspection> {
  return readPitwallHookState(dir, items, CLAUDE_HOOK_FILE)
}
