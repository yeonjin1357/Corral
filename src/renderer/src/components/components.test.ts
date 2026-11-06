// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import StatusBadge from './StatusBadge.vue'
import RamBar from './RamBar.vue'
import DashCard from './DashCard.vue'
import PortsCard from './PortsCard.vue'
import MemoryGroupsCard from './MemoryGroupsCard.vue'
import { GB, MB, portRow, snapshot, threePorts } from '../testing/fixtures'

describe('StatusBadge', () => {
  test('Uptime Kuma 배지 마크업(rounded-pill + bg-톤)', () => {
    const w = mount(StatusBadge, { props: { tone: 'warning', text: '업데이트 지연' } })
    expect(w.classes()).toEqual(expect.arrayContaining(['badge', 'rounded-pill', 'bg-warning']))
    expect(w.text()).toBe('업데이트 지연')
  })
})

describe('RamBar', () => {
  test('단계에 맞는 막대 색과 사용량 문구', () => {
    const w = mount(RamBar, { props: { memory: snapshot().memory } })
    const bar = w.get('.progress-bar')
    expect(bar.classes()).toContain('bg-warning')
    expect(bar.attributes('aria-valuenow')).toBe('82')
    expect(bar.attributes('style')).toContain('width: 82.2%')
    expect(w.text()).toContain('26.3 GB / 32.0 GB (82%)')
  })

  test('표시 퍼센트는 내림 — 79.96% 를 80% 로 보여 주면서 정상(초록)으로 칠하지 않는다', () => {
    const w = mount(RamBar, {
      props: {
        memory: { totalBytes: 100 * GB, usedBytes: 79.96 * GB, usedPercent: 79.96, level: 'normal' }
      }
    })
    expect(w.text()).toContain('(79%)')
    expect(w.get('.progress-bar').attributes('aria-valuenow')).toBe('79')
  })

  test('normal 은 primary, danger 는 danger', () => {
    const normal = mount(RamBar, {
      props: { memory: { totalBytes: GB, usedBytes: 0, usedPercent: 0, level: 'normal' } }
    })
    expect(normal.get('.progress-bar').classes()).toContain('bg-primary')
    const danger = mount(RamBar, {
      props: { memory: { totalBytes: GB, usedBytes: GB, usedPercent: 100, level: 'danger' } }
    })
    expect(danger.get('.progress-bar').classes()).toContain('bg-danger')
  })
})

describe('DashCard', () => {
  test('헤더를 누르면 toggle, 펼쳤을 때만 상세 슬롯', async () => {
    const w = mount(DashCard, {
      props: { title: '개발 서버 포트', summary: '3개', expanded: false },
      slots: { detail: '<p class="d">상세</p>' }
    })
    expect(w.find('.d').exists()).toBe(false)
    await w.get('button.card-head').trigger('click')
    expect(w.emitted('toggle')).toHaveLength(1)
    await w.setProps({ expanded: true })
    expect(w.find('.d').exists()).toBe(true)
    expect(w.get('button.card-head').attributes('aria-expanded')).toBe('true')
    expect(w.classes()).toContain('expanded')
  })

  test('pending 카드는 안내 문구를 보이고 눌러도 펼쳐지지 않는다', async () => {
    const w = mount(DashCard, {
      props: { title: '디스크', summary: '—', expanded: false, pending: true }
    })
    expect(w.text()).toContain('다음 단계에서 추가돼요')
    const head = w.get('button.card-head')
    expect(head.attributes('disabled')).toBeDefined()
    await head.trigger('click')
    expect(w.emitted('toggle')).toBeUndefined()
  })
})

describe('PortsCard', () => {
  test('행 3개, 연결 배지, 판별 불가 행에는 내리기 버튼 없음', () => {
    const w = mount(PortsCard, { props: { ports: threePorts } })
    const rows = w.findAll('tbody tr')
    expect(rows).toHaveLength(3)
    expect(rows[0].text()).toContain(':3000')
    expect(rows[0].text()).toContain('shop-web · develop')
    expect(rows[0].get('.badge').classes()).toContain('bg-primary')
    expect(rows[0].get('.badge').text()).toBe('연결 1')
    expect(rows[1].get('.badge').classes()).toContain('bg-secondary')
    expect(rows[1].get('.badge').text()).toBe('연결 없음')
    expect(rows[1].text()).toContain('wt-a · feat/a')
    expect(rows[2].text()).toContain('판별 불가')
    expect(rows[2].find('button').exists()).toBe(false)
    expect(rows[0].text()).toContain('1.2 GB')
  })

  test('내리기를 누르면 (포트, pid) 로 kill', async () => {
    const w = mount(PortsCard, { props: { ports: threePorts } })
    await w.findAll('tbody tr')[0].get('button').trigger('click')
    expect(w.emitted('kill')?.[0]).toEqual([3000, 4100])
  })

  test('처리 중인 pid 의 버튼은 비활성', () => {
    const w = mount(PortsCard, { props: { ports: threePorts, busyPid: 4100 } })
    expect(w.findAll('tbody tr')[0].get('button').attributes('disabled')).toBeDefined()
    expect(w.findAll('tbody tr')[1].get('button').attributes('disabled')).toBeUndefined()
  })

  test('포트가 없으면 빈 안내', () => {
    const w = mount(PortsCard, { props: { ports: [] } })
    expect(w.text()).toContain('열려 있는 개발 서버 포트가 없어요.')
    expect(w.find('table').exists()).toBe(false)
  })

  test('PID·프로세스 이름을 함께 보여준다', () => {
    const w = mount(PortsCard, { props: { ports: [portRow()] } })
    expect(w.text()).toContain('node.exe')
    expect(w.text()).toContain('4100')
  })
})

describe('MemoryGroupsCard', () => {
  test('개발 서버 · 에이전트 · 그 외 순서와 크기·프로세스 수', () => {
    const w = mount(MemoryGroupsCard, { props: { groups: snapshot().groups } })
    const rows = w.findAll('tbody tr').map((r) => r.text())
    expect(rows[0]).toContain('개발 서버')
    expect(rows[0]).toContain('2.1 GB')
    expect(rows[0]).toContain('프로세스 5개')
    expect(rows[1]).toContain('에이전트')
    expect(rows[1]).toContain(`${Math.round((500 * MB) / MB)} MB`)
    expect(rows[2]).toContain('그 외')
  })
})
