import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import type { DashboardSnapshot } from '../shared/types'
import { DEFAULT_INTERVALS, DEFAULT_THRESHOLDS } from '../shared/defaults'
import { IPC } from '../shared/ipc'
import { text } from '../shared/text'
import { sample, toPlatform } from './collect/sample'
import { readMemory } from './collect/memory'
import { resolveProcessWorktrees } from './collect/worktree'
import { buildSnapshot } from './snapshot'
import { createScheduler } from './scheduler'
import { createPortKiller, type KillConfirm } from './kill'

const APP_ID = 'io.github.yeonjin1357.pitwall'
const platform = toPlatform(process.platform)
let mainWindow: BrowserWindow | null = null

async function collect(): Promise<DashboardSnapshot> {
  if (!platform) throw new Error(text.unsupportedPlatform)
  const [raw, memory] = await Promise.all([sample(platform), readMemory(platform)])
  const worktrees = await resolveProcessWorktrees(raw.processes)
  return buildSnapshot({
    sample: raw,
    worktrees,
    totalBytes: memory.totalBytes,
    freeBytes: memory.freeBytes,
    thresholds: DEFAULT_THRESHOLDS,
    now: Date.now(),
    selfPid: process.pid
  })
}

const scheduler = createScheduler({
  collect,
  intervals: DEFAULT_INTERVALS,
  onSnapshot: (snapshot) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.snapshot, snapshot)
  }
})

async function confirmKill(options: KillConfirm): Promise<boolean> {
  const box = { type: 'warning' as const, noLink: true, ...options }
  const result =
    mainWindow && !mainWindow.isDestroyed()
      ? await dialog.showMessageBox(mainWindow, box)
      : await dialog.showMessageBox(box)
  return result.response === 0
}

const killer = createPortKiller({
  latest: () => scheduler.latest(),
  resample: () => (platform ? sample(platform) : Promise.reject(new Error(text.unsupportedPlatform))),
  confirm: confirmKill,
  signal: (pid, sig) => {
    process.kill(pid, sig)
  },
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  platform: platform ?? 'win32'
})

function registerIpc(): void {
  const fromMainWindow = (sender: Electron.WebContents): boolean =>
    !!mainWindow && !mainWindow.isDestroyed() && sender === mainWindow.webContents

  ipcMain.handle(IPC.getLatest, (event) => (fromMainWindow(event.sender) ? scheduler.latest() : null))
  ipcMain.handle(IPC.killPort, async (event, arg: unknown) => {
    if (!fromMainWindow(event.sender)) return { status: 'failed', message: text.killResult.invalid }
    const { port, pid } = (arg ?? {}) as { port?: unknown; pid?: unknown }
    const result = await killer.killPort(Number(port), Number(pid))
    void scheduler.refreshNow()
    return result
  })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
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

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('show', () => scheduler.setWindowOpen(true))
  mainWindow.on('hide', () => scheduler.setWindowOpen(false))
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

app.whenReady().then(() => {
  electronApp.setAppUserModelId(APP_ID)

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerIpc()
  scheduler.start()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => scheduler.stop())
