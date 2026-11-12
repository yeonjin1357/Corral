import { classifyMacProcess } from './macApps'

const CHROME = '/Applications/Google Chrome.app'

const cases: { name: string; path: string | null; want: ReturnType<typeof classifyMacProcess> }[] =
  [
    {
      name: '앱 묶음의 주 실행 파일은 그 앱',
      path: `${CHROME}/Contents/MacOS/Google Chrome`,
      want: { kind: 'app', name: 'Google Chrome', bundle: CHROME }
    },
    {
      name: '앱 안의 보조 앱(Helper)도 맨 바깥 앱으로 묶는다',
      path: `${CHROME}/Contents/Frameworks/Google Chrome Framework.framework/Versions/130/Helpers/Google Chrome Helper (Renderer).app/Contents/MacOS/Google Chrome Helper (Renderer)`,
      want: { kind: 'app', name: 'Google Chrome', bundle: CHROME }
    },
    {
      name: '앱 안의 XPC 서비스도 그 앱',
      path: '/Applications/Corral.app/Contents/XPCServices/Updater.xpc/Contents/MacOS/Updater',
      want: { kind: 'app', name: 'Corral', bundle: '/Applications/Corral.app' }
    },
    {
      name: '사용자 폴더의 앱',
      path: '/Users/dev/Applications/Rectangle.app/Contents/MacOS/Rectangle',
      want: { kind: 'app', name: 'Rectangle', bundle: '/Users/dev/Applications/Rectangle.app' }
    },
    {
      name: 'macOS 기본 앱(/System/Applications)은 접지 않고 앱으로',
      path: '/System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal',
      want: {
        kind: 'app',
        name: 'Terminal',
        bundle: '/System/Applications/Utilities/Terminal.app'
      }
    },
    {
      name: 'Safari 는 시스템 볼륨의 Applications 아래에 있다 — 앱으로',
      path: '/System/Volumes/Preboot/Cryptexes/App/System/Applications/Safari.app/Contents/MacOS/Safari',
      want: {
        kind: 'app',
        name: 'Safari',
        bundle: '/System/Volumes/Preboot/Cryptexes/App/System/Applications/Safari.app'
      }
    },
    {
      name: '시스템 화면 요소(Finder·Dock 등, CoreServices 의 .app)는 시스템',
      path: '/System/Library/CoreServices/Finder.app/Contents/MacOS/Finder',
      want: { kind: 'system' }
    },
    {
      name: '시스템 프레임워크 안의 보조 프로세스는 시스템',
      path: '/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/Metadata.framework/Versions/A/Support/mdworker_shared',
      want: { kind: 'system' }
    },
    {
      name: '/usr/libexec 의 데몬은 시스템',
      path: '/usr/libexec/trustd',
      want: { kind: 'system' }
    },
    { name: '/usr/sbin 의 데몬은 시스템', path: '/usr/sbin/cfprefsd', want: { kind: 'system' } },
    { name: 'launchd 는 시스템', path: '/sbin/launchd', want: { kind: 'system' } },
    {
      name: 'Apple 이 따로 까는 시스템 구성 요소(/Library/Apple)는 시스템',
      path: '/Library/Apple/System/Library/CoreServices/XProtect.app/Contents/MacOS/XProtect',
      want: { kind: 'system' }
    },
    // 아래는 지금처럼 이름별로 묶는다(null).
    { name: '사용자가 띄우는 도구(/usr/bin)는 시스템이 아니다', path: '/usr/bin/ssh', want: null },
    { name: '셸(/bin)은 시스템이 아니다', path: '/bin/zsh', want: null },
    {
      name: 'Homebrew 로 깐 프로그램은 시스템이 아니다',
      path: '/opt/homebrew/bin/postgres',
      want: null
    },
    {
      name: '다른 회사의 보조 도구(/Library)는 시스템이 아니다',
      path: '/Library/PrivilegedHelperTools/com.docker.vmnetd',
      want: null
    },
    { name: '경로를 모르면 알 수 없다', path: null, want: null },
    { name: '절대 경로가 아니면 알 수 없다(-zsh)', path: '-zsh', want: null }
  ]

test.each(cases)('$name', ({ path, want }) => {
  expect(classifyMacProcess(path)).toEqual(want)
})
