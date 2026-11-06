// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import HeartbeatBar from './HeartbeatBar.vue'
import PortListItem from './PortListItem.vue'
import AgentListItem from './AgentListItem.vue'
import LeftoverListItem from './LeftoverListItem.vue'
import ListGroup from './ListGroup.vue'
import PortList from './PortList.vue'
import AgentDetail from './AgentDetail.vue'
import LeftoverDetail from './LeftoverDetail.vue'
import HomeView from './HomeView.vue'
import { appendSnapshot, emptyHistory, selectionKey } from '../history'
import type { ClaudeHookStatus } from '../../../shared/types'
import { agentRow, leftoverRow, portRow, snapshot, threePorts } from '../testing/fixtures'

const stubs = {
  TrendChart: { template: '<div class="trend-chart-stub" />', props: ['points', 'label', 'unit'] }
}
const HOOK_OFF: ClaudeHookStatus = {
  state: 'off',
  problem: null,
  allHooksDisabled: false,
  settingsPath: 'C:\\Users\\a\\.claude\\settings.json'
}
const tagTexts = (w: { findAll: (s: string) => { text: () => string }[] }): string[] =>
  w.findAll('.tag-wrapper').map((t) => t.text())

beforeEach(() => {
  try {
    window.localStorage.clear()
  } catch {
    // 저장소를 못 쓰는 환경이어도 테스트는 이어간다.
  }
})

describe('HeartbeatBar 상태 색', () => {
  test('권한 대기는 pending, 오류는 down 막대', () => {
    const w = mount(HeartbeatBar, { props: { beats: ['pending', 'down'] } })
    const kinds = w.findAll('.beat').map((b) => b.classes().find((c) => c.startsWith('beat-')))
    expect(kinds.slice(-2)).toEqual(['beat-pending', 'beat-down'])
  })
})

