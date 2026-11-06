// @vitest-environment happy-dom
import { flushPromises, mount, type DOMWrapper } from '@vue/test-utils'
import type { Mock } from 'vitest'
import App from './App.vue'
import type { DashboardSnapshot, KillResult } from '../../shared/types'
import type { PitwallApi } from '../../shared/ipc'
import { snapshot } from './testing/fixtures'

function installApi(opts: { latest?: DashboardSnapshot | null; kill?: KillResult } = {}): {
  push(s: DashboardSnapshot): void
  api: PitwallApi & {
    killPort: Mock<PitwallApi['killPort']>
    onSnapshot: Mock<PitwallApi['onSnapshot']>
  }
  resolveLatest(): void
  off: Mock<() => void>
} {
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
    killPort: vi.fn(async (): Promise<KillResult> => opts.kill ?? { status: 'killed' })
  }
  ;(window as unknown as { pitwall: PitwallApi }).pitwall = api
  return { push: (s: DashboardSnapshot) => cb?.(s), api, resolveLatest: () => resolveLatest(), off }
}

test('스냅샷 전에는 불러오는 중, 오면 카드 요약', async () => {
  const { push, resolveLatest } = installApi()
  const w = mount(App)
  expect(w.text()).toContain('불러오는 중…')
  push(snapshot())
  resolveLatest()
  await flushPromises()
  expect(w.text()).toContain('개발 서버 포트')
  expect(w.text()).toContain('3개')
  expect(w.text()).toContain('26.3 GB / 32.0 GB (82%)')
  expect(w.findAll('.dash-card')).toHaveLength(6)
  const memory = w.findAll('.dash-card').find((c) => c.text().includes('개발 작업 메모리'))!
  expect(memory.get('.num').text()).toBe('2.6 GB')
})

test('getLatest 가 늦게 와도 먼저 받은 더 새 스냅샷을 덮어쓰지 않는다', async () => {
  const { push, resolveLatest } = installApi({ latest: snapshot({ agentProcessCount: 9 }) })
  const w = mount(App)
  push(snapshot({ agentProcessCount: 2 }))
  resolveLatest()
  await flushPromises()
  const agents = w.findAll('.dash-card').find((c) => c.text().includes('에이전트'))!
  expect(agents.text()).toContain('2개')
})

test('스냅샷이 없을 때 getLatest 결과를 쓴다', async () => {
  const { resolveLatest } = installApi({ latest: snapshot() })
  const w = mount(App)
  resolveLatest()
  await flushPromises()
  expect(w.text()).toContain('3개')
})

test('한 번에 카드 하나만 펼친다', async () => {
  const { push } = installApi()
  const w = mount(App)
  push(snapshot())
  await flushPromises()
  const card = (title: string): DOMWrapper<Element> =>
    w.findAll('.dash-card').find((c) => c.text().includes(title))!
  await card('개발 서버 포트').get('button.card-head').trigger('click')
  expect(card('개발 서버 포트').classes()).toContain('expanded')
  expect(w.find('table').exists()).toBe(true)
  await card('개발 작업 메모리').get('button.card-head').trigger('click')
  expect(card('개발 서버 포트').classes()).not.toContain('expanded')
  expect(card('개발 작업 메모리').classes()).toContain('expanded')
  await card('개발 작업 메모리').get('button.card-head').trigger('click')
  expect(w.findAll('.dash-card.expanded')).toHaveLength(0)
})

test('stale 이면 업데이트 지연 배지와 에러 문구', async () => {
  const { push } = installApi()
  const w = mount(App)
  push(snapshot({ stale: true, error: 'timeout' }))
  await flushPromises()
  expect(w.get('header .badge').text()).toBe('업데이트 지연')
  expect(w.text()).toContain('timeout')
})

test('내리기 결과가 killed 가 아니면 카드 안에 이유를 보여준다', async () => {
  const { push, api } = installApi({ kill: { status: 'changed' } })
  const w = mount(App)
  push(snapshot())
  await flushPromises()
  const ports = w.findAll('.dash-card').find((c) => c.text().includes('개발 서버 포트'))!
  await ports.get('button.card-head').trigger('click')
  await w.findAll('tbody tr')[0].get('button').trigger('click')
  await flushPromises()
  expect(api.killPort).toHaveBeenCalledWith(3000, 4100)
  expect(w.text()).toContain('그 사이 다른 프로세스로 바뀌어서 내리지 않았어요.')
})

test('취소는 조용히 넘어가고, failed 는 메시지를 우선 보여준다', async () => {
  const cancelled = installApi({ kill: { status: 'cancelled' } })
  const w = mount(App)
  cancelled.push(snapshot())
  await flushPromises()
  const open = async (): Promise<void> => {
    const ports = w.findAll('.dash-card').find((c) => c.text().includes('개발 서버 포트'))!
    if (!ports.classes().includes('expanded')) await ports.get('button.card-head').trigger('click')
    await w.findAll('tbody tr')[0].get('button').trigger('click')
    await flushPromises()
  }
  await open()
  expect(w.find('.kill-notice').exists()).toBe(false)
  cancelled.api.killPort.mockResolvedValueOnce({ status: 'failed', message: '권한이 없어요' })
  await open()
  expect(w.get('.kill-notice').text()).toBe('권한이 없어요')
})

test('언마운트하면 구독을 끊고 다크 모드 감시도 해제한다', async () => {
  const { off } = installApi()
  const w = mount(App)
  await flushPromises()
  expect(off).not.toHaveBeenCalled()
  w.unmount()
  expect(off).toHaveBeenCalledTimes(1)
})
