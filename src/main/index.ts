import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  dialog,
  Tray,
  Menu,
  nativeImage,
  nativeTheme,
  Notification
} from 'electron'
import { join } from 'path'
import { cpus, homedir } from 'os'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import type { DashboardSnapshot } from '../shared/types'
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  REFRESH_INTERVALS,
  type Settings
} from '../shared/settings'
import { IPC, type NavigateTarget } from '../shared/ipc'
import { text } from '../shared/text'
import { mkdirSync, readdirSync, rmSync } from 'fs'
import { sample, toPlatform } from './collect/sample'
import { configureWindowsSampler, nativeHelperDllName } from './collect/windows'
import { readMemory } from './collect/memory'
import { resolveProcessWorktrees, resolveWorktree } from './collect/worktree'
import { collectOptionsFrom, createCollector } from './collector'
import { loadConfig, updateConfig } from './config'
import { claudeConfigDir } from './claudeHooks'
import { createClaudeIntegration } from './claudeIntegration'
import type { Sessions } from './sessions'
import { createScheduler } from './scheduler'
import { createKiller, type KillConfirm } from './kill'
import { createDiskManager, createRepoMemory, snapshotWorktrees } from './disk'
import { createNotifier, type Notice } from './notifier'
import { loginItemOptions, shouldStartHidden } from './startup'
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

/** 사용자 설정. 시작할 때 config.json 에서 읽고, 설정 화면에서 저장하면 바로 바꾼다. */
let settings: Settings = DEFAULT_SETTINGS

/** Claude 훅이 알려 주는 세션들. 훅 서버가 채우고 수집기가 읽는다. */
const sessions: Sessions = new Map()

const collector = platform
  ? createCollector({
      platform,
      sample: () => sample(platform),
      readMemory: () => readMemory(platform),
      resolveProcessWorktrees,
      resolveWorktree,
      sessions,
      hookStatus: () => claude.status(),
      options: () => collectOptionsFrom(settings),
      selfPid: process.pid,
      cpuCount: cpus().length,
      now: Date.now
    })
  : null

/** 디스크 정리에서 살펴볼 저장소(에이전트·개발 서버를 본 저장소를 기억한다). */
const repoMemory = createRepoMemory(join(app.getPath('userData'), 'state.json'))

async function collect(): Promise<DashboardSnapshot> {
  if (!collector) throw new Error(text.unsupportedPlatform)
  const snapshot = await collector.collect()
  repoMemory.add(snapshotWorktrees(snapshot).map((w) => w.commonDir))
  return { ...snapshot, disk: disk.report() }
}

const scheduler = createScheduler({
  collect,
  intervals: REFRESH_INTERVALS[settings.refresh],
  onSnapshot: (snapshot) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.snapshot, snapshot)
    trayController?.update(snapshot)
    notifier.update(snapshot)
  }
})

/** 창을 열고(없으면 만들고) 화면에 보여 줄 곳을 알린다. 창이 아직 로딩 중이면 다 뜬 뒤에 보낸다. */
function navigate(target: NavigateTarget): void {
  showWindow()
  const window = mainWindow
  if (!window || window.isDestroyed()) return
  const send = (): void => {
    if (!window.isDestroyed()) window.webContents.send(IPC.navigate, target)
  }
  if (window.webContents.isLoading()) window.webContents.once('did-finish-load', send)
  else send()
}

/** 보낸 알림을 붙잡아 둔다(가비지 컬렉션되면 Windows 에서 눌러도 반응하지 않는다). */
const notices = new Set<Notification>()
function showNotice(notice: Notice): void {
  if (!Notification.isSupported()) return
  const note = new Notification({ title: notice.title, body: notice.body })
  notices.add(note)
  const forget = (): void => {
    notices.delete(note)
  }
  note.on('click', () => {
    forget()
    navigate({ page: 'dashboard', key: notice.target })
  })
  note.on('close', forget)
  note.show()
}

const notifier = createNotifier({
  show: showNotice,
  settings: () => settings.notify,
  isFocused: () =>
    !!mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && mainWindow.isFocused(),
  now: Date.now
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
    actions: {
      open: showWindow,
      settings: () => navigate({ page: 'settings' }),
      quit: () => app.quit()
    },
    platform: platform ?? 'win32'
  })
  const latest = scheduler.latest()
  if (latest) trayController.update(latest)
}

/** 끄기·설정 바꾸기 전에 띄우는 네이티브 확인 창. 첫 번째 버튼이면 true. */
async function confirmDialog(options: KillConfirm): Promise<boolean> {
  const box = { type: 'warning' as const, noLink: true, ...options }
  const result =
    mainWindow && !mainWindow.isDestroyed()
      ? await dialog.showMessageBox(mainWindow, box)
      : await dialog.showMessageBox(box)
  return result.response === 0
}

/** 디스크 정리: 시작 1분 뒤, 30분마다, 화면에서 요청할 때, 관련 설정을 바꿀 때 다시 찾는다. */
const DISK_FIRST_SCAN_MS = 60 * 1000
const DISK_SCAN_EVERY_MS = 30 * 60 * 1000
const disk = createDiskManager({
  settings: () => settings,
  knownRepos: () => repoMemory.list(),
  latest: () => scheduler.latest(),
  resample: () =>
    platform ? sample(platform) : Promise.reject(new Error(text.unsupportedPlatform)),
  confirm: (o) => confirmDialog(o),
  now: Date.now,
  onChange: (report) => {
    const latest = scheduler.latest()
    if (latest) scheduler.publish({ ...latest, disk: report })
  }
})

const killer = createKiller({
  latest: () => scheduler.latest(),
  resample: () =>
    platform ? sample(platform) : Promise.reject(new Error(text.unsupportedPlatform)),
  confirm: confirmDialog,
  signal: (pid, sig) => {
    process.kill(pid, sig)
  },
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  platform: platform ?? 'win32'
})

