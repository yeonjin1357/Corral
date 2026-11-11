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
import { TOP_HEIGHTS } from './layoutState'
import { fakeResizeObserver, setBoxHeights } from './testing/resizeObserver'
import {
  MB,
  agentRow,
  diskRow,
  otherPort,
  serverRow,
  snapshot,
  workspaceRow
} from './testing/fixtures'

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
    historyGroups: async () => [],
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
    // 창과 함께 막 시작한 앱.
    appInfo: async () => ({ version: '0.1.0', startedAt: Date.now() }),
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

test('설정 > 알림에서 조용함·꺼짐 알림을 끄고 응답 대기 다시 알림(분)을 바꿔 저장한다', async () => {
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
  expect(w.text()).toContain('작업 중이거나 응답을 기다리던 에이전트가 꺼지면 알려요.')
  expect(w.text()).toContain(
    '응답 대기가 이 시간 넘게 이어지면 다시 알려요. 0 이면 다시 알리지 않아요.'
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
    '에이전트 알림을 누르면 그 에이전트가 떠 있는 터미널·에디터 창을 앞으로 가져와요. 창을 찾지 못하면 Corral 을 열어요. 탭까지 고르지는 못해요.'
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

test('설정 > 에이전트 연동에서 "토큰 사용량 보기"를 끄고 저장한다', async () => {
  const f = fake()
  const w = await start(f)
  f.navigate({ page: 'settings' })
  await flushPromises()
  await w
    .findAll('button')
    .find((b) => b.text().includes('에이전트 연동'))!
    .trigger('click')
  const box = w.find('#read-usage')
  expect(box.attributes('aria-checked')).toBe('true')
  expect(w.text()).toContain('토큰 사용량 보기')
  expect(w.text()).toContain(
    '세션 기록 파일에서 토큰 숫자만 읽어요. 대화 내용은 남기지 않아요. Claude 의 사용 한도는 보여 주지 않아요(상태 줄 설정을 건드려야 해서요).'
  )
  await box.trigger('click')
  await w.find('form').trigger('submit')
  await flushPromises()
  expect(f.saved.at(-1)?.readUsage).toBe(false)
  w.unmount()
})

test('설정 > 무거운 작업에서 "겹치면 에이전트가 기다리게 하기"를 켜고 저장한다(메인이 되돌리면 체크도 되돌린다)', async () => {
  const saved: Settings[] = []
  // 메인은 Claude 연동이 켜져 있으면 확인 창을 띄우고, 취소하면 이전 값으로 저장해 돌려준다.
  let cancel = true
  const f = fake({
    settings: {
      get: async () => structuredClone(DEFAULT_SETTINGS),
      save: vi.fn(async (next: Settings) => {
        saved.push(next)
        return { ...structuredClone(next), heavyGuard: cancel ? false : next.heavyGuard }
      }),
      pickFolder: async () => null,
      onChange: () => () => {}
    }
  } as Partial<PitwallApi>)
  const w = await start(f)
  f.navigate({ page: 'settings' })
  await flushPromises()
  await w
    .findAll('button')
    .find((b) => b.text().trim() === '무거운 작업')!
    .trigger('click')
  const box = (): ReturnType<VueWrapper['find']> => w.find('#heavy-guard')
  expect(box().attributes('aria-checked')).toBe('false')
  expect(w.find('label[for="heavy-guard"]').text()).toBe(
    '겹치면 에이전트가 기다리게 하기(Claude Code)'
  )
  expect(w.text()).toContain(
    '켜면 Claude 가 Bash·PowerShell 명령을 실행하기 전에 Corral 에 물어봐요. 무거운 작업이 이미 돌고 있고 메모리가 경고 기준을 넘었을 때만, 같은 명령을 두 번까지 1분 뒤로 미루게 해요. Claude 설정 파일에 훅을 하나 더 넣어요(확인 창·백업). Corral 이 꺼져 있으면 아무 일도 없어요.'
  )
  // 위의 무거운 명령 도움말은 알리기만 한다고 말하고 아래 항목을 가리킨다.
  expect(w.text()).toContain(
    '한 줄에 하나씩. 명령 이름(예: vue-tsc)이나 이름과 인자(예: vite build). 둘 이상 겹치고 RAM 이 경고 기준 이상이면 알려요. 알리기만 해요 — 에이전트를 기다리게 하려면 아래 항목을 켜세요.'
  )
  expect(w.text()).not.toContain('막거나 기다리게 하지는 않아요')
  const notice = (): string => w.find('.save-notice').text()

  await box().trigger('click')
  await w.find('form').trigger('submit')
  await flushPromises()
  expect(saved.at(-1)?.heavyGuard).toBe(true)
  // 확인 창에서 취소해 메인이 되돌린 값이 화면에도 보인다(저장하지 않은 변경으로 남지 않는다).
  expect(box().attributes('aria-checked')).toBe('false')
  expect(w.find('[data-action="save"]').attributes('disabled')).toBeDefined()
  // "저장했어요" 대신 켜지 않았다고 알린다.
  expect(notice()).toBe('에이전트 기다리게 하기는 켜지 않았어요(훅 설치를 취소했거나 실패했어요).')

  cancel = false
  await box().trigger('click')
  await w.find('form').trigger('submit')
  await flushPromises()
  expect(saved.at(-1)?.heavyGuard).toBe(true)
  expect(box().attributes('aria-checked')).toBe('true')
  expect(notice()).toBe('저장했어요.')
  w.unmount()
})

test('설정 > 무거운 작업: 기다리게 하기를 켰는데 Claude 연동이 켜져 있지 않으면 지금은 동작하지 않는다고 알린다', async () => {
  const hint =
    'Claude 연동이 꺼져 있어 지금은 동작하지 않아요. Claude 연동을 켜면 질문 훅도 함께 설치돼요.'
  for (const state of ['off', 'partial', 'on'] as const) {
    const f = fake({
      getLatest: async () =>
        snapshot({
          hook: {
            state,
            problem: null,
            allHooksDisabled: false,
            settingsPath: 'C:\\Users\\dev\\.claude\\settings.json'
          }
        })
    })
    const w = await start(f)
    f.navigate({ page: 'settings' })
    await flushPromises()
    await w
      .findAll('button')
      .find((b) => b.text().trim() === '무거운 작업')!
      .trigger('click')
    expect(w.text()).not.toContain(hint)
    await w.find('#heavy-guard').trigger('click')
    expect({ state, shown: w.text().includes(hint) }).toEqual({ state, shown: state !== 'on' })
    w.unmount()
  }
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

test('검색해도 메모리 막대 길이는 그대로', async () => {
  const w = await start(fake())
  const search = (q: string): Promise<void> => w.find('input[placeholder^="이름"]').setValue(q)
  const bar = (tr: string): string | undefined => w.find(`${tr} td.memory-bar`).attributes('style')
  const apiRow = `tr[data-key="${selectionKey.server(api)}"]`
  // 작업 공간 탭: 사용 중 RAM 대비.
  const wsHead = bar('tr[data-group="ws:c:\\\\work\\\\ws"]')
  const wsApi = bar(apiRow)
  expect(wsHead).toContain('--memory-share: 4.5%')
  expect(wsApi).toContain('--memory-share: 3.3%')
  await search(':8081')
  expect(bar('tr[data-group="ws:c:\\\\work\\\\ws"]')).toBe(wsHead)
  expect(bar(apiRow)).toBe(wsApi)
  await search('')
  // 개발 서버 탭(묶음 보기): 표 줄 합(300 + 900 + 100 MB) 대비, 머리는 작업 공간(1200 MB).
  await openTab(w, 'ports')
  expect(bar('tr[data-group]')).toContain('--memory-share: 92.3%')
  expect(bar(apiRow)).toContain('--memory-share: 69.2%')
  await search(':8081')
  expect(bar('tr[data-group]')).toContain('--memory-share: 92.3%')
  expect(bar(apiRow)).toContain('--memory-share: 69.2%')
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

test('메모리 지도에서 서버를 누르면 메모리 상세를 닫고 그 서버의 상세 패널', async () => {
  // happy-dom 은 배치를 하지 않아 너비가 0 이다. 지도를 그리도록 너비를 준다.
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => 600
  })
  try {
    const w = await start(fake())
    await w.find('[aria-label="메모리 자세히 보기"]').trigger('click')
    await flushPromises()
    const tile = document.body.querySelector<HTMLElement>(
      `button[data-map-tile="${selectionKey.server(api)}"]`
    )!
    tile.click()
    await flushPromises()
    expect(document.body.querySelector('[data-memory-map]')).toBeNull()
    expect(pressedTab(w)).toBe('ports')
    expect(document.body.textContent).toContain('node.exe · PID 2')
    expect(w.find(`tr[data-key="${selectionKey.server(api)}"]`).attributes('data-selected')).toBe(
      'true'
    )
    w.unmount()
  } finally {
    if (original) Object.defineProperty(HTMLElement.prototype, 'clientWidth', original)
  }
})

test('묶음 기록을 받지 못해도(예전 메인·실패) 화면은 그대로', async () => {
  // 이 IPC 가 없는 메인(예전 preload): 부르지 않고 스냅샷으로 쌓은 기록만 쓴다.
  const w = await start(
    fake({ historyGroups: undefined as unknown as PitwallApi['historyGroups'] })
  )
  await w.find('[aria-label="메모리 자세히 보기"]').trigger('click')
  await flushPromises()
  expect(document.body.querySelector('[data-memory-map]')).not.toBeNull()
  expect(w.findComponent(MemorySheet).props('groupHistory')).toHaveLength(1)
  w.unmount()
  // 거절(메인 오류): 기록은 스냅샷으로 그대로 쌓인다.
  const failed = await start(fake({ historyGroups: async () => Promise.reject(new Error('x')) }))
  await failed.find('[aria-label="메모리 자세히 보기"]').trigger('click')
  await flushPromises()
  expect(document.body.querySelector('[data-memory-map]')).not.toBeNull()
  expect(failed.findComponent(MemorySheet).props('groupHistory')).toHaveLength(1)
  failed.unmount()
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

test('찾는 포트가 개발 서버에 없고 다른 포트에 있으면 다른 포트에서 찾기를 권한다', async () => {
  const chrome = otherPort({ port: 9229, pid: 4410, processName: 'chrome.exe' })
  const w = await start(
    fake({ getLatest: async () => ({ ...snap(), otherPorts: [otherPort(), chrome] }) })
  )
  await openTab(w, 'ports')
  const search = w.find('input[placeholder^="이름"]')
  const findOther = (): ReturnType<VueWrapper['find']> => w.find('[data-action="find-other"]')
  // 개발 서버에 있는 포트, 어디에도 없는 포트, 포트 번호가 아닌 검색어에는 권하지 않는다.
  for (const q of ['3000', ':9999', 'postgres']) {
    await search.setValue(q)
    expect(findOther().exists(), q).toBe(false)
  }
  await search.setValue(' :5432 ')
  expect(w.find('tbody').text()).toContain('찾는 항목이 없어요')
  expect(findOther().text()).toBe('다른 포트에서 찾기')
  await findOther().trigger('click')
  // 검색어를 둔 채 다른 포트 보기로: 고를 수 없는 줄, 동작 칸 없음.
  expect((search.element as HTMLInputElement).value).toBe(' :5432 ')
  const rows = w.findAll('tbody tr')
  expect(rows).toHaveLength(1)
  expect(rows[0].text()).toContain(':5432')
  expect(rows[0].text()).toContain('postgres.exe')
  expect(rows[0].attributes('data-key')).toBeUndefined()
  expect(w.find('.actions-heading').exists()).toBe(false)
  expect(w.find('[data-action="toggle-other"]').text()).toBe('다른 포트 닫기')
  expect(w.find('footer').text()).toContain('다른 포트 1개')
  w.unmount()
})

test('다른 포트 보기는 숨긴 서버 보기와 하나만 켜지고, 탭을 바꾸면 풀린다', async () => {
  const hidden = serverRow({ pid: 7, ports: [2375], processName: 'docker.exe' })
  const w = await start(
    fake({
      getLatest: async () => ({ ...snap(), hiddenServers: [hidden], otherPorts: [otherPort()] })
    })
  )
  await openTab(w, 'ports')
  const other = (): ReturnType<VueWrapper['find']> => w.find('[data-action="toggle-other"]')
  const hiddenToggle = (): ReturnType<VueWrapper['find']> => w.find('[data-action="toggle-hidden"]')
  const body = (): string => w.find('tbody').text()
  expect(other().text()).toBe('다른 포트 1개')
  await other().trigger('click')
  expect(body()).toContain('postgres.exe')
  // 묶음 보기여도 다른 포트는 평평한 표다.
  expect(w.find('tr[data-group]').exists()).toBe(false)
  await hiddenToggle().trigger('click')
  expect(hiddenToggle().text()).toBe('숨긴 서버 닫기')
  expect(other().text()).toBe('다른 포트 1개')
  expect(body()).toContain(':2375')
  expect(body()).not.toContain('postgres.exe')
  await other().trigger('click')
  expect(hiddenToggle().text()).toBe('숨김 1개')
  expect(body()).toContain('postgres.exe')
  await openTab(w, 'agents')
  await openTab(w, 'ports')
  expect(other().text()).toBe('다른 포트 1개')
  expect(body()).not.toContain('postgres.exe')
  w.unmount()
})

test('에이전트 탭: 연동은 켜고 끄는 버튼 대신 두 도구의 상태와 연동 설정으로 가는 버튼', async () => {
  const w = await start(
    fake({
      getLatest: async () => ({
        ...snap(),
        hook: { state: 'on', problem: null, allHooksDisabled: false, settingsPath: '' },
        codexHook: { state: 'off', problem: null, path: '' }
      })
    })
  )
  await openTab(w, 'agents')
  const bar = w.find('.toolbar')
  expect(bar.text()).not.toContain('Claude 연동 끄기')
  const go = bar.find('[data-action="integration-settings"]')
  expect(go.text()).toBe('연동 설정')
  expect(
    go.findAll('[data-integration-dot]').map((d) => d.attributes('data-integration-dot'))
  ).toEqual(['on', 'off'])
  // 다른 탭에는 없다.
  await openTab(w, 'ports')
  expect(w.find('[data-action="integration-settings"]').exists()).toBe(false)
  await openTab(w, 'agents')
  await w.find('[data-action="integration-settings"]').trigger('click')
  await flushPromises()
  expect(w.findAll('h1').map((h) => h.text())).toContain('에이전트 연동')
  // 설정의 두 연동 카드 제목에 도구 로고.
  for (const tool of ['claude', 'codex'])
    expect(w.find(`[data-integration-title="${tool}"] img`).exists()).toBe(true)
  w.unmount()
})

test('다른 포트 보기에서 검색하면 전체 수는 다른 포트 수', async () => {
  // 개발 서버 3개, 다른 포트 5개(postgres 하나, 디버깅 브라우저 넷).
  const chrome = [9222, 9223, 9224, 9225].map((port, i) =>
    otherPort({ port, pid: 4400 + i, processName: 'chrome.exe' })
  )
  const w = await start(
    fake({ getLatest: async () => ({ ...snap(), otherPorts: [otherPort(), ...chrome] }) })
  )
  await openTab(w, 'ports')
  await w.find('[data-action="toggle-other"]').trigger('click')
  await w.find('input[placeholder^="이름"]').setValue('chrome')
  expect(w.find('.toolbar').text()).toContain('5개 중 4개')
  // 탭 숫자는 그대로 개발 서버 수.
  expect(w.find('[data-slot="toggle-group-item"][data-value="ports"]').text()).toBe('개발 서버 3')
  w.unmount()
})

test('숨긴 서버 보기에서 검색하면 전체 수는 숨긴 서버 수', async () => {
  const hidden = [2375, 2376].map((port, i) =>
    serverRow({ pid: 70 + i, ports: [port], processName: 'docker.exe' })
  )
  const w = await start(fake({ getLatest: async () => ({ ...snap(), hiddenServers: hidden }) }))
  await openTab(w, 'ports')
  await w.find('[data-action="toggle-hidden"]').trigger('click')
  await w.find('input[placeholder^="이름"]').setValue(':2375')
  expect(w.find('.toolbar').text()).toContain('2개 중 1개')
  expect(w.find('[data-slot="toggle-group-item"][data-value="ports"]').text()).toBe('개발 서버 3')
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

// ── 카드 영역 세 단계(G2) ──
/** 표의 줄(작업 공간 탭의 묶음 머리). */
const groupRows = (w: VueWrapper): string[] =>
  w.findAll('tbody tr[data-group]').map((tr) => tr.attributes('data-group')!)

test('접기를 고르면 카드가 없고 다시 켜도 기억한다', async () => {
  const w = await start(fake())
  // 처음은 자세히.
  expect(w.findAll('.resource-grid [data-slot=card]')).toHaveLength(6)
  expect(w.find('[data-mode="full"]').attributes('aria-pressed')).toBe('true')
  await w.find('[data-mode="collapsed"]').trigger('click')
  // 카드는 없고 손잡이 줄과 표는 남는다.
  expect(w.find('.resource-grid').exists()).toBe(false)
  expect(w.find('[role="separator"]').exists()).toBe(true)
  expect(groupRows(w)).toEqual(['ws:c:\\work\\ws', 'ws:?'])
  w.unmount()
  // 다시 켠다(저장소는 그대로).
  window.pitwall = fake().api
  const again = mount(App, { attachTo: document.body })
  await flushPromises()
  expect(again.find('.resource-grid').exists()).toBe(false)
  expect(again.find('[data-mode="collapsed"]').attributes('aria-pressed')).toBe('true')
  // 손잡이를 더블클릭하면 자세히로 돌아오고, 그것도 기억한다.
  await again.find('[role="separator"]').trigger('dblclick')
  expect(again.findAll('.resource-grid [data-slot=card]')).toHaveLength(6)
  expect(localStorage.getItem('pitwall.topMode')).toBe('full')
  again.unmount()
})

test('간단히에서도 표가 보인다', async () => {
  const w = await start(fake())
  await w.find('[data-mode="compact"]').trigger('click')
  // 카드는 여섯 장 그대로, 낮은 한 줄 모양.
  const cards = w.findAll('.resource-grid [data-slot=card]')
  expect(cards).toHaveLength(6)
  for (const c of cards) expect(c.find('[data-compact-value]').exists()).toBe(true)
  // 낮은 창에서 화면 전체를 스크롤하는 규칙은 자세히에만 걸린다(표가 아래로 밀려나지 않게).
  expect(w.find('main').attributes('data-top-mode')).toBe('compact')
  expect(w.find('.table-section').exists()).toBe(true)
  expect(groupRows(w)).toEqual(['ws:c:\\work\\ws', 'ws:?'])
  // 간단히 카드를 눌러도 자세히의 ↗ 처럼 그 탭으로 간다.
  await cards[1].find('button').trigger('click')
  expect(pressedTab(w)).toBe('ports')
  expect(localStorage.getItem('pitwall.topMode')).toBe('compact')
  w.unmount()
})

test('손잡이를 끄는 동안 카드 영역이 그 높이를 따르고 놓으면 단계에 붙는다', async () => {
  const w = await start(fake())
  const handle = w.find('[role="separator"]')
  const area = (): HTMLElement => w.find('.resource-grid').element.parentElement!
  await handle.trigger('pointerdown', { clientY: 500, button: 0, pointerId: 1 })
  await handle.trigger('pointermove', { clientY: 380, pointerId: 1 })
  // 끄는 동안: 그 높이로 잘라 보이고, 놓으면 붙을 단계(간단히) 모양으로 미리 보인다.
  expect(area().style.height).toBe(`${TOP_HEIGHTS.full - 120}px`)
  expect(w.find('.resource-grid [data-compact-value]').exists()).toBe(true)
  await handle.trigger('pointerup', { clientY: 380, pointerId: 1 })
  expect(area().style.height).toBe('')
  expect(w.find('[data-mode="compact"]').attributes('aria-pressed')).toBe('true')
  w.unmount()
})

test('끄는 중에 단축키로 설정에 갔다 돌아와도 카드 영역이 그 높이로 잘려 있지 않다', async () => {
  const f = fake()
  const w = await start(f)
  const handle = w.find('[role="separator"]')
  await handle.trigger('pointerdown', { clientY: 500, button: 0, pointerId: 1 })
  await handle.trigger('pointermove', { clientY: 380, pointerId: 1 })
  expect(w.find('.resource-grid').element.parentElement!.style.height).toBe(
    `${TOP_HEIGHTS.full - 120}px`
  )
  // 손을 떼기 전에 Ctrl+, 로 설정에 간다(손잡이가 사라진다).
  window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', ctrlKey: true }))
  await flushPromises()
  expect(w.find('[role="separator"]').exists()).toBe(false)
  f.navigate({ page: 'dashboard', key: null })
  await flushPromises()
  // 돌아오면 고른 단계(자세히)의 제 높이 그대로.
  const area = w.find('.resource-grid').element.parentElement!
  expect(area.style.height).toBe('')
  expect(area.classList.contains('overflow-hidden')).toBe(false)
  expect(w.find('.resource-grid [data-compact-value]').exists()).toBe(false)
  expect(w.find('[data-mode="full"]').attributes('aria-pressed')).toBe('true')
  w.unmount()
})

test('카드 줄에 가로 스크롤바가 생기면 끄는 높이·붙는 높이에 그만큼 더한다', async () => {
  const resize = fakeResizeObserver()
  try {
    const w = await start(fake())
    const handle = w.find('[role="separator"]')
    expect(handle.attributes('aria-valuemax')).toBe(String(TOP_HEIGHTS.full))
    // 카드가 넘쳐 카드 줄에 6px 스크롤바가 생긴다.
    const grid = w.find('.resource-grid').element
    setBoxHeights(grid, TOP_HEIGHTS.full + 6, TOP_HEIGHTS.full)
    resize.watches.find((x) => x.el === grid)!.fire()
    await flushPromises()
    expect(handle.attributes('aria-valuemax')).toBe(String(TOP_HEIGHTS.full + 6))
    expect(handle.attributes('aria-valuenow')).toBe(String(TOP_HEIGHTS.full + 6))
    // 끌기는 늘어난 높이에서 시작한다(위로 6px 끌면 스크롤바를 뺀 자세히 높이).
    await handle.trigger('pointerdown', { clientY: 500, button: 0, pointerId: 1 })
    await handle.trigger('pointermove', { clientY: 494, pointerId: 1 })
    const area = grid.parentElement!
    expect(area.style.height).toBe(`${TOP_HEIGHTS.full}px`)
    await handle.trigger('pointerup', { clientY: 494, pointerId: 1 })
    expect(w.find('[data-mode="full"]').attributes('aria-pressed')).toBe('true')
    w.unmount()
  } finally {
    resize.restore()
  }
})

test('접었다가 자세히로 돌아오면 새 카드 줄을 다시 지켜봐 손잡이 최대 높이가 따라간다', async () => {
  const resize = fakeResizeObserver()
  try {
    const w = await start(fake())
    const handle = w.find('[role="separator"]')
    const grid = w.find('.resource-grid').element
    const oldWatch = resize.watches.find((x) => x.el === grid)!
    await w.find('[data-mode="collapsed"]').trigger('click')
    // 접으면 카드 줄이 없어지고 그 관찰자도 끊긴다.
    expect(w.find('.resource-grid').exists()).toBe(false)
    expect(oldWatch.disconnected()).toBe(true)
    await w.find('[data-mode="full"]').trigger('click')
    await flushPromises()
    const again = w.find('.resource-grid').element
    expect(again).not.toBe(grid)
    // 새 카드 줄에 8px 스크롤바가 생기면 손잡이의 최대 높이가 그만큼 는다.
    setBoxHeights(again, TOP_HEIGHTS.full + 8, TOP_HEIGHTS.full)
    resize.watches.find((x) => x.el === again)!.fire()
    await flushPromises()
    expect(handle.attributes('aria-valuemax')).toBe(String(TOP_HEIGHTS.full + 8))
    w.unmount()
  } finally {
    resize.restore()
  }
})

// ── 카드 고르기(G3) ──
/** 카드 줄의 칸 이름(data-card) 순서. */
const cardIds = (w: VueWrapper): string[] =>
  w.findAll('.resource-grid [data-card]').map((c) => c.attributes('data-card')!)

test('카드 배치를 바꾸면 다시 켜도 기억한다', async () => {
  const w = await start(fake())
  expect(cardIds(w)).toEqual(['memory', 'servers', 'agents', 'heavy', 'leftovers', 'disk'])
  await w.find('[data-action="cards-edit"]').trigger('click')
  // 새 카드를 더하고, 메모리를 숨기고, 디스크 정리를 앞으로.
  await w.find('[data-add-card="waiting"]').trigger('click')
  await w.find('[data-card="memory"] [data-card-action="hide"]').trigger('click')
  await w.find('[data-card="disk"] [data-card-action="left"]').trigger('click')
  // 편집 중에는 숨긴 카드도 보인다. 더한 카드는 더할 목록에서 빠진다.
  expect(cardIds(w)).toEqual([
    'memory',
    'servers',
    'agents',
    'heavy',
    'disk',
    'leftovers',
    'waiting'
  ])
  expect(w.find('[data-add-card="waiting"]').exists()).toBe(false)
  // 편집을 끝내면 숨긴 카드는 없고, 배치는 저장돼 있다.
  await w.find('[data-action="cards-edit"]').trigger('click')
  expect(w.find('[data-card-action]').exists()).toBe(false)
  expect(cardIds(w)).toEqual(['servers', 'agents', 'heavy', 'disk', 'leftovers', 'waiting'])
  expect(JSON.parse(localStorage.getItem('pitwall.cards')!)).toEqual({
    order: ['memory', 'servers', 'agents', 'heavy', 'disk', 'leftovers', 'waiting'],
    hidden: ['memory']
  })
  w.unmount()
  // 다시 켠다(저장소는 그대로).
  window.pitwall = fake().api
  const again = mount(App, { attachTo: document.body })
  await flushPromises()
  expect(cardIds(again)).toEqual(['servers', 'agents', 'heavy', 'disk', 'leftovers', 'waiting'])
  // 기본값으로 돌리면 기본 여섯 장, 그것도 기억한다.
  await again.find('[data-action="cards-edit"]').trigger('click')
  await again.find('[data-action="cards-reset"]').trigger('click')
  await again.find('[data-action="cards-edit"]').trigger('click')
  expect(cardIds(again)).toEqual(['memory', 'servers', 'agents', 'heavy', 'leftovers', 'disk'])
  expect(JSON.parse(localStorage.getItem('pitwall.cards')!)).toEqual({
    order: ['memory', 'servers', 'agents', 'heavy', 'leftovers', 'disk'],
    hidden: []
  })
  again.unmount()
})

test('접기에서 카드 편집을 누르면 자세히로 바뀐다', async () => {
  const waiting = agentRow({ pid: 6000, state: 'waiting', stateSince: 1 })
  const w = await start(fake({ getLatest: async () => ({ ...snap(), agents: [agent, waiting] }) }))
  await w.find('[data-mode="collapsed"]').trigger('click')
  expect(w.find('.resource-grid').exists()).toBe(false)
  await w.find('[data-action="cards-edit"]').trigger('click')
  // 자세히로 돌아와 카드가 편집 모양으로 보이고, 편집 막대가 단계 버튼 자리에.
  expect(w.find('main').attributes('data-top-mode')).toBe('full')
  expect(w.findAll('.resource-grid [data-card] [inert]')).toHaveLength(6)
  expect(w.find('[data-mode]').exists()).toBe(false)
  expect(localStorage.getItem('pitwall.topMode')).toBe('full')
  await w.find('[data-add-card="waiting"]').trigger('click')
  // 간단히에서도 편집할 수 있다.
  await w.find('[data-action="cards-edit"]').trigger('click')
  await w.find('[data-mode="compact"]').trigger('click')
  await w.find('[data-action="cards-edit"]').trigger('click')
  expect(w.find('main').attributes('data-top-mode')).toBe('compact')
  expect(w.find('[data-card="waiting"] [data-card-action="remove"]').exists()).toBe(true)
  // 손잡이를 더블클릭해 접으면 편집도 끝난다.
  await w.find('[role="separator"]').trigger('dblclick')
  expect(w.find('.resource-grid').exists()).toBe(false)
  expect(w.findAll('[data-mode]')).toHaveLength(3)
  expect(w.find('[data-action="cards-edit"]').text()).toBe('카드 편집')
  // 자세히로 돌아와 응답 대기 카드의 줄을 누르면 그 에이전트의 상세 패널.
  await w.find('[data-mode="full"]').trigger('click')
  await w.find('[data-card="waiting"] [data-waiting] button').trigger('click')
  await flushPromises()
  expect(pressedTab(w)).toBe('agents')
  expect(document.body.textContent).toContain('Claude Code · PID 6000')
  expect(w.find(`tr[data-key="${selectionKey.agent(waiting)}"]`).attributes('data-selected')).toBe(
    'true'
  )
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

  test('트레이로만 시작한 뒤 창을 처음 열면 앱이 시작된 때부터 요약한다', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T0 + 40 * 60_000)
    const events = [done(1, T0 + 5 * 60_000), done(2, T0 + 20 * 60_000)]
    const opened = (startedAt: number): Fake =>
      fake({
        appInfo: async () => ({ version: '0.1.0', startedAt }),
        events: { get: async () => events, onAdded: () => () => {} }
      })
    const w = await start(opened(T0))
    expect(w.find('[data-away]').exists()).toBe(true)
    expect(w.find('[data-away]').text()).toContain('40분 동안: 작업 끝남 2')
    w.unmount()

    // 처음 불러올 때 숨김이던 창이 나중에 보여도 마찬가지다.
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    const late = await start(opened(T0))
    expect(late.find('[data-away]').exists()).toBe(false)
    setVisibility('visible')
    await flushPromises()
    expect(late.find('[data-away]').text()).toContain('40분 동안: 작업 끝남 2')
    late.unmount()

    // 앱과 함께 창이 열렸으면(시작한 지 10분이 안 됨) 카드가 없다.
    const fresh = await start(opened(T0 + 35 * 60_000))
    expect(fresh.find('[data-away]').exists()).toBe(false)
    fresh.unmount()
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
