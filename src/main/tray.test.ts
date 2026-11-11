import {
  BADGE_COLOR,
  buildTrayMenu,
  trayBadge,
  trayTooltip,
  LEVEL_COLORS,
  createTrayController,
  type TrayLike
} from './tray'
import type {
  AgentRow,
  DashboardSnapshot,
  HeavyJobRow,
  LeftoverRow,
  UpdateStatus
} from '../shared/types'
import { blankSnapshot } from '../shared/snapshot'

const GB = 1024 ** 3

function snap(over: Partial<DashboardSnapshot> = {}): DashboardSnapshot {
  return {
    ...blankSnapshot(1),
    memory: {
      totalBytes: 32 * GB,
      usedBytes: Math.round(26.3 * GB),
      usedPercent: 82.2,
      availableBytes: 32 * GB - Math.round(26.3 * GB),
      level: 'warn',
      ramLevel: 'warn',
      commit: null,
      kernelBytes: null
    },
    servers: [1, 2, 3].map((i) => ({
      ports: [3000 + i],
      pid: i,
      processName: 'node',
      commandLine: 'node',
      worktree: null,
      workspace: null,
      unresolvable: false,
      memoryBytes: 1,
      commitBytes: null,
      descendantPids: [],
      processes: [],
      clientCount: 0,
      startedAt: null,
      judgement: null,
      idleSince: null,
      agentInWorktree: false,
      parkedAgent: false,
      parkedSince: null,
      cpuPercent: null,
      memoryGrowth: null
    })),
    platform: 'win32',
    cpuCount: 8,
    ...over
  }
}

function agentRow(state: AgentRow['state'], quietSince: number | null = null): AgentRow {
  return {
    pid: 1,
    tool: 'claude',
    worktree: null,
    workspace: null,
    startedAt: 1,
    memoryBytes: 1,
    commitBytes: null,
    descendantCount: 0,
    processes: [],
    state,
    stateSource: 'hook',
    stateSince: null,
    cpuPercent: 0,
    lastActiveAt: null,
    parked: false,
    activity: null,
    quietSince,
    usage: null,
    waitReason: null,
    host: { pids: [], app: null }
  }
}

const actions = { open: vi.fn(), settings: vi.fn(), quit: vi.fn() }
const labels = (items: Electron.MenuItemConstructorOptions[]): (string | undefined)[] =>
  items.map((i) => (i.type === 'separator' ? '---' : i.label))

