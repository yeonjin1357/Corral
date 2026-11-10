// @vitest-environment happy-dom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { isProxy } from 'vue'
import App from './App.vue'
import { DEFAULT_SETTINGS, type Settings } from '../../shared/settings'
import type { NavigateTarget, PitwallApi } from '../../shared/ipc'
import type { DashboardSnapshot } from '../../shared/types'
import { selectionKey } from '../../shared/keys'
import { MB, agentRow, diskRow, serverRow, snapshot } from './testing/fixtures'

const WS = { root: 'C:\\work\\ws', name: 'ws', branch: 'main', outer: true }
const front = serverRow({ pid: 1, ports: [5173], workspace: WS, memoryBytes: 300 * MB })
const api = serverRow({
  pid: 2,
  ports: [8081],
  workspace: WS,
  memoryBytes: 900 * MB,
  worktree: { root: 'C:\\work\\ws\\api', branch: 'feat/api', isLinkedWorktree: false }
})
const solo = serverRow({ pid: 3, ports: [3000], memoryBytes: 100 * MB })
const agent = agentRow({ pid: 5000 })

function snap(): DashboardSnapshot {
  return snapshot({
    servers: [front, api, solo],
    agents: [agent],
    disk: { rows: [diskRow()], scannedAt: 1, scanning: false, error: null }
  })
}

interface Fake {
  api: PitwallApi
  navigate: (t: NavigateTarget) => void
  saved: Settings[]
}

function fake(over: Partial<PitwallApi> = {}): Fake {
  let navigate: (t: NavigateTarget) => void = () => {}
  const saved: Settings[] = []
  let current: Settings = structuredClone(DEFAULT_SETTINGS)
  const off = (): (() => void) => () => {}
  const api = {
    onSnapshot: off,
    getLatest: async () => snap(),
    historyRam: async () => [],
    tray: { action: vi.fn() },
    killServer: vi.fn(async () => ({ status: 'killed' as const })),
    killLeftover: vi.fn(async () => ({ status: 'killed' as const })),
    killMany: vi.fn(async () => ({ status: 'killed' as const })),
    cleanupWorkspace: vi.fn(async () => ({ status: 'killed' as const, message: '2개를 껐어요.' })),
    diskScan: vi.fn(async () => null),
    diskRemove: vi.fn(async () => ({ status: 'killed' as const, message: '1.2 GB 를 지웠어요.' })),
    refreshNow: vi.fn(async () => {}),
    openPort: vi.fn(async () => true),
    claudeHook: { status: async () => null, enable: vi.fn(), disable: vi.fn() },
    codexHook: { status: async () => null, enable: vi.fn(), disable: vi.fn() },
    appInfo: async () => ({ version: '0.1.0' }),
    fileIcon: async () => null,
    update: {
      get: async () => null,
      check: async () => null,
      install: async () => {},
      onChange: off
    },
    onNavigate: (cb: (t: NavigateTarget) => void) => {
      navigate = cb
      return () => {}
    },
    settings: {
      get: async () => current,
      save: vi.fn(async (next: Settings) => {
        saved.push(next)
        current = structuredClone(next)
        return current
      }),
      pickFolder: async () => null,
      onChange: off
    },
    ...over
  } as unknown as PitwallApi
  return { api, navigate: (t) => navigate(t), saved }
}

async function start(f: Fake): Promise<VueWrapper> {
  window.pitwall = f.api
  localStorage.clear()
  const w = mount(App, { attachTo: document.body })
  await flushPromises()
  return w
}

const notice = (w: VueWrapper, slot = 'action'): string =>
  w.find(`[data-notice="${slot}"]`).exists() ? w.find(`[data-notice="${slot}"]`).text() : ''

afterEach(() => {
  document.body.innerHTML = ''
})

test('서버를 끄면 그 서버(맨 위 pid)를 끄고, 실패하면 결과 알림이 제목줄 아래에', async () => {
  const f = fake()
  const w = await start(f)
  const row = w.find(`tr[data-key="${selectionKey.server(solo)}"]`)
  await row.find('[data-action="kill"]').trigger('click')
  await flushPromises()
  expect(f.api.killServer).toHaveBeenCalledWith(3)
  expect(notice(w)).toBe('') // 하나를 끈 것은 목록에서 사라지는 것으로 충분하다.
  vi.mocked(f.api.killServer).mockResolvedValueOnce({ status: 'failed', message: '권한이 없어요.' })
  await row.find('[data-action="kill"]').trigger('click')
  await flushPromises()
  expect(notice(w)).toContain('권한이 없어요.')
  w.unmount()
})

test('디스크 정리 결과 알림', async () => {
  const f = fake()
  const w = await start(f)
  const diskTab = w
    .findAll('[data-slot="toggle-group-item"]')
    .find((b) => b.text().startsWith('디스크'))!
  await diskTab.trigger('click')
  await w.find('[data-action="remove"]').trigger('click')
  await flushPromises()
  expect(f.api.diskRemove).toHaveBeenCalledWith(diskRow().worktreeRoot)
  expect(notice(w)).toContain('1.2 GB 를 지웠어요.')
  w.unmount()
})

test('OS 알림에서 온 이동은 그 탭·그 항목 상세를 연다', async () => {
  const f = fake()
  const w = await start(f)
  f.navigate({ page: 'dashboard', key: selectionKey.agent(agent) })
  await flushPromises()
  const pressed = w.find('[data-slot="toggle-group-item"][aria-pressed="true"]')
  expect(pressed.text()).toContain('에이전트')
  expect(document.body.textContent).toContain('Claude Code · PID 5000')
  w.unmount()
})

