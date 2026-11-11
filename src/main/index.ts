// 반드시 맨 처음: 아래 모듈들이 설정 폴더를 읽기 전에 예전 폴더(<appData>/pitwall)로 고정한다.
import './pinUserData'
import {
  screen,
  app,
  shell,
  clipboard,
  BrowserWindow,
  ipcMain,
  dialog,
  Tray,
  Menu,
  nativeImage,
  nativeTheme,
  net,
  Notification
} from 'electron'
import { autoUpdater } from 'electron-updater'
import { spawn } from 'child_process'
import { join } from 'path'
import { cpus, homedir } from 'os'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import type { DashboardSnapshot, KillResult } from '../shared/types'
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  REFRESH_INTERVALS,
  type Settings
} from '../shared/settings'
import { IPC, type NavigateTarget } from '../shared/ipc'
import { text } from '../shared/text'
import { mkdirSync, readdirSync, rmSync } from 'fs'
import { access, stat } from 'fs/promises'
import { sample, toPlatform } from './collect/sample'
import {
  configureWindowsSampler,
  nativeHelperDllName,
  windowsHelperDllPath
} from './collect/windows'
import { runCommand } from './collect/runCommand'
import { allCwdsDarwin } from './collect/darwin'
import { readMemory } from './collect/memory'
import { resolveProcessWorktrees, resolveWorkspace, resolveWorktree } from './collect/worktree'
import { collectOptionsFrom, createCollector } from './collector'
import { countChanges, createChangeCounter } from './gitStatus'
import { loadConfig, updateConfig } from './config'
import { claudeConfigDir } from './claudeHooks'
import { createSessionFileReader } from './claudeSessionFiles'
import { createClaudeUsageReader, createUsageCache } from './claudeUsage'
import { createClaudeIntegration } from './claudeIntegration'
import { createCodexIntegration } from './codexIntegration'
import { createHookHub } from './hookHub'
import { createGuardAnswerer, settleHeavyGuard } from './heavyGuard'
import { applyHookEvent, clearActivity } from './sessions'
import type { Sessions } from './sessions'
import { createScheduler } from './scheduler'
import { createKiller, type KillConfirm } from './kill'
import { createDiskManager, createRepoMemory, pathExists, snapshotWorktrees } from './disk'
import { createNotifier, type Notice } from './notifier'
import { loginItemOptions, shouldStartHidden } from './startup'
import { createUpdater } from './updates'
import { localUrlFor } from './open'
import { createQuickActions, isQuickKind } from './quickActions'
import { createFocuser, openNoticeTarget } from './focusWindow'
import { backgroundFor, overlayFor, windowChrome } from './windowChrome'
import { createIconSource } from './icons'
import { createGroupHistory, createRamHistory, loadHistory, saveHistory } from './historyStore'
import { cleanupEvent, createEventLog, diffEvents, diskRemoveEvent } from './events'
import { codexHome, createCodexReader } from './codexRollout'
import { BADGE_COLOR, createTrayController, LEVEL_COLORS } from './tray'
import {
  createIdleCloser,
  shouldReopen,
  trayWindowBounds,
  TRAY_WINDOW_CLOSE_AFTER_MS,
  TRAY_WINDOW_SIZE,
  type Rect
} from './trayWindow'
import { encodePng, renderSmallIcon } from './pixelArt'
import type { MemoryLevel } from '../shared/types'

const APP_ID = 'io.github.yeonjin1357.pitwall'
const platform = toPlatform(process.platform)
let mainWindow: BrowserWindow | null = null
// 모듈 변수로 붙잡아 두지 않으면 GC 되어 트레이 아이콘이 사라진다.
let tray: Tray | null = null
let trayController: ReturnType<typeof createTrayController> | null = null
/** 트레이 '종료'·Cmd+Q 로 끝낼 때만 창을 실제로 닫는다. 그 외 닫기는 숨김. */
let quitting = false
/** 앱이 시작된 시각(화면의 자리 비운 사이 기준 — 트레이로만 시작한 뒤 창을 처음 열 때). */
const appStartedAt = Date.now()

