import { app, shell, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import type { DashboardSnapshot } from '../shared/types'
import { DEFAULT_INTERVALS, DEFAULT_THRESHOLDS } from '../shared/defaults'
import { IPC } from '../shared/ipc'
import { text } from '../shared/text'
import { mkdirSync, readdirSync, rmSync } from 'fs'
import { sample, toPlatform } from './collect/sample'
import { configureWindowsSampler, nativeHelperDllName } from './collect/windows'
import { readMemory } from './collect/memory'
import { resolveProcessWorktrees } from './collect/worktree'
import { buildSnapshot, pidsForWorktreeLookup } from './snapshot'
import { topLevelAgentPids } from './processTree'
import { createScheduler } from './scheduler'
import { createKiller, type KillConfirm } from './kill'
import { localUrlFor } from './open'
import { createDotIcon, createTrayController, encodePng, LEVEL_COLORS } from './tray'
import type { MemoryLevel } from '../shared/types'

const APP_ID = 'io.github.yeonjin1357.pitwall'
const platform = toPlatform(process.platform)
let mainWindow: BrowserWindow | null = null
// 모듈 변수로 붙잡아 두지 않으면 GC 되어 트레이 아이콘이 사라진다.
let tray: Tray | null = null
let trayController: ReturnType<typeof createTrayController> | null = null
/** 트레이 '종료'·Cmd+Q 로 끝낼 때만 창을 실제로 닫는다. 그 외 닫기는 숨김. */
let quitting = false

const iconCache = new Map<MemoryLevel, Electron.NativeImage>()
function trayIcon(level: MemoryLevel): Electron.NativeImage {
  const cached = iconCache.get(level)
  if (cached) return cached
  const color = LEVEL_COLORS[level]
  const image = nativeImage.createFromBuffer(encodePng(createDotIcon(color, 16), 16, 16), {
    scaleFactor: 1
  })
  image.addRepresentation({ scaleFactor: 2, buffer: encodePng(createDotIcon(color, 32), 32, 32) })
  iconCache.set(level, image)
  return image
}

async function collect(): Promise<DashboardSnapshot> {
  if (!platform) throw new Error(text.unsupportedPlatform)
  const [raw, memory] = await Promise.all([sample(platform), readMemory(platform)])
  const needed = pidsForWorktreeLookup(raw, platform)
  const worktrees = await resolveProcessWorktrees(
    raw.processes.filter((p) => needed.has(p.pid)),
    raw.cwds,
    new Set(topLevelAgentPids(raw.processes))
  )
  return buildSnapshot({
    sample: raw,
    worktrees,
    totalBytes: memory.totalBytes,
    freeBytes: memory.freeBytes,
    thresholds: DEFAULT_THRESHOLDS,
    now: Date.now(),
    selfPid: process.pid,
    platform
  })
}

const scheduler = createScheduler({
  collect,
  intervals: DEFAULT_INTERVALS,
  onSnapshot: (snapshot) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.snapshot, snapshot)
    trayController?.update(snapshot)
  }
})

function showWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
  void app.dock?.show()
}

function hideWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.hide()
  app.dock?.hide()
  trayController?.notifyHiddenOnce()
}

function createTray(): void {
  tray = new Tray(trayIcon('normal'))
  const t = tray
  trayController = createTrayController({
    tray: {
      setContextMenu: (menu) => t.setContextMenu(menu as Menu),
      setToolTip: (tooltip) => t.setToolTip(tooltip),
      setImage: (image) => t.setImage(image as Electron.NativeImage),
      popUpContextMenu: () => t.popUpContextMenu(),
      displayBalloon: (options) => t.displayBalloon(options),
      on: (_event, listener) => {
        t.on('click', listener)
      }
    },
    makeIcon: trayIcon,
    buildMenu: (items) => Menu.buildFromTemplate(items),
    actions: { open: showWindow, quit: () => app.quit() },
    platform: platform ?? 'win32'
  })
  const latest = scheduler.latest()
  if (latest) trayController.update(latest)
}

async function confirmKill(options: KillConfirm): Promise<boolean> {
  const box = { type: 'warning' as const, noLink: true, ...options }
  const result =
    mainWindow && !mainWindow.isDestroyed()
      ? await dialog.showMessageBox(mainWindow, box)
      : await dialog.showMessageBox(box)
  return result.response === 0
}

