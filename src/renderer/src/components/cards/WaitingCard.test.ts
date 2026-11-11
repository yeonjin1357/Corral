// @vitest-environment happy-dom
import { mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import WaitingCard from './WaitingCard.vue'
import type { AgentRow } from '../../../../shared/types'
import { selectionKey } from '../../../../shared/keys'
import { agentRow } from '../../testing/fixtures'

const NOW = 10 * 60 * 60_000
const wt = (name: string): AgentRow['worktree'] => ({
  root: `C:\\work\\${name}`,
  branch: 'main',
  isLinkedWorktree: true
})

function card(agents: AgentRow[], compact = false): VueWrapper {
  return mount(WaitingCard, { props: { agents, now: NOW, compact } })
}
/** 줄마다 [폴더, 기다린 시간, 이유]. */
const lines = (w: VueWrapper): string[][] =>
  w
    .findAll('[data-waiting]')
    .map((li) =>
      ['[data-folder]', '[data-waited]', '[data-reason]'].map((s) =>
        li.find(s).exists() ? li.find(s).text() : ''
      )
    )
const value = (w: VueWrapper): DOMWrapper<Element> => w.find('[data-card-value]')

test('응답 대기 에이전트 최대 세 줄, 누르면 그 에이전트', async () => {
  // 오래 기다린 것부터: 권한을 기다리는 도구(12분), 질문(3분), 이유 모름(30초), 언제부터인지 모름.
  const tool = agentRow({
    pid: 1,
    state: 'waiting',
    worktree: wt('wt-b'),
    stateSince: NOW - 12 * 60_000,
    activity: { title: null, prompt: null, tool: null, waiting: { tool: 'Bash', summary: 'ls' } }
  })
  const question = agentRow({
    pid: 2,
    state: 'waiting',
    worktree: wt('wt-a'),
    stateSource: 'file',
    waitReason: 'input',
    stateSince: NOW - 3 * 60_000
  })
  const plain = agentRow({ pid: 3, state: 'waiting', worktree: null, stateSince: NOW - 30_000 })
  const unknown = agentRow({ pid: 4, state: 'waiting', worktree: wt('wt-d'), stateSince: null })
  const working = agentRow({ pid: 5, state: 'working', worktree: wt('wt-e') })
  const w = card([unknown, working, plain, question, tool])
  expect(w.find('[data-slot=card-title]').text()).toBe('응답 대기')
  // 큰 수는 응답 대기 전부, 줄은 세 개까지.
  expect(value(w).text()).toBe('4개')
  expect(lines(w)).toEqual([
    ['wt-b', '12분', '권한: Bash'],
    ['wt-a', '3분', '질문에 답 대기'],
    ['작업 폴더 모름', '30초', '응답 대기']
  ])
  await w.findAll('[data-waiting] button')[1].trigger('click')
  expect(w.emitted('select')).toEqual([[selectionKey.agent(question)]])
  // 언제부터인지 모르면 기다린 시간 없이.
  expect(lines(card([unknown]))).toEqual([['wt-d', '', '응답 대기']])

  // 간단히: 수와 가장 오래 기다린 한 줄, 누르면 그 에이전트.
  const compact = card([unknown, plain, question, tool], true)
  expect(compact.find('[data-compact-value]').text()).toBe('4개')
  expect(
    compact
      .findAll('[data-compact-sub] > span')
      .map((s) => s.text())
      .filter(Boolean)
  ).toEqual(['wt-b · 권한: Bash', '12분'])
  await compact.find('[data-compact-body]').trigger('click')
  expect(compact.emitted('select')).toEqual([[selectionKey.agent(tool)]])
})

test('없으면 안내 문구', async () => {
  const w = card([agentRow({ state: 'working' }), agentRow({ pid: 2, state: 'idle' })])
  expect(value(w).text()).toBe('0개')
  expect(w.find('[data-waiting]').exists()).toBe(false)
  expect(w.text()).toContain('기다리는 에이전트가 없어요')
  // 간단히: 안내 문구, 누를 것이 없다.
  const compact = card([], true)
  expect(compact.find('[data-compact-value]').text()).toBe('0개')
  expect(compact.find('[data-compact-sub]').text()).toBe('기다리는 에이전트가 없어요')
  const body = compact.find('[data-compact-body]')
  expect(body.attributes('disabled')).toBeDefined()
  await body.trigger('click')
  expect(compact.emitted('select')).toBeUndefined()
})