test('저장 안 한 설정은 대시보드를 다녀와도 남는다', async () => {
  const f = fake()
  const w = await start(f)
  f.navigate({ page: 'settings' })
  await flushPromises()
  const thresholds = w.findAll('button').find((b) => b.text().includes('기준값'))!
  await thresholds.trigger('click')
  await w.find('#idle-port').setValue('45')
  await w
    .findAll('button')
    .find((b) => b.text().includes('대시보드로'))!
    .trigger('click')
  await flushPromises()
  expect(w.find('#idle-port').exists()).toBe(false)
  f.navigate({ page: 'settings' })
  await flushPromises()
  await w
    .findAll('button')
    .find((b) => b.text().includes('기준값'))!
    .trigger('click')
  expect((w.find('#idle-port').element as HTMLInputElement).value).toBe('45')
  w.unmount()
})

test('설정 저장은 IPC 로 보낼 수 있는 값(반응형 아닌 순수 값)으로 보낸다', async () => {
  const f = fake()
  const w = await start(f)
  f.navigate({ page: 'settings' })
  await flushPromises()
  await w.find('form').trigger('submit')
  await flushPromises()
  expect(f.saved).toHaveLength(1)
  expect(isProxy(f.saved[0])).toBe(false)
  expect(() => structuredClone(f.saved[0])).not.toThrow()
  w.unmount()
})

test('검색·탭·정렬', async () => {
  const f = fake()
  const w = await start(f)
  const keys = (): string[] =>
    w.findAll('tbody tr[data-key]').map((tr) => tr.attributes('data-key')!)
  // 목록 보기로 바꿔 서버 줄만 본다.
  await w
    .findAll('button')
    .find((b) => b.text() === '목록')!
    .trigger('click')
  await w.find('input[placeholder^="이름"]').setValue(':8081')
  expect(keys()).toEqual([selectionKey.server(api)])
  await w.find('input[placeholder^="이름"]').setValue('')
  const memory = w.findAll('th').find((th) => th.text().includes('메모리'))!
  await memory.find('button').trigger('click')
  expect(keys()).toEqual([api, front, solo].map((r) => selectionKey.server(r)))
  const agents = w
    .findAll('[data-slot="toggle-group-item"]')
    .find((b) => b.text().startsWith('에이전트'))!
  await agents.trigger('click')
  expect(keys()).toEqual([selectionKey.agent(agent)])
  w.unmount()
})

test('묶음 정리 버튼은 작업 공간 정리를 부르고 결과를 알린다', async () => {
  const f = fake()
  const w = await start(f)
  await w.find('tr[data-group] [data-action="cleanup"]').trigger('click')
  await flushPromises()
  expect(f.api.cleanupWorkspace).toHaveBeenCalledWith('C:\\work\\ws')
  expect(notice(w)).toContain('2개를 껐어요.')
  w.unmount()
})

test('작업 공간 이름을 바꾸면 별칭으로 저장하고 다시 수집한다', async () => {
  const f = fake()
  const w = await start(f)
  await w.find('tr[data-group] [data-action="rename"]').trigger('click')
  const input = w.find('tr[data-group] input')
  await input.setValue('쇼핑')
  await input.trigger('keydown', { key: 'Enter' })
  await flushPromises()
  expect(f.saved.at(-1)?.workspaceAliases).toEqual({ 'C:\\work\\ws': '쇼핑' })
  expect(f.api.refreshNow).toHaveBeenCalled()
  w.unmount()
})

test('저장 안 한 설정 화면이 대시보드에서 바꾼 숨기기·별칭을 되돌리지 않는다', async () => {
  const f = fake()
  const w = await start(f)
  f.navigate({ page: 'settings' })
  await flushPromises()
  await w
    .findAll('button')
    .find((b) => b.text().includes('기준값'))!
    .trigger('click')
  await w.find('#idle-port').setValue('45')
  await w
    .findAll('button')
    .find((b) => b.text().includes('대시보드로'))!
    .trigger('click')
  await flushPromises()
  // 대시보드에서 작업 공간 이름 바꾸기(바로 저장된다).
  await w.find('tr[data-group] [data-action="rename"]').trigger('click')
  await w.find('tr[data-group] input').setValue('쇼핑')
  await w.find('tr[data-group] input').trigger('keydown', { key: 'Enter' })
  await flushPromises()
  // 설정으로 돌아가 저장한다.
  f.navigate({ page: 'settings' })
  await flushPromises()
  await w.find('form').trigger('submit')
  await flushPromises()
  expect(f.saved.at(-1)).toMatchObject({
    idlePortMinutes: 45,
    workspaceAliases: { 'C:\\work\\ws': '쇼핑' }
  })
  w.unmount()
})

test('메모리 상세의 묶음을 누르면 상세를 닫고 그 탭으로 간다(검색어는 비운다)', async () => {
  const f = fake()
  const w = await start(f)
  await w.find('input[type="search"], input').setValue('없는이름')
  await w.find('[aria-label="메모리 자세히 보기"]').trigger('click')
  await flushPromises()
  const agent = document.body.querySelector<HTMLElement>('[data-memory-group="agent"] button')!
  agent.click()
  await flushPromises()
  expect(document.body.querySelector('[data-memory-group]')).toBeNull()
  expect(
    w.find('[data-slot="toggle-group-item"][data-value="agents"]').attributes('data-state')
  ).toBe('on')
  expect((w.find('input[type="search"], input').element as HTMLInputElement).value).toBe('')
  w.unmount()
})
