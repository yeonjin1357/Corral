import type { ClaudeHookStatus } from '../../shared/types'
import { text } from '../../shared/text'

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

/** 한눈에 보기·설정 화면이 같이 쓰는 Claude 연동 상태 문구와 버튼. */
export function hookControls(h: ClaudeHookStatus | null): HookControls {
  if (!h) return { text: '', button: null, canAlsoDisable: false }
  const stateText =
    h.state === 'error'
      ? text.ui.hook.states[h.problem ?? 'settings']
      : text.ui.hook.states[h.state]
  const button =
    h.state === 'on'
      ? { label: text.ui.hook.disable, action: 'disable' as const }
      : h.state === 'off'
        ? { label: text.ui.hook.enable, action: 'enable' as const }
        : { label: text.ui.hook.reenable, action: 'enable' as const }
  return {
    text: stateText,
    button,
    canAlsoDisable: h.state === 'partial' || (h.state === 'error' && h.problem === 'server')
  }
}