const iconCache = new Map<string, Electron.NativeImage>()
function trayIcon(level: MemoryLevel, badge = false): Electron.NativeImage {
  const key = `${level}:${badge}`
  const cached = iconCache.get(key)
  if (cached) return cached
  const color = LEVEL_COLORS[level]
  const dot = badge ? BADGE_COLOR : undefined
  // 앱 아이콘과 같은 작은 모니터. 그래프 선 색으로 RAM 상태를, 오른쪽 위 점으로 기다리는 에이전트를 보인다
  // (16px 그대로·32px 는 2배).
  const image = nativeImage.createFromBuffer(encodePng(renderSmallIcon(color, 16, dot), 16, 16), {
    scaleFactor: 1
  })
  image.addRepresentation({
    scaleFactor: 2,
    buffer: encodePng(renderSmallIcon(color, 32, dot), 32, 32)
  })
  iconCache.set(key, image)
  return image
}

/** 사용자 설정. 시작할 때 config.json 에서 읽고, 설정 화면에서 저장하면 바로 바꾼다. */
let settings: Settings = DEFAULT_SETTINGS

/** Claude 훅이 알려 주는 세션들. 훅 서버가 채우고 수집기가 읽는다. */
const sessions: Sessions = new Map()

/**
 * Codex 세션 기록 읽기(세션 폴더만, 설정은 바꾸지 않는다). 토큰 숫자·사용 한도(G6)는 설정 readUsage 가 켜져 있을
 * 때만 읽는다.
 */
const codexReader = createCodexReader(codexHome(process.env, homedir()), {
  usage: () => settings.readUsage
})

/** Claude 실행 중 세션 파일 읽기(`<Claude 설정 폴더>/sessions/<pid>.json` 만 읽는다). */
const sessionFileReader = createSessionFileReader({
  dir: join(claudeConfigDir(process.env, homedir()), 'sessions')
})

/**
 * Claude 세션 기록의 토큰 숫자(G6, `<Claude 설정 폴더>/projects` 안의 .jsonl 만 읽는다). 수집은 기억한 값만 쓰고
 * 기록은 뒤에서 하나씩 읽는다(처음 읽는 큰 기록이 수집을 늦추지 않게).
 */
const claudeUsage = createUsageCache({
  reader: createClaudeUsageReader({
    projectsDir: join(claudeConfigDir(process.env, homedir()), 'projects')
  }),
  now: Date.now
})

/** 워크트리마다 커밋 안 한 변경 수(G4, 5분에 한 번 뒤에서 센다). */
const changeCounter = createChangeCounter({ run: countChanges, now: Date.now })

