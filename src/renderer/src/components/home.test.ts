// @vitest-environment happy-dom
import { mount, type VueWrapper } from '@vue/test-utils'
import HomeView from './HomeView.vue'
import type { DashboardSnapshot, MemoryLevel } from '../../../shared/types'
import { GB, MB, heavyJob, leftoverRow, portRow, snapshot } from '../testing/fixtures'

const stubs = {
  TrendChart: { template: '<div class="trend-chart-stub" />', props: ['points', 'label', 'unit'] }
}

function memory(level: MemoryLevel, usedPercent: number): DashboardSnapshot['memory'] {
  return { totalBytes: 32 * GB, usedBytes: (32 * GB * usedPercent) / 100, usedPercent, level }
}

function home(s: DashboardSnapshot, extra: Record<string, unknown> = {}): VueWrapper {
  return mount(HomeView, { props: { snapshot: s, ramHistory: [], ...extra }, global: { stubs } })
}

describe('메모리 정리 추천', () => {
  const candidate = portRow({
    port: 3005,
    pid: 4500,
    judgement: 'candidate',
    memoryBytes: 800 * MB
  })
  const leftover = leftoverRow({
    pid: 7000,
    memoryBytes: 1100 * MB,
    worktree: { root: 'C:\\work\\api', branch: 'main', isLinkedWorktree: false }
  })

  test('RAM 이 정상이면 보이지 않는다', () => {
    const w = home(snapshot({ memory: memory('normal', 50), ports: [candidate] }))
    expect(w.find('.recommend-box').exists()).toBe(false)
  })

  test('경고 이상이면 정리 후보를 메모리 큰 순으로, 합계와 함께. 누르면 그 항목, 모두 끄기는 키 목록', async () => {
    const w = home(
      snapshot({ memory: memory('warn', 85), ports: [candidate], leftovers: [leftover] })
    )
    const box = w.get('.recommend-box')
    expect(box.text()).toContain('메모리 정리 추천')
    expect(box.text()).toContain('2개를 끄면 약 1.9 GB 를 확보할 수 있어요.')
    const rows = box.findAll('.recommend-item').map((r) => r.text())
    expect(rows[0]).toContain('Playwright 브라우저')
    expect(rows[0]).toContain('1.1 GB')
    expect(rows[1]).toContain(':3005')
    expect(rows[1]).toContain('shop-web · develop')
    await box.findAll('.recommend-item')[1].trigger('click')
    expect(w.emitted('select')).toEqual([['port:3005:4500']])
    await box.get('.btn-kill-many').trigger('click')
    expect(w.emitted('killMany')).toEqual([[['leftover:7000:300', 'port:3005:4500']]])
  })

  test('처리 중이면 모두 끄기를 막고, 결과 문구를 보인다', () => {
    const w = home(snapshot({ memory: memory('danger', 93), ports: [candidate] }), {
      recommendBusy: true,
      recommendNotice: '1개를 껐어요.'
    })
    expect(w.get('.btn-kill-many').attributes('disabled')).toBeDefined()
    expect(w.get('.recommend-box').text()).toContain('1개를 껐어요.')
  })

  test('후보가 없으면 다른 앱을 확인해 보라고 안내하고 버튼은 없다', () => {
    const w = home(snapshot({ memory: memory('danger', 93), ports: [] }))
    expect(w.get('.recommend-box').text()).toContain('정리 후보가 없어요.')
    expect(w.find('.btn-kill-many').exists()).toBe(false)
  })
})

describe('무거운 작업', () => {
  test('없으면 보이지 않고, 있으면 이름·워크트리·메모리·실행 시간', () => {
    expect(home(snapshot()).find('.heavy-box').exists()).toBe(false)
    const w = home(snapshot({ takenAt: 5 * 60 * 1000, heavyJobs: [heavyJob()] }))
    const row = w.get('.heavy-box tbody tr').text()
    expect(row).toContain('vue-tsc')
    expect(row).toContain('shop-web · develop')
    expect(row).toContain('6.0 GB')
    expect(row).toContain('5분')
    expect(w.get('.heavy-box').text()).not.toContain('겹쳐')
  })

  test('겹치면 경고 문구', () => {
    const w = home(
      snapshot({
        memory: memory('warn', 86.4),
        heavyJobs: [heavyJob(), heavyJob({ pid: 8100, label: 'vite build', worktree: null })],
        heavyOverlap: true
      })
    )
    const box = w.get('.heavy-box')
    expect(box.text()).toContain('RAM 이 86% 인데 무거운 작업 2개가 겹쳐 돌고 있어요.')
    expect(box.findAll('tbody tr')[1].text()).toContain('작업 폴더 모름')
  })
})

describe('메모리 묶음', () => {
  test('시스템·공유 메모리는 프로세스 수 대신 —, 다른 앱 상위 표', () => {
    const w = home(snapshot())
    const rows = w.findAll('.groups-box tbody tr').map((r) => r.text())
    expect(rows[4]).toContain('시스템·공유 메모리')
    expect(rows[4]).toContain('—')
    const apps = w.findAll('.top-apps-box tbody tr').map((r) => r.text())
    expect(apps[0]).toContain('chrome.exe')
    expect(apps[0]).toContain('5.0 GB')
    expect(apps[0]).toContain('40개')
  })

  test('다른 앱 정보가 없으면 그 표는 없다', () => {
    expect(
      home(snapshot({ topApps: [] }))
        .find('.top-apps-box')
        .exists()
    ).toBe(false)
  })
})

describe('남은 프로세스 개수', () => {
  test('에이전트가 있는 워크트리의 것은 개수·주황에서 빼고 따로 알린다', () => {
    const w = home(
      snapshot({
        leftovers: [leftoverRow({ pid: 1 }), leftoverRow({ pid: 2, agentInWorktree: true })]
      })
    )
    const col = w.findAll('.stats .stat')[3]
    expect(col.get('.num').text()).toBe('1')
    expect(col.get('.num').classes()).toContain('text-warning')
    expect(col.text()).toContain('에이전트 워크트리 1')
    const onlyAgent = home(snapshot({ leftovers: [leftoverRow({ agentInWorktree: true })] }))
    const c2 = onlyAgent.findAll('.stats .stat')[3]
    expect(c2.get('.num').text()).toBe('0')
    expect(c2.get('.num').classes()).toContain('text-secondary')
  })
})

test('숫자 칸은 좁은 창에서 한 줄에 3개, 넓은 창에서 한 줄에 모두', () => {
  const cols = home(snapshot()).findAll('.stats .stat')
  expect(cols).toHaveLength(5)
  for (const c of cols) expect(c.classes()).toEqual(expect.arrayContaining(['col-4', 'col-lg']))
})

test('시스템·공유 메모리가 무엇인지 표 아래에 설명한다', () => {
  expect(home(snapshot()).get('.groups-box .group-note').text()).toContain(
    'pitwall 이 읽을 수 없는 프로세스'
  )
})
