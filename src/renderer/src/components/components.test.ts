// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import StatusBadge from './StatusBadge.vue'
import HeartbeatBar from './HeartbeatBar.vue'
import PortListItem from './PortListItem.vue'
import PortList from './PortList.vue'
import HomeView from './HomeView.vue'
import PortDetail from './PortDetail.vue'
import { appendSnapshot, emptyHistory, portKey, selectionKey } from '../history'
import { GB, MB, portRow, snapshot, threePorts } from '../testing/fixtures'

// 그래프(canvas)는 happy-dom 에서 그릴 수 없어 자리만 확인한다.
const stubs = {
  TrendChart: { template: '<div class="trend-chart-stub" />', props: ['points', 'label', 'unit'] }
}

describe('StatusBadge', () => {
  test('Uptime Kuma 배지 마크업(rounded-pill + bg-톤)', () => {
    const w = mount(StatusBadge, { props: { tone: 'warning', text: '업데이트 지연' } })
    expect(w.classes()).toEqual(expect.arrayContaining(['badge', 'rounded-pill', 'bg-warning']))
    expect(w.text()).toBe('업데이트 지연')
  })
})

describe('HeartbeatBar', () => {
  test('기록 순서대로 막대를 그리고 상태별 클래스를 단다(최신이 오른쪽 끝), 기록 없는 칸은 빈 막대로 채운다', () => {
    const w = mount(HeartbeatBar, { props: { beats: ['idle', 'up', 'up'], size: 'small' } })
    expect(w.classes()).toContain('hp-bar-small')
    const kinds = w.findAll('.beat').map((b) => b.classes().find((c) => c.startsWith('beat-')))
    expect(kinds).toHaveLength(60)
    expect(kinds.slice(-3)).toEqual(['beat-idle', 'beat-up', 'beat-up'])
    expect(new Set(kinds.slice(0, -3))).toEqual(new Set(['beat-empty']))
  })

  test('기본 크기는 big', () => {
    expect(mount(HeartbeatBar, { props: { beats: [] } }).classes()).toContain('hp-bar-big')
  })
})

describe('PortListItem', () => {
  test('포트 배지(연결 있으면 초록)·폴더 이름·브랜치와 프로세스 태그·작은 하트비트', () => {
    const w = mount(PortListItem, { props: { row: portRow(), beats: ['up'], active: false } })
    const pill = w.get('.badge.rounded-pill')
    expect(pill.text()).toBe(':3000')
    expect(pill.classes()).toContain('bg-primary')
    expect(w.get('.name').text()).toBe('shop-web')
    expect(w.findAll('.tag-wrapper').map((t) => t.text())).toEqual(['develop', 'node.exe'])
    expect(w.find('.hp-bar-small').exists()).toBe(true)
  })

  test('연결이 없으면 회색 배지, 판별 불가는 회색 태그', () => {
    const w = mount(PortListItem, {
      props: {
        row: portRow({ clientCount: 0, worktree: null, unresolvable: true }),
        beats: [],
        active: false
      }
    })
    expect(w.get('.badge.rounded-pill').classes()).toContain('bg-secondary')
    expect(w.get('.name').text()).toBe('판별 불가')
    expect(w.findAll('.tag-wrapper').map((t) => t.text())).toEqual(['node.exe'])
  })

  test('detached HEAD 는 브랜치 태그에 (detached)', () => {
    const w = mount(PortListItem, {
      props: {
        row: portRow({ worktree: { root: 'C:\\w\\x', branch: null, isLinkedWorktree: false } }),
        beats: [],
        active: false
      }
    })
    expect(w.findAll('.tag-wrapper').map((t) => t.text())).toEqual(['(detached)', 'node.exe'])
  })

  test('누르면 select, 고른 항목은 active', async () => {
    const w = mount(PortListItem, { props: { row: portRow(), beats: [], active: true } })
    expect(w.get('.item').classes()).toContain('active')
    await w.get('.item').trigger('click')
    expect(w.emitted('select')).toHaveLength(1)
  })
})

