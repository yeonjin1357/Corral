/**
 * macOS 의 앱 안 업데이트. Corral 은 Apple 서명이 없어 electron-updater 가 설치할 수 없다(Squirrel.Mac 은 서명을
 * 요구한다). 대신 릴리스의 dmg 를 직접 내려받아 확인하고, 앱이 끝난 뒤 앱 묶음을 바꿔 넣는다.
 *
 * 1. 릴리스의 latest-mac.yml 에서 이 Mac 에 맞는 dmg 이름과 sha512 를 읽는다(새 버전 확인도 이 파일로 한다).
 * 2. dmg 를 내려받아 sha512 를 견준다. 앱이 직접 받은 파일에는 "인터넷에서 받음" 표시가 붙지 않아 macOS 가 막지 않는다.
 * 3. dmg 를 열어 새 앱을 지금 앱 옆(`Corral.app.updating`)에 풀고, 서명·앱 ID·버전을 확인한다. 여기까지 실패하면
 *    지금 앱은 그대로다(부르는 쪽이 설치 한 줄을 안내한다).
 * 4. 앱에서 떨어진 도우미(bash)를 띄우고 앱을 끝낸다. 도우미는 앱이 끝나면 바꿔 넣고 다시 연다. 바꿔 넣지 못하면
 *    예전 앱을 되돌려 다시 열고, 다음 실행이 알 수 있게 실패 표시 파일을 남긴다.
 */
import type { CommandResult } from './collect/runCommand'

/** 최신 릴리스의 파일을 이름으로 받는 주소(GitHub 이 최신 릴리스로 넘겨 준다). API 가 아니라 요청 한도가 없다. */
export const MAC_FEED = 'https://github.com/yeonjin1357/Corral/releases/latest/download'
/** 사람에게 알려 줄 내려받기 페이지. */
export const MAC_RELEASE_PAGE = 'https://github.com/yeonjin1357/Corral/releases/latest'
/** 앱 안에서 바꿔 넣지 못했을 때 안내하는 설치 한 줄(README 와 같다). */
export const MAC_INSTALL_COMMAND =
  'curl -fsSL https://raw.githubusercontent.com/yeonjin1357/Corral/main/scripts/install-mac.sh | bash'
const BUNDLE_ID = 'io.github.yeonjin1357.pitwall'
const APP_NAME = 'Corral.app'

export type MacArch = 'arm64' | 'x64'

export interface MacRelease {
  version: string
  /** 설치 파일 이름(`corral-0.3.0-arm64.dmg`). */
  file: string
  /** 그 파일의 sha512(base64). */
  sha512: string
}

/**
 * location: 바꿔 넣을 수 없는 자리에서 실행 중, download: 내려받지 못함, checksum: 확인 값이 다름,
 * open: 설치 파일을 열지 못함, write: 응용 프로그램 폴더에 쓸 수 없음, verify: 풀어 놓은 앱이 기대와 다름.
 */
export class MacUpdateError extends Error {
  constructor(
    readonly code: 'location' | 'download' | 'checksum' | 'open' | 'write' | 'verify',
    message: string
  ) {
    super(message)
    this.name = 'MacUpdateError'
  }
}

const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/

/**
 * electron-builder 가 만든 latest-mac.yml 에서 버전과, 이 Mac 에 맞는 dmg 의 이름·sha512 를 꺼낸다.
 * 형식이 다르거나, 이 Mac 용 파일이 없거나, 이름이 `corral-<버전>-<구조>.dmg` 가 아니면 null.
 */
