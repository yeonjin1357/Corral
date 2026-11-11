import { hookControls, integrationStatus } from './hook'
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
  // /hooks 의 항목에는 내부 이름이 든 주소(…/pitwall-hook/codex…)가 보여 어느 훅인지 함께 알린다.
  expect(codex.states.on).toContain('(주소에 pitwall-hook 이 들어 있는 훅)')
  // Claude 는 기본 문구 그대로.
  const claude: ClaudeHookStatus = {
    state: 'off',
    problem: null,
    allHooksDisabled: false,
    settingsPath: ''
  }
  expect(hookControls(claude).button?.label).toBe(text.ui.hook.enable)
})

test('연동 요약: 도구마다 짧은 상태와 점 색(켜짐 초록·꺼짐 회색·다시 켜야 함 주황·문제 빨강)', () => {
  const I = text.ui.integration
  const claude = (
    state: ClaudeHookStatus['state'],
    allHooksDisabled = false
  ): ClaudeHookStatus => ({ state, problem: null, allHooksDisabled, settingsPath: '' })
  const codex = (state: CodexHookStatus['state']): CodexHookStatus => ({
    state,
    problem: null,
    path: ''
  })
  expect(integrationStatus(claude('on'), codex('off'))).toEqual([
    { tool: 'claude', state: 'on', label: I.states.on, tone: 'running' },
    { tool: 'codex', state: 'off', label: I.states.off, tone: 'idle' }
  ])
  expect(
    integrationStatus(claude('partial'), codex('error')).map((i) => [i.label, i.tone])
  ).toEqual([
    [I.states.partial, 'warn'],
    [I.states.error, 'stopped']
  ])
  // 켜져 있어도 Claude 설정에서 훅을 모두 꺼 두었으면 이벤트가 오지 않는다.
  expect(integrationStatus(claude('on', true), null)[0]).toEqual({
    tool: 'claude',
    state: 'on',
    label: I.states.allHooksDisabled,
    tone: 'warn'
  })
  // 아직 모르면 확인 중(회색).
  expect(integrationStatus(null, null)).toEqual([
    { tool: 'claude', state: null, label: I.states.unknown, tone: 'idle' },
    { tool: 'codex', state: null, label: I.states.unknown, tone: 'idle' }
  ])
})
