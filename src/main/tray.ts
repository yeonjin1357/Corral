import type { MenuItemConstructorOptions } from 'electron'
import type { DashboardSnapshot, MemoryLevel, Platform, UpdateStatus } from '../shared/types'
import { formatBytes, pressureText } from '../shared/format'
import { text } from '../shared/text'

/** 트레이 아이콘(작은 모니터) 그래프 선 색: 화면 어두운 테마(NeoHtop Catppuccin)의 초록·노랑·분홍. */
export const LEVEL_COLORS: Record<MemoryLevel, string> = {
  normal: '#a6e3a1',
  warn: '#f9e2af',
  danger: '#f38ba8'
}

/** 트레이 아이콘 오른쪽 위 점 색(Catppuccin peach, 화면의 권한 대기·조용함 색과 같다). */
export const BADGE_COLOR = '#fab387'

const hasMemory = (s: DashboardSnapshot | null): s is DashboardSnapshot =>
  !!s && s.memory.totalBytes > 0
// 화면(RamBar)과 같은 규칙: 내림해야 경고 기준과 표시가 어긋나지 않는다.
const percentOf = (s: DashboardSnapshot): number => Math.floor(s.memory.usedPercent)

export interface TrayActions {
  open(): void
  settings(): void
  quit(): void
  /** Windows: 받아 둔 새 버전을 설치(다시 시작). */
  installUpdate?(): void
  /** macOS: 새 버전 릴리스 페이지 열기. */
  openRelease?(url: string): void
}

export function buildTrayMenu(
  s: DashboardSnapshot | null,
  actions: TrayActions,
  update: UpdateStatus | null = null
): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = []
  if (!s) {
    items.push({ label: text.tray.checking, enabled: false })
  } else if (!hasMemory(s)) {
    items.push({ label: text.tray.failed, enabled: false })
  } else {
    const ram = text.tray.ram(
      percentOf(s),
      formatBytes(s.memory.usedBytes),
      formatBytes(s.memory.totalBytes)
    )
    items.push({ label: s.stale ? ram + text.tray.staleSuffix : ram, enabled: false })
  }
  if (s) {
    items.push({ label: text.tray.servers(s.servers.length), enabled: false })
    const waiting = s.agents.filter((a) => a.state === 'waiting').length
    items.push({ label: text.tray.agents(s.agents.length, waiting), enabled: false })
    const candidates = s.servers.filter((p) => p.judgement === 'candidate').length
    // 정리 후보는 바로 확인하러 갈 수 있게 누르면 앱을 연다(끄기는 앱의 확인 창을 거친다).
    if (candidates > 0)
      items.push({ label: text.tray.candidates(candidates), click: () => actions.open() })
    // 에이전트가 있는 워크트리의 남은 프로세스는 그 에이전트가 쓰고 있을 수 있어 세지 않는다.
    const leftovers = s.leftovers.filter((l) => !l.agentInWorktree).length
    if (leftovers > 0)
      items.push({ label: text.tray.leftovers(leftovers), click: () => actions.open() })
    if (s.heavyJobs.length > 0)
      items.push({
        label: text.tray.heavy(s.heavyJobs.length, s.heavyOverlap),
        enabled: false
      })
    const diskBytes = (s.disk?.rows ?? []).reduce((sum, r) => sum + (r.totalBytes ?? 0), 0)
    if (diskBytes > 0)
      items.push({ label: text.tray.disk(formatBytes(diskBytes)), click: () => actions.open() })
  }
  if (update?.state === 'ready' && update.version)
    items.push({
      label: text.tray.updateReady(update.version),
      click: () => actions.installUpdate?.()
    })
  if (update?.state === 'available' && update.version && update.url) {
    const url = update.url
    items.push({
      label: text.tray.updateAvailable(update.version),
      click: () => actions.openRelease?.(url)
    })
  }
  items.push(
    { type: 'separator' },
    { label: text.tray.open, click: () => actions.open() },
    { label: text.tray.settings, click: () => actions.settings() },
    { type: 'separator' },
    { label: text.tray.quit, click: () => actions.quit() }
  )
  return items
}

export function trayTooltip(s: DashboardSnapshot | null): string {
  if (!hasMemory(s)) return text.appName
  const waiting = s.agents.filter((a) => a.state === 'waiting').length
  return text.tray.tooltip(pressureText(s.memory), waiting)
}