export function parseLatestMac(yml: string, arch: MacArch): MacRelease | null {
  const version = /^version:\s*(\S+)\s*$/m.exec(yml)?.[1]
  if (!version || !VERSION.test(version)) return null
  const file = `corral-${version}-${arch}.dmg`
  const lines = yml.split(/\r?\n/)
  const at = lines.findIndex((line) => /^\s*-\s*url:\s*(\S+)\s*$/.exec(line)?.[1] === file)
  if (at < 0) return null
  // 그 파일 항목(다음 `- url:` 전까지)의 sha512.
  for (const line of lines.slice(at + 1)) {
    if (/^\s*-\s/.test(line) || /^\S/.test(line)) break
    const sha512 = /^\s+sha512:\s*([A-Za-z0-9+/=]+)\s*$/.exec(line)?.[1]
    if (sha512) return { version, file, sha512 }
  }
  return null
}

/**
 * 릴리스 파일을 받을 주소. 검증할 때는 `--update-feed=http://127.0.0.1:<포트>` 로 이 PC 안의 주소를 줄 수 있다
 * (이 PC 밖의 주소는 무시한다 — 실행 인자로 다른 곳의 앱을 받게 할 수 없다).
 */
export function feedBase(override: string | null | undefined): string {
  if (!override) return MAC_FEED
  try {
    const url = new URL(override)
    const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost'
    if (url.protocol !== 'http:' || !local || url.search || url.hash || url.username)
      return MAC_FEED
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
  } catch {
    return MAC_FEED
  }
}

/**
 * 실행 파일 경로에서 바꿔 넣을 앱 묶음(`…/Corral.app`). macOS 가 임시로 옮겨 실행했거나(AppTranslocation) 설치 파일
 * 안에서 바로 실행한(/Volumes) 앱은 바꿔 넣을 수 없어 null.
 */
export function bundleOf(execPath: string): string | null {
  const bundle = /^(\/.+\.app)\/Contents\/MacOS\/[^/]+$/.exec(execPath)?.[1]
  if (!bundle || bundle.includes('.app/')) return null
  if (bundle.startsWith('/Volumes/') || bundle.includes('/AppTranslocation/')) return null
  return bundle
}

/**
 * 바꿔 넣는 도우미. 인자: 앱 pid, 풀어 둔 새 앱, 지금 앱, 실패 표시 파일, (시험용) 기다릴 횟수.
 * 앱이 끝나기를 기다렸다가 지금 앱을 옆으로 치우고 새 앱을 넣는다. 어디서 실패하든 예전 앱이 제자리에 남는다.
 */
const SWAP_SCRIPT = [
  'pid=$1; staged=$2; target=$3; marker=$4; tries=${5:-240}',
  'i=0',
  'while kill -0 "$pid" 2>/dev/null && [ "$i" -lt "$tries" ]; do sleep 0.25; i=$((i + 1)); done',
  // 앱이 끝나지 않으면 건드리지 않는다.
  'if kill -0 "$pid" 2>/dev/null; then rm -rf "$staged"; : > "$marker"; exit 1; fi',
  'rm -rf "$target.previous"',
  'if mv "$target" "$target.previous" 2>/dev/null && mv "$staged" "$target" 2>/dev/null; then',
  '  rm -rf "$target.previous"; open "$target"; exit 0',
  'fi',
  // 바꿔 넣지 못했다: 예전 앱을 되돌리고 다시 연다.
  'if [ ! -e "$target" ] && [ -e "$target.previous" ]; then mv "$target.previous" "$target"; fi',
  'rm -rf "$staged" 2>/dev/null',
  ': > "$marker"',
  'open "$target"',
  'exit 1'
].join('\n')

export function swapArgv(
  pid: number,
  staged: string,
  target: string,
  failedMarker: string
): string[] {
  return [
    '/bin/bash',
    '-c',
    SWAP_SCRIPT,
    'corral-update',
    String(pid),
    staged,
    target,
    failedMarker
  ]
}

