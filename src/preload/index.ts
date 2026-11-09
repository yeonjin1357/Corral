import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type NavigateTarget, type PitwallApi } from '../shared/ipc'
import type { DashboardSnapshot, UpdateStatus } from '../shared/types'
import type { Settings } from '../shared/settings'

/** 렌더러에는 pitwall 이 쓰는 동작만 노출한다(ipcRenderer 전체를 넘기지 않음). */
const api: PitwallApi = {
  onSnapshot(callback) {
    const handler = (_event: IpcRendererEvent, snapshot: DashboardSnapshot): void =>
      callback(snapshot)
    ipcRenderer.on(IPC.snapshot, handler)
    return () => {
      ipcRenderer.removeListener(IPC.snapshot, handler)
    }
  },
  getLatest: () => ipcRenderer.invoke(IPC.getLatest),
  historyRam: () => ipcRenderer.invoke(IPC.historyRam),
  tray: {
    action: (kind, key) => ipcRenderer.invoke(IPC.trayAction, { kind, key })
  },
  appInfo: () => ipcRenderer.invoke(IPC.appInfo),
  fileIcon: (path) => ipcRenderer.invoke(IPC.fileIcon, path),
  update: {
    get: () => ipcRenderer.invoke(IPC.updateGet),
    check: () => ipcRenderer.invoke(IPC.updateCheck),
    install: () => ipcRenderer.invoke(IPC.updateInstall),
    onChange(callback) {
      const handler = (_event: IpcRendererEvent, status: UpdateStatus): void => callback(status)
      ipcRenderer.on(IPC.updateChanged, handler)
      return () => {
        ipcRenderer.removeListener(IPC.updateChanged, handler)
      }
    }
  },
  onNavigate(callback) {
    const handler = (_event: IpcRendererEvent, target: NavigateTarget): void => callback(target)
    ipcRenderer.on(IPC.navigate, handler)
    return () => {
      ipcRenderer.removeListener(IPC.navigate, handler)
    }
  },
  killServer: (pid) => ipcRenderer.invoke(IPC.killServer, pid),
  killLeftover: (pid) => ipcRenderer.invoke(IPC.killLeftover, pid),
  killMany: (keys) => ipcRenderer.invoke(IPC.killMany, keys),
  cleanupWorkspace: (root) => ipcRenderer.invoke(IPC.cleanupWorkspace, root),
  diskScan: () => ipcRenderer.invoke(IPC.diskScan),
  diskRemove: (worktreeRoot) => ipcRenderer.invoke(IPC.diskRemove, worktreeRoot),
  refreshNow: () => ipcRenderer.invoke(IPC.refreshNow),
  openPort: (port) => ipcRenderer.invoke(IPC.openPort, port),
  claudeHook: {
    status: () => ipcRenderer.invoke(IPC.claudeHookStatus),
    enable: () => ipcRenderer.invoke(IPC.claudeHookEnable),
    disable: () => ipcRenderer.invoke(IPC.claudeHookDisable)
  },
  codexHook: {
    status: () => ipcRenderer.invoke(IPC.codexHookStatus),
    enable: () => ipcRenderer.invoke(IPC.codexHookEnable),
    disable: () => ipcRenderer.invoke(IPC.codexHookDisable)
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    save: (next) => ipcRenderer.invoke(IPC.settingsSave, next),
    pickFolder: () => ipcRenderer.invoke(IPC.settingsPickFolder),
    onChange(callback) {
      const handler = (_event: IpcRendererEvent, settings: Settings): void => callback(settings)
      ipcRenderer.on(IPC.settingsChanged, handler)
      return () => {
        ipcRenderer.removeListener(IPC.settingsChanged, handler)
      }
    }
  }
}

contextBridge.exposeInMainWorld('pitwall', api)
