import type { PitwallApi } from '../shared/ipc'

declare global {
  interface Window {
    pitwall: PitwallApi
  }
}
