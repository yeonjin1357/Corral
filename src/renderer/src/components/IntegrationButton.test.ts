// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import IntegrationButton from './IntegrationButton.vue'
import { text } from '../../../shared/text'
import type { ClaudeHookStatus, CodexHookStatus } from '../../../shared/types'

const I = text.ui.integration
const claude: ClaudeHookStatus = {
  state: 'on',
  problem: null,
  allHooksDisabled: false,
  settingsPath: ''
}
const codex: CodexHookStatus = { state: 'partial', problem: null, path: '' }

test('연동 설정 버튼: 두 도구의 로고와 상태 점, 풍선말에 상태, 누르면 설정을 연다', async () => {
  const w = mount(IntegrationButton, { props: { claude, codex } })
  const button = w.find('[data-action="integration-settings"]')
  expect(button.text()).toBe(I.settings)
  expect(
    button.findAll('[data-integration-dot]').map((d) => d.attributes('data-integration-dot'))
  ).toEqual(['on', 'partial'])
  expect(button.attributes('title')).toBe(
    [I.stateLine('Claude Code', I.states.on), I.stateLine('Codex', I.states.partial)].join('\n')
  )
  await button.trigger('click')
  expect(w.emitted('open')).toHaveLength(1)
})

test('설명 버튼: 누르면 연동 설명과 도구마다 상태를 보이고, 거기서도 설정을 연다', async () => {
  const w = mount(IntegrationButton, { props: { claude, codex }, attachTo: document.body })
  expect(w.text()).not.toContain(I.helpTitle)
  const help = w.find('[data-action="integration-help"]')
  expect(help.attributes('aria-label')).toBe(I.help)
  await help.trigger('click')
  expect(w.text()).toContain(I.helpTitle)
  for (const line of I.helpBody) expect(w.text()).toContain(line)
  expect(w.find('[data-integration="claude"]').text()).toContain(I.states.on)
  expect(w.find('[data-integration="codex"]').text()).toContain(I.states.partial)
  await w.find('[data-action="integration-help-settings"]').trigger('click')
  expect(w.emitted('open')).toHaveLength(1)
  expect(w.text()).not.toContain(I.helpTitle)
  w.unmount()
})
