import { inflateSync } from 'zlib'
import {
  buildTrayMenu,
  trayTooltip,
  createDotIcon,
  encodePng,
  LEVEL_COLORS,
  createTrayController,
  type TrayLike
} from './tray'
import type { AgentRow, DashboardSnapshot, HeavyJobRow, UpdateStatus } from '../shared/types'
import { blankSnapshot } from '../shared/snapshot'

const GB = 1024 ** 3

function snap(over: Partial<DashboardSnapshot> = {}): DashboardSnapshot {
  return {
    ...blankSnapshot(1),
    memory: {
      totalBytes: 32 * GB,
      usedBytes: Math.round(26.3 * GB),
      usedPercent: 82.2,
      level: 'warn'
    },
    ports: [1, 2, 3].map((i) => ({
      port: 3000 + i,
      pid: i,
      processName: 'node',
      commandLine: 'node',
      worktree: null,
      unresolvable: false,
      memoryBytes: 1,
      descendantPids: [],
      clientCount: 0,
      startedAt: null,
      judgement: null,
      idleSince: null,
      agentInWorktree: false
    })),
    platform: 'win32',
    cpuCount: 8,
    ...over
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
      '개발 서버 포트 3개',
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
      startedAt: 1,
      memoryBytes: 1,
      descendantCount: 0,
      state,
      stateSource: 'hook',
      cpuPercent: 0
    })
    const base = snap()
    const s = snap({
      agents: [agent('waiting'), agent('working')],
      ports: [{ ...base.ports[0], judgement: 'candidate' }, base.ports[1]],
      leftovers: [
        {
          pid: 9,
          processName: 'chrome.exe',
          label: 'Playwright 브라우저',
          commandLine: 'chrome',
          worktree: null,
          memoryBytes: 1,
          descendantPids: [],
          startedAt: 1,
          agentInWorktree: false
        }
      ]
    })
    const items = buildTrayMenu(s, actions)
    expect(labels(items).slice(1, 5)).toEqual([
      '개발 서버 포트 2개',
      '에이전트 2개 (권한 대기 1)',
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
      ports: [],
      memory: { totalBytes: 0, usedBytes: 0, usedPercent: 0, level: 'normal' }
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
      memoryBytes: 1,
      descendantPids: [],
      startedAt: 1
    })
    const one = labels(buildTrayMenu(snap({ heavyJobs: [job(1)] }), actions))
    expect(one).toContain('무거운 작업 1개')
    const overlap = buildTrayMenu(
      snap({ heavyJobs: [job(1), job(2)], heavyOverlap: true }),
      actions
    )
    expect(labels(overlap)).toContain('무거운 작업 2개 · 겹침(RAM 부족)')
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
  expect(trayTooltip(snap())).toBe('pitwall — RAM 82%')
  expect(trayTooltip(null)).toBe('pitwall')
})

describe('아이콘', () => {
  test('색은 Uptime Kuma 팔레트', () => {
    expect(LEVEL_COLORS).toEqual({ normal: '#5cdd8b', warn: '#f8a306', danger: '#dc3545' })
  })

  test('점 아이콘: 크기와 가운데·모서리 픽셀, 가장자리는 반투명', () => {
    const b = createDotIcon('#5cdd8b', 16)
    expect(b.length).toBe(16 * 16 * 4)
    expect([...b.subarray((8 * 16 + 8) * 4, (8 * 16 + 8) * 4 + 4)]).toEqual([0x5c, 0xdd, 0x8b, 255])
    expect(b[3]).toBe(0)
    const edgeAlphas = [...Array(16).keys()].map((x) => b[(8 * 16 + x) * 4 + 3])
    expect(edgeAlphas.some((a) => a > 0 && a < 255)).toBe(true)
  })

  test('PNG: 시그니처·크기·압축을 푼 픽셀이 원본과 같다', () => {
    const rgba = createDotIcon('#dc3545', 16)
    const png = encodePng(rgba, 16, 16)
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(png.readUInt32BE(16)).toBe(16)
    expect(png.readUInt32BE(20)).toBe(16)
    const idatAt = png.indexOf('IDAT')
    const idatLen = png.readUInt32BE(idatAt - 4)
    const raw = inflateSync(png.subarray(idatAt + 4, idatAt + 4 + idatLen))
    expect(raw.length).toBe(16 * (1 + 16 * 4))
    const row8 = raw.subarray(8 * 65 + 1, 9 * 65)
    expect([...row8.subarray(8 * 4, 8 * 4 + 4)]).toEqual([0xdc, 0x35, 0x45, 255])
    expect(png.subarray(-8, -4).toString('latin1')).toBe('IEND')
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
    expect(tray.setContextMenu).toHaveBeenCalledTimes(2) // 처음(null) + 첫 스냅샷
    expect(tray.setToolTip).toHaveBeenCalledTimes(2)
    controller.update(
      snap({
        memory: { totalBytes: 32 * GB, usedBytes: 30 * GB, usedPercent: 93.7, level: 'danger' }
      })
    )
    expect(tray.setImage).toHaveBeenLastCalledWith('icon:danger')
    expect(tray.setContextMenu).toHaveBeenCalledTimes(3)
  })

  test('처음엔 normal 아이콘과 확인 중 메뉴', () => {
    const { tray, buildMenu } = setup('darwin')
    expect(tray.setImage).toHaveBeenCalledWith('icon:normal')
    expect(labels(buildMenu.mock.calls[0][0])[0]).toBe('RAM 확인 중…')
  })

  test('Windows: 왼쪽 클릭에도 메뉴. 더블클릭은 첫 클릭에 뜬 메뉴가 막아 닿지 않으므로 걸지 않는다', () => {
    const { tray } = setup('win32')
    tray.handlers['click']()
    expect(tray.popUpContextMenu).toHaveBeenCalledTimes(1)
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
      title: 'pitwall',
      content:
        'pitwall 은 트레이에서 계속 실행돼요. 끄려면 트레이 아이콘 메뉴에서 종료를 누르세요.',
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
