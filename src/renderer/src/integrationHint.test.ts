import type {
  AgentTool,
  ClaudeHookStatus,
  CodexHookStatus,
  DashboardSnapshot
} from '../../shared/types'
import { hintTools, readHintDismissed, writeHintDismissed } from './integrationHint'
import { agentRow } from './testing/fixtures'

type Input = Pick<DashboardSnapshot, 'agents' | 'hook' | 'codexHook'>

const claudeHook = (state: ClaudeHookStatus['state']): ClaudeHookStatus => ({
  state,
  problem: null,
  allHooksDisabled: false,
  settingsPath: 'C:\\Users\\dev\\.claude\\settings.json'
})
const codexHook = (state: CodexHookStatus['state']): CodexHookStatus => ({
  state,
  problem: null,
  path: 'C:\\Users\\dev\\.codex\\hooks.json'
})
const claude = agentRow({ pid: 1, tool: 'claude' })
const codex = agentRow({ pid: 2, tool: 'codex' })

const cases: {
  name: string
  input: Input | null
  dismissed?: AgentTool[]
  want: AgentTool[]
}[] = [
  {
    name: 'Claude Code 가 도는데 Claude 연동이 꺼져 있으면 Claude 를 권한다',
    input: { agents: [claude], hook: claudeHook('off'), codexHook: codexHook('off') },
    want: ['claude']
  },
  {
    name: 'Codex 만 도는 사람에게는 Claude 연동을 권하지 않는다',
    input: { agents: [codex], hook: claudeHook('off'), codexHook: codexHook('off') },
    want: ['codex']
  },
  {
    name: '둘 다 돌고 둘 다 꺼져 있으면 둘 다, 에이전트 순서와 상관없이 Claude 먼저',
    input: { agents: [codex, claude], hook: claudeHook('off'), codexHook: codexHook('off') },
    want: ['claude', 'codex']
  },
  {
    name: '이미 켠 도구는 권하지 않는다',
    input: { agents: [claude, codex], hook: claudeHook('on'), codexHook: codexHook('off') },
    want: ['codex']
  },
  {
    name: '에이전트가 하나도 없으면 권하지 않는다',
    input: { agents: [], hook: claudeHook('off'), codexHook: codexHook('off') },
    want: []
  },
  {
    name: '연동 상태를 아직 모르면(null) 권하지 않는다',
    input: { agents: [claude, codex], hook: null, codexHook: null },
    want: []
  },
  {
    name: '다시 켜야 하거나 문제가 있는 상태는 설정 화면이 다룬다(권하지 않는다)',
    input: { agents: [claude, codex], hook: claudeHook('partial'), codexHook: codexHook('error') },
    want: []
  },
  {
    name: '닫은 도구는 권하지 않고, 닫지 않은 도구는 그대로 권한다',
    input: { agents: [claude, codex], hook: claudeHook('off'), codexHook: codexHook('off') },
    dismissed: ['claude'],
    want: ['codex']
  },
  {
    name: '스냅샷이 아직 없으면 권하지 않는다',
    input: null,
    want: []
  }
]

test.each(cases)('$name', ({ input, dismissed, want }) => {
  expect(hintTools(input, dismissed ?? [])).toEqual(want)
})

function memoryStorage(
  initial: Record<string, string> = {}
): Storage & { data: Record<string, string> } {
  const data = { ...initial }
  return {
    data,
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => {
      data[k] = v
    }
  } as Storage & { data: Record<string, string> }
}

test('닫은 도구는 기억한다(처음은 닫은 것이 없다)', () => {
  const storage = memoryStorage()
  expect(readHintDismissed(storage)).toEqual([])
  writeHintDismissed(storage, ['codex'])
  expect(readHintDismissed(storage)).toEqual(['codex'])
})

test('모르는 이름·중복은 버린다', () => {
  const storage = memoryStorage({
    'pitwall.integrationHintDismissed': '["codex","cursor","codex",7]'
  })
  expect(readHintDismissed(storage)).toEqual(['codex'])
})

test('저장소가 없거나 깨진 값이면 닫은 것이 없다, 저장이 막혀도 오류를 내지 않는다', () => {
  expect(readHintDismissed(null)).toEqual([])
  expect(
    readHintDismissed(memoryStorage({ 'pitwall.integrationHintDismissed': '{"claude":true}' }))
  ).toEqual([])
  expect(
    readHintDismissed(memoryStorage({ 'pitwall.integrationHintDismissed': 'not json' }))
  ).toEqual([])
  const blocked = {
    getItem: () => {
      throw new Error('denied')
    },
    setItem: () => {
      throw new Error('denied')
    }
  }
  expect(readHintDismissed(blocked)).toEqual([])
  expect(() => writeHintDismissed(blocked, ['claude'])).not.toThrow()
})
