import { deflateSync } from 'zlib'
import type { MenuItemConstructorOptions } from 'electron'
import type { DashboardSnapshot, MemoryLevel, Platform, UpdateStatus } from '../shared/types'
import { formatBytes } from '../shared/format'
import { text } from '../shared/text'

/** Uptime Kuma vars.scss 의 $primary / $warning / $danger. */
export const LEVEL_COLORS: Record<MemoryLevel, string> = {
  normal: '#5cdd8b',
  warn: '#f8a306',
  danger: '#dc3545'
}

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
    items.push({ label: text.tray.ports(s.ports.length), enabled: false })
    const waiting = s.agents.filter((a) => a.state === 'waiting').length
    items.push({ label: text.tray.agents(s.agents.length, waiting), enabled: false })
    const candidates = s.ports.filter((p) => p.judgement === 'candidate').length
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
  return hasMemory(s) ? text.tray.tooltip(percentOf(s)) : text.appName
}

/** 가운데 원 하나를 그린 RGBA 비트맵(가장자리 1px 은 반투명으로 부드럽게). */
export function createDotIcon(rgbHex: string, size: number): Buffer {
  const r = parseInt(rgbHex.slice(1, 3), 16)
  const g = parseInt(rgbHex.slice(3, 5), 16)
  const b = parseInt(rgbHex.slice(5, 7), 16)
  const center = size / 2
  const radius = size / 2 - 1
  const out = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const distance = Math.hypot(x + 0.5 - center, y + 0.5 - center)
      const coverage = Math.min(1, Math.max(0, radius + 0.5 - distance))
      const i = (y * size + x) * 4
      out[i] = r
      out[i + 1] = g
      out[i + 2] = b
      out[i + 3] = Math.round(coverage * 255)
    }
  }
  return out
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(data: Buffer): number {
  let c = 0xffffffff
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeAndData = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData))
  return Buffer.concat([length, typeAndData, crc])
}

/**
 * RGBA 비트맵을 PNG 로 감싼다. nativeImage.createFromBitmap 은 OS 마다 바이트 순서(BGRA)와
 * 미리 곱한 알파를 가정해 색이 틀어질 수 있어, 형식이 정해진 PNG 로 넘긴다.
 */
export function encodePng(rgba: Buffer, width: number, height: number): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // 비트 깊이
  header[9] = 6 // RGBA
  const stride = width * 4
  const raw = Buffer.alloc(height * (1 + stride))
  for (let y = 0; y < height; y++) {
    raw[y * (1 + stride)] = 0 // 필터 없음
    rgba.copy(raw, y * (1 + stride) + 1, y * stride, (y + 1) * stride)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

/** Electron Tray 중 pitwall 이 쓰는 부분(테스트에서 가짜로 바꿔 끼운다). */
export interface TrayLike {
  setContextMenu(menu: unknown): void
  setToolTip(tooltip: string): void
  setImage(image: unknown): void
  popUpContextMenu(): void
  displayBalloon(options: { title: string; content: string; noSound?: boolean }): void
  on(event: 'click', listener: () => void): void
}

export function createTrayController<Icon, Menu>(deps: {
  tray: TrayLike
  makeIcon: (level: MemoryLevel) => Icon
  buildMenu: (items: MenuItemConstructorOptions[]) => Menu
  actions: TrayActions
  platform: Platform
}): {
  update(s: DashboardSnapshot | null): void
  setUpdate(status: UpdateStatus): void
  notifyHiddenOnce(): void
} {
  let menuKey = ''
  let last: DashboardSnapshot | null = null
  let updateStatus: UpdateStatus | null = null
  let tooltip = ''
  let level: MemoryLevel | null = null
  let notified = false

  function apply(s: DashboardSnapshot | null): void {
    last = s
    const items = buildTrayMenu(s, deps.actions, updateStatus)
    // 열려 있는 메뉴가 닫히거나 깜빡이지 않도록, 내용이 바뀔 때만 다시 만든다.
    const key = JSON.stringify(items.map((i) => [i.type ?? '', i.label ?? '', i.enabled ?? true]))
    if (key !== menuKey) {
      deps.tray.setContextMenu(deps.buildMenu(items))
      menuKey = key
    }
    const nextTooltip = trayTooltip(s)
    if (nextTooltip !== tooltip) {
      deps.tray.setToolTip(nextTooltip)
      tooltip = nextTooltip
    }
    const nextLevel = hasMemory(s) ? s.memory.level : 'normal'
    if (nextLevel !== level) {
      deps.tray.setImage(deps.makeIcon(nextLevel))
      level = nextLevel
    }
  }

  // Windows 는 오른쪽 클릭에만 메뉴가 뜬다. 왼쪽 클릭에도 띄운다(더블클릭은 첫 클릭에 뜬 메뉴가 막아 닿지 않는다).
  // macOS 는 OS 가 클릭에 메뉴를 띄운다.
  if (deps.platform === 'win32') {
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
