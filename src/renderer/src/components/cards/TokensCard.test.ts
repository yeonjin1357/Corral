// @vitest-environment happy-dom
import { mount, type VueWrapper } from '@vue/test-utils'
import TokensCard from './TokensCard.vue'
import type { AgentRow, AgentUsage, CodexLimits } from '../../../../shared/types'
import { agentRow } from '../../testing/fixtures'

const NOW = 10 * 60 * 60_000
const usage = (contextTokens: number | null, contextWindow: number | null = null): AgentUsage => ({
  contextTokens,
  contextWindow,
  outputTokens: null,
  totalTokens: null,
  model: null
})
const limits = (resetsAt: number | null = NOW + 3_600_000): CodexLimits => ({
  primary: { usedPercent: 14.2, windowMinutes: 300, resetsAt },
  secondary: { usedPercent: 30.6, windowMinutes: 10080, resetsAt },
  planType: 'plus',
  at: NOW - 3 * 60_000
})

function card(agents: AgentRow[], l: CodexLimits | null, compact = false): VueWrapper {
  return mount(TokensCard, { props: { agents, limits: l, now: NOW, compact } })
}
/** 한도 창마다 [이름, %]. */
const windows = (w: VueWrapper): string[][] =>
  w
    .findAll('[data-limit]')
    .map((r) => [r.find('[data-limit-label]').text(), r.find('[data-limit-percent]').text()])

test('가장 큰 컨텍스트와 Codex 한도', async () => {
  const agents = [
    agentRow({ pid: 1, usage: usage(50_000) }),
    agentRow({
      pid: 2,
      tool: 'codex',
      worktree: { root: 'C:\\work\\wt-b', branch: 'main', isLinkedWorktree: true },
      usage: usage(132_000, 258_000)
    }),
    agentRow({ pid: 3, usage: usage(null) }),
    agentRow({ pid: 4, usage: null })
  ]
  const w = card(agents, limits())
  expect(w.find('[data-slot=card-title]').text()).toBe('토큰·한도')
  // 컨텍스트가 가장 큰 에이전트의 값과 폴더.
  expect(w.find('[data-card-value]').text()).toBe('132k / 258k')
  expect(w.find('[data-context-of]').text().replace(/\s+/g, ' ')).toBe('컨텍스트 · wt-b')
  // Codex 한도 두 창(5시간·주간), 풍선말에는 초기화 시각과 기준 시각.
  expect(windows(w)).toEqual([
    ['5시간', '14%'],
    ['주간', '31%']
  ])
  const bars = w.findAll('[data-limit-bar]').map((b) => (b.element as HTMLElement).style.width)
  expect(bars).toEqual(['14%', '31%'])
  const tip = w.find('[data-limits]').attributes('title')!
  expect(tip).toContain('5시간: 14% · ')
  expect(tip.endsWith('3분 전 기준')).toBe(true)
  expect(w.text()).not.toContain('아직 읽은 토큰이 없어요')
  // ↗ 는 에이전트 탭으로.
  await w.find('button[aria-label="목록에서 보기"]').trigger('click')
  expect(w.emitted('tab')).toEqual([['agents']])

  // 간단히: 큰 값은 컨텍스트, 한 줄은 폴더와 가장 높은 한도 창. 누르면 에이전트 탭.
  const compact = card(agents, limits(), true)
  expect(compact.find('[data-compact-value]').text()).toBe('132k')
  expect(
    compact
      .findAll('[data-compact-sub] > span')
      .map((s) => s.text())
      .filter(Boolean)
  ).toEqual(['wt-b', 'Codex 한도 주간 31%'])
  await compact.find('[data-compact-body]').trigger('click')
  expect(compact.emitted('tab')).toEqual([['agents']])
})

test('모르면 안내 문구', () => {
  // 토큰도 한도도 모름(모든 창이 이미 초기화된 한도는 모르는 것과 같다).
  for (const l of [null, limits(NOW - 1)]) {
    const w = card([agentRow({ usage: usage(null) })], l)
    expect(w.text()).toContain('아직 읽은 토큰이 없어요')
    expect(w.find('[data-card-value]').exists()).toBe(false)
    expect(w.find('[data-limits]').exists()).toBe(false)
    const compact = card([], l, true)
    expect(compact.find('[data-compact-value]').text()).toBe('—')
    expect(compact.find('[data-compact-sub]').text()).toBe('아직 읽은 토큰이 없어요')
  }
  // 한쪽만 알면 아는 것만.
  const onlyLimits = card([], limits())
  expect(onlyLimits.find('[data-card-value]').exists()).toBe(false)
  expect(windows(onlyLimits)).toHaveLength(2)
  expect(onlyLimits.text()).not.toContain('아직 읽은 토큰이 없어요')
  const onlyContext = card([agentRow({ usage: usage(1_200) })], null)
  expect(onlyContext.find('[data-card-value]').text()).toBe('1.2k')
  expect(onlyContext.find('[data-limits]').exists()).toBe(false)
  expect(onlyContext.text()).not.toContain('아직 읽은 토큰이 없어요')
})