describe('PortListItem 판단 태그', () => {
  test('정리 후보는 빨강, 확인해볼 것은 주황 태그가 맨 앞에', () => {
    const candidate = mount(PortListItem, {
      props: { row: portRow({ judgement: 'candidate' }), beats: [], active: false }
    })
    const first = candidate.findAll('.tag-wrapper')[0]
    expect(first.text()).toBe('정리 후보')
    expect(first.attributes('style')).toMatch(/#DC2626/i)
    const check = mount(PortListItem, {
      props: { row: portRow({ judgement: 'check' }), beats: [], active: false }
    })
    expect(check.findAll('.tag-wrapper')[0].text()).toBe('확인해볼 것')
    expect(check.findAll('.tag-wrapper')[0].attributes('style')).toMatch(/#D97706/i)
  })
})

describe('AgentListItem', () => {
  test('알약에 도구 이름, 색은 상태, 이름은 워크트리 폴더, 태그는 상태·브랜치, 작은 하트비트', () => {
    const w = mount(AgentListItem, { props: { row: agentRow(), beats: ['up'], active: false } })
    const pill = w.get('.badge.rounded-pill')
    expect(pill.text()).toBe('Claude')
    expect(pill.classes()).toContain('bg-primary')
    expect(w.get('.name').text()).toBe('wt-a')
    expect(tagTexts(w)).toEqual(['작업 중', 'feat/a'])
    expect(w.find('.hp-bar-small').exists()).toBe(true)
  })

  test.each([
    ['waiting', 'bg-warning', '권한 대기'],
    ['idle', 'bg-secondary', '쉬는 중'],
    ['error', 'bg-danger', '오류'],
    ['unknown', 'bg-secondary', '확인 중']
  ] as const)('%s → %s, 태그 %s', (state, cls, label) => {
    const w = mount(AgentListItem, {
      props: { row: agentRow({ state }), beats: [], active: false }
    })
    expect(w.get('.badge').classes()).toContain(cls)
    expect(tagTexts(w)[0]).toBe(label)
  })

  test('Codex, 작업 폴더를 모르면 이름이 "작업 폴더 모름"이고 브랜치 태그가 없다', () => {
    const w = mount(AgentListItem, {
      props: { row: agentRow({ tool: 'codex', worktree: null }), beats: [], active: false }
    })
    expect(w.get('.badge').text()).toBe('Codex')
    expect(w.get('.name').text()).toBe('작업 폴더 모름')
    expect(tagTexts(w)).toEqual(['작업 중'])
  })

  test('누르면 select, 고른 항목은 active', async () => {
    const w = mount(AgentListItem, { props: { row: agentRow(), beats: [], active: true } })
    expect(w.get('.item').classes()).toContain('active')
    await w.get('.item').trigger('click')
    expect(w.emitted('select')).toHaveLength(1)
  })
})

describe('LeftoverListItem', () => {
  test('알약에 메모리(주황), 이름은 알아보기 쉬운 이름, 태그는 작업 폴더·프로세스 이름', () => {
    const w = mount(LeftoverListItem, { props: { row: leftoverRow(), active: false } })
    const pill = w.get('.badge.rounded-pill')
    expect(pill.text()).toBe('900 MB')
    expect(pill.classes()).toContain('bg-warning')
    expect(w.get('.name').text()).toBe('Playwright 브라우저')
    expect(tagTexts(w)).toEqual(['작업 폴더 모름', 'chrome.exe'])
  })

  test('워크트리를 알면 폴더 이름, 같은 워크트리에 에이전트가 있으면 알림 태그', () => {
    const w = mount(LeftoverListItem, {
      props: {
        row: leftoverRow({
          worktree: { root: 'C:\\work\\shop-web', branch: 'develop', isLinkedWorktree: false },
          agentInWorktree: true
        }),
        active: false
      }
    })
    expect(tagTexts(w)).toEqual(['shop-web', 'chrome.exe', '에이전트 실행 중'])
  })

  test('누르면 select', async () => {
    const w = mount(LeftoverListItem, { props: { row: leftoverRow(), active: false } })
    await w.get('.item').trigger('click')
    expect(w.emitted('select')).toHaveLength(1)
  })
})

describe('ListGroup', () => {
  function group(): ReturnType<typeof mount> {
    return mount(ListGroup, {
      props: { groupId: 'agents', title: '에이전트', count: 2, pillClass: 'bg-warning' },
      slots: {
        default: '<div class="child">항목</div>',
        actions: '<button class="act">켜기</button>'
      }
    })
  }

  test('Uptime Kuma 그룹 모양: 개수 알약·접기 화살표·이름, 처음에는 펼쳐져 있다', () => {
    const w = group()
    expect(w.get('.group-item .badge').text()).toBe('2')
    expect(w.get('.group-item .badge').classes()).toContain('bg-warning')
    expect(w.get('.group-item .name').text()).toBe('에이전트')
    expect(w.find('.child').exists()).toBe(true)
    expect(w.get('.collapse-icon').classes()).not.toContain('collapsed')
  })

  test('머리를 누르면 접히고 다시 누르면 펼쳐지며, 접은 상태를 기억한다', async () => {
    const w = group()
    await w.get('.group-item').trigger('click')
    expect(w.find('.child').exists()).toBe(false)
    expect(w.get('.collapse-icon').classes()).toContain('collapsed')
    const again = group()
    expect(again.find('.child').exists()).toBe(false)
    await again.get('.group-item').trigger('click')
    expect(again.find('.child').exists()).toBe(true)
  })

  test('머리의 버튼을 눌러도 접히지 않는다', async () => {
    const w = group()
    await w.get('.act').trigger('click')
    expect(w.find('.child').exists()).toBe(true)
  })
})

describe('PortList(그룹 목록)', () => {
  const s = snapshot({
    agents: [agentRow(), agentRow({ pid: 6000, tool: 'codex', state: 'waiting', worktree: null })],
    leftovers: [leftoverRow()]
  })
  const history = appendSnapshot(emptyHistory(), s)
  const base = {
    ports: s.ports,
    agents: s.agents,
    leftovers: s.leftovers,
    history,
    selectedKey: null,
    hook: HOOK_OFF
  }
  const rows = (w: ReturnType<typeof mount>): string[] =>
    w.findAll('.item:not(.group-item) .name').map((n) => n.text())

  test('개발 서버 포트 · 에이전트 · 남은 프로세스 세 그룹과 개수', () => {
    const w = mount(PortList, { props: base })
    expect(w.findAll('.group-item .name').map((n) => n.text())).toEqual([
      '개발 서버 포트',
      '에이전트',
      '남은 프로세스'
    ])
    expect(w.findAll('.group-item .badge').map((n) => n.text())).toEqual(['3', '2', '1'])
    expect(rows(w)).toEqual([
      'shop-web',
      'wt-a',
      '판별 불가',
      'wt-a',
      '작업 폴더 모름',
      'Playwright 브라우저'
    ])
  })

  test('에이전트 그룹 알약은 권한 대기가 있으면 주황, 정리 후보가 있으면 포트 그룹 알약이 빨강', () => {
    const w = mount(PortList, {
      props: { ...base, ports: [portRow({ judgement: 'candidate' })] }
    })
    const pills = w.findAll('.group-item .badge')
    expect(pills[0].classes()).toContain('bg-danger')
    expect(pills[1].classes()).toContain('bg-warning')
  })

  test('누르면 종류가 붙은 키로 select, 고른 항목은 active', async () => {
    const w = mount(PortList, {
      props: { ...base, selectedKey: selectionKey.agent(s.agents[1]) }
    })
    const items = w.findAll('.item:not(.group-item)')
    expect(items[4].classes()).toContain('active')
    await items[3].trigger('click')
    await items[5].trigger('click')
    await items[0].trigger('click')
    expect(w.emitted('select')).toEqual([
      [selectionKey.agent(s.agents[0])],
      [selectionKey.leftover(s.leftovers[0])],
      [selectionKey.port(threePorts[0])]
    ])
  })

  test('검색은 세 그룹 모두에 적용된다(도구 이름·브랜치·남은 프로세스 이름 포함)', async () => {
    const w = mount(PortList, { props: base })
    await w.get('input.search-input').setValue('codex')
    expect(rows(w)).toEqual(['작업 폴더 모름'])
    await w.get('input.search-input').setValue('FEAT/A')
    expect(rows(w)).toEqual(['wt-a', 'wt-a'])
    await w.get('input.search-input').setValue('playwright')
    expect(rows(w)).toEqual(['Playwright 브라우저'])
    await w.get('input.search-input').setValue('없는이름')
    expect(rows(w)).toEqual([])
    expect(w.text()).toContain('찾는 항목이 없어요.')
  })

  test('그룹이 비면 그룹마다 안내', () => {
    const w = mount(PortList, { props: { ...base, ports: [], agents: [], leftovers: [] } })
    expect(w.text()).toContain('열려 있는 개발 서버 포트가 없어요.')
    expect(w.text()).toContain('실행 중인 에이전트가 없어요.')
    expect(w.text()).toContain('남은 프로세스가 없어요.')
  })

  test('에이전트 그룹 머리에 Claude 연동 버튼: 꺼져 있으면 켜기, 켜져 있으면 끄기, 문제 있으면 다시 켜기', async () => {
    const off = mount(PortList, { props: base })
    expect(off.get('.btn-hook').text()).toBe('Claude 연동 켜기')
    await off.get('.btn-hook').trigger('click')
    expect(off.emitted('hook')).toEqual([['enable']])

    const on = mount(PortList, { props: { ...base, hook: { ...HOOK_OFF, state: 'on' } } })
    expect(on.get('.btn-hook').text()).toBe('Claude 연동 끄기')
    await on.get('.btn-hook').trigger('click')
    expect(on.emitted('hook')).toEqual([['disable']])

    const broken = mount(PortList, {
      props: { ...base, hook: { ...HOOK_OFF, state: 'error', problem: 'server' } }
    })
    expect(broken.get('.btn-hook').text()).toBe('Claude 연동 다시 켜기')

    const busy = mount(PortList, { props: { ...base, hookBusy: true } })
    expect(busy.get('.btn-hook').attributes('disabled')).toBeDefined()

    const unknown = mount(PortList, { props: { ...base, hook: null } })
    expect(unknown.find('.btn-hook').exists()).toBe(false)
  })
})

describe('AgentDetail', () => {
  test('제목·도구와 경로·상태 배지·숫자 칸(메모리·하위 프로세스·실행 시간·CPU·상태 출처), 끄기 버튼 없음', () => {
    const w = mount(AgentDetail, {
      props: {
        row: agentRow({ startedAt: 1000 }),
        history: undefined,
        now: 1000 + (2 * 60 + 5) * 60 * 1000,
        hook: HOOK_OFF
      },
      global: { stubs }
    })
    expect(w.get('h1').text()).toBe('wt-a')
    expect(w.get('.url').text()).toBe('Claude Code · C:\\work\\wt-a')
    const badge = w.get('.status-badge')
    expect(badge.text()).toBe('작업 중')
    expect(badge.classes()).toContain('bg-primary')
    const stats = w.findAll('.stats .col').map((c) => c.text())
    expect(stats[0]).toContain('600 MB')
    expect(stats[1]).toContain('3')
    expect(stats[2]).toContain('2시간 5분')
    expect(stats[3]).toContain('12.5%')
    expect(stats[4]).toContain('Claude 훅')
    expect(w.find('.btn-kill').exists()).toBe(false)
    expect(w.find('.trend-chart-stub').exists()).toBe(true)
  })

  test('CPU 를 모르면 —, Codex 는 CPU 로만 짐작한다는 안내', () => {
    const w = mount(AgentDetail, {
      props: {
        row: agentRow({ tool: 'codex', cpuPercent: null, state: 'unknown', stateSource: 'cpu' }),
        history: undefined,
        now: 0,
        hook: HOOK_OFF
      },
      global: { stubs }
    })
    expect(w.findAll('.stats .col')[3].text()).toContain('—')
    expect(w.text()).toContain('Codex 는 CPU 사용량으로만 작업 중인지 짐작해요.')
  })

  test('Claude 인데 연동이 꺼져 있으면 켜면 더 정확하다는 안내', () => {
    const w = mount(AgentDetail, {
      props: {
        row: agentRow({ stateSource: 'cpu' }),
        history: undefined,
        now: 0,
        hook: HOOK_OFF
      },
      global: { stubs }
    })
    expect(w.text()).toContain('Claude 연동을 켜면 권한 대기까지 정확히 알 수 있어요.')
  })
})

describe('LeftoverDetail', () => {
  test('제목·끄기 버튼·명령줄·숫자 칸(메모리·PID·하위 프로세스·실행 시간)', async () => {
    const w = mount(LeftoverDetail, {
      props: { row: leftoverRow({ startedAt: 0 }), busy: false, notice: null, now: 90 * 60 * 1000 }
    })
    expect(w.get('h1').text()).toBe('Playwright 브라우저')
    expect(w.get('.url').text()).toBe('작업 폴더 모름')
    expect(w.get('.command-line').text()).toBe('chrome.exe --remote-debugging-pipe --headless')
    const stats = w.findAll('.stats .col').map((c) => c.text())
    expect(stats[0]).toContain('900 MB')
    expect(stats[1]).toContain('7000')
    expect(stats[1]).toContain('chrome.exe')
    expect(stats[2]).toContain('2')
    expect(stats[3]).toContain('1시간 30분')
    await w.get('.btn-kill').trigger('click')
    expect(w.emitted('kill')).toHaveLength(1)
  })

  test('처리 중엔 끄기 비활성, 안내 문구 표시', () => {
    const w = mount(LeftoverDetail, {
      props: { row: leftoverRow(), busy: true, notice: '취소했어요.', now: 0 }
    })
    expect(w.get('.btn-kill').attributes('disabled')).toBeDefined()
    expect(w.get('.kill-notice').text()).toBe('취소했어요.')
  })
})

describe('HomeView 2단계', () => {
  test('에이전트(권한 대기 n)·남은 프로세스·정리 후보(확인해볼 것 n) 숫자 칸', () => {
    const s = snapshot({
      ports: [
        portRow({ judgement: 'candidate' }),
        portRow({ port: 3001, judgement: 'check' }),
        portRow({ port: 3002, judgement: 'candidate' })
      ],
      agents: [agentRow({ state: 'waiting' }), agentRow({ pid: 1, state: 'working' })],
      leftovers: [leftoverRow()],
      hook: HOOK_OFF
    })
    const w = mount(HomeView, { props: { snapshot: s, ramHistory: [] }, global: { stubs } })
    const cols = w.findAll('.stats .col').map((c) => c.text())
    expect(cols[2]).toContain('에이전트')
    expect(cols[2]).toContain('2')
    expect(cols[2]).toContain('권한 대기 1')
    expect(cols[3]).toContain('남은 프로세스')
    expect(cols[3]).toContain('1')
    expect(cols[4]).toContain('정리 후보')
    expect(cols[4]).toContain('2')
    expect(cols[4]).toContain('확인해볼 것 1')
  })

  test('Claude 연동 상자: 상태 설명과 켜기 버튼', async () => {
    const w = mount(HomeView, {
      props: { snapshot: snapshot({ hook: HOOK_OFF }), ramHistory: [] },
      global: { stubs }
    })
    expect(w.get('.hook-box').text()).toContain('꺼짐')
    await w.get('.hook-box .btn-hook').trigger('click')
    expect(w.emitted('hook')).toEqual([['enable']])
  })

  test('disableAllHooks 면 경고를 함께 보여 준다', () => {
    const w = mount(HomeView, {
      props: {
        snapshot: snapshot({ hook: { ...HOOK_OFF, state: 'on', allHooksDisabled: true } }),
        ramHistory: []
      },
      global: { stubs }
    })
    expect(w.get('.hook-box').text()).toContain('disableAllHooks')
  })

  test('훅 상태를 모르면(null) 연동 상자를 보이지 않는다', () => {
    const w = mount(HomeView, {
      props: { snapshot: snapshot(), ramHistory: [] },
      global: { stubs }
    })
    expect(w.find('.hook-box').exists()).toBe(false)
  })
})

test('작업 폴더를 모르면 상세의 경로 줄을 흐리게(링크처럼 보이지 않게)', () => {
  const agent = mount(AgentDetail, {
    props: { row: agentRow({ worktree: null }), history: undefined, now: 0, hook: HOOK_OFF },
    global: { stubs }
  })
  expect(agent.get('.url').classes()).toContain('muted')
  const leftover = mount(LeftoverDetail, {
    props: { row: leftoverRow(), busy: false, notice: null, now: 0 }
  })
  expect(leftover.get('.url').classes()).toContain('muted')
  const known = mount(AgentDetail, {
    props: { row: agentRow(), history: undefined, now: 0, hook: HOOK_OFF },
    global: { stubs }
  })
  expect(known.get('.url').classes()).not.toContain('muted')
})

describe('문제 상태에서도 Claude 연동을 끌 수 있다', () => {
  test.each([
    ['partial', null],
    ['error', 'server']
  ] as const)('%s(%s): 첫 화면에 다시 켜기와 끄기가 함께 있다', async (state, problem) => {
    const w = mount(HomeView, {
      props: { snapshot: snapshot({ hook: { ...HOOK_OFF, state, problem } }), ramHistory: [] },
      global: { stubs }
    })
    expect(w.get('.hook-box .btn-hook').text()).toBe('Claude 연동 다시 켜기')
    await w.get('.hook-box .btn-hook-off').trigger('click')
    expect(w.emitted('hook')).toEqual([['disable']])
  })

  test('켜짐·꺼짐·설정 파일을 읽을 수 없음에는 끄기 버튼을 따로 두지 않는다', () => {
    for (const hook of [
      { ...HOOK_OFF, state: 'on' as const },
      HOOK_OFF,
      { ...HOOK_OFF, state: 'error' as const, problem: 'settings' as const }
    ]) {
      const w = mount(HomeView, {
        props: { snapshot: snapshot({ hook }), ramHistory: [] },
        global: { stubs }
      })
      expect(w.find('.hook-box .btn-hook-off').exists()).toBe(false)
    }
  })
})
