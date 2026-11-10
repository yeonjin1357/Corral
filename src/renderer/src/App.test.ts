// @vitest-environment happy-dom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { isProxy } from 'vue'
import App from './App.vue'
import MemorySheet from './components/MemorySheet.vue'
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
    quick: vi.fn(async () => true),
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

test('설정 > 기준값에서 오래 쉬는 세션 기준(분)을 바꿔 저장한다', async () => {
  const f = fake()
  const w = await start(f)
  f.navigate({ page: 'settings' })
  await flushPromises()
  await w
    .findAll('button')
    .find((b) => b.text().includes('기준값'))!
    .trigger('click')
  const input = w.find('#agent-parked')
  expect((input.element as HTMLInputElement).value).toBe('180')
  expect(input.attributes()).toMatchObject({ min: '10', max: '10080' })
  expect(w.text()).toContain('오래 쉬는 세션 기준')
  expect(w.text()).toContain(
    '그 에이전트만 있는 워크트리의 서버는 정리 후보가 아니라 확인해볼 것까지만'
  )
  await input.setValue('240')
  await w.find('form').trigger('submit')
  await flushPromises()
  expect(f.saved.at(-1)?.agentParkedMinutes).toBe(240)
  w.unmount()
})

test('설정 > 알림에서 조용함·꺼짐 알림을 끄고 권한 대기 다시 알림(분)을 바꿔 저장한다', async () => {
  const f = fake()
  const w = await start(f)
  f.navigate({ page: 'settings' })
  await flushPromises()
  await w
    .findAll('button')
    .find((b) => b.text().trim() === '알림')!
    .trigger('click')
  expect(w.text()).toContain(
    '훅으로 작업 중인 에이전트가 15분 넘게 이벤트도 CPU 사용도 없으면 알려요. 오래 걸리는 명령을 기다리는 중일 수도 있어요.'
  )
  expect(w.text()).toContain('작업 중이거나 권한을 기다리던 에이전트가 꺼지면 알려요.')
  expect(w.text()).toContain(
    '권한 대기가 이 시간 넘게 이어지면 다시 알려요. 0 이면 다시 알리지 않아요.'
  )
  const quiet = w.find('#notify-quiet')
  const gone = w.find('#notify-gone')
  expect(quiet.attributes('aria-checked')).toBe('true')
  expect(gone.attributes('aria-checked')).toBe('true')
  const reminder = w.find('#waiting-reminder')
  expect((reminder.element as HTMLInputElement).value).toBe('10')
  expect(reminder.attributes()).toMatchObject({ min: '0', max: '120' })
  await quiet.trigger('click')
  await gone.trigger('click')
  await reminder.setValue('0')
  await w.find('form').trigger('submit')
  await flushPromises()
  expect(f.saved.at(-1)?.notify).toMatchObject({ agentQuiet: false, agentGone: false })
  expect(f.saved.at(-1)?.waitingReminderMinutes).toBe(0)
  w.unmount()
})

