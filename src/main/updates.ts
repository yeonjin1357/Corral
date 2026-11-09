import type { Platform, UpdateStatus } from '../shared/types'

/** 새 버전 확인. pitwall 이 하는 유일한 인터넷 접속이고, 설정에서 끈다. */

export const RELEASES_API = 'https://api.github.com/repos/yeonjin1357/pitwall/releases/latest'
const RELEASE_PAGE = /^https:\/\/github\.com\/yeonjin1357\/pitwall\/releases\//

/** electron-updater 의 autoUpdater 중 pitwall 이 쓰는 부분(테스트에서 가짜로 바꿔 끼운다). */
export interface AutoUpdaterLike {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  checkForUpdates(): Promise<unknown>
  quitAndInstall(): void
  on(event: string, listener: (...args: unknown[]) => void): unknown
}

function parts(v: string): { nums: number[]; pre: boolean } {
  const [core, pre] = v.replace(/^v/i, '').split('-', 2)
  return { nums: core.split('.').map((n) => Number(n) || 0), pre: pre !== undefined }
}

/** 0.2.0 > 0.1.9, v 접두어 무시, 같은 번호면 정식 > 미리보기(-beta). */
export function compareVersions(a: string, b: string): number {
  const x = parts(a)
  const y = parts(b)
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0)
    if (d !== 0) return d
  }
  return Number(y.pre) - Number(x.pre)
}

/** GitHub 의 최신 릴리스(초안·미리보기 제외는 GitHub 이 해 준다). 형식이 다르면 null. */
export async function latestRelease(
  fetchJson: (url: string) => Promise<unknown>
): Promise<{ version: string; url: string } | null> {
  const value = (await fetchJson(RELEASES_API)) as { tag_name?: unknown; html_url?: unknown }
  if (typeof value?.tag_name !== 'string' || typeof value?.html_url !== 'string') return null
  // 알려 줄 주소는 이 저장소의 릴리스 페이지만(다른 곳으로 가는 링크를 띄우지 않는다).
  if (!RELEASE_PAGE.test(value.html_url)) return null
  return { version: value.tag_name.replace(/^v/i, ''), url: value.html_url }
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * Windows 는 electron-updater 로 GitHub 게시본을 내려받아 종료할 때(또는 "다시 시작해 설치") 설치한다.
 * macOS 는 서명이 없어 자동 설치가 안 되므로 최신 릴리스만 확인해 페이지를 알려 준다.
 * 개발 실행이거나 설정에서 끄면 확인하지 않는다.
 */
export function createUpdater(deps: {
  platform: Platform
  packaged: boolean
  currentVersion: string
  enabled: () => boolean
  fetchJson: (url: string) => Promise<unknown>
  /** Windows 설치본에서만 넘긴다. */
  autoUpdater: AutoUpdaterLike | null
  now: () => number
  onChange: (s: UpdateStatus) => void
}): { status(): UpdateStatus; check(): Promise<UpdateStatus>; install(): void } {
  let current: UpdateStatus = {
    state: 'idle',
    version: null,
    url: null,
    error: null,
    checkedAt: null
  }
  const set = (next: Partial<UpdateStatus>): UpdateStatus => {
    current = { ...current, ...next }
    deps.onChange(current)
    return current
  }
  const auto = deps.platform === 'win32' ? deps.autoUpdater : null

  if (auto) {
    auto.autoDownload = true
    auto.autoInstallOnAppQuit = true
    const versionOf = (info: unknown): string | null =>
      typeof (info as { version?: unknown })?.version === 'string'
        ? (info as { version: string }).version
        : null
    auto.on('checking-for-update', () => set({ state: 'checking', error: null }))
    auto.on('update-available', (info) =>
      set({ state: 'downloading', version: versionOf(info), checkedAt: deps.now() })
    )
    auto.on('update-not-available', () =>
      set({ state: 'none', version: null, checkedAt: deps.now() })
    )
    auto.on('update-downloaded', (info) => set({ state: 'ready', version: versionOf(info) }))
    auto.on('error', (e) => set({ state: 'error', error: message(e), checkedAt: deps.now() }))
  }

  async function check(): Promise<UpdateStatus> {
    if (!deps.packaged || !deps.enabled()) return set({ state: 'disabled', error: null })
    if (current.state === 'downloading' || current.state === 'ready') return current
    set({ state: 'checking', error: null })
    if (auto) {
      try {
        await auto.checkForUpdates()
      } catch (e) {
        return set({ state: 'error', error: message(e), checkedAt: deps.now() })
      }
      return current
    }
    try {
      const latest = await latestRelease(deps.fetchJson)
      const newer = latest && compareVersions(latest.version, deps.currentVersion) > 0
      return set(
        newer
          ? { state: 'available', version: latest.version, url: latest.url, checkedAt: deps.now() }
          : { state: 'none', version: null, url: null, checkedAt: deps.now() }
      )
    } catch (e) {
      return set({ state: 'error', error: message(e), checkedAt: deps.now() })
    }
  }

  return {
    status: () => current,
    check,
    install() {
      if (auto && current.state === 'ready') auto.quitAndInstall()
    }
  }
}