describe('buildTrayMenu', () => {
  test('메뉴 항목(퍼센트는 내림, 정보 줄은 비활성)', () => {
    const items = buildTrayMenu(snap(), actions)
    expect(labels(items)).toEqual([
      'RAM 82% (26.3 GB / 32.0 GB)',
      '개발 서버 3개',
      '에이전트 0개',
      '---',
      '앱 열기',
      '설정',
      '---',
      '종료'
    ])
    expect(items[0].enabled).toBe(false)
    expect(items[1].enabled).toBe(false)
    expect(items[2].enabled).toBe(false)
  })

  test('에이전트(권한 대기)·정리 후보·남은 프로세스 줄, 정리 후보 줄을 누르면 앱을 연다', () => {
    const agent = (state: AgentRow['state']): AgentRow => ({
      pid: 1,
      tool: 'claude',
      worktree: null,
      workspace: null,
      startedAt: 1,
      memoryBytes: 1,
      commitBytes: null,
      descendantCount: 0,
      processes: [],
      state,
      stateSource: 'hook',
      stateSince: null,
      cpuPercent: 0,
      lastActiveAt: null,
      parked: false,
      activity: null,
      quietSince: null,
      usage: null,
      waitReason: null,
      host: { pids: [], app: null }
    })
    const base = snap()
    const s = snap({
      agents: [agent('waiting'), agent('working')],
      servers: [{ ...base.servers[0], judgement: 'candidate' }, base.servers[1]],
      leftovers: [
        {
          pid: 9,
          processName: 'chrome.exe',
          label: 'Playwright 브라우저',
          commandLine: 'chrome',
          worktree: null,
          workspace: null,
          memoryBytes: 1,
          commitBytes: null,
          descendantPids: [],
          processes: [],
          startedAt: 1,
          agentInWorktree: false
        }
      ]
    })
    const items = buildTrayMenu(s, actions)
    expect(labels(items).slice(1, 5)).toEqual([
      '개발 서버 2개',
      '에이전트 2개 (응답 대기 1)',
      '정리 후보 1개',
      '남은 프로세스 1개'
    ])
    actions.open.mockClear()
    items[3].click!({} as never, undefined, {} as never)
    expect(actions.open).toHaveBeenCalledTimes(1)
  })

  test('스냅샷 전에는 확인 중, 포트 줄 없음', () => {
    expect(labels(buildTrayMenu(null, actions))).toEqual([
      'RAM 확인 중…',
      '---',
      '앱 열기',
      '설정',
      '---',
      '종료'
    ])
  })

  test('업데이트 지연과 수집 실패', () => {
    expect(buildTrayMenu(snap({ stale: true, error: 'timeout' }), actions)[0].label).toBe(
      'RAM 82% (26.3 GB / 32.0 GB) · 업데이트 지연'
    )
    const failed = snap({
      stale: true,
      error: 'x',
      servers: [],
      memory: blankSnapshot(1).memory
    })
    expect(labels(buildTrayMenu(failed, actions))[0]).toBe('RAM 정보를 가져오지 못했어요')
  })

  test('앱 열기·설정·종료는 각각의 동작을 부른다', () => {
    actions.open.mockClear()
    const items = buildTrayMenu(snap(), actions)
    items.find((i) => i.label === '앱 열기')!.click!({} as never, undefined, {} as never)
    items.find((i) => i.label === '설정')!.click!({} as never, undefined, {} as never)
    items.find((i) => i.label === '종료')!.click!({} as never, undefined, {} as never)
    expect(actions.open).toHaveBeenCalledTimes(1)
    expect(actions.settings).toHaveBeenCalledTimes(1)
    expect(actions.quit).toHaveBeenCalledTimes(1)
  })

  test('무거운 작업(겹치면 표시)·디스크 정리 가능 크기 줄, 디스크 줄을 누르면 앱을 연다', () => {
    const job = (pid: number): HeavyJobRow => ({
      pid,
      label: 'vue-tsc',
      processName: 'node.exe',
      commandLine: 'vue-tsc',
      worktree: null,
      workspace: null,
      memoryBytes: 1,
      commitBytes: null,
      descendantPids: [],
      processes: [],
      startedAt: 1
    })
    const one = labels(buildTrayMenu(snap({ heavyJobs: [job(1)] }), actions))
    expect(one).toContain('무거운 작업 1개')
    const overlap = buildTrayMenu(
      snap({ heavyJobs: [job(1), job(2)], heavyOverlap: true }),
      actions
    )
    expect(labels(overlap)).toContain('무거운 작업 2개 · 겹침(메모리 부족)')
    const disk = buildTrayMenu(
      snap({
        disk: {
          rows: [
            {
              worktreeRoot: 'C:\\work\\old',
              commonDir: 'C:\\work\\shop-web\\.git',
              branch: 'feat/old',
              evidence: 'upstreamGone',
              folders: [],
              totalBytes: 1.5 * GB,
              inUse: false
            }
          ],
          scannedAt: 1,
          scanning: false,
          error: null
        }
      }),
      actions
    )
    const line = disk.find((i) => i.label === '디스크 정리 가능 1.5 GB')!
    actions.open.mockClear()
    line.click!({} as never, undefined, {} as never)
    expect(actions.open).toHaveBeenCalledTimes(1)
  })
})

test('툴팁', () => {
  expect(trayTooltip(snap())).toBe('Corral — RAM 82%')
  expect(trayTooltip(null)).toBe('Corral')
  // 커밋이 더 높으면 그 압박을 말한다.
  const m = snap().memory
  expect(
    trayTooltip(
      snap({
        memory: {
          ...m,
          ramLevel: 'normal',
          level: 'danger',
          commit: { usedBytes: 91, limitBytes: 100, percent: 91.4, level: 'danger' }
        }
      })
    )
  ).toBe('Corral — 커밋 91%')
})

