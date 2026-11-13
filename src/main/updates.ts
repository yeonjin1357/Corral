import type { Platform, UpdateStatus } from '../shared/types'
import { text } from '../shared/text'
import {
  MAC_INSTALL_COMMAND,
  MAC_RELEASE_PAGE,
  MacUpdateError,
  parseLatestMac,
  type MacArch,
  type MacRelease
} from './macUpdate'

/** 새 버전 확인. pitwall 이 하는 유일한 인터넷 접속이고, 설정에서 끈다. */

export const RELEASES_API = 'https://api.github.com/repos/yeonjin1357/Corral/releases/latest'
/** 내려받는 중 소식이 이만큼 없으면 멈춘 것으로 본다. */
const DOWNLOAD_STALL_MS = 30 * 60 * 1000
/**
 * 알려 줄 수 있는 릴리스 페이지(이 저장소만). 저장소 이름이 pitwall → Corral 로 바뀌어 GitHub 이 새 이름의 주소를
 * 돌려준다. GitHub 저장소 이름은 대소문자를 가리지 않으므로 대소문자를 무시한다.
 */
const RELEASE_PAGE = /^https:\/\/github\.com\/yeonjin1357\/corral\/releases\//i

/** electron-updater 의 autoUpdater 중 pitwall 이 쓰는 부분(테스트에서 가짜로 바꿔 끼운다). */
export interface AutoUpdaterLike {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  checkForUpdates(): Promise<unknown>
  quitAndInstall(): void
  on(event: string, listener: (...args: unknown[]) => void): unknown
}

/** macOS 설치본의 앱 안 업데이트(macUpdate.ts)에 필요한 것. */
export interface MacUpdateDeps {
  arch: MacArch
  /** 릴리스 정보(latest-mac.yml)의 글자. */
  fetchFeed: () => Promise<string>
  /** 내려받아 새 앱을 풀어 두고 바꿔 넣을 도우미를 띄운다. 실패하면 MacUpdateError. */
  install: (release: MacRelease) => Promise<void>
  /** 앱을 끝낸다(도우미가 그 뒤에 바꿔 넣고 다시 연다). */
  quit: () => void
  /** 지난번에 도우미가 바꿔 넣지 못했는지(남긴 표시를 읽고 지운다). */
  failedBefore: () => boolean
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
 * macOS 설치본은 서명이 없어 electron-updater 를 쓸 수 없다. 릴리스 정보 파일로 새 버전을 확인하고, 사용자가 누르면
 * 직접 내려받아 앱을 바꿔 넣는다(mac). 바꿔 넣지 못하면 앱은 그대로 두고 설치 한 줄을 알린다.
 * mac 이 없는 macOS(예전 방식)는 최신 릴리스만 확인해 페이지를 알려 준다.
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
  /** macOS 설치본에서만 넘긴다. */
  mac?: MacUpdateDeps | null
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
  const mac = deps.platform === 'darwin' ? (deps.mac ?? null) : null
  /** 앱 안에서 바꿔 넣지 못한 까닭. 있으면 다시 시도하지 않고 설치 한 줄을 알린다. */
  let macBroken: string | null = mac?.failedBefore() ? text.update.macFailed.swap : null
  /** 확인해 둔 새 버전(업데이트를 누르면 이것을 받는다). */
  let macRelease: MacRelease | null = null

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

  /** macOS 설치본: 새 버전이 있음을 알린다(앱 안에서 바꿔 넣을 수 있는지와, 안 될 때 쓸 설치 한 줄까지). */
  const macAvailable = (release: MacRelease): UpdateStatus =>
    set({
      state: 'available',
      version: release.version,
      url: MAC_RELEASE_PAGE,
      error: macBroken,
      checkedAt: deps.now(),
      selfInstall: macBroken == null,
      installCommand: MAC_INSTALL_COMMAND
    })

  async function checkMac(feed: MacUpdateDeps): Promise<UpdateStatus> {
    try {
      const release = parseLatestMac(await feed.fetchFeed(), feed.arch)
      if (!release)
        return set({ state: 'error', error: text.update.feedUnreadable, checkedAt: deps.now() })
      if (compareVersions(release.version, deps.currentVersion) <= 0) {
        macRelease = null
        return set({ state: 'none', version: null, url: null, checkedAt: deps.now() })
      }
      macRelease = release
      return macAvailable(release)
    } catch (e) {
      return set({ state: 'error', error: message(e), checkedAt: deps.now() })
    }
  }

  async function check(): Promise<UpdateStatus> {
    if (!deps.packaged || !deps.enabled()) return set({ state: 'disabled', error: null })
    if (current.state === 'ready') return current
    // 내려받는 중이면 기다린다. 소식(완료·오류)이 너무 오래 없으면 멈춘 것으로 보고 다시 확인한다.
    if (
      current.state === 'downloading' &&
      deps.now() - (current.checkedAt ?? 0) < DOWNLOAD_STALL_MS
    )
      return current
    set({ state: 'checking', error: null })
    if (auto) {
      try {
        await auto.checkForUpdates()
      } catch (e) {
        return set({ state: 'error', error: message(e), checkedAt: deps.now() })
      }
      return current
    }
    if (mac) return checkMac(mac)
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

  /** macOS 설치본: 내려받아 바꿔 넣을 준비를 하고 앱을 끝낸다. 실패하면 앱은 그대로, 까닭을 알린다. */
  function installMac(feed: MacUpdateDeps, release: MacRelease): void {
    set({ state: 'downloading', error: null, checkedAt: deps.now() })
    feed.install(release).then(
      () => feed.quit(),
      (e: unknown) => {
        macBroken =
          e instanceof MacUpdateError ? text.update.macFailed[e.code] : text.update.macFailed.swap
        macAvailable(release)
      }
    )
  }

  return {
    status: () => current,
    check,
    install() {
      if (auto && current.state === 'ready') auto.quitAndInstall()
      if (mac && current.state === 'available' && current.selfInstall && macRelease)
        installMac(mac, macRelease)
    }
  }
}
