import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type PitwallApi } from '../shared/ipc'
import type { DashboardSnapshot } from '../shared/types'

/** 렌더러에는 pitwall 이 쓰는 세 가지 동작만 노출한다(ipcRenderer 전체를 넘기지 않음). */
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
  killPort: (port, pid) => ipcRenderer.invoke(IPC.killPort, { port, pid })
}

contextBridge.exposeInMainWorld('pitwall', api)
