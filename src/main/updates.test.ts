import { EventEmitter } from 'events'
import {
  compareVersions,
  createUpdater,
  latestRelease,
  RELEASES_API,
  type AutoUpdaterLike
} from './updates'

describe('compareVersions', () => {
  test.each([
    ['0.2.0', '0.1.9', 1],
    ['v0.10.0', '0.9.0', 1],
    ['1.0.0', '1.0.0', 0],
    ['1.0.0', 'v1.0.1', -1],
    ['1.0.0-beta.1', '1.0.0', -1],
    ['1.0', '1.0.0', 0]
  ])('%s vs %s → %i', (a, b, expected) => {
    expect(Math.sign(compareVersions(a, b))).toBe(expected)
  })
})

describe('latestRelease', () => {
  test('GitHub 최신 릴리스의 버전과 페이지 주소', async () => {
    const fetchJson = vi.fn(async () => ({
      tag_name: 'v0.2.0',
      html_url: 'https://github.com/yeonjin1357/pitwall/releases/tag/v0.2.0',
      draft: false,
      prerelease: false
    }))
    expect(await latestRelease(fetchJson)).toEqual({
      version: '0.2.0',
      url: 'https://github.com/yeonjin1357/pitwall/releases/tag/v0.2.0'
    })
    expect(fetchJson).toHaveBeenCalledWith(RELEASES_API)
  })

  test('형식이 다르거나 GitHub 이 아닌 주소면 null', async () => {
    expect(await latestRelease(async () => ({ message: 'Not Found' }))).toBeNull()
    expect(
      await latestRelease(async () => ({ tag_name: 'v9.0.0', html_url: 'https://evil.example/x' }))
    ).toBeNull()
  })
})

function fakeAutoUpdater(): AutoUpdaterLike &
  EventEmitter & {
    checkForUpdates: ReturnType<typeof vi.fn>
    quitAndInstall: (() => void) & ReturnType<typeof vi.fn>
  } {
  const e = new EventEmitter() as AutoUpdaterLike &
    EventEmitter & {
      checkForUpdates: ReturnType<typeof vi.fn>
      quitAndInstall: (() => void) & ReturnType<typeof vi.fn>
    }
  e.autoDownload = false
  e.autoInstallOnAppQuit = false
  e.checkForUpdates = vi.fn(async () => null)
  e.quitAndInstall = vi.fn() as unknown as (() => void) & ReturnType<typeof vi.fn>
  return e
}

function deps(
  over: Partial<Parameters<typeof createUpdater>[0]> = {}
): Parameters<typeof createUpdater>[0] {
  return {
    platform: 'win32',
    packaged: true,
    currentVersion: '0.1.0',
    enabled: () => true,
    fetchJson: async () => ({
      tag_name: 'v0.2.0',
      html_url: 'https://github.com/yeonjin1357/pitwall/releases/tag/v0.2.0'
    }),
    autoUpdater: null,
    now: () => 1000,
    onChange: () => {},
    ...over
  }
}

describe('createUpdater', () => {
  test('개발 실행이거나 설정에서 끄면 확인하지 않는다(네트워크 없음)', async () => {
    const fetchJson = vi.fn()
    const dev = createUpdater(deps({ packaged: false, fetchJson }))
    expect((await dev.check()).state).toBe('disabled')
    const off = createUpdater(deps({ enabled: () => false, fetchJson }))
    expect((await off.check()).state).toBe('disabled')
    expect(fetchJson).not.toHaveBeenCalled()
  })

  test('Windows: 자동 업데이트로 내려받고, 다 받으면 다시 시작해 설치할 수 있다', async () => {
    const auto = fakeAutoUpdater()
    const changes: string[] = []
    const updater = createUpdater(
      deps({ autoUpdater: auto, onChange: (s) => changes.push(s.state) })
    )
    expect(auto.autoDownload).toBe(true)
    expect(auto.autoInstallOnAppQuit).toBe(true)
    await updater.check()
    expect(auto.checkForUpdates).toHaveBeenCalled()
    auto.emit('checking-for-update')
    auto.emit('update-available', { version: '0.2.0' })
    auto.emit('update-downloaded', { version: '0.2.0' })
    expect(updater.status()).toMatchObject({ state: 'ready', version: '0.2.0' })
    expect(changes).toEqual(['checking', 'checking', 'downloading', 'ready'])
    updater.install()
    expect(auto.quitAndInstall).toHaveBeenCalled()
  })

  test('Windows: 새 버전이 없거나 오류면 그렇게', async () => {
    const auto = fakeAutoUpdater()
    const updater = createUpdater(deps({ autoUpdater: auto }))
    await updater.check()
    auto.emit('update-not-available', { version: '0.1.0' })
    expect(updater.status()).toMatchObject({ state: 'none', checkedAt: 1000 })
    auto.emit('error', new Error('net::ERR_INTERNET_DISCONNECTED'))
    expect(updater.status()).toMatchObject({
      state: 'error',
      error: 'net::ERR_INTERNET_DISCONNECTED'
    })
    // 받지 않은 상태에서는 설치하지 않는다.
    updater.install()
    expect(auto.quitAndInstall).not.toHaveBeenCalled()
  })

  test('Windows: 내려받는 중 소식이 30분 넘게 없으면 다시 확인할 수 있다(멈춘 상태로 남지 않게)', async () => {
    const auto = fakeAutoUpdater()
    const clock = { now: 1000 }
    const updater = createUpdater(deps({ autoUpdater: auto, now: () => clock.now }))
    await updater.check()
    auto.emit('update-available', { version: '0.2.0' })
    await updater.check()
    expect(auto.checkForUpdates).toHaveBeenCalledTimes(1)
    clock.now += 31 * 60 * 1000
    await updater.check()
    expect(auto.checkForUpdates).toHaveBeenCalledTimes(2)
  })

  test('macOS(서명 없음): 최신 릴리스만 확인해 새 버전 페이지를 알려 준다', async () => {
    const updater = createUpdater(deps({ platform: 'darwin' }))
    expect(await updater.check()).toMatchObject({
      state: 'available',
      version: '0.2.0',
      url: 'https://github.com/yeonjin1357/pitwall/releases/tag/v0.2.0'
    })
    const same = createUpdater(deps({ platform: 'darwin', currentVersion: '0.2.0' }))
    expect((await same.check()).state).toBe('none')
    const failing = createUpdater(
      deps({
        platform: 'darwin',
        fetchJson: async () => {
          throw new Error('offline')
        }
      })
    )
    expect(await failing.check()).toMatchObject({ state: 'error', error: 'offline' })
  })
})
