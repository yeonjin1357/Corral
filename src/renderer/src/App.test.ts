// @vitest-environment happy-dom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { isProxy } from 'vue'
import App from './App.vue'
import MemorySheet from './components/MemorySheet.vue'
import { DEFAULT_SETTINGS, type Settings } from '../../shared/settings'
import type { NavigateTarget, PitwallApi } from '../../shared/ipc'
import type { PitEvent } from '../../shared/events'
import type { DashboardSnapshot } from '../../shared/types'
import { selectionKey } from '../../shared/keys'
import { MB, agentRow, diskRow, serverRow, snapshot, workspaceRow } from './testing/fixtures'

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
const agent = agentRow({ pid: 5000, host: { pids: [4000], app: null } })

function snap(): DashboardSnapshot {
  return snapshot({
    servers: [front, api, solo],
    agents: [agent],
    disk: { rows: [diskRow()], scannedAt: 1, scanning: false, error: null },
    workspaces: [
      workspaceRow({
        key: 'ws:c:\\work\\ws',
        root: 'C:\\work\\ws',
        name: 'ws',
        outer: true,
        memoryBytes: 1200 * MB,
        serverKeys: [selectionKey.server(front), selectionKey.server(api)]
      }),
      // 작업 공간을 모르는 서버·에이전트.
      workspaceRow({
        key: 'ws:?',
        root: null,
        name: '작업 폴더 모름',
        memoryBytes: 700 * MB,
        serverKeys: [selectionKey.server(solo)],
        agentKeys: [selectionKey.agent(agent)]
      })
    ]
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
    events: { get: vi.fn(async () => [] as PitEvent[]), onAdded: () => () => {} },
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
    focusAgent: vi.fn(async () => true),
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

/** 탭을 고른다(처음 탭은 작업 공간). */
async function openTab(w: VueWrapper, tab: string): Promise<void> {
  await w.find(`[data-slot="toggle-group-item"][data-value="${tab}"]`).trigger('click')
}

const pressedTab = (w: VueWrapper): string | undefined =>
  w.find('[data-slot="toggle-group-item"][aria-pressed="true"]').attributes('data-value')

afterEach(() => {
  document.body.innerHTML = ''
})

test('처음 탭은 작업 공간', async () => {
  const w = await start(fake())
  expect(pressedTab(w)).toBe('workspaces')
  expect(w.findAll('tbody tr[data-group]').map((tr) => tr.attributes('data-group'))).toEqual([
    'ws:c:\\work\\ws',
    'ws:?'
  ])
  expect(w.find('footer').text()).toContain('작업 공간 2개')
  w.unmount()
})

test('작업 공간이 없으면 빈 화면 문구', async () => {
  const w = await start(fake({ getLatest: async () => snapshot({ servers: [], workspaces: [] }) }))
  expect(w.find('tbody').text()).toContain('실행 중인 작업이 없어요.')
  w.unmount()
})

test('작업 공간 탭에서 서버를 누르면 탭은 그대로, 상세 패널이 열린다', async () => {
  const f = fake()
  const w = await start(f)
  await w.find(`tr[data-key="${selectionKey.server(api)}"] td button`).trigger('click')
  await flushPromises()
  expect(pressedTab(w)).toBe('workspaces')
  expect(document.body.textContent).toContain('node.exe · PID 2')
  expect(w.find(`tr[data-key="${selectionKey.server(api)}"]`).attributes('data-selected')).toBe(
    'true'
  )
  // 동작 칸의 자세히도 같다.
  await w
    .find(`tr[data-key="${selectionKey.agent(agent)}"] [data-action="details"]`)
    .trigger('click')
  await flushPromises()
  expect(pressedTab(w)).toBe('workspaces')
  expect(document.body.textContent).toContain('Claude Code · PID 5000')
  w.unmount()
})

test('머리의 정리는 그 작업 공간 루트로 cleanupWorkspace 를 부른다', async () => {
  const f = fake()
  const w = await start(f)
  // 작업 공간을 모르는 줄에는 정리·폴더 열기가 없다.
  expect(w.find('tr[data-group="ws:?"] [data-action]').exists()).toBe(false)
  await w.find('tr[data-group="ws:c:\\\\work\\\\ws"] [data-action="cleanup"]').trigger('click')
  await flushPromises()
  expect(f.api.cleanupWorkspace).toHaveBeenCalledWith('C:\\work\\ws')
  expect(notice(w)).toContain('2개를 껐어요.')
  await w.find('tr[data-group="ws:c:\\\\work\\\\ws"] [data-action="folder"]').trigger('click')
  await flushPromises()
  expect(f.api.quick).toHaveBeenCalledWith('folder', 'C:\\work\\ws')
  w.unmount()
})

test('작업 공간 탭의 검색: 맞는 구성원이 있는 작업 공간만, 개수도 작업 공간으로 센다', async () => {
  const w = await start(fake())
  await w.find('input[placeholder^="이름"]').setValue(':8081')
  expect(w.findAll('tbody tr[data-group]').map((tr) => tr.attributes('data-group'))).toEqual([
    'ws:c:\\work\\ws'
  ])
  expect(w.findAll('tbody tr[data-key]').map((tr) => tr.attributes('data-key'))).toEqual([
    selectionKey.server(api)
  ])
  expect(w.text()).toContain('2개 중 1개')
  expect(w.find('footer').text()).toContain('작업 공간 1개')
  w.unmount()
})

test('서버를 끄면 그 서버(맨 위 pid)를 끄고, 실패하면 결과 알림이 제목줄 아래에', async () => {
  const f = fake()
  const w = await start(f)
  await openTab(w, 'ports')
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

test('설정 > 알림에서 "알림을 누르면 그 에이전트의 창으로"를 끄고 저장한다', async () => {
  const f = fake()
  const w = await start(f)
  f.navigate({ page: 'settings' })
  await flushPromises()
  await w
    .findAll('button')
    .find((b) => b.text().trim() === '알림')!
    .trigger('click')
  const box = w.find('#notify-click-focus')
  expect(box.attributes('aria-checked')).toBe('true')
  expect(w.find('label[for="notify-click-focus"]').text()).toBe(
    '알림을 누르면 그 에이전트의 창으로'
  )
  expect(w.text()).toContain(
    '에이전트 알림을 누르면 그 에이전트가 떠 있는 터미널·에디터 창을 앞으로 가져와요. 창을 찾지 못하면 pitwall 을 열어요. 탭까지 고르지는 못해요.'
  )
  await box.trigger('click')
  await w.find('form').trigger('submit')
  await flushPromises()
  expect(f.saved.at(-1)?.notifyClickFocus).toBe(false)
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
  await openTab(w, 'ports')
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
  await openTab(w, 'ports')
  // 개발 서버 탭의 묶음 머리는 그대로(서버 수, 폴더 열기 없음).
  expect(w.find('tr[data-group] [data-action="folder"]').exists()).toBe(false)
  await w.find('tr[data-group] [data-action="cleanup"]').trigger('click')
  await flushPromises()
  expect(f.api.cleanupWorkspace).toHaveBeenCalledWith('C:\\work\\ws')
  expect(notice(w)).toContain('2개를 껐어요.')
  w.unmount()
})

test('작업 공간 이름을 바꾸면 별칭으로 저장하고 다시 수집한다', async () => {
  const f = fake()
  const w = await start(f)
  await openTab(w, 'ports')
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
  await openTab(w, 'ports')
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
  await openTab(w, 'ports')
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
  await openTab(w, 'ports')
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

test('상세 패널의 창으로 가기: 그 에이전트의 키로 부르고, 찾지 못하면 한 줄로 알린다', async () => {
  const f = fake()
  const w = await start(f)
  f.navigate({ page: 'dashboard', key: selectionKey.agent(agent) })
  await flushPromises()
  const button = (): HTMLElement =>
    document.body.querySelector<HTMLElement>('[data-action="focus"]')!
  button().click()
  await flushPromises()
  expect(f.api.focusAgent).toHaveBeenCalledWith(selectionKey.agent(agent))
  expect(notice(w)).toBe('')
  vi.mocked(f.api.focusAgent).mockResolvedValueOnce(false)
  button().click()
  await flushPromises()
  expect(notice(w)).toContain('그 에이전트의 창을 찾지 못했어요.')
  w.unmount()
})

test('상세 패널에서 고른 포트를 연다', async () => {
  const multi = serverRow({ pid: 9, ports: [6176, 8081], workspace: null })
  const f = fake({ getLatest: async () => snapshot({ servers: [multi] }) })
  const w = await start(f)
  await openTab(w, 'ports')
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

// ── 자리 비운 사이(G3g) ──
function setVisibility(state: 'hidden' | 'visible'): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('자리 비운 사이', () => {
  const T0 = new Date(2026, 10, 10, 15, 0).getTime()
  const done = (id: number, t: number): PitEvent => ({
    id,
    t,
    kind: 'agent-done',
    tool: 'claude',
    ms: 60_000
  })

  afterEach(() => {
    vi.useRealTimers()
    setVisibility('visible')
  })

  test('10분 넘게 숨겼다가 다시 보면 자리 비운 사이 카드, 기록 보기로 기록 탭', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T0)
    const events = [done(1, T0 + 5 * 60_000), done(2, T0 + 20 * 60_000)]
    const f = fake({ events: { get: async () => events, onAdded: () => () => {} } })
    const w = await start(f)
    setVisibility('hidden')
    vi.setSystemTime(T0 + 30 * 60_000)
    setVisibility('visible')
    await flushPromises()
    const card = w.find('[data-away]')
    expect(card.exists()).toBe(true)
    expect(card.text()).toContain('자리 비운 사이')
    expect(card.text()).toContain('30분 동안: 작업 끝남 2')
    await card
      .findAll('button')
      .find((b) => b.text() === '기록 보기')!
      .trigger('click')
    const pressed = w.find('[data-slot="toggle-group-item"][aria-pressed="true"]')
    expect(pressed.text()).toContain('기록')
    expect(w.findAll('tbody tr').length).toBe(2)
    expect(w.find('[data-away]').exists()).toBe(false)
    w.unmount()
  })

  test('닫을 수 있고, 다시 숨기면 사라진다', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T0)
    const events = [done(1, T0 + 5 * 60_000)]
    const f = fake({ events: { get: async () => events, onAdded: () => () => {} } })
    const w = await start(f)
    setVisibility('hidden')
    vi.setSystemTime(T0 + 15 * 60_000)
    setVisibility('visible')
    await flushPromises()
    expect(w.find('[data-away]').exists()).toBe(true)
    await w.find('[data-away] [aria-label="닫기"]').trigger('click')
    expect(w.find('[data-away]').exists()).toBe(false)
    setVisibility('hidden')
    setVisibility('visible')
    await flushPromises()
    expect(w.find('[data-away]').exists()).toBe(false)
    w.unmount()
  })

  test('10분이 안 됐으면 카드가 없다', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T0)
    const events = [done(1, T0 + 2 * 60_000)]
    const f = fake({ events: { get: async () => events, onAdded: () => () => {} } })
    const w = await start(f)
    setVisibility('hidden')
    vi.setSystemTime(T0 + 9 * 60_000)
    setVisibility('visible')
    await flushPromises()
    expect(w.find('[data-away]').exists()).toBe(false)
    w.unmount()
  })

  test('새 기록은 기록 탭에 바로 더해진다', async () => {
    let push: (e: PitEvent[]) => void = () => {}
    const f = fake({
      events: {
        get: async () => [],
        onAdded: (cb: (e: PitEvent[]) => void) => ((push = cb), () => {})
      }
    })
    const w = await start(f)
    const tab = w
      .findAll('[data-slot="toggle-group-item"]')
      .find((b) => b.text().startsWith('기록'))!
    expect(tab.text()).toContain('0')
    push([done(1, T0)])
    await flushPromises()
    expect(tab.text()).toContain('1')
    w.unmount()
  })
})