describe('PortList', () => {
  const history = appendSnapshot(emptyHistory(), snapshot())
  const base = { ports: threePorts, agents: [], leftovers: [], history, hook: null }
  const portItems = (
    w: ReturnType<typeof mount>
  ): ReturnType<ReturnType<typeof mount>['findAll']> => w.findAll('.item:not(.group-item)')

  test('포트마다 항목, 고른 항목 표시, 누르면 키로 select', async () => {
    const w = mount(PortList, {
      props: { ...base, selectedKey: selectionKey.port(threePorts[1]) }
    })
    const items = portItems(w)
    expect(items).toHaveLength(3)
    expect(items[1].classes()).toContain('active')
    await items[2].trigger('click')
    expect(w.emitted('select')?.[0]).toEqual([selectionKey.port(threePorts[2])])
  })

  test('검색: worktree·포트·프로세스 이름으로 거르고(대소문자 무시), 없으면 안내', async () => {
    const w = mount(PortList, { props: { ...base, selectedKey: null } })
    await w.get('input.search-input').setValue('WT-A')
    expect(portItems(w).map((i) => i.get('.badge').text())).toEqual([':3003'])
    await w.get('input.search-input').setValue(':8080')
    expect(portItems(w).map((i) => i.get('.badge').text())).toEqual([':8080'])
    await w.get('input.search-input').setValue('wslrelay')
    expect(portItems(w)).toHaveLength(1)
    await w.get('input.search-input').setValue('없는이름')
    expect(portItems(w)).toHaveLength(0)
    expect(w.text()).toContain('찾는 항목이 없어요.')
  })

  test('포트가 없으면 빈 안내', () => {
    const w = mount(PortList, {
      props: { ...base, ports: [], history: emptyHistory(), selectedKey: null }
    })
    expect(w.text()).toContain('열려 있는 개발 서버 포트가 없어요.')
  })
})

describe('HomeView', () => {
  test('한눈에 보기: RAM(내림 %, 단계 색)·개발 서버·에이전트·남은 프로세스·정리 후보', () => {
    const w = mount(HomeView, {
      props: { snapshot: snapshot(), ramHistory: [] },
      global: { stubs }
    })
    expect(w.get('h1').text()).toBe('한눈에 보기')
    const cols = w.findAll('.stats .col').map((c) => c.text().replace(/\s+/g, ' ').trim())
    expect(cols[0]).toContain('RAM')
    expect(cols[0]).toContain('82%')
    expect(cols[0]).toContain('26.3 GB / 32.0 GB')
    expect(w.findAll('.stats .num')[0].classes()).toContain('text-warning')
    expect(cols[1]).toContain('개발 서버')
    expect(cols[1]).toContain('3')
    expect(cols[2]).toContain('에이전트')
    expect(cols[2]).toContain('0')
    expect(cols[3]).toContain('남은 프로세스')
    expect(cols[4]).toContain('정리 후보')
    expect(w.find('.trend-chart-stub').exists()).toBe(true)
  })

  test('맨 아래에 수집 방식을 작게 보여 준다(문제 생겼을 때 원인 찾기용)', () => {
    const w = mount(HomeView, {
      props: { snapshot: snapshot({ collectMode: 'helper-memory' }), ramHistory: [] },
      global: { stubs }
    })
    expect(w.get('.collect-mode').text()).toBe('수집 방식: 보조 코드(메모리에서 컴파일)')
    const none = mount(HomeView, {
      props: { snapshot: snapshot(), ramHistory: [] },
      global: { stubs }
    })
    expect(none.find('.collect-mode').exists()).toBe(false)
  })

  test('메모리 묶음 표: 개발 서버·에이전트·무거운 작업·다른 앱·시스템', () => {
    const w = mount(HomeView, {
      props: { snapshot: snapshot(), ramHistory: [] },
      global: { stubs }
    })
    const rows = w.findAll('tbody tr').map((r) => r.text())
    expect(rows[0]).toContain('개발 서버')
    expect(rows[0]).toContain('2.1 GB')
    expect(rows[1]).toContain(`${Math.round((500 * MB) / MB)} MB`)
    expect(rows[2]).toContain('무거운 작업')
    expect(rows[3]).toContain('다른 앱')
    expect(rows[3]).toContain('18.0 GB')
    expect(rows[4]).toContain('시스템·공유 메모리')
  })

  test('RAM 위험 단계는 빨강, 총량 0 은 — 로', () => {
    const danger = mount(HomeView, {
      props: {
        snapshot: snapshot({
          memory: { totalBytes: GB, usedBytes: GB, usedPercent: 95, level: 'danger' }
        }),
        ramHistory: []
      },
      global: { stubs }
    })
    expect(danger.findAll('.stats .num')[0].classes()).toContain('text-danger')
    const zero = mount(HomeView, {
      props: {
        snapshot: snapshot({
          memory: { totalBytes: 0, usedBytes: 0, usedPercent: 0, level: 'normal' }
        }),
        ramHistory: []
      },
      global: { stubs }
    })
    expect(zero.findAll('.stats .num')[0].text()).toBe('—')
  })
})

