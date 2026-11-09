import { join } from 'node:path'
import type { CodexHookStatus, Platform } from '../shared/types'
import type { ClaudeHookActionResult } from '../shared/ipc'
import { text } from '../shared/text'
import { ClaudeSettingsError, type ClaudeHookEntry } from './claudeHooks'
import {
  codexHookCommand,
  installCodexHooks,
  readCodexHookState,
  uninstallCodexHooks
} from './codexHooks'
import { ensureHookConfig, loadConfig, pickFreePort, updateConfig, type HookConfig } from './config'
import type { HookHub } from './hookHub'
import type { KillConfirm } from './kill'
import type { Sessions } from './sessions'

export interface CodexIntegrationDeps {
  /** pitwall 앱 데이터 폴더(포트·토큰 저장). */
  userData: string
  /** CODEX_HOME 또는 ~/.codex. */
  codexHome: string
  platform: Platform
  systemRoot?: string
  /** Claude 연동과 같이 쓰는 훅 서버. */
  hub: HookHub
  sessions: Sessions
  now: () => number
  confirm: (o: KillConfirm) => Promise<boolean>
  pickPort?: () => Promise<number>
}

const NO_ENTRY: ClaudeHookEntry = { type: 'command', command: '', async: true, timeout: 5 }

function errorMessage(e: unknown): string {
  if (e instanceof ClaudeSettingsError) return text.codexHook.errors[e.code]
  return text.codexHook.errors.other(e instanceof Error ? e.message : String(e))
}

/**
 * Codex 연동(F7 hooks): 사용자가 켜기·끄기를 누를 때만 `$CODEX_HOME/hooks.json` 을 바꾼다(확인 창·백업).
 * 켜면 Codex 에서 `/hooks` 로 한 번 승인해야 이벤트가 온다. 이벤트는 Claude 연동과 같은 훅 서버의 codex 경로로 받는다.
 * `auth.json`·`config.toml` 은 건드리지 않는다.
 */
export function createCodexIntegration(deps: CodexIntegrationDeps): {
  start(): Promise<void>
  status(): Promise<CodexHookStatus>
  enable(): Promise<ClaudeHookActionResult>
  disable(): Promise<ClaudeHookActionResult>
} {
  const path = join(deps.codexHome, 'hooks.json')
  const pickPort = deps.pickPort ?? (() => pickFreePort())
  const entryFor = (hook: HookConfig): ClaudeHookEntry =>
    codexHookCommand(deps.platform, hook.port, hook.token, deps.systemRoot)

  async function start(): Promise<void> {
    const { hook } = await loadConfig(deps.userData)
    if (!hook) return
    const inspection = await readCodexHookState(deps.codexHome, entryFor(hook))
    if (inspection.state !== 'on' && inspection.state !== 'partial') return
    try {
      await deps.hub.claim('codex', hook)
    } catch {
      // status() 가 error(server) 로 알린다.
    }
  }

  async function status(): Promise<CodexHookStatus> {
    const { hook } = await loadConfig(deps.userData)
    const inspection = await readCodexHookState(deps.codexHome, hook ? entryFor(hook) : NO_ENTRY)
    if (inspection.state === 'error') return { state: 'error', problem: 'settings', path }
    if (!hook) return { state: inspection.state === 'off' ? 'off' : 'partial', problem: null, path }
    if (inspection.state === 'off') return { state: 'off', problem: null, path }
    try {
      await deps.hub.claim('codex', hook)
    } catch {
      return { state: 'error', problem: 'server', path }
    }
    return { state: inspection.state, problem: null, path }
  }

  async function enable(): Promise<ClaudeHookActionResult> {
    const ok = await deps.confirm({
      title: text.codexHook.enableTitle,
      message: text.codexHook.enableMessage,
      detail: text.codexHook.enableDetail(path),
      buttons: [text.codexHook.enableConfirm, text.kill.cancel],
      defaultId: 1,
      cancelId: 1
    })
    if (!ok) return { status: 'cancelled' }
    try {
      let hook = await ensureHookConfig(deps.userData, { pickPort })
      try {
        await deps.hub.claim('codex', hook)
      } catch {
        hook = { ...hook, port: await pickPort() }
        await deps.hub.claim('codex', hook)
        const moved = hook
        await updateConfig(deps.userData, (c) => ({ ...c, hook: moved }))
      }
      const result = await installCodexHooks({
        dir: deps.codexHome,
        entry: entryFor(hook),
        now: deps.now()
      })
      if (!result.changed) return { status: 'done', message: text.codexHook.alreadyOn }
      return { status: 'done', message: text.codexHook.enabled(result.backupPath) }
    } catch (e) {
      return { status: 'failed', message: errorMessage(e) }
    }
  }

  async function disable(): Promise<ClaudeHookActionResult> {
    const ok = await deps.confirm({
      title: text.codexHook.disableTitle,
      message: text.codexHook.disableMessage,
      detail: text.codexHook.disableDetail(path),
      buttons: [text.codexHook.disableConfirm, text.kill.cancel],
      defaultId: 1,
      cancelId: 1
    })
    if (!ok) return { status: 'cancelled' }
    try {
      const result = await uninstallCodexHooks({ dir: deps.codexHome, now: deps.now() })
      await deps.hub.release('codex')
      for (const [id, s] of deps.sessions) if (s.tool === 'codex') deps.sessions.delete(id)
      if (!result.changed) return { status: 'done', message: text.codexHook.alreadyOff }
      return { status: 'done', message: text.codexHook.disabled(result.backupPath) }
    } catch (e) {
      return { status: 'failed', message: errorMessage(e) }
    }
  }

  return { start, status, enable, disable }
}