const collector = platform
  ? createCollector({
      platform,
      sample: () => sample(platform),
      readMemory: () => readMemory(platform),
      resolveProcessWorktrees,
      resolveWorktree,
      resolveWorkspace,
      codexInfo: (agent, now) => codexReader.infoFor(agent, now),
      claudeSessionFiles: (agents, now) => sessionFileReader.read(agents, now),
      claudeUsage,
      sessions,
      hookStatus: () => claude.status(),
      codexHookStatus: () => codex.status(),
      changedFiles: changeCounter,
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

/** RAM·묶음 추이(30초·2시간)와 수집기 기억을 userData/history.json 에 이어 쓴다(F8). */
const HISTORY_SAVE_EVERY_MS = 5 * 60 * 1000
const HISTORY_SAVE_TIMEOUT_MS = 2000
const historyPath = join(app.getPath('userData'), 'history.json')
const ramHistory = createRamHistory()
const groupHistory = createGroupHistory()

/** 기록(G3g): 스냅샷 변화와 정리 동작. 새 기록은 앱 창에 바로 보낸다. */
const eventLog = createEventLog({
  onAdded: (events) => {
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send(IPC.eventsAdded, events)
  }
})
/**
 * 기록을 견줄 지난 스냅샷. 지연된 스냅샷은 옛 데이터라 건너뛰어, 수집이 되살아나면 마지막 정상 스냅샷과 견준다.
 * 다시 내보낸 스냅샷(훅 상태·디스크 갱신)도 여기에 들어가므로 같은 변화를 두 번 적지 않는다.
 */
let eventBase: DashboardSnapshot | null = null
/** 무거운 작업별 그동안의 최대 메모리(diffEvents 가 갱신한다). */
const heavyPeaks = new Map<string, number>()

function recordSnapshot(snapshot: DashboardSnapshot): void {
  eventLog.add(diffEvents(eventBase, snapshot, heavyPeaks))
  if (!snapshot.stale) eventBase = snapshot
}

/** 끄기·정리(하나·한꺼번에·작업 공간)로 끈 것이 있으면 기록에 남긴다. */
function recordCleanup(result: KillResult): void {
  const event = cleanupEvent(result, Date.now())
  if (event) eventLog.add([event])
}

async function restoreHistory(): Promise<void> {
  const now = Date.now()
  const loaded = await loadHistory(historyPath, now)
  if (!loaded) return
  ramHistory.import(loaded.ram, now)
  groupHistory.import(loaded.groups, now)
  collector?.importState(loaded, now)
  eventLog.import(loaded.events, now)
}

async function persistHistory(): Promise<void> {
  if (!collector) return
  try {
    await saveHistory(historyPath, {
      version: 2,
      savedAt: Date.now(),
      ram: ramHistory.points(),
      groups: groupHistory.points(),
      ...collector.exportState(),
      events: eventLog.export()
    })
  } catch {
    // 기록을 못 남겨도 앱 동작에는 지장이 없다(다음에 처음부터 센다).
  }
}

const scheduler = createScheduler({
  collect,
  intervals: REFRESH_INTERVALS[settings.refresh],
  onSnapshot: (snapshot) => {
    if (!snapshot.stale && snapshot.memory.totalBytes > 0) {
      ramHistory.record(snapshot.takenAt, snapshot.memory.usedPercent)
      groupHistory.record(snapshot.takenAt, snapshot.groups)
    }
    recordSnapshot(snapshot)
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.snapshot, snapshot)
    if (trayWindow && !trayWindow.isDestroyed() && trayWindow.isVisible())
      trayWindow.webContents.send(IPC.snapshot, snapshot)
    trayController?.update(snapshot)
    notifier.update(snapshot)
  }
})

/** 화면 표의 앱 아이콘(OS 아이콘). 지금 스냅샷에 나온 실행 파일만 답한다. */
const icons = createIconSource({
  latest: () => scheduler.latest(),
  getFileIcon: (path) => app.getFileIcon(path, { size: 'normal' })
})

/** 지금도 폴더인지(없거나 읽을 수 없으면 false). */
const isDirectory = (path: string): Promise<boolean> =>
  stat(path).then(
    (s) => s.isDirectory(),
    () => false
  )

/** 상세 패널의 바로 가기(경로 복사·폴더 열기·터미널 열기). 지금 스냅샷에 있는 폴더만 다룬다. */
const quickActions = createQuickActions({
  latest: () => scheduler.latest(),
  platform: platform ?? 'win32',
  env: process.env,
  // access 는 Windows 에서 파일 속성만 읽어 실행 별칭(WindowsApps\wt.exe)도 있다고 본다.
  exists: (path) =>
    access(path).then(
      () => true,
      () => false
    ),
  isDirectory,
  openPath: (path) => shell.openPath(path),
  writeClipboard: (value) => clipboard.writeText(value),
  spawn: (command, args, options) => spawn(command, args, options)
})

/** 창으로 가기(상세 패널·알림 누르기). 지금 스냅샷의 에이전트만 다룬다. */
const focuser = createFocuser({
  platform: platform ?? 'win32',
  latest: () => scheduler.latest(),
  run: runCommand,
  helperDllPath: windowsHelperDllPath,
  isDirectory
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
  // 에이전트 알림은 먼저 그 에이전트의 창으로 가 보고(설정 notifyClickFocus), 안 되면 pitwall 의 그 항목을 연다.
  note.on('click', () => {
    forget()
    void openNoticeTarget(notice, {
      clickFocus: settings.notifyClickFocus,
      focusAgent: (key) => focuser.focusAgent(key),
      navigate: (key) => navigate({ page: 'dashboard', key })
    })
  })
  note.on('close', forget)
  note.show()
}

const notifier = createNotifier({
  show: showNotice,
  settings: () => settings.notify,
  isFocused: () =>
    !!mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && mainWindow.isFocused(),
  now: Date.now,
  reminderMs: () => settings.waitingReminderMinutes * 60 * 1000
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

// ── 트레이 요약 창(F10): 왼쪽 클릭에 트레이 옆으로 띄우고, 다른 곳을 누르면(포커스를 잃으면) 숨긴다 ──
let trayWindow: BrowserWindow | null = null
let trayHiddenAt: number | null = null
/** 숨긴 요약 창은 1분 뒤 닫아 화면 프로세스 메모리를 돌려준다(다시 열면 새로 만든다). */
const trayCloser = createIdleCloser(TRAY_WINDOW_CLOSE_AFTER_MS, () => {
  if (trayWindow && !trayWindow.isDestroyed() && !trayWindow.isVisible()) trayWindow.destroy()
})

function loadRenderer(window: BrowserWindow, query: Record<string, string> = {}): void {
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    const url = new URL(process.env['ELECTRON_RENDERER_URL'])
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
    void window.loadURL(url.toString())
  } else void window.loadFile(join(__dirname, '../renderer/index.html'), { query })
}

function createTrayWindow(): BrowserWindow {
  const window = new BrowserWindow({
    ...TRAY_WINDOW_SIZE,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    transparent: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    title: text.appName,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  window.on('blur', () => hideTrayWindow())
  window.on('closed', () => {
    if (trayWindow === window) trayWindow = null
  })
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  loadRenderer(window, { view: 'tray' })
  return window
}

function hideTrayWindow(): void {
  if (!trayWindow || trayWindow.isDestroyed() || !trayWindow.isVisible()) return
  trayHiddenAt = Date.now()
  trayWindow.hide()
  trayCloser.hidden()
}

function toggleTrayWindow(bounds: Rect): void {
  if (trayWindow && !trayWindow.isDestroyed() && trayWindow.isVisible()) {
    hideTrayWindow()
    return
  }
  // 창이 포커스를 잃어 막 숨은 직후의 클릭은 "닫기" 뜻이다.
  if (!shouldReopen(trayHiddenAt, Date.now())) return
  const window = trayWindow && !trayWindow.isDestroyed() ? trayWindow : createTrayWindow()
  trayWindow = window
  const display = screen.getDisplayNearestPoint({
    x: Math.round(bounds.x + bounds.width / 2),
    y: Math.round(bounds.y + bounds.height / 2)
  })
  window.setBounds(trayWindowBounds(bounds, display, TRAY_WINDOW_SIZE, platform ?? 'win32'))
  const latest = scheduler.latest()
  if (latest && !window.webContents.isLoading()) window.webContents.send(IPC.snapshot, latest)
  trayCloser.shown()
  window.show()
  window.focus()
  void scheduler.refreshNow()
}

function createTray(): void {
  tray = new Tray(trayIcon('normal'))
  const t = tray
  trayController = createTrayController({
    tray: {
      setContextMenu: (menu) => t.setContextMenu(menu as Menu),
      setToolTip: (tooltip) => t.setToolTip(tooltip),
      setImage: (image) => t.setImage(image as Electron.NativeImage),
      popUpContextMenu: (menu) => t.popUpContextMenu((menu as Menu | null) ?? undefined),
      displayBalloon: (options) => t.displayBalloon(options),
      on: (event, listener) => {
        if (event === 'click') t.on('click', (e, bounds) => listener(e, bounds))
        else t.on('right-click', (e, bounds) => listener(e, bounds))
      }
    },
    onPopover: toggleTrayWindow,
    makeIcon: trayIcon,
    buildMenu: (items) => Menu.buildFromTemplate(items),
    actions: {
      open: showWindow,
      settings: () => navigate({ page: 'settings' }),
      quit: () => app.quit(),
      installUpdate: () => {
        quitting = true
        updater.install()
      },
      openRelease: (url) => void shell.openExternal(url)
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
  // 찾을 때마다 없어진 저장소를 먼저 뺀다(G5a).
  knownRepos: async () => {
    await repoMemory.prune(pathExists)
    return repoMemory.list()
  },
  latest: () => scheduler.latest(),
  resample: () =>
    platform ? sample(platform) : Promise.reject(new Error(text.unsupportedPlatform)),
  confirm: (o) => confirmDialog(o),
  // macOS 수집은 포트를 연 프로세스·에이전트의 작업 폴더만 읽어, 지우기 직전에 전체를 한 번 읽는다.
  fullCwds: platform === 'darwin' ? () => allCwdsDarwin() : undefined,
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

/**
 * Claude 질문 훅(G7)에 답한다(설정이 꺼져 있으면 답하지 않는다). 같은 세션·패턴을 몇 번 미루게 했는지 기억하고,
 * 미루게 하면 기록에 남긴다.
 */
const answerGuard = createGuardAnswerer({
  settings: () => settings,
  latest: () => scheduler.latest(),
  now: Date.now,
  record: (event) => eventLog.add([event])
})

/**
 * Claude·Codex 연동이 같이 쓰는 훅 서버. 이벤트가 오면 세션 상태를 바꾸고 화면을 바로 갱신한다.
 * 하는 일(G3b) 보기가 꺼져 있으면 이벤트의 내용(제목·요청·도구)은 받는 순간 버린다.
 */
const hookHub = createHookHub({
  onEvent: (event, tool) => {
    if (applyHookEvent(sessions, event, Date.now(), tool, { activity: settings.showAgentActivity }))
      scheduleRestate()
  },
  onGuard: answerGuard
})

const claude = createClaudeIntegration({
  userData: app.getPath('userData'),
  configDir: claudeConfigDir(process.env, homedir()),
  platform: platform ?? 'win32',
  systemRoot: process.env.SystemRoot,
  sessions,
  hub: hookHub,
  now: Date.now,
  confirm: confirmDialog,
  guard: () => settings.heavyGuard
})

/** Codex 연동: 사용자가 켤 때만 $CODEX_HOME/hooks.json 을 바꾼다. */
const codex = createCodexIntegration({
  userData: app.getPath('userData'),
  codexHome: codexHome(process.env, homedir()),
  platform: platform ?? 'win32',
  systemRoot: process.env.SystemRoot,
  hub: hookHub,
  sessions,
  now: Date.now,
  confirm: confirmDialog
})

/** 새 버전 확인: 시작 10초 뒤, 6시간마다, 설정에서 켤 때. */
const UPDATE_FIRST_CHECK_MS = 10 * 1000
const UPDATE_CHECK_EVERY_MS = 6 * 60 * 60 * 1000
const updater = createUpdater({
  platform: platform ?? 'win32',
  packaged: app.isPackaged,
  currentVersion: app.getVersion(),
  enabled: () => settings.updateCheck,
  fetchJson: async (url) => {
    // 사용자 정보는 보내지 않는다(일반 이름의 User-Agent 만).
    const response = await net.fetch(url, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Corral' }
    })
    if (!response.ok) throw new Error(`GitHub ${response.status}`)
    return response.json()
  },
  // 설치한 Windows 앱만 자동 업데이트(macOS 는 서명이 없어 설치할 수 없다).
  autoUpdater: process.platform === 'win32' && app.isPackaged ? autoUpdater : null,
  now: Date.now,
  onChange: (status) => {
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send(IPC.updateChanged, status)
    trayController?.setUpdate(status)
  }
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
  // 하는 일(G3b) 보기를 끄면 들고 있던 내용도 지운다(화면은 저장 뒤 새로 수집할 때 비워진다).
  if (!next.showAgentActivity) clearActivity(sessions)
  // 토큰·한도(G6) 읽기를 끄면 들고 있던 숫자를 바로 버린다(Claude 는 읽던 위치도, Codex 는 숫자만).
  if (!next.readUsage) {
    claudeUsage.clear()
    codexReader.dropUsage()
  }
  scheduler.setIntervals(REFRESH_INTERVALS[next.refresh])
  // 화면(prefers-color-scheme)과 확인 창·메뉴가 같은 테마를 따르도록 OS 테마 설정을 바꾼다.
  nativeTheme.themeSource = next.theme === 'auto' ? 'system' : next.theme
  const login = loginItemOptions(next, app.isPackaged)
  if (login) app.setLoginItemSettings(login)
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.send(IPC.settingsChanged, next)
}

/** config.json 에 저장하고 앱 전체에 반영한다. */
async function persistSettings(next: Settings): Promise<Settings> {
  const saved = await updateConfig(app.getPath('userData'), (c) => ({ ...c, settings: next }))
  applySettings(saved.settings)
  return saved.settings
}

/**
 * 설정 저장 중에 Claude 설정 파일을 바꾸지 못한 이유를 OS 창으로 알린다(설정 화면의 저장 결과에는 설정만 돌아가고,
 * 연동 카드의 알림 줄은 렌더러가 연동 켜기를 눌렀을 때만 쓴다). 기다리지 않는다.
 */
function showHookFailure(title: string, message: string): void {
  const box = { type: 'error' as const, noLink: true, title, message }
  void (mainWindow && !mainWindow.isDestroyed()
    ? dialog.showMessageBox(mainWindow, box)
    : dialog.showMessageBox(box))
}

async function saveSettings(next: unknown): Promise<Settings> {
  const before = settings
  const normalized = normalizeSettings(next)
  // 무거운 작업 기다리게 하기(G7)를 바꿨으면 질문 훅도 맞춘다(켜기는 설치한 뒤 저장, 끄기는 저장한 뒤 뺄지 묻는다).
  const { saved, failure } = await settleHeavyGuard({
    before,
    next: normalized,
    integration: async () => (await claude.status()).state,
    save: persistSettings,
    rewrite: (on) => claude.enable(on ? 'guardOn' : 'guardOff')
  })
  if (failure)
    showHookFailure(
      normalized.heavyGuard ? text.claudeHook.guardOnTitle : text.claudeHook.guardOffTitle,
      failure
    )
  void scheduler.refreshNow()
  if (saved.updateCheck && !before.updateCheck) void updater.check()
  const diskChanged =
    JSON.stringify([before.dependencyDirs, before.extraRepos, before.staleWorktreeDays]) !==
    JSON.stringify([saved.dependencyDirs, saved.extraRepos, saved.staleWorktreeDays])
  if (diskChanged) void disk.scan({ manual: true })
  return saved
}

function registerIpc(): void {
  const fromMainWindow = (sender: Electron.WebContents): boolean =>
    !!mainWindow && !mainWindow.isDestroyed() && sender === mainWindow.webContents
  const fromTrayWindow = (sender: Electron.WebContents): boolean =>
    !!trayWindow && !trayWindow.isDestroyed() && sender === trayWindow.webContents

  // 트레이 요약 창은 스냅샷 읽기와 아래 동작만 할 수 있다(끄기·설정 바꾸기는 앱 창에서 확인 창을 거친다).
  ipcMain.handle(IPC.getLatest, (event) =>
    fromMainWindow(event.sender) || fromTrayWindow(event.sender) ? scheduler.latest() : null
  )
  ipcMain.handle(IPC.trayAction, (event, arg: unknown) => {
    if (!fromTrayWindow(event.sender)) return
    const { kind, key } = (arg ?? {}) as { kind?: unknown; key?: unknown }
    hideTrayWindow()
    if (kind === 'open') showWindow()
    else if (kind === 'settings') navigate({ page: 'settings' })
    else if (kind === 'quit') app.quit()
    else if (kind === 'item' && typeof key === 'string' && key.length <= 1000)
      navigate({ page: 'dashboard', key })
  })
  ipcMain.handle(IPC.historyRam, (event) =>
    fromMainWindow(event.sender) ? ramHistory.points() : []
  )
  ipcMain.handle(IPC.historyGroups, (event) =>
    fromMainWindow(event.sender) ? groupHistory.points() : []
  )
  ipcMain.handle(IPC.eventsGet, (event) => (fromMainWindow(event.sender) ? eventLog.list() : []))
  ipcMain.handle(IPC.killServer, async (event, pid: unknown) => {
    if (!fromMainWindow(event.sender)) return { status: 'failed', message: text.killResult.invalid }
    const result = await killer.killServer(Number(pid))
    recordCleanup(result)
    void scheduler.refreshNow()
    return result
  })
  ipcMain.handle(IPC.killLeftover, async (event, pid: unknown) => {
    if (!fromMainWindow(event.sender)) return { status: 'failed', message: text.killResult.invalid }
    const result = await killer.killLeftover(Number(pid))
    recordCleanup(result)
    void scheduler.refreshNow()
    return result
  })
  ipcMain.handle(IPC.killMany, async (event, keys: unknown) => {
    if (!fromMainWindow(event.sender)) return { status: 'failed', message: text.killResult.invalid }
    const result = await killer.killMany(keys as string[])
    recordCleanup(result)
    void scheduler.refreshNow()
    return result
  })
  ipcMain.handle(IPC.cleanupWorkspace, async (event, root: unknown) => {
    if (!fromMainWindow(event.sender)) return { status: 'failed', message: text.killResult.invalid }
    const result = await killer.cleanupWorkspace(root as string)
    recordCleanup(result)
    void scheduler.refreshNow()
    return result
  })
  ipcMain.handle(IPC.diskScan, async (event) =>
    fromMainWindow(event.sender) ? disk.scan({ manual: true }) : null
  )
  ipcMain.handle(IPC.diskRemove, async (event, root: unknown) => {
    if (!fromMainWindow(event.sender)) return { status: 'failed', message: text.killResult.invalid }
    const target = typeof root === 'string' ? root : ''
    const result = await disk.remove(target)
    const removed = diskRemoveEvent(target, result, Date.now())
    if (removed) eventLog.add([removed])
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
  ipcMain.handle(IPC.codexHookStatus, async (event) =>
    fromMainWindow(event.sender) ? codex.status() : null
  )
  ipcMain.handle(IPC.codexHookEnable, async (event) => {
    if (!fromMainWindow(event.sender)) return { status: 'cancelled' }
    const result = await codex.enable()
    void scheduler.refreshNow()
    return result
  })
  ipcMain.handle(IPC.codexHookDisable, async (event) => {
    if (!fromMainWindow(event.sender)) return { status: 'cancelled' }
    const result = await codex.disable()
    void scheduler.refreshNow()
    return result
  })
  ipcMain.handle(IPC.appInfo, () => ({ version: app.getVersion(), startedAt: appStartedAt }))
  ipcMain.handle(IPC.fileIcon, (event, path: unknown) =>
    fromMainWindow(event.sender) || fromTrayWindow(event.sender) ? icons.get(path) : null
  )
  ipcMain.handle(IPC.updateGet, (event) => (fromMainWindow(event.sender) ? updater.status() : null))
  ipcMain.handle(IPC.updateCheck, async (event) =>
    fromMainWindow(event.sender) ? updater.check() : null
  )
  ipcMain.handle(IPC.updateInstall, (event) => {
    if (!fromMainWindow(event.sender)) return
    quitting = true
    updater.install()
  })
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
  ipcMain.handle(IPC.quick, async (event, kind: unknown, path: unknown) => {
    if (!fromMainWindow(event.sender) || !isQuickKind(kind) || typeof path !== 'string')
      return false
    return quickActions.run(kind, path)
  })
  // 키는 믿지 않는다: 문자열·길이를 보고, 지금 스냅샷의 에이전트인지는 focuser 가 확인한다.
  ipcMain.handle(IPC.focusAgent, async (event, key: unknown) => {
    if (!fromMainWindow(event.sender) || typeof key !== 'string') return false
    return focuser.focusAgent(key)
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
    ...windowChrome(process.platform, nativeTheme.shouldUseDarkColors),
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // 테마가 바뀌면(설정·OS) 창 단추 줄과 바탕색도 화면 제목줄 색에 맞춘다.
  const syncChrome = (): void => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    const dark = nativeTheme.shouldUseDarkColors
    mainWindow.setBackgroundColor(backgroundFor(dark))
    if (process.platform !== 'darwin') mainWindow.setTitleBarOverlay(overlayFor(dark))
  }
  nativeTheme.on('updated', syncChrome)
  mainWindow.on('closed', () => nativeTheme.off('updated', syncChrome))

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

// 화면은 표·SVG 그래프뿐이라 GPU 가 필요 없다. 끄면 GPU 프로세스 메모리(요약 창을 연 뒤 약 130 MB)를 아낀다.
app.disableHardwareAcceleration()

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
    // 없어진 저장소(지운 저장소·테스트가 남긴 임시 저장소)는 불러온 뒤 한 번 뺀다(G5a). 기다리지 않는다.
    void repoMemory.prune(pathExists)
    // 첫 수집 전에 불러와야 판단 기억이 이어진다.
    await restoreHistory()
    setInterval(() => void persistHistory(), HISTORY_SAVE_EVERY_MS).unref()
    setTimeout(() => void disk.scan(), DISK_FIRST_SCAN_MS)
    setInterval(() => void disk.scan(), DISK_SCAN_EVERY_MS)
    setTimeout(() => void updater.check(), UPDATE_FIRST_CHECK_MS)
    setInterval(() => void updater.check(), UPDATE_CHECK_EVERY_MS)

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    prepareWindowsHelper()
    registerIpc()
    void claude.start()
    void codex.start()
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

  let historySaved = false
  app.on('before-quit', (event) => {
    quitting = true
    scheduler.stop()
    trayCloser.dispose()
    void hookHub.stop()
    // 기록을 남기고 끝낸다. 오래 걸리면(디스크 문제) 기다리지 않는다.
    if (historySaved) return
    historySaved = true
    event.preventDefault()
    void Promise.race([
      persistHistory(),
      new Promise((resolve) => setTimeout(resolve, HISTORY_SAVE_TIMEOUT_MS))
    ]).finally(() => app.quit())
  })
}
