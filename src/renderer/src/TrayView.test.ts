// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import TrayView from './TrayView.vue'
import { workspaceSummary } from './rows'
import { GB, MB, agentRow, serverRow, snapshot } from './testing/fixtures'
import { DEFAULT_SETTINGS } from '../../shared/settings'
import type { AgentRow, DashboardSnapshot } from '../../shared/types'

const WS = { root: 'C:\\work\\ws', name: 'ws', branch: 'main', outer: true }
const s = snapshot({
  takenAt: 10 * 60_000,
  servers: [
    serverRow({ pid: 1, ports: [5173], workspace: WS, memoryBytes: 300 * MB }),
    serverRow({ pid: 2, ports: [8081], workspace: WS, memoryBytes: 2 * GB }),
    serverRow({
      pid: 3,
      ports: [3000],
      memoryBytes: 900 * MB,
      judgement: 'candidate',
      clientCount: 0,
      workspace: { root: 'C:\\work\\shop-web', name: 'shop-web', branch: 'develop', outer: false }
    })
  ],
  agents: [
    agentRow({
      workspace: WS,
      worktree: { root: 'C:\\work\\ws', branch: 'main', isLinkedWorktree: false },
      state: 'waiting',
      stateSince: 7 * 60_000
    })
  ]
})

test('작업 공간 요약: 메모리 큰 순, 서버 수·메모리 합·에이전트·첫 서버 키', () => {
  const summary = workspaceSummary(s)
  expect(summary.map((w) => [w.name, w.serverCount, w.memoryBytes, w.agents.length])).toEqual([
    ['ws', 2, 300 * MB + 2 * GB, 1],
    ['shop-web', 1, 900 * MB, 0]
  ])
  expect(summary[0].firstKey).toBe('server:2:200')
})

describe('TrayView', () => {
  let action: ReturnType<typeof vi.fn>
  let listener: ((s: DashboardSnapshot) => void) | null

  beforeEach(() => {
    action = vi.fn(async () => {})
    listener = null
    window.pitwall = {
      getLatest: async () => s,
      onSnapshot: (cb: (s: DashboardSnapshot) => void) => {
        listener = cb
        return () => {}
      },
      settings: { get: async () => DEFAULT_SETTINGS, onChange: () => () => {} },
      fileIcon: async () => null,
      tray: { action }
    } as unknown as Window['pitwall']
  })

  test('RAM·개발 서버·에이전트 요약과 작업 공간·기다리는 에이전트를 보인다', async () => {
    const w = mount(TrayView)
    await flushPromises()
    expect(w.find('[data-metric="ram"]').text()).toContain('82%')
    expect(w.find('[data-metric="servers"]').text()).toContain('3')
    expect(w.find('[data-metric="agents"]').text()).toContain('권한 대기 1')
    expect(w.findAll('[data-workspace]').map((r) => r.text())).toEqual([
      expect.stringContaining('ws'),
      expect.stringContaining('shop-web')
    ])
    expect(w.find('[data-agent]').text()).toContain('권한 대기 · 3분')
    w.unmount()
  })

  test('정리 추천이 있으면 버튼으로 앱을 연다, 줄을 누르면 그 항목, 바닥 버튼은 앱 열기·설정·종료', async () => {
    const w = mount(TrayView)
    await flushPromises()
    await w.find('[data-action="recommend"]').trigger('click')
    expect(action).toHaveBeenLastCalledWith('open')
    await w.find('[data-workspace]').trigger('click')
    expect(action).toHaveBeenLastCalledWith('item', 'server:2:200')
    await w.find('[data-action="settings"]').trigger('click')
    expect(action).toHaveBeenLastCalledWith('settings')
    await w.find('[data-action="quit"]').trigger('click')
    expect(action).toHaveBeenLastCalledWith('quit')
    w.unmount()
  })

  test('요약 창의 에이전트 줄은 표와 같은 상태 글자, 권한 대기 다음에 조용함', async () => {
    const MIN = 60_000
    const now = 4 * 60 * MIN
    const at = (pid: number, root: string): Partial<AgentRow> => ({
      pid,
      startedAt: pid,
      worktree: { root, branch: 'main', isLinkedWorktree: false }
    })
    const many = snapshot({
      ...s,
      takenAt: now,
      agents: [
        agentRow({
          ...at(1, 'C:\\work\\parked'),
          state: 'idle',
          stateSince: now - 3 * 60 * MIN,
          parked: true,
          lastActiveAt: now - 3 * 60 * MIN
        }),
        agentRow({ ...at(2, 'C:\\work\\busy'), state: 'working', stateSince: now - 5 * MIN }),
        agentRow({ ...at(3, 'C:\\work\\broken'), state: 'error', stateSince: now - MIN }),
        agentRow({
          ...at(4, 'C:\\work\\quiet'),
          state: 'working',
          stateSince: now - 40 * MIN,
          quietSince: now - 18 * MIN
        }),
        agentRow({ ...at(5, 'C:\\work\\asking'), state: 'waiting', stateSince: now - 3 * MIN })
      ]
    })
    window.pitwall.getLatest = async () => many
    const w = mount(TrayView)
    await flushPromises()
    const rows = w.findAll('[data-agent]')
    expect(rows.map((r) => r.text())).toEqual([
      expect.stringMatching(/asking.*권한 대기 · 3분/),
      expect.stringMatching(/quiet.*조용함 · 18분/),
      expect.stringMatching(/broken.*오류 · 1분/),
      expect.stringMatching(/busy.*작업 중 · 5분/)
    ])
    const peach = rows.map((r) =>
      r.findAll('span').some((x) => x.classes().includes('text-[color:var(--peach)]'))
    )
    expect(peach).toEqual([true, true, false, false])
    // 오래 쉬는 세션도 표와 같은 글자("오래 쉼 · 기간").
    listener!(snapshot({ ...many, takenAt: now + 1, agents: [many.agents[0]] }))
    await flushPromises()
    expect(w.find('[data-agent]').text()).toContain('오래 쉼 · 3시간')
    w.unmount()
  })

  test('새 스냅샷이 오면 바로 바꾸고, Esc 는 창을 숨긴다', async () => {
    const w = mount(TrayView, { attachTo: document.body })
    await flushPromises()
    listener!({ ...s, memory: { ...s.memory, usedPercent: 91.4, level: 'danger' } })
    await flushPromises()
    expect(w.find('[data-metric="ram"]').text()).toContain('91%')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(action).toHaveBeenLastCalledWith('hide')
    w.unmount()
  })
})

test('정리 추천 버튼은 커밋을 알면 RAM·커밋 둘 다 보인다', async () => {
  const commitSnap = snapshot({
    ...s,
    servers: s.servers.map((r) => ({ ...r, commitBytes: 1 * GB }))
  })
  window.pitwall = {
    getLatest: async () => commitSnap,
    onSnapshot: () => () => {},
    settings: { get: async () => DEFAULT_SETTINGS, onChange: () => () => {} },
    fileIcon: async () => null,
    tray: { action: vi.fn(async () => {}) }
  } as unknown as Window['pitwall']
  const w = mount(TrayView)
  await flushPromises()
  expect(w.find('[data-action="recommend"]').text()).toMatch(/RAM 약 .* · 커밋 약 .* 확보/)
  w.unmount()
})