const killer = createKiller({
  latest: () => scheduler.latest(),
  resample: () =>
    platform ? sample(platform) : Promise.reject(new Error(text.unsupportedPlatform)),
  confirm: confirmKill,
  signal: (pid, sig) => {
    process.kill(pid, sig)
  },
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  platform: platform ?? 'win32'
})

/** Windows 수집 보조 코드(C#)를 앱 데이터 폴더에 한 번만 컴파일해 두고, 예전 버전 DLL 은 지운다. */
function prepareWindowsHelper(): void {
  if (platform !== 'win32') return
  const dir = app.getPath('userData')
  const current = nativeHelperDllName()
  try {
    mkdirSync(dir, { recursive: true })
    for (const name of readdirSync(dir)) {
      if (/^pitwall-native-.*\.dll$/.test(name) && name !== current) {
        try {
          rmSync(join(dir, name), { force: true })
        } catch {
          // 다른 수집이 불러 쓰는 중이면 다음 실행 때 지운다.
        }
      }
    }
    configureWindowsSampler({ helperDllPath: join(dir, current) })
  } catch {
    // 폴더를 못 쓰면 매번 메모리에서 컴파일한다(느리지만 동작은 같다).
    configureWindowsSampler({ helperDllPath: null })
  }
}

function registerIpc(): void {
  const fromMainWindow = (sender: Electron.WebContents): boolean =>
    !!mainWindow && !mainWindow.isDestroyed() && sender === mainWindow.webContents

  ipcMain.handle(IPC.getLatest, (event) =>
    fromMainWindow(event.sender) ? scheduler.latest() : null
  )
  ipcMain.handle(IPC.killPort, async (event, arg: unknown) => {
    if (!fromMainWindow(event.sender)) return { status: 'failed', message: text.killResult.invalid }
    const { port, pid } = (arg ?? {}) as { port?: unknown; pid?: unknown }
    const result = await killer.killPort(Number(port), Number(pid))
    void scheduler.refreshNow()
    return result
  })
  ipcMain.handle(IPC.refreshNow, async (event) => {
    if (fromMainWindow(event.sender)) await scheduler.refreshNow()
  })
  ipcMain.handle(IPC.openPort, async (event, port: unknown) => {
    if (!fromMainWindow(event.sender)) return false
    const url = localUrlFor(port, scheduler.latest())
    if (!url) return false
    await shell.openExternal(url)
    return true
  })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 800,
    minHeight: 560,
    show: false,
    title: text.appName,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => showWindow())
  mainWindow.on('show', () => scheduler.setWindowOpen(true))
  mainWindow.on('restore', () => scheduler.setWindowOpen(true))
  mainWindow.on('hide', () => scheduler.setWindowOpen(false))
  mainWindow.on('minimize', () => scheduler.setWindowOpen(false))
  // 창 닫기(X)는 트레이로 숨기기. 앱 종료는 트레이 메뉴의 '종료'(또는 macOS Cmd+Q)로만 한다.
  mainWindow.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    hideWindow()
  })
  mainWindow.on('closed', () => {
    scheduler.setWindowOpen(false)
    mainWindow = null
  })

  // 앱 화면 밖으로 이동하거나 새 창을 여는 것을 막고, 외부 링크는 기본 브라우저로 연다.
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())
  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (/^https?:\/\//.test(details.url)) void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// 두 번째로 실행하면 새로 띄우지 않고 이미 떠 있는 창을 보여 준다(트레이 아이콘이 둘이 되지 않도록).
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow())

  app.whenReady().then(() => {
    electronApp.setAppUserModelId(APP_ID)

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    prepareWindowsHelper()
    registerIpc()
    scheduler.start()
    createTray()
    createWindow()

    // macOS 독 아이콘을 누르면 창을 다시 보여 준다.
    app.on('activate', () => showWindow())
  })

  // 창이 모두 닫혀도 트레이에서 계속 돈다.
  app.on('window-all-closed', () => {})

  app.on('before-quit', () => {
    quitting = true
    scheduler.stop()
  })
}