export interface MacInstallerDeps {
  /** 릴리스 파일을 받을 주소(feedBase). */
  base: string
  /** 이 앱의 실행 파일 경로(process.execPath). */
  execPath: string
  pid: number
  /** 도우미가 바꿔 넣지 못했을 때 남기는 파일(다음 실행이 읽는다). */
  failedMarker: string
  /** 새 임시 폴더를 만들어 그 경로를 준다. */
  tmpDir: () => Promise<string>
  /** 주소의 파일을 내려받아 저장하고 그 sha512(base64)를 준다. */
  download: (url: string, file: string) => Promise<string>
  run: (argv: string[], opts?: { timeoutMs?: number }) => Promise<CommandResult>
  /** 이 앱이 끝나도 계속 도는 프로세스를 띄운다. */
  spawnDetached: (argv: string[]) => void
  remove: (path: string) => Promise<void>
}

/** 설치 파일을 열고 푸는 데 주는 시간. */
const STEP_TIMEOUT_MS = 120_000

/**
 * install 이 끝나면 새 앱이 지금 앱 옆에 풀려 있고 도우미가 앱이 끝나기를 기다리고 있다 — 부르는 쪽이 앱을 끝낸다.
 * 그 전에 실패하면 MacUpdateError 를 던지고 지금 앱은 그대로다.
 */
export function createMacInstaller(deps: MacInstallerDeps): {
  install(release: MacRelease): Promise<void>
} {
  const plist = async (app: string, key: string): Promise<string | null> => {
    const r = await deps.run([
      '/usr/bin/plutil',
      '-extract',
      key,
      'raw',
      '-o',
      '-',
      `${app}/Contents/Info.plist`
    ])
    return r.exitCode === 0 ? r.stdout.trim() : null
  }

  return {
    async install(release) {
      const target = bundleOf(deps.execPath)
      if (!target) throw new MacUpdateError('location', deps.execPath)
      const staged = `${target}.updating`
      const dir = await deps.tmpDir()
      const dmg = `${dir}/${release.file}`
      const volume = `${dir}/volume`
      let mounted = false
      let keepStaged = false
      try {
        let sha512: string
        try {
          sha512 = await deps.download(`${deps.base}/${release.file}`, dmg)
        } catch (e) {
          throw new MacUpdateError('download', e instanceof Error ? e.message : String(e))
        }
        if (sha512 !== release.sha512) throw new MacUpdateError('checksum', release.file)

        const attach = await deps.run(
          ['/usr/bin/hdiutil', 'attach', dmg, '-nobrowse', '-readonly', '-mountpoint', volume],
          { timeoutMs: STEP_TIMEOUT_MS }
        )
        if (attach.exitCode !== 0) throw new MacUpdateError('open', attach.stderr.trim())
        mounted = true

        await deps.remove(staged)
        const copy = await deps.run(['/usr/bin/ditto', `${volume}/${APP_NAME}`, staged], {
          timeoutMs: STEP_TIMEOUT_MS
        })
        if (copy.exitCode !== 0) throw new MacUpdateError('write', copy.stderr.trim())

        const signed = await deps.run(
          ['/usr/bin/codesign', '--verify', '--deep', '--strict', staged],
          { timeoutMs: STEP_TIMEOUT_MS }
        )
        if (signed.exitCode !== 0) throw new MacUpdateError('verify', signed.stderr.trim())
        const id = await plist(staged, 'CFBundleIdentifier')
        if (id !== BUNDLE_ID) throw new MacUpdateError('verify', `bundle id ${id}`)
        const version = await plist(staged, 'CFBundleShortVersionString')
        if (version !== release.version) throw new MacUpdateError('verify', `version ${version}`)

        deps.spawnDetached(swapArgv(deps.pid, staged, target, deps.failedMarker))
        keepStaged = true
      } finally {
        if (mounted) {
          try {
            await deps.run(['/usr/bin/hdiutil', 'detach', volume, '-quiet'])
          } catch {
            // 닫지 못해도 임시 폴더와 함께 나중에 풀린다.
          }
        }
        if (!keepStaged && mounted) await deps.remove(staged).catch(() => {})
        await deps.remove(dir).catch(() => {})
      }
    }
  }
}
