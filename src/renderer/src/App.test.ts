// @vitest-environment happy-dom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import type { Mock } from 'vitest'
import App from './App.vue'
import type { DashboardSnapshot, KillResult } from '../../shared/types'
import type { ClaudeHookActionResult, PitwallApi } from '../../shared/ipc'
import { agentRow, leftoverRow, portRow, snapshot, threePorts } from './testing/fixtures'
import { DEFAULT_SETTINGS, type Settings } from '../../shared/settings'

interface FakeApi {
  push(s: DashboardSnapshot): void
  api: PitwallApi & {
    killPort: Mock<PitwallApi['killPort']>
    killLeftover: Mock<PitwallApi['killLeftover']>
    refreshNow: Mock<PitwallApi['refreshNow']>
    openPort: Mock<PitwallApi['openPort']>
  }
  resolveLatest(): void
  off: Mock<() => void>
}

function installApi(
  opts: { latest?: DashboardSnapshot | null; kill?: KillResult; settings?: Settings } = {}
): FakeApi {
  let cb: ((s: DashboardSnapshot) => void) | null = null
  let resolveLatest: () => void = () => {}
  const off = vi.fn((): void => {
    cb = null
  })
  const api = {
    onSnapshot: vi.fn((c: (s: DashboardSnapshot) => void): (() => void) => {
      cb = c
      return off
    }),
    getLatest: vi.fn(
      () =>
        new Promise<DashboardSnapshot | null>((r) => (resolveLatest = () => r(opts.latest ?? null)))
    ),
    killPort: vi.fn(async (): Promise<KillResult> => opts.kill ?? { status: 'killed' }),
    killLeftover: vi.fn(async (): Promise<KillResult> => opts.kill ?? { status: 'killed' }),
    killMany: vi.fn(async (): Promise<KillResult> => opts.kill ?? { status: 'killed' }),
    refreshNow: vi.fn(async (): Promise<void> => {}),
    openPort: vi.fn(async (): Promise<boolean> => true),
    claudeHook: {
      status: vi.fn(async () => null),
      enable: vi.fn(async (): Promise<ClaudeHookActionResult> => ({ status: 'cancelled' })),
      disable: vi.fn(async (): Promise<ClaudeHookActionResult> => ({ status: 'cancelled' }))
    },
    settings: {
      get: vi.fn(async (): Promise<Settings> => opts.settings ?? DEFAULT_SETTINGS),
      save: vi.fn(async (next: Settings): Promise<Settings> => next),
      pickFolder: vi.fn(async (): Promise<string | null> => null),
      onChange: vi.fn(() => () => {})
    }
  }
  ;(window as unknown as { pitwall: PitwallApi }).pitwall = api
  return { push: (s: DashboardSnapshot) => cb?.(s), api, resolveLatest: () => resolveLatest(), off }
}

const stubs = {
  TrendChart: { template: '<div class="trend-chart-stub" />', props: ['points', 'label', 'unit'] }
}

async function mountWith(fake: FakeApi, s: DashboardSnapshot = snapshot()): Promise<VueWrapper> {
  const w = mount(App, { global: { stubs } })
  fake.push(s)
  await flushPromises()
  return w
}

test('스냅샷 전에는 불러오는 중, 오면 왼쪽 포트 목록과 오른쪽 한눈에 보기', async () => {
  const fake = installApi()
  const w = mount(App, { global: { stubs } })
  expect(w.text()).toContain('불러오는 중…')
  fake.push(snapshot())
  fake.resolveLatest()
  await flushPromises()
  expect(w.findAll('.monitor-list .item:not(.group-item)')).toHaveLength(3)
  expect(w.get('h1').text()).toBe('한눈에 보기')
  expect(w.get('header .title').text()).toBe('pitwall')
  expect(w.get('header .nav-link.active').text()).toBe('대시보드')
})

test('getLatest 가 늦게 와도 먼저 받은 더 새 스냅샷을 덮어쓰지 않는다', async () => {
  const fake = installApi({
    latest: snapshot({ agents: Array.from({ length: 9 }, (_, i) => agentRow({ pid: i + 1 })) })
  })
  const w = mount(App, { global: { stubs } })
  fake.push(snapshot({ agents: [agentRow({ pid: 1 }), agentRow({ pid: 2 })] }))
  fake.resolveLatest()
  await flushPromises()
  const agents = w.findAll('.stats .col').find((c) => c.text().includes('에이전트'))!
  expect(agents.get('.num').text()).toBe('2')
})

test('스냅샷이 없을 때 getLatest 결과를 쓴다', async () => {
  const fake = installApi({ latest: snapshot() })
  const w = mount(App, { global: { stubs } })
  fake.resolveLatest()
  await flushPromises()
  expect(w.findAll('.monitor-list .item:not(.group-item)')).toHaveLength(3)
})

test('목록에서 고르면 오른쪽에 그 포트 상세, 대시보드를 누르면 다시 한눈에 보기', async () => {
  const fake = installApi()
  const w = await mountWith(fake)
  await w.findAll('.monitor-list .item:not(.group-item)')[0].trigger('click')
  expect(w.get('h1').text()).toBe('shop-web')
  expect(w.findAll('.monitor-list .item:not(.group-item)')[0].classes()).toContain('active')
  await w.get('header .nav-link.active').trigger('click')
  expect(w.get('h1').text()).toBe('한눈에 보기')
})

