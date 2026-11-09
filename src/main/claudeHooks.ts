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
import { HOOK_PATH } from './hookServer'

/**
 * pitwall 이 넣은 훅인지 알아보는 표시: 명령 안의 `127.0.0.1:<포트>/pitwall-hook/<도구>` 주소.
 * 'pitwall-hook' 글자만 보면 다른 도구의 훅(예: 이름이 비슷한 스크립트)을 pitwall 것으로 알고 지울 수 있다.
 */
function hookUrlPattern(path: string): RegExp {
  return new RegExp(`127\\.0\\.0\\.1:\\d{1,5}${path.replace(/\//g, '\\/')}(?![\\w-])`)
}

export const CLAUDE_HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
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
  async: true
  timeout: number
}

/**
 * pitwall 훅을 넣는 설정 파일(Claude `settings.json`, Codex `hooks.json`). 둘 다
 * `{ "hooks": { "<이벤트>": [ { "hooks": [ { "type": "command", ... } ] } ] } }` 모양이다.
 */
export interface HookFileSpec {
  file: string
  events: readonly string[]
  /** 훅 서버 경로(`/pitwall-hook/claude` 등). pitwall 항목을 알아보는 표시. */
  path: string
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
  events: CLAUDE_HOOK_EVENTS,
  path: HOOK_PATH
}

export function claudeConfigDir(env: Record<string, string | undefined>, home: string): string {
  const custom = env.CLAUDE_CONFIG_DIR?.trim()
  return custom ? custom : join(home, '.claude')
}

const TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/
/** 공백·따옴표·셸 특수 문자가 없는 Windows 폴더 경로만 그대로 쓴다. */
const SAFE_WINDOWS_DIR = /^[A-Za-z]:\\[A-Za-z0-9_.\\-]*$/

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
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`invalid port ${port}`)
  if (!TOKEN_PATTERN.test(token)) throw new Error('invalid hook token')
  const url = `'http://127.0.0.1:${port}${HOOK_PATH}?t=${token}'`
  let command: string
  if (platform === 'win32') {
    const curl =
      systemRoot && SAFE_WINDOWS_DIR.test(systemRoot)
        ? `${systemRoot.replace(/\\/g, '/').replace(/\/$/, '')}/System32/curl.exe`
        : 'curl.exe'
    command = `${curl} -s -m 2 -o NUL --data-binary '@-' ${url}; exit 0`
  } else {
    command = `/usr/bin/curl -s -m 2 -o /dev/null --data-binary '@-' ${url}; exit 0`
  }
  return { type: 'command', command, async: true, timeout: 5 }
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

/** 기존 pitwall 훅을 빼고 각 이벤트 끝에 새 그룹을 더한다(두 번 켜도 하나, 포트가 바뀌면 교체). */
export function addPitwallHooks(
  text: string,
  entry: ClaudeHookEntry,
  spec: HookFileSpec = CLAUDE_HOOK_FILE
): string {
  const base = removePitwallHooks(text, spec)
  const style = styleOf(text)
  let next = base.trim() ? base : '{}' + style.eol
  const group = { hooks: [entry] }
  for (const event of spec.events) {
    const root = treeOf(next)
    const hooks = findNodeAtLocation(root, ['hooks'])
    if (!hooks) {
      const value = Object.fromEntries(spec.events.map((e) => [e, [group]]))
      next = appendChild(next, root, (i) => `"hooks": ${serialize(value, i, style)}`, style)
      break
    }
    const groups = findNodeAtLocation(hooks, [event])
    next = groups
      ? appendChild(next, groups, (i) => serialize(group, i, style), style)
      : appendChild(
          next,
          hooks,
          (i) => `${JSON.stringify(event)}: ${serialize([group], i, style)}`,
          style
        )
  }
  readSettings(next, spec.file)
  return next
}

export interface PitwallHookInspection {
  /** on: 모든 이벤트에 지금 명령이 있음, partial: 일부만 있거나 다른 포트·토큰, off: 없음, error: 파일을 읽을 수 없음. */
  state: 'on' | 'partial' | 'off' | 'error'
  /** 사용자가 disableAllHooks 로 훅을 모두 끈 상태. 켜져 있어도 이벤트가 오지 않는다. */
  allHooksDisabled: boolean
}

export function inspectPitwallHooks(
  text: string,
  entry: ClaudeHookEntry,
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
  let found = 0
  let current = 0
  for (const event of spec.events) {
    const ours = (hooks[event] ?? []).flatMap((group) => {
      const list = (group as { hooks?: unknown } | null)?.hooks
      return Array.isArray(list) ? list.filter((h) => isPitwallHook(h, url)) : []
    })
    if (ours.length) found++
    if (ours.some((h) => (h as { command?: unknown }).command === entry.command)) current++
  }
  const state =
    found === 0 ? 'off' : current === spec.events.length && found === current ? 'on' : 'partial'
  return { state, allHooksDisabled }
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
  entry: ClaudeHookEntry
  now: number
  spec: HookFileSpec
}): Promise<HookFileResult> {
  return rewriteSettings(
    opts.dir,
    (text) => addPitwallHooks(text, opts.entry, opts.spec),
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
  entry: ClaudeHookEntry,
  spec: HookFileSpec
): Promise<PitwallHookInspection> {
  try {
    const bytes = await readBytes(join(dir, spec.file))
    const text = bytes === null ? '' : decodeUtf8(bytes, spec.file)
    return inspectPitwallHooks(text.startsWith(BOM) ? text.slice(1) : text, entry, spec)
  } catch {
    return { state: 'error', allHooksDisabled: false }
  }
}

export function installClaudeHooks(opts: {
  dir: string
  entry: ClaudeHookEntry
  now: number
}): Promise<HookFileResult> {
  return installPitwallHooks({ ...opts, spec: CLAUDE_HOOK_FILE })
}

export function uninstallClaudeHooks(opts: { dir: string; now: number }): Promise<HookFileResult> {
  return uninstallPitwallHooks({ ...opts, spec: CLAUDE_HOOK_FILE })
}

export function readClaudeHookState(
  dir: string,
  entry: ClaudeHookEntry
): Promise<PitwallHookInspection> {
  return readPitwallHookState(dir, entry, CLAUDE_HOOK_FILE)
}
