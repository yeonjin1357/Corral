import type { Platform } from '../shared/types'
import type { Settings } from '../shared/settings'

/** 로그인 항목이 넘기는 인자. 이것으로 켜지면 창 없이 트레이로만 시작한다(Windows). */
export const HIDDEN_ARG = '--hidden'

/**
 * 로그인할 때 실행할지 OS 에 등록할 값. 설치된 앱에서만 등록한다 — 개발 실행에서 등록하면
 * 로그인할 때마다 electron.exe 가 뜬다. null 이면 건드리지 않는다.
 */
export function loginItemOptions(
  s: Pick<Settings, 'launchAtLogin'>,
  packaged: boolean
): { openAtLogin: boolean; args: string[] } | null {
  if (!packaged) return null
  return { openAtLogin: s.launchAtLogin, args: s.launchAtLogin ? [HIDDEN_ARG] : [] }
}

/** 로그인으로 켜졌으면 창을 띄우지 않는다. macOS 는 로그인 항목 인자를 넘기지 않아 OS 가 알려 주는 값을 쓴다. */
export function shouldStartHidden(
  argv: string[],
  platform: Platform,
  wasOpenedAtLogin: boolean
): boolean {
  return argv.includes(HIDDEN_ARG) || (platform === 'darwin' && wasOpenedAtLogin)
}