test('풍선말에 응답 대기 수', () => {
  expect(
    trayTooltip(snap({ agents: [agentRow('waiting'), agentRow('working'), agentRow('waiting')] }))
  ).toBe('Corral — RAM 82% · 응답 대기 2')
  // 조용한 에이전트는 점으로만 보이고 풍선말에는 세지 않는다.
  expect(trayTooltip(snap({ agents: [agentRow('working', 1)] }))).toBe('Corral — RAM 82%')
})

describe('아이콘', () => {
  test('상태 색은 화면과 같은 Catppuccin(정상 초록·경고 노랑·위험 분홍), 점은 주황', () => {
    expect(LEVEL_COLORS).toEqual({ normal: '#a6e3a1', warn: '#f9e2af', danger: '#f38ba8' })
    expect(BADGE_COLOR).toBe('#fab387')
  })

  test('권한 대기나 조용한 에이전트가 있으면 점', () => {
    expect(trayBadge(null)).toBe(false)
    expect(trayBadge(snap())).toBe(false)
    expect(trayBadge(snap({ agents: [agentRow('working'), agentRow('idle')] }))).toBe(false)
    expect(trayBadge(snap({ agents: [agentRow('waiting')] }))).toBe(true)
    expect(trayBadge(snap({ agents: [agentRow('working', 1)] }))).toBe(true)
  })
})