/** 아이콘에 점을 찍을지(G3d): 권한을 기다리거나 조용한(G3c) 에이전트가 있으면. */
export function trayBadge(s: DashboardSnapshot | null): boolean {
  return !!s && s.agents.some((a) => a.state === 'waiting' || a.quietSince != null)
}

/** Electron Tray 중 pitwall 이 쓰는 부분(테스트에서 가짜로 바꿔 끼운다). */
export interface TrayLike {
  setContextMenu(menu: unknown): void
  setToolTip(tooltip: string): void
  setImage(image: unknown): void
  popUpContextMenu(menu?: unknown): void
  displayBalloon(options: { title: string; content: string; noSound?: boolean }): void
  on(
    event: 'click' | 'right-click',
    listener: (
      event: unknown,
      bounds: { x: number; y: number; width: number; height: number }
    ) => void
  ): void
}

export function createTrayController<Icon, Menu>(deps: {
  tray: TrayLike
  /** level: 메모리 단계(그래프 선 색), badge: 오른쪽 위 점(trayBadge). */
  makeIcon: (level: MemoryLevel, badge: boolean) => Icon
  buildMenu: (items: MenuItemConstructorOptions[]) => Menu
  actions: TrayActions
  platform: Platform
  /**
   * 왼쪽 클릭에 띄울 요약 창(F10). 있으면 왼쪽 클릭 = 요약 창, 오른쪽 클릭 = 메뉴.
   * macOS 는 메뉴를 붙여 두면 OS 가 왼쪽 클릭에도 메뉴를 띄우므로, 붙이지 않고 오른쪽 클릭에 직접 띄운다.
   */
  onPopover?: (bounds: { x: number; y: number; width: number; height: number }) => void
}): {
  update(s: DashboardSnapshot | null): void
  setUpdate(status: UpdateStatus): void
  notifyHiddenOnce(): void
} {
  let menuKey = ''
  let last: DashboardSnapshot | null = null
  let updateStatus: UpdateStatus | null = null
  let tooltip = ''
  /** 지금 아이콘(단계·점). 바뀔 때만 다시 넣는다. */
  let iconKey = ''
  let notified = false
  let menu: Menu | null = null
  const attachMenu = !(deps.onPopover && deps.platform === 'darwin')

  function apply(s: DashboardSnapshot | null): void {
    last = s
    const items = buildTrayMenu(s, deps.actions, updateStatus)
    // 열려 있는 메뉴가 닫히거나 깜빡이지 않도록, 내용이 바뀔 때만 다시 만든다.
    const key = JSON.stringify(items.map((i) => [i.type ?? '', i.label ?? '', i.enabled ?? true]))
    if (key !== menuKey) {
      menu = deps.buildMenu(items)
      if (attachMenu) deps.tray.setContextMenu(menu)
      menuKey = key
    }
    const nextTooltip = trayTooltip(s)
    if (nextTooltip !== tooltip) {
      deps.tray.setToolTip(nextTooltip)
      tooltip = nextTooltip
    }
    const nextLevel = hasMemory(s) ? s.memory.level : 'normal'
    const badge = trayBadge(s)
    const nextIconKey = `${nextLevel}:${badge}`
    if (nextIconKey !== iconKey) {
      deps.tray.setImage(deps.makeIcon(nextLevel, badge))
      iconKey = nextIconKey
    }
  }

  if (deps.onPopover) {
    const popover = deps.onPopover
    deps.tray.on('click', (_event, bounds) => popover(bounds))
    // Windows 는 메뉴를 붙여 두면 오른쪽 클릭에 OS 가 띄운다. macOS 는 직접 띄운다.
    if (!attachMenu) deps.tray.on('right-click', () => deps.tray.popUpContextMenu(menu))
  } else if (deps.platform === 'win32') {
    // Windows 는 오른쪽 클릭에만 메뉴가 뜬다. 왼쪽 클릭에도 띄운다(더블클릭은 첫 클릭에 뜬 메뉴가 막아 닿지 않는다).
    // macOS 는 OS 가 클릭에 메뉴를 띄운다.
    deps.tray.on('click', () => deps.tray.popUpContextMenu())
  }
  apply(null)

  return {
    update: apply,
    setUpdate(status) {
      updateStatus = status
      apply(last)
    },
    notifyHiddenOnce() {
      if (notified || deps.platform !== 'win32') return
      notified = true
      deps.tray.displayBalloon({
        title: text.appName,
        content: text.tray.stillRunning,
        noSound: true
      })
    }
  }
}