test('설정 > 에이전트 연동에서 "에이전트가 하는 일 보기"를 끄고 저장한다', async () => {
  const f = fake()
  const w = await start(f)
  f.navigate({ page: 'settings' })
  await flushPromises()
  await w
    .findAll('button')
    .find((b) => b.text().includes('에이전트 연동'))!
    .trigger('click')
  const box = w.find('#show-agent-activity')
  expect(box.attributes('aria-checked')).toBe('true')
  expect(w.text()).toContain('에이전트가 하는 일 보기')
  expect(w.text()).toContain(
    '훅이 알려 주는 세션 제목·요청 첫 줄·도구 이름을 화면에 보여요. 메모리에만 두고 파일로 남기지 않아요.'
  )
  await box.trigger('click')
  await w.find('form').trigger('submit')
  await flushPromises()
  expect(f.saved.at(-1)?.showAgentActivity).toBe(false)
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

test('메모리 상세의 RAM 추이는 쌓인 기록만큼(최소 작은 그래프 길이, 최대 2시간), 끊긴 구간은 비운다', async () => {
  const MIN = 60_000
  const open = async (points: { t: number; value: number }[]): Promise<VueWrapper> => {
    const w = await start(fake({ historyRam: async () => points }))
    await w.find('[aria-label="메모리 자세히 보기"]').trigger('click')
    await flushPromises()
    return w
  }
  // 막 켰을 때(기록 없음): 작은 그래프와 같은 10분(보통 갱신 5초 × 120).
  let w = await open([])
  expect(w.findComponent(MemorySheet).props('windowMs')).toBe(10 * MIN)
  expect(w.findComponent(MemorySheet).props('gapMs')).toBeGreaterThanOrEqual(MIN)
  w.unmount()
  // 앱이 기억한 기록이 90분이면 90분.
  w = await open([{ t: 1 - 90 * MIN, value: 50 }])
  expect(w.findComponent(MemorySheet).props('windowMs')).toBe(90 * MIN)
  w.unmount()
  // 2시간보다 오래된 기록은 버리므로 축도 그만큼 길어지지 않는다.
  w = await open([{ t: 1 - 300 * MIN, value: 50 }])
  expect(w.findComponent(MemorySheet).props('windowMs')).toBe(10 * MIN)
  w.unmount()
})

test('상세 패널의 숨기기는 그 워크트리의 첫 포트로 숨긴다(다른 프로젝트의 같은 포트는 그대로)', async () => {
  const f = fake()
  const w = await start(f)
  await w
    .find(`tr[data-key="${selectionKey.server(api)}"] [data-action="details"]`)
    .trigger('click')
  await flushPromises()
  document.body.querySelector<HTMLElement>('[data-action="hide"]')!.click()
  await flushPromises()
  expect(f.saved.at(-1)?.hiddenServers).toEqual(['C:\\work\\ws\\api:8081'])
  expect(notice(w)).toContain('api :8081')
  w.unmount()
})

test('상세 패널의 바로 가기: 경로를 복사하면 알리고, 열지 못하면 실패를 한 줄로 알린다', async () => {
  const f = fake()
  const w = await start(f)
  await w
    .find(`tr[data-key="${selectionKey.server(api)}"] [data-action="details"]`)
    .trigger('click')
  await flushPromises()
  const button = (kind: string): HTMLElement =>
    document.body.querySelector<HTMLElement>(`[data-quick="${kind}"]`)!
  button('copy').click()
  await flushPromises()
  expect(f.api.quick).toHaveBeenCalledWith('copy', 'C:\\work\\ws\\api')
  expect(notice(w)).toContain('경로를 복사했어요.')
  // 폴더·터미널은 열리는 것으로 충분하다(알림 없음).
  button('terminal').click()
  await flushPromises()
  expect(f.api.quick).toHaveBeenLastCalledWith('terminal', 'C:\\work\\ws\\api')
  expect(notice(w)).toBe('')
  vi.mocked(f.api.quick).mockResolvedValueOnce(false)
  button('folder').click()
  await flushPromises()
  expect(f.api.quick).toHaveBeenLastCalledWith('folder', 'C:\\work\\ws\\api')
  expect(notice(w)).toContain('열지 못했어요. 폴더가 없어졌을 수 있어요.')
  w.unmount()
})

test('상세 패널에서 고른 포트를 연다', async () => {
  const multi = serverRow({ pid: 9, ports: [6176, 8081], workspace: null })
  const f = fake({ getLatest: async () => snapshot({ servers: [multi] }) })
  const w = await start(f)
  await w
    .find(`tr[data-key="${selectionKey.server(multi)}"] [data-action="details"]`)
    .trigger('click')
  await flushPromises()
  ;[...document.body.querySelectorAll<HTMLElement>('[data-action="open"]')]
    .find((b) => b.textContent!.trim() === ':8081')!
    .click()
  await flushPromises()
  expect(f.api.openPort).toHaveBeenCalledWith(8081)
  w.unmount()
})
