import { hookControls } from './hook'
import { text } from '../../shared/text'
import type { ClaudeHookStatus, CodexHookStatus } from '../../shared/types'

test('Codex 연동도 같은 규칙으로 상태 문구와 버튼(켜기·끄기·다시 켜기)을 고른다', () => {
  const codex = text.ui.codexHook
  const status = (
    state: 'on' | 'off' | 'partial' | 'error',
    problem: 'server' | 'settings' | null = null
  ): CodexHookStatus => ({
    state,
    problem,
    path: 'C:\\Users\\dev\\.codex\\hooks.json'
  })
  expect(hookControls(status('off'), codex)).toEqual({
    text: codex.states.off,
    button: { label: codex.enable, action: 'enable' },
    canAlsoDisable: false
  })
  expect(hookControls(status('on'), codex).button).toEqual({
    label: codex.disable,
    action: 'disable'
  })
  expect(hookControls(status('partial'), codex)).toMatchObject({
    button: { label: codex.reenable, action: 'enable' },
    canAlsoDisable: true
  })
  expect(hookControls(status('error', 'settings'), codex).text).toBe(codex.states.settings)
  expect(codex.states.on).toContain('/hooks')
  // Claude 는 기본 문구 그대로.
  const claude: ClaudeHookStatus = {
    state: 'off',
    problem: null,
    allHooksDisabled: false,
    settingsPath: ''
  }
  expect(hookControls(claude).button?.label).toBe(text.ui.hook.enable)
})
