import type { AgentTool, ClaudeHookStatus, CodexHookStatus } from '../../shared/types'
import { text } from '../../shared/text'
import type { Tone } from './rows'

/** 에이전트 탭 도구줄에 보이는 도구 하나의 연동 상태(짧은 글과 점 색). */
export interface IntegrationItem {
  tool: AgentTool
  /** 모르면 null(확인 중). */
  state: ClaudeHookStatus['state'] | null
  label: string
  tone: Tone
}

/**
 * Claude·Codex 연동 상태를 짧은 글과 점 색으로. 켜짐 초록, 꺼짐 회색(꺼도 세션 파일·기록으로 상태는 안다),
 * 다시 켜야 함 주황, 문제 빨강. Claude 가 켜져 있어도 설정에서 훅을 모두 꺼 두었으면(이벤트가 오지 않음) 주황.
 */
export function integrationStatus(
  claude: Pick<ClaudeHookStatus, 'state' | 'allHooksDisabled'> | null,
  codex: Pick<CodexHookStatus, 'state'> | null
): IntegrationItem[] {
  const S = text.ui.integration.states
  const item = (
    tool: AgentTool,
    h: { state: ClaudeHookStatus['state']; allHooksDisabled?: boolean } | null
  ): IntegrationItem => {
    if (!h) return { tool, state: null, label: S.unknown, tone: 'idle' }
    if (h.state === 'on' && h.allHooksDisabled)
      return { tool, state: h.state, label: S.allHooksDisabled, tone: 'warn' }
    const tone: Tone =
      h.state === 'on'
        ? 'running'
        : h.state === 'partial'
          ? 'warn'
          : h.state === 'error'
            ? 'stopped'
            : 'idle'
    return { tool, state: h.state, label: S[h.state], tone }
  }
  return [item('claude', claude), item('codex', codex)]
}

export interface HookControls {
  /** 지금 상태 설명. */
  text: string
  /** 주 버튼(켜기·끄기·다시 켜기). 상태를 모르면 null. */
  button: { label: string; action: 'enable' | 'disable' } | null
  /**
   * 예전 설정이 남았거나(partial) 훅 포트를 못 연(error·server) 상태에서도 다시 켜지 않고 바로 끌 수 있게 한다.
   * settings.json 을 읽을 수 없으면 끄기도 못 하므로 두지 않는다.
   */
  canAlsoDisable: boolean
}

/** 연동 버튼·상태 문구(Claude 연동, Codex 연동). */
interface HookLabels {
  enable: string
  reenable: string
  disable: string
  states: Record<'on' | 'off' | 'partial' | 'server' | 'settings', string>
}

/** 한눈에 보기·설정 화면이 같이 쓰는 연동 상태 문구와 버튼(기본은 Claude 연동). */
export function hookControls(
  h: Pick<ClaudeHookStatus, 'state' | 'problem'> | null,
  labels: HookLabels = text.ui.hook
): HookControls {
  if (!h) return { text: '', button: null, canAlsoDisable: false }
  const stateText =
    h.state === 'error' ? labels.states[h.problem ?? 'settings'] : labels.states[h.state]
  const button =
    h.state === 'on'
      ? { label: labels.disable, action: 'disable' as const }
      : h.state === 'off'
        ? { label: labels.enable, action: 'enable' as const }
        : { label: labels.reenable, action: 'enable' as const }
  return {
    text: stateText,
    button,
    canAlsoDisable: h.state === 'partial' || (h.state === 'error' && h.problem === 'server')
  }
}