describe('createTrayController', () => {
  function fakeTray(): TrayLike & { handlers: Record<string, () => void> } {
    const handlers: Record<string, () => void> = {}
    return {
      handlers,
      setContextMenu: vi.fn(),
      setToolTip: vi.fn(),
      setImage: vi.fn(),
      popUpContextMenu: vi.fn(),
      displayBalloon: vi.fn(),
      on: vi.fn((event: string, h: () => void) => {
        handlers[event] = h
      }) as unknown as TrayLike['on']
    }
  }

  interface Setup {
    tray: ReturnType<typeof fakeTray>
    makeIcon: ReturnType<typeof vi.fn>
    buildMenu: ReturnType<typeof vi.fn>
    actions: {
      open: ReturnType<typeof vi.fn>
      settings: ReturnType<typeof vi.fn>
      quit: ReturnType<typeof vi.fn>
    }
    controller: ReturnType<typeof createTrayController>
  }

  function setup(platform: 'win32' | 'darwin'): Setup {
    const tray = fakeTray()
    const makeIcon = vi.fn((level: string) => `icon:${level}`)
    const buildMenu = vi.fn((items: Electron.MenuItemConstructorOptions[]) => ({ items }))
    const actions = { open: vi.fn(), settings: vi.fn(), quit: vi.fn() }
    const controller = createTrayController({ tray, makeIcon, buildMenu, actions, platform })
    return { tray, makeIcon, buildMenu, actions, controller }
  }

  test('같은 내용이면 메뉴·툴팁을 다시 만들지 않고, 단계가 바뀔 때만 아이콘을 바꾼다', () => {
    const { tray, controller } = setup('win32')
    controller.update(snap())
    controller.update(snap({ takenAt: 2 }))
    expect(vi.mocked(tray.setContextMenu)).toHaveBeenCalledTimes(2) // 처음(null) + 첫 스냅샷
    expect(tray.setToolTip).toHaveBeenCalledTimes(2)
    controller.update(
      snap({
        memory: {
          totalBytes: 32 * GB,
          usedBytes: 30 * GB,
          usedPercent: 93.7,
          availableBytes: 2 * GB,
          level: 'danger',
          ramLevel: 'danger',
          commit: null,
          kernelBytes: null
        }
      })
    )
    expect(tray.setImage).toHaveBeenLastCalledWith('icon:danger')
    expect(vi.mocked(tray.setContextMenu)).toHaveBeenCalledTimes(3)
  })

  test('권한 대기가 있으면 점이 있는 아이콘, 없어지면 점 없는 아이콘', () => {
    const tray = fakeTray()
    const makeIcon = vi.fn((level: string, badge: boolean) => `icon:${level}${badge ? ':dot' : ''}`)
    const controller = createTrayController({
      tray,
      makeIcon,
      buildMenu: (items) => ({ items }),
      actions: { open: vi.fn(), settings: vi.fn(), quit: vi.fn() },
      platform: 'win32'
    })
    expect(tray.setImage).toHaveBeenLastCalledWith('icon:normal')
    controller.update(snap({ agents: [agentRow('waiting')] }))
    expect(tray.setImage).toHaveBeenLastCalledWith('icon:warn:dot')
    // 같은 단계·같은 점이면 아이콘을 다시 넣지 않는다.
    controller.update(snap({ agents: [agentRow('waiting')], takenAt: 2 }))
    expect(tray.setImage).toHaveBeenCalledTimes(2)
    controller.update(snap({ agents: [agentRow('working')] }))
    expect(tray.setImage).toHaveBeenLastCalledWith('icon:warn')
    // 조용한 에이전트도 점.
    controller.update(snap({ agents: [agentRow('working', 1)] }))
    expect(tray.setImage).toHaveBeenLastCalledWith('icon:warn:dot')
    expect(tray.setImage).toHaveBeenCalledTimes(4)
  })

  test('처음엔 normal 아이콘과 확인 중 메뉴', () => {
    const { tray, buildMenu } = setup('darwin')
    expect(tray.setImage).toHaveBeenCalledWith('icon:normal')
    expect(labels(buildMenu.mock.calls[0][0])[0]).toBe('RAM 확인 중…')
  })

  test('Windows: 왼쪽 클릭에도 메뉴. 더블클릭은 첫 클릭에 뜬 메뉴가 막아 닿지 않으므로 걸지 않는다', () => {
    const { tray } = setup('win32')
    tray.handlers['click']()
    expect(vi.mocked(tray.popUpContextMenu)).toHaveBeenCalledTimes(1)
    expect(tray.handlers['double-click']).toBeUndefined()
  })

  test('macOS: 클릭은 OS 가 메뉴를 띄우므로 따로 처리하지 않는다', () => {
    const { tray } = setup('darwin')
    expect(tray.handlers['click']).toBeUndefined()
  })

  test('창을 처음 닫을 때 한 번만 트레이에서 계속 실행 중이라고 알린다(Windows)', () => {
    const { tray, controller } = setup('win32')
    controller.notifyHiddenOnce()
    controller.notifyHiddenOnce()
    expect(tray.displayBalloon).toHaveBeenCalledTimes(1)
    expect(tray.displayBalloon).toHaveBeenCalledWith({
      title: 'Corral',
      content: 'Corral 은 트레이에서 계속 실행돼요. 끄려면 트레이 아이콘 메뉴에서 종료를 누르세요.',
      noSound: true
    })
    const mac = setup('darwin')
    mac.controller.notifyHiddenOnce()
    expect(mac.tray.displayBalloon).not.toHaveBeenCalled()
  })
})

describe('새 버전', () => {
  const status = (
    state: UpdateStatus['state'],
    version: string | null = '0.2.0'
  ): UpdateStatus => ({
    state,
    version,
    url: 'https://github.com/yeonjin1357/pitwall/releases/tag/v0.2.0',
    error: null,
    checkedAt: 1
  })

  test('Windows 에서 다 받았으면 다시 시작해 설치, macOS 새 버전이면 내려받기 줄(누르면 각 동작)', () => {
    const install = vi.fn()
    const openRelease = vi.fn()
    const acts = { ...actions, installUpdate: install, openRelease }
    const ready = buildTrayMenu(snap(), acts, status('ready'))
    ready.find((i) => i.label === '새 버전 0.2.0 — 다시 시작해 설치')!.click!(
      {} as never,
      undefined,
      {} as never
    )
    expect(install).toHaveBeenCalled()
    const available = buildTrayMenu(snap(), acts, status('available'))
    available.find((i) => i.label === '새 버전 0.2.0 내려받기')!.click!(
      {} as never,
      undefined,
      {} as never
    )
    expect(openRelease).toHaveBeenCalledWith(
      'https://github.com/yeonjin1357/pitwall/releases/tag/v0.2.0'
    )
    for (const state of ['none', 'checking', 'downloading', 'error', 'disabled'] as const)
      expect(labels(buildTrayMenu(snap(), acts, status(state))).join()).not.toContain('새 버전')
  })
})