test('고른 포트가 다음 스냅샷에서 사라지면 한눈에 보기로 돌아간다', async () => {
  const fake = installApi()
  const w = await mountWith(fake)
  await w.findAll('.monitor-list .item:not(.group-item)')[0].trigger('click')
  fake.push(snapshot({ takenAt: 2, ports: threePorts.slice(1) }))
  await flushPromises()
  expect(w.get('h1').text()).toBe('한눈에 보기')
})

test('지금 새로고침은 refreshNow 를 부르고, 끝날 때까지 버튼을 막는다', async () => {
  const fake = installApi()
  let release: () => void = () => {}
  fake.api.refreshNow.mockImplementationOnce(() => new Promise<void>((r) => (release = r)))
  const w = await mountWith(fake)
  await w.get('button.btn-refresh').trigger('click')
  expect(fake.api.refreshNow).toHaveBeenCalledTimes(1)
  expect(w.get('button.btn-refresh').attributes('disabled')).toBeDefined()
  release()
  await flushPromises()
  expect(w.get('button.btn-refresh').attributes('disabled')).toBeUndefined()
})

test('브라우저로 열기는 포트 번호만 넘긴다', async () => {
  const fake = installApi()
  const w = await mountWith(fake)
  await w.findAll('.monitor-list .item:not(.group-item)')[0].trigger('click')
  await w.get('button.btn-open').trigger('click')
  expect(fake.api.openPort).toHaveBeenCalledWith(3000)
})

test('내리기 결과가 killed 가 아니면 상세에 이유를 보여 준다', async () => {
  const fake = installApi({ kill: { status: 'changed' } })
  const w = await mountWith(fake)
  await w.findAll('.monitor-list .item:not(.group-item)')[0].trigger('click')
  await w.get('button.btn-kill').trigger('click')
  await flushPromises()
  expect(fake.api.killPort).toHaveBeenCalledWith(3000, 4100)
  expect(w.get('.kill-notice').text()).toBe('그 사이 다른 프로세스로 바뀌어서 내리지 않았어요.')
})

test('다른 포트를 고르면 이전 안내 문구는 지운다', async () => {
  const fake = installApi({ kill: { status: 'gone' } })
  const w = await mountWith(fake)
  await w.findAll('.monitor-list .item:not(.group-item)')[0].trigger('click')
  await w.get('button.btn-kill').trigger('click')
  await flushPromises()
  expect(w.find('.kill-notice').exists()).toBe(true)
  await w.findAll('.monitor-list .item:not(.group-item)')[1].trigger('click')
  expect(w.find('.kill-notice').exists()).toBe(false)
})

describe('요청이 실패해도 화면이 멈추지 않는다', () => {
  test('내리기 요청이 오류로 끝나면 이유를 보이고 버튼을 다시 쓸 수 있다', async () => {
    const fake = installApi()
    fake.api.killPort.mockRejectedValueOnce(new Error('IPC 끊김'))
    const w = await mountWith(fake)
    await w.findAll('.monitor-list .item:not(.group-item)')[0].trigger('click')
    await w.get('button.btn-kill').trigger('click')
    await flushPromises()
    expect(w.get('.kill-notice').text()).toBe('요청을 처리하지 못했어요: IPC 끊김')
    expect(w.get('button.btn-kill').attributes('disabled')).toBeUndefined()
  })

  test('지금 새로고침이 실패하면 버튼을 되살리고 이유를 보인다', async () => {
    const fake = installApi()
    fake.api.refreshNow.mockRejectedValueOnce(new Error('IPC 끊김'))
    const w = await mountWith(fake)
    await w.get('button.btn-refresh').trigger('click')
    await flushPromises()
    expect(w.get('button.btn-refresh').attributes('disabled')).toBeUndefined()
    expect(w.get('.action-error').text()).toBe('요청을 처리하지 못했어요: IPC 끊김')
  })

  test('브라우저로 열지 못하면 상세에 알린다', async () => {
    const fake = installApi()
    fake.api.openPort.mockResolvedValueOnce(false)
    const w = await mountWith(fake)
    await w.findAll('.monitor-list .item:not(.group-item)')[0].trigger('click')
    await w.get('button.btn-open').trigger('click')
    await flushPromises()
    expect(w.get('.kill-notice').text()).toBe(
      '브라우저로 열지 못했어요. 포트가 이미 닫혔을 수 있어요.'
    )
  })
})

test('stale 이면 헤더에 업데이트 지연 배지와 이유', async () => {
  const fake = installApi()
  const w = await mountWith(fake, snapshot({ stale: true, error: 'timeout' }))
  expect(w.get('header .badge').text()).toBe('업데이트 지연')
  expect(w.text()).toContain('timeout')
})