/** 훅 이벤트가 몰려도 화면 갱신은 잠깐 모아서 한 번(다시 샘플링하지 않고 상태만 바꾼다). */
let restateTimer: ReturnType<typeof setTimeout> | null = null
function scheduleRestate(): void {
  if (restateTimer || !collector) return
  restateTimer = setTimeout(() => {
    restateTimer = null
    const latest = scheduler.latest()
    if (!latest) return
    void collector.restate(latest).then((next) => {
      // 그 사이 새 수집 결과가 나왔으면 그것이 더 최신이다.
      if (scheduler.latest() === latest) scheduler.publish(next)
    })
  }, 200)
}

const claude = createClaudeIntegration({
  userData: app.getPath('userData'),
  configDir: claudeConfigDir(process.env, homedir()),
  platform: platform ?? 'win32',
  systemRoot: process.env.SystemRoot,
  sessions,
  now: Date.now,
  confirm: confirmDialog,
  onEvent: scheduleRestate
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

/** 바뀐 설정을 앱 전체에 반영한다(수집 기준값은 수집기가 매번 읽는다). */
function applySettings(next: Settings): void {
  settings = next
  scheduler.setIntervals(REFRESH_INTERVALS[next.refresh])
  // 화면(prefers-color-scheme)과 확인 창·메뉴가 같은 테마를 따르도록 OS 테마 설정을 바꾼다.
  nativeTheme.themeSource = next.theme === 'auto' ? 'system' : next.theme
  const login = loginItemOptions(next, app.isPackaged)
  if (login) app.setLoginItemSettings(login)
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.send(IPC.settingsChanged, next)
}

async function saveSettings(next: unknown): Promise<Settings> {
  const normalized = normalizeSettings(next)
  const before = settings
  const saved = await updateConfig(app.getPath('userData'), (c) => ({ ...c, settings: normalized }))
  applySettings(saved.settings)
  void scheduler.refreshNow()
  const diskChanged =
    JSON.stringify([before.dependencyDirs, before.extraRepos]) !==
    JSON.stringify([saved.settings.dependencyDirs, saved.settings.extraRepos])
  if (diskChanged) void disk.scan()
  return saved.settings
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
  ipcMain.handle(IPC.killLeftover, async (event, pid: unknown) => {
    if (!fromMainWindow(event.sender)) return { status: 'failed', message: text.killResult.invalid }
    const result = await killer.killLeftover(Number(pid))
    void scheduler.refreshNow()
    return result
  })
  ipcMain.handle(IPC.killMany, async (event, keys: unknown) => {
    if (!fromMainWindow(event.sender)) return { status: 'failed', message: text.killResult.invalid }
    const result = await killer.killMany(keys as string[])
    void scheduler.refreshNow()
    return result
  })
  ipcMain.handle(IPC.diskScan, async (event) => (fromMainWindow(event.sender) ? disk.scan() : null))
  ipcMain.handle(IPC.diskRemove, async (event, root: unknown) => {
    if (!fromMainWindow(event.sender)) return { status: 'failed', message: text.killResult.invalid }
    const result = await disk.remove(typeof root === 'string' ? root : '')
    void scheduler.refreshNow()
    return result
  })
  ipcMain.handle(IPC.claudeHookStatus, async (event) =>
    fromMainWindow(event.sender) ? claude.status() : null
  )
  ipcMain.handle(IPC.claudeHookEnable, async (event) => {
    if (!fromMainWindow(event.sender)) return { status: 'cancelled' }
    const result = await claude.enable()
    void scheduler.refreshNow()
    return result
  })
  ipcMain.handle(IPC.claudeHookDisable, async (event) => {
    if (!fromMainWindow(event.sender)) return { status: 'cancelled' }
    const result = await claude.disable()
    void scheduler.refreshNow()
    return result
  })
  ipcMain.handle(IPC.appInfo, () => ({ version: app.getVersion() }))
  ipcMain.handle(IPC.settingsGet, (event) =>
    fromMainWindow(event.sender) ? settings : DEFAULT_SETTINGS
  )
  ipcMain.handle(IPC.settingsSave, async (event, next: unknown) => {
    if (!fromMainWindow(event.sender)) return settings
    return saveSettings(next)
  })
  ipcMain.handle(IPC.settingsPickFolder, async (event) => {
    if (!fromMainWindow(event.sender) || !mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] })
    return result.canceled ? null : (result.filePaths[0] ?? null)
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

  app.whenReady().then(async () => {
    electronApp.setAppUserModelId(APP_ID)
    // 설정을 먼저 읽어 첫 수집부터 사용자 기준값·주기를 쓴다.
    applySettings((await loadConfig(app.getPath('userData'))).settings)
    await repoMemory.load()
    setTimeout(() => void disk.scan(), DISK_FIRST_SCAN_MS)
    setInterval(() => void disk.scan(), DISK_SCAN_EVERY_MS)

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    prepareWindowsHelper()
    registerIpc()
    void claude.start()
    scheduler.start()
    createTray()
    // 로그인할 때 켜졌으면 창 없이 트레이로만 시작한다(트레이에서 열면 그때 만든다).
    const hidden = shouldStartHidden(
      process.argv,
      platform ?? 'win32',
      process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin
    )
    if (hidden) app.dock?.hide()
    else createWindow()

    // macOS 독 아이콘을 누르면 창을 다시 보여 준다.
    app.on('activate', () => showWindow())
  })

  // 창이 모두 닫혀도 트레이에서 계속 돈다.
  app.on('window-all-closed', () => {})

  app.on('before-quit', () => {
    quitting = true
    scheduler.stop()
    void claude.stop()
  })
}
