import { EventEmitter } from 'events'
import {
  compareVersions,
  createUpdater,
  latestRelease,
  RELEASES_API,
  type AutoUpdaterLike,
  type MacUpdateDeps
} from './updates'
import { MacUpdateError, type MacRelease } from './macUpdate'

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
      html_url: 'https://github.com/yeonjin1357/Corral/releases/tag/v0.2.0',
      draft: false,
      prerelease: false
    }))
    expect(await latestRelease(fetchJson)).toEqual({
      version: '0.2.0',
      url: 'https://github.com/yeonjin1357/Corral/releases/tag/v0.2.0'
    })
    expect(fetchJson).toHaveBeenCalledWith(RELEASES_API)
  })

  test('형식이 다르거나 GitHub 이 아닌 주소면 null', async () => {
    expect(await latestRelease(async () => ({ message: 'Not Found' }))).toBeNull()
    expect(
      await latestRelease(async () => ({ tag_name: 'v9.0.0', html_url: 'https://evil.example/x' }))
    ).toBeNull()
    // 같은 GitHub 이라도 다른 저장소의 릴리스는 알려 주지 않는다.
    expect(
      await latestRelease(async () => ({
        tag_name: 'v9.0.0',
        html_url: 'https://github.com/someone/else/releases/tag/v9.0.0'
      }))
    ).toBeNull()
  })

  test('저장소 이름이 Corral 로 바뀐 뒤 GitHub 이 주는 새 주소를 받아들이고, 새 이름으로 묻는다', async () => {
    // GitHub 는 저장소 이름을 바꾸면 API 에서 새 이름(대소문자 그대로)의 주소를 돌려준다.
    for (const html_url of [
      'https://github.com/yeonjin1357/Corral/releases/tag/v0.3.0',
      'https://github.com/yeonjin1357/corral/releases/tag/v0.3.0'
    ]) {
      expect(await latestRelease(async () => ({ tag_name: 'v0.3.0', html_url }))).toEqual({
        version: '0.3.0',
        url: html_url
      })
    }
    expect(RELEASES_API).toBe('https://api.github.com/repos/yeonjin1357/Corral/releases/latest')
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
      html_url: 'https://github.com/yeonjin1357/Corral/releases/tag/v0.2.0'
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
      url: 'https://github.com/yeonjin1357/Corral/releases/tag/v0.2.0'
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

describe('macOS: 앱 안에서 내려받아 바꿔 넣는다', () => {
  const SHA =
    'kdUvtiB20qgTtljEmBEZ87y5MOvcPQztLuay9SiD+rdbSaSU0e8+Nle4QcWx/mgnVxd9LHdRpI7AG855SX0VJQ=='
  const feed = (version: string): string =>
    [
      `version: ${version}`,
      'files:',
      `  - url: corral-${version}-x64.dmg`,
      '    sha512: AAAA',
      '    size: 1',
      `  - url: corral-${version}-arm64.dmg`,
      `    sha512: ${SHA}`,
      '    size: 2',
      `path: corral-${version}-x64.dmg`,
      ''
    ].join('\n')
  const RELEASE: MacRelease = { version: '0.3.0', file: 'corral-0.3.0-arm64.dmg', sha512: SHA }
  const PAGE = 'https://github.com/yeonjin1357/Corral/releases/latest'
  const COMMAND =
    'curl -fsSL https://raw.githubusercontent.com/yeonjin1357/Corral/main/scripts/install-mac.sh | bash'

  function mac(over: Partial<MacUpdateDeps> = {}): MacUpdateDeps & {
    install: ReturnType<typeof vi.fn>
    quit: ReturnType<typeof vi.fn>
  } {
    return {
      arch: 'arm64',
      fetchFeed: async () => feed('0.3.0'),
      install: vi.fn(async () => {}),
      quit: vi.fn(),
      failedBefore: () => false,
      ...over
    } as MacUpdateDeps & { install: ReturnType<typeof vi.fn>; quit: ReturnType<typeof vi.fn> }
  }
  const updaterWith = (
    m: MacUpdateDeps,
    over: Partial<Parameters<typeof createUpdater>[0]> = {}
  ): ReturnType<typeof createUpdater> =>
    createUpdater(deps({ platform: 'darwin', currentVersion: '0.2.0', mac: m, ...over }))

  test('릴리스 정보 파일로 새 버전을 확인하고, 앱 안에서 업데이트할 수 있다고 알린다(GitHub API 는 쓰지 않는다)', async () => {
    const fetchJson = vi.fn()
    const updater = updaterWith(mac(), { fetchJson })
    expect(await updater.check()).toEqual({
      state: 'available',
      version: '0.3.0',
      url: PAGE,
      error: null,
      checkedAt: 1000,
      selfInstall: true,
      installCommand: COMMAND
    })
    expect(fetchJson).not.toHaveBeenCalled()
  })

  test('같거나 낮은 버전이면 새 버전이 없다', async () => {
    expect((await updaterWith(mac({ fetchFeed: async () => feed('0.2.0') })).check()).state).toBe(
      'none'
    )
    expect((await updaterWith(mac({ fetchFeed: async () => feed('0.1.9') })).check()).state).toBe(
      'none'
    )
  })

  test('릴리스 정보를 받지 못하거나 읽을 수 없으면 오류', async () => {
    const offline = updaterWith(
      mac({
        fetchFeed: async () => {
          throw new Error('offline')
        }
      })
    )
    expect(await offline.check()).toMatchObject({ state: 'error', error: 'offline' })
    const garbage = updaterWith(mac({ fetchFeed: async () => '<html>Not Found</html>' }))
    expect(await garbage.check()).toMatchObject({
      state: 'error',
      error: '릴리스 정보를 읽지 못했어요.'
    })
  })

  test('업데이트를 누르면 내려받는 중이 되고, 준비가 끝나면 앱을 끝낸다(도우미가 바꿔 넣는다)', async () => {
    const m = mac()
    const states: string[] = []
    const updater = updaterWith(m, { onChange: (s) => states.push(s.state) })
    await updater.check()
    updater.install()
    expect(updater.status()).toMatchObject({ state: 'downloading', version: '0.3.0' })
    await vi.waitFor(() => expect(m.quit).toHaveBeenCalledTimes(1))
    expect(m.install).toHaveBeenCalledWith(RELEASE)
    expect(states).toEqual(['checking', 'available', 'downloading'])
  })

  test('내려받는 중에 또 눌러도 한 번만 한다', async () => {
    let finish: () => void = () => {}
    const m = mac({ install: vi.fn(() => new Promise<void>((resolve) => (finish = resolve))) })
    const updater = updaterWith(m)
    await updater.check()
    updater.install()
    updater.install()
    expect(m.install).toHaveBeenCalledTimes(1)
    finish()
    await vi.waitFor(() => expect(m.quit).toHaveBeenCalledTimes(1))
  })

  test('바꿔 넣을 준비에 실패하면 앱을 끝내지 않고, 까닭과 설치 한 줄을 알린다', async () => {
    const m = mac({
      install: vi.fn(async () => {
        throw new MacUpdateError('write', 'ditto: Operation not permitted')
      })
    })
    const updater = updaterWith(m)
    await updater.check()
    updater.install()
    await vi.waitFor(() => expect(updater.status().state).toBe('available'))
    expect(updater.status()).toMatchObject({
      version: '0.3.0',
      url: PAGE,
      selfInstall: false,
      installCommand: COMMAND,
      error: '응용 프로그램 폴더에 쓸 수 없어요.'
    })
    expect(m.quit).not.toHaveBeenCalled()
    // 다시 눌러도 같은 일을 되풀이하지 않는다(화면은 설치 한 줄을 안내한다).
    updater.install()
    expect(m.install).toHaveBeenCalledTimes(1)
    // 다시 확인해도 앱 안 업데이트는 권하지 않는다.
    expect(await updater.check()).toMatchObject({ state: 'available', selfInstall: false })
  })

  test('지난번에 바꿔 넣지 못했으면(도우미가 남긴 표시) 앱 안 업데이트 대신 설치 한 줄을 알린다', async () => {
    const m = mac({ failedBefore: () => true })
    const updater = updaterWith(m)
    expect(await updater.check()).toMatchObject({
      state: 'available',
      selfInstall: false,
      installCommand: COMMAND,
      error: '지난번에 앱을 바꿔 넣지 못했어요.'
    })
    updater.install()
    expect(m.install).not.toHaveBeenCalled()
  })

  test('새 버전이 없을 때는 눌러도 아무 일도 없다', async () => {
    const m = mac({ fetchFeed: async () => feed('0.2.0') })
    const updater = updaterWith(m)
    await updater.check()
    updater.install()
    expect(m.install).not.toHaveBeenCalled()
  })
})
