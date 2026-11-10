import { join } from 'node:path'
import type { ClaudeHookStatus, Platform } from '../shared/types'
import type { ClaudeHookActionResult } from '../shared/ipc'
import { text } from '../shared/text'
import {
  claudeHookItems,
  ClaudeSettingsError,
  guardCommand,
  hookCommand,
  installClaudeHooks,
  readClaudeHookState,
  uninstallClaudeHooks,
  type HookItem
} from './claudeHooks'
import { ensureHookConfig, loadConfig, pickFreePort, updateConfig, type HookConfig } from './config'
import { createHookHub, type HookHub } from './hookHub'
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
  /** 훅 이벤트로 세션 상태가 바뀌었을 때(화면을 바로 갱신하려고). hub 를 주면 쓰지 않는다. */
  onEvent?: () => void
  pickPort?: () => Promise<number>
  /** Codex 연동과 같이 쓰는 훅 서버. 없으면 혼자 쓰는 것을 만든다. */
  hub?: HookHub
  /**
   * 무거운 작업 기다리게 하기(G7, 설정 heavyGuard)를 켰는지. 켜면 알림 훅에 더해 PreToolUse 질문 훅을 넣고,
   * 상태도 그 목록과 견준다(설정과 파일이 다르면 partial — 다시 켜기로 맞춘다).
   */
  guard: () => boolean
}

export type HookActionResult = ClaudeHookActionResult

/** 연동 켜기를 부르는 까닭: 연동 켜기 버튼, 설정에서 기다리게 하기 켜기·끄기(G7). */
export type EnablePurpose = 'integration' | 'guardOn' | 'guardOff'

/** pitwall 설정이 없을 때 settings.json 에 남은 pitwall 훅이 있는지만 보려고 쓰는 빈 목록. */
const NO_ITEMS: HookItem[] = []

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
  /**
   * 훅을 넣는다(확인 창·백업). integration: 연동 켜기(질문 훅은 설정을 따른다), guardOn·guardOff: 설정에서 무거운 작업
   * 기다리게 하기를 켜거나 끌 때 — 그 확인 창으로 묻고 질문 훅을 넣거나 뺀다(알림 훅은 그대로 다시 쓴다).
   */
  enable(purpose?: EnablePurpose): Promise<HookActionResult>
  disable(): Promise<HookActionResult>
  stop(): Promise<void>
} {
  const settingsPath = join(deps.configDir, 'settings.json')
  const pickPort = deps.pickPort ?? (() => pickFreePort())
  const hub =
    deps.hub ??
    createHookHub({
      onEvent: (event, tool) => {
        if (applyHookEvent(deps.sessions, event, deps.now(), tool)) deps.onEvent?.()
      }
    })

  /** 넣을 훅 목록: 알림 훅들 + (guard 면) 질문 훅. */
  const itemsFor = (hook: HookConfig, guard = deps.guard()): HookItem[] =>
    claudeHookItems(
      hookCommand(deps.platform, hook.port, hook.token, deps.systemRoot),
      guard ? guardCommand(deps.platform, hook.port, hook.token, deps.systemRoot) : null
    )

  /** 무엇을 위해 켜는지에 따른 확인 창과 질문 훅을 넣을지. */
  function plan(purpose: EnablePurpose): { dialog: KillConfirm; guard: boolean } {
    const t = text.claudeHook
    const ask = (title: string, message: string, detail: string, confirm: string): KillConfirm => ({
      title,
      message,
      detail,
      buttons: [confirm, text.kill.cancel],
      defaultId: 1,
      cancelId: 1
    })
    if (purpose === 'guardOn')
      return {
        dialog: ask(
          t.guardOnTitle,
          t.guardOnMessage,
          t.guardOnDetail(settingsPath),
          t.guardOnConfirm
        ),
        guard: true
      }
    if (purpose === 'guardOff')
      return {
        dialog: ask(
          t.guardOffTitle,
          t.guardOffMessage,
          t.guardOffDetail(settingsPath),
          t.guardOffConfirm
        ),
        guard: false
      }
    const guard = deps.guard()
    const detail = t.enableDetail(settingsPath) + (guard ? t.enableGuardNote : '')
    return { dialog: ask(t.enableTitle, t.enableMessage, detail, t.enableConfirm), guard }
  }

  const closeServer = (): Promise<void> => hub.release('claude')
  /** 이미 같은 포트·토큰으로 열려 있으면 그대로. 실패하면 예외. */
  const openServer = (hook: HookConfig): Promise<void> => hub.claim('claude', hook)

  async function start(): Promise<void> {
    const { hook } = await loadConfig(deps.userData)
    if (!hook) return
    const inspection = await readClaudeHookState(deps.configDir, itemsFor(hook))
    if (inspection.state !== 'on' && inspection.state !== 'partial') return
    try {
      await openServer(hook)
    } catch {
      // status() 가 error(server) 로 알리고, 다시 켜기로 새 포트를 고를 수 있다.
    }
  }

  async function status(): Promise<ClaudeHookStatus> {
    const { hook } = await loadConfig(deps.userData)
    const inspection = await readClaudeHookState(deps.configDir, hook ? itemsFor(hook) : NO_ITEMS)
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

  async function enable(purpose: EnablePurpose = 'integration'): Promise<HookActionResult> {
    const { dialog, guard } = plan(purpose)
    if (!(await deps.confirm(dialog))) return { status: 'cancelled' }
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
        items: itemsFor(hook, guard),
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
      // Claude 세션만 비운다(Codex 연동의 세션은 그대로).
      for (const [id, s] of deps.sessions)
        if ((s.tool ?? 'claude') === 'claude') deps.sessions.delete(id)
      if (!result.changed) return { status: 'done', message: text.claudeHook.alreadyOff }
      return { status: 'done', message: text.claudeHook.disabled(result.backupPath) }
    } catch (e) {
      return { status: 'failed', message: settingsErrorMessage(e) }
    }
  }

  return { start, status, enable, disable, stop: closeServer }
}