test('설정은 다음 단계라 비활성', async () => {
  const fake = installApi()
  const w = await mountWith(fake)
  const settings = w.findAll('header .nav-link').find((l) => l.text().includes('설정'))!
  expect(settings.classes()).toContain('disabled')
})

test('언마운트하면 구독을 끊는다', async () => {
  const fake = installApi()
  const w = mount(App, { global: { stubs } })
  await flushPromises()
  expect(fake.off).not.toHaveBeenCalled()
  w.unmount()
  expect(fake.off).toHaveBeenCalledTimes(1)
})

test('포트 행 고유 키는 포트와 pid 를 함께 쓴다(같은 포트를 다른 프로세스가 열면 다른 항목)', async () => {
  const fake = installApi()
  const w = await mountWith(
    fake,
    snapshot({ ports: [portRow({ pid: 1 }), portRow({ pid: 2, port: 3000 })] })
  )
  expect(w.findAll('.monitor-list .item:not(.group-item)')).toHaveLength(2)
})

describe('에이전트·남은 프로세스·Claude 연동', () => {
  const s2 = (): DashboardSnapshot =>
    snapshot({
      agents: [agentRow()],
      leftovers: [leftoverRow()],
      hook: {
        state: 'off',
        problem: null,
        allHooksDisabled: false,
        settingsPath: 'C:\\x\\settings.json'
      }
    })
  const rows = (w: VueWrapper): ReturnType<VueWrapper['findAll']> =>
    w.findAll('.monitor-list .item:not(.group-item)')

  test('에이전트를 고르면 에이전트 상세(끄기 버튼 없음)', async () => {
    const fake = installApi()
    const w = await mountWith(fake, s2())
    await rows(w)[3].trigger('click')
    expect(w.get('h1').text()).toBe('wt-a')
    expect(w.get('.status-badge').text()).toBe('작업 중')
    expect(w.find('.btn-kill').exists()).toBe(false)
  })

  test('남은 프로세스를 고르고 끄기를 누르면 killLeftover(pid), 결과를 상세에 보인다', async () => {
    const fake = installApi({ kill: { status: 'gone' } })
    const w = await mountWith(fake, s2())
    await rows(w)[4].trigger('click')
    expect(w.get('h1').text()).toBe('Playwright 브라우저')
    await w.get('.btn-kill').trigger('click')
    await flushPromises()
    expect(fake.api.killLeftover).toHaveBeenCalledWith(7000)
    expect(w.get('.kill-notice').text()).toBe('이미 종료된 프로세스예요.')
  })

  test('고른 에이전트가 사라지면 한눈에 보기로 돌아간다', async () => {
    const fake = installApi()
    const w = await mountWith(fake, s2())
    await rows(w)[3].trigger('click')
    fake.push(snapshot({ takenAt: 2, agents: [], leftovers: [] }))
    await flushPromises()
    expect(w.get('h1').text()).toBe('한눈에 보기')
  })

  test('Claude 연동 켜기: 메인에 요청하고 결과 문구를 보인다, 취소면 아무 문구도 없다', async () => {
    const fake = installApi()
    const w = await mountWith(fake, s2())
    const enable = fake.api.claudeHook.enable as Mock<PitwallApi['claudeHook']['enable']>
    enable.mockResolvedValueOnce({ status: 'done', message: 'Claude 연동을 켰어요.' })
    await w.get('.hook-box .btn-hook').trigger('click')
    await flushPromises()
    expect(enable).toHaveBeenCalledTimes(1)
    expect(w.get('.hook-notice').text()).toBe('Claude 연동을 켰어요.')
    expect(w.get('.hook-notice').classes()).toContain('text-success')

    enable.mockResolvedValueOnce({ status: 'cancelled' })
    await w.get('.list-box .btn-hook').trigger('click')
    await flushPromises()
    expect(w.find('.hook-notice').exists()).toBe(false)
  })

  test('Claude 연동 실패는 빨간 문구, 요청 오류도 문구로 보이고 버튼을 되살린다', async () => {
    const fake = installApi()
    const w = await mountWith(fake, s2())
    const enable = fake.api.claudeHook.enable as Mock<PitwallApi['claudeHook']['enable']>
    enable.mockResolvedValueOnce({ status: 'failed', message: '바꾸지 않았어요.' })
    await w.get('.hook-box .btn-hook').trigger('click')
    await flushPromises()
    expect(w.get('.hook-notice').classes()).toContain('text-danger')
    enable.mockRejectedValueOnce(new Error('ipc down'))
    await w.get('.hook-box .btn-hook').trigger('click')
    await flushPromises()
    expect(w.get('.hook-notice').text()).toContain('ipc down')
    expect(w.get('.hook-box .btn-hook').attributes('disabled')).toBeUndefined()
  })
})

test('상세 화면의 확인 주기 문구는 설정의 갱신 주기를 따른다', async () => {
  const fake = installApi({ settings: { ...DEFAULT_SETTINGS, refresh: 'fast' } })
  const w = await mountWith(fake)
  await w.findAll('.monitor-list .item:not(.group-item)')[0].trigger('click')
  await flushPromises()
  expect(w.text()).toContain('창이 열려 있으면 2초, 닫혀 있으면 10초마다 확인')
})