describe('PortDetail', () => {
  const history = appendSnapshot(emptyHistory(), snapshot()).ports[portKey(portRow())]
  const intervals = { openMs: 5000, closedMs: 30000 }

  test('제목·localhost 링크·상태 배지·숫자 칸', () => {
    const w = mount(PortDetail, {
      props: { row: portRow(), history, busy: false, notice: null, intervals },
      global: { stubs }
    })
    expect(w.get('h1').text()).toBe('shop-web')
    expect(w.get('.url').text()).toBe('http://localhost:3000')
    expect(w.get('.status-badge').text()).toBe('사용 중')
    expect(w.get('.status-badge').classes()).toContain('bg-primary')
    const stats = w.findAll('.stats .col').map((c) => c.text().replace(/\s+/g, ' ').trim())
    expect(stats[0]).toContain('메모리')
    expect(stats[0]).toContain('1.2 GB')
    expect(stats[1]).toContain('연결')
    expect(stats[2]).toContain('PID')
    expect(stats[2]).toContain('4100')
    expect(stats[2]).toContain('node.exe')
    expect(stats[3]).toContain('하위 프로세스')
    expect(stats[4]).toContain('develop')
    expect(stats[4]).toContain('메인 체크아웃')
    expect(w.text()).toContain('창이 열려 있으면 5초, 닫혀 있으면 30초마다 확인')
    expect(w.find('.hp-bar-big').exists()).toBe(true)
    expect(w.find('.trend-chart-stub').exists()).toBe(true)
  })

  test('연결이 없으면 회색 "연결 없음", 연결된 worktree 표시', () => {
    const w = mount(PortDetail, {
      props: {
        row: portRow({
          clientCount: 0,
          worktree: { root: '/Users/dev/wt-a', branch: null, isLinkedWorktree: true }
        }),
        history: undefined,
        busy: false,
        notice: null,
        intervals
      },
      global: { stubs }
    })
    expect(w.get('.status-badge').text()).toBe('연결 없음')
    expect(w.get('.status-badge').classes()).toContain('bg-secondary')
    expect(w.text()).toContain('(detached)')
    expect(w.text()).toContain('연결된 worktree')
  })

  test('링크·브라우저 열기 버튼은 open, 내리기는 kill, 처리 중엔 내리기 비활성, 안내 문구 표시', async () => {
    const w = mount(PortDetail, {
      props: {
        row: portRow(),
        history,
        busy: true,
        notice: '이미 종료된 프로세스예요.',
        intervals
      },
      global: { stubs }
    })
    await w.get('.url a').trigger('click')
    await w.get('button.btn-open').trigger('click')
    expect(w.emitted('open')).toHaveLength(2)
    expect(w.get('button.btn-kill').attributes('disabled')).toBeDefined()
    expect(w.get('.kill-notice').text()).toBe('이미 종료된 프로세스예요.')
    await w.setProps({ busy: false })
    await w.get('button.btn-kill').trigger('click')
    expect(w.emitted('kill')).toHaveLength(1)
  })

  test('판별 불가 포트는 제목이 "판별 불가"이고 내리기 버튼이 없다', () => {
    const w = mount(PortDetail, {
      props: { row: threePorts[2], history: undefined, busy: false, notice: null, intervals },
      global: { stubs }
    })
    expect(w.get('h1').text()).toBe('판별 불가')
    expect(w.find('button.btn-kill').exists()).toBe(false)
  })
})