test('남은 프로세스 줄은 에이전트 워크트리의 것을 빼고 센다', () => {
  const left = (pid: number, agentInWorktree: boolean): LeftoverRow => ({
    pid,
    processName: 'node',
    label: 'Vitest',
    commandLine: 'node',
    worktree: null,
    workspace: null,
    memoryBytes: 1,
    commitBytes: null,
    descendantPids: [],
    processes: [],
    startedAt: 1,
    agentInWorktree
  })
  expect(
    labels(buildTrayMenu(snap({ leftovers: [left(1, false), left(2, true)] }), actions))
  ).toContain('남은 프로세스 1개')
  expect(labels(buildTrayMenu(snap({ leftovers: [left(2, true)] }), actions)).join()).not.toContain(
    '남은 프로세스'
  )
})

test('트레이 개발 서버 수는 서버 수', () => {
  const base = snap()
  const s = snap({
    servers: [
      { ...base.servers[0], ports: [6176, 8081, 9091] },
      { ...base.servers[1], ports: [3000, 3001] }
    ]
  })
  const items = buildTrayMenu(s, actions)
  expect(labels(items)).toContain('개발 서버 2개')
})

describe('트레이 요약 창(F10)', () => {
  function fakeTray(): TrayLike & {
    handlers: Record<string, (e?: unknown, b?: unknown) => void>
  } {
    const handlers: Record<string, (e?: unknown, b?: unknown) => void> = {}
    return {
      handlers,
      setContextMenu: vi.fn(),
      setToolTip: vi.fn(),
      setImage: vi.fn(),
      popUpContextMenu: vi.fn(),
      displayBalloon: vi.fn(),
      on: vi.fn((event: string, h: (e?: unknown, b?: unknown) => void) => {
        handlers[event] = h
      }) as unknown as TrayLike['on']
    }
  }

  test('왼쪽 클릭은 요약 창, 오른쪽 클릭은 메뉴', () => {
    for (const platform of ['win32', 'darwin'] as const) {
      const tray = fakeTray()
      const popover = vi.fn()
      createTrayController({
        tray,
        makeIcon: () => 'icon',
        buildMenu: (items) => ({ items }),
        actions: { open: vi.fn(), settings: vi.fn(), quit: vi.fn() },
        platform,
        onPopover: popover
      })
      const bounds = { x: 1, y: 2, width: 3, height: 4 }
      tray.handlers['click']({}, bounds)
      expect(popover).toHaveBeenCalledWith(bounds)
      expect(vi.mocked(tray.popUpContextMenu)).not.toHaveBeenCalled()
      if (platform === 'darwin') {
        // macOS 는 메뉴를 붙여 두면 OS 가 왼쪽 클릭에도 메뉴를 띄우므로 붙이지 않고 오른쪽 클릭에 직접 띄운다.
        tray.handlers['right-click']({}, bounds)
        expect(vi.mocked(tray.popUpContextMenu)).toHaveBeenCalledTimes(1)
        expect(vi.mocked(tray.setContextMenu)).not.toHaveBeenCalled()
        expect(vi.mocked(tray.popUpContextMenu).mock.calls[0][0]).toMatchObject({
          items: expect.any(Array)
        })
      } else {
        // Windows 는 붙여 둔 메뉴를 OS 가 오른쪽 클릭에 띄운다(직접 띄우면 두 번 뜰 수 있다).
        expect(vi.mocked(tray.setContextMenu)).toHaveBeenCalled()
        expect(tray.handlers['right-click']).toBeUndefined()
      }
    }
  })
})
