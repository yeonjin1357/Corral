import { join } from 'node:path'
import type { ClaudeHookStatus, Platform } from '../shared/types'
import type { ClaudeHookActionResult } from '../shared/ipc'
import { text } from '../shared/text'
import {
  ClaudeSettingsError,
  hookCommand,
  installClaudeHooks,
  readClaudeHookState,
  uninstallClaudeHooks,
  type ClaudeHookEntry
} from './claudeHooks'
import { ensureHookConfig, loadConfig, pickFreePort, updateConfig, type HookConfig } from './config'
import { createHookServer, type HookServer } from './hookServer'
import type { KillConfirm } from './kill'
import { applyHookEvent, type Sessions } from './sessions'

export interface ClaudeIntegrationDeps {
  /** pitwall 앱 데이터 폴더(포트·토큰 저장). */
  userData: string
  /** Claude 설정 폴더(CLAUDE_CONFIG_DIR 또는 ~/.claude). */
  configDir: string
  platform: Platform
  systemRoot?: string
  sessions: Sessions
  now: () => number
  /** 메인 프로세스의 네이티브 확인 창. 첫 번째 버튼이면 true. */
  confirm: (o: KillConfirm) => Promise<boolean>
  /** 훅 이벤트로 세션 상태가 바뀌었을 때(화면을 바로 갱신하려고). */
  onEvent?: () => void
  pickPort?: () => Promise<number>
}

export type HookActionResult = ClaudeHookActionResult

/** pitwall 설정이 없을 때 settings.json 에 남은 pitwall 훅이 있는지만 보려고 쓰는 빈 명령. */
const NO_ENTRY: ClaudeHookEntry = { type: 'command', command: '', async: true, timeout: 5 }

function settingsErrorMessage(e: unknown): string {
  if (e instanceof ClaudeSettingsError) return text.claudeHook.errors[e.code]
  return text.claudeHook.errors.other(e instanceof Error ? e.message : String(e))
}

/**
 * Claude 훅 연동: 사용자가 켜기·끄기를 누를 때만 settings.json 을 바꾸고(확인 창·백업), 훅 이벤트를 받는
 * 로컬 서버를 연다. 앱을 다시 켜면 설정에 훅이 있을 때만 같은 포트·토큰으로 서버를 연다.
 */
export function createClaudeIntegration(deps: ClaudeIntegrationDeps): {
  start(): Promise<void>
  status(): Promise<ClaudeHookStatus>
  enable(): Promise<HookActionResult>
  disable(): Promise<HookActionResult>
  stop(): Promise<void>
} {
  const settingsPath = join(deps.configDir, 'settings.json')
  const pickPort = deps.pickPort ?? (() => pickFreePort())
  let server: HookServer | null = null
  let serverHook: HookConfig | null = null

  const entryFor = (hook: HookConfig): ClaudeHookEntry =>
    hookCommand(deps.platform, hook.port, hook.token, deps.systemRoot)

  async function closeServer(): Promise<void> {
    const s = server
    server = null
    serverHook = null
    if (s) await s.close()
  }

  /** 이미 같은 포트·토큰으로 열려 있으면 그대로. 실패하면 예외. */
  async function openServer(hook: HookConfig): Promise<void> {
    if (server && serverHook?.port === hook.port && serverHook.token === hook.token) return
    await closeServer()
    server = await createHookServer({
      port: hook.port,
      token: hook.token,
      onEvent: (event) => {
        if (applyHookEvent(deps.sessions, event, deps.now())) deps.onEvent?.()
      }
    })
    serverHook = hook
  }

  async function start(): Promise<void> {
    const { hook } = await loadConfig(deps.userData)
    if (!hook) return
    const inspection = await readClaudeHookState(deps.configDir, entryFor(hook))
    if (inspection.state !== 'on' && inspection.state !== 'partial') return
    try {
      await openServer(hook)
    } catch {
      // status() 가 error(server) 로 알리고, 다시 켜기로 새 포트를 고를 수 있다.
    }
  }

  async function status(): Promise<ClaudeHookStatus> {
    const { hook } = await loadConfig(deps.userData)
    const inspection = await readClaudeHookState(deps.configDir, hook ? entryFor(hook) : NO_ENTRY)
    const base = { allHooksDisabled: inspection.allHooksDisabled, settingsPath }
    if (inspection.state === 'error') return { state: 'error', problem: 'settings', ...base }
    if (!hook)
      return { state: inspection.state === 'off' ? 'off' : 'partial', problem: null, ...base }
    if (inspection.state === 'off') return { state: 'off', problem: null, ...base }
    // 훅이 있으면 서버가 열려 있어야 이벤트가 온다. 닫혀 있으면 다시 열어 본다(포트가 풀렸을 수 있음).
    try {
      await openServer(hook)
    } catch {
      return { state: 'error', problem: 'server', ...base }
    }
    return { state: inspection.state, problem: null, ...base }
  }

  async function enable(): Promise<HookActionResult> {
    const ok = await deps.confirm({
      title: text.claudeHook.enableTitle,
      message: text.claudeHook.enableMessage,
      detail: text.claudeHook.enableDetail(settingsPath),
      buttons: [text.claudeHook.enableConfirm, text.kill.cancel],
      defaultId: 1,
      cancelId: 1
    })
    if (!ok) return { status: 'cancelled' }
    try {
      let hook = await ensureHookConfig(deps.userData, { pickPort })
      try {
        await openServer(hook)
      } catch {
        // 저장된 포트를 다른 프로그램이 쓰고 있으면 새 포트로 바꾼다(토큰은 그대로).
        hook = { ...hook, port: await pickPort() }
        await openServer(hook)
        const moved = hook
        await updateConfig(deps.userData, (c) => ({ ...c, hook: moved }))
      }
      const result = await installClaudeHooks({
        dir: deps.configDir,
        entry: entryFor(hook),
        now: deps.now()
      })
      if (!result.changed) return { status: 'done', message: text.claudeHook.alreadyOn }
      return { status: 'done', message: text.claudeHook.enabled(result.backupPath) }
    } catch (e) {
      return { status: 'failed', message: settingsErrorMessage(e) }
    }
  }

  async function disable(): Promise<HookActionResult> {
    const ok = await deps.confirm({
      title: text.claudeHook.disableTitle,
      message: text.claudeHook.disableMessage,
      detail: text.claudeHook.disableDetail(settingsPath),
      buttons: [text.claudeHook.disableConfirm, text.kill.cancel],
      defaultId: 1,
      cancelId: 1
    })
    if (!ok) return { status: 'cancelled' }
    try {
      const result = await uninstallClaudeHooks({ dir: deps.configDir, now: deps.now() })
      await closeServer()
      deps.sessions.clear()
      if (!result.changed) return { status: 'done', message: text.claudeHook.alreadyOff }
      return { status: 'done', message: text.claudeHook.disabled(result.backupPath) }
    } catch (e) {
      return { status: 'failed', message: settingsErrorMessage(e) }
    }
  }

  return { start, status, enable, disable, stop: closeServer }
}
