import { DEFAULT_SETTINGS, normalizeSettings, REFRESH_INTERVALS } from './settings'

test('값이 없거나 객체가 아니면 기본값', () => {
  for (const value of [undefined, null, 1, 'x', []])
    expect(normalizeSettings(value)).toEqual(DEFAULT_SETTINGS)
})

test('기본값: 보통 갱신, 자동 테마, 로그인 시 실행·업데이트 확인 켬, RAM 80/90%, 20분, 알림 모두 켬, 의존성·빌드 결과 폴더', () => {
  expect(DEFAULT_SETTINGS).toMatchObject({
    refresh: 'normal',
    theme: 'auto',
    launchAtLogin: true,
    updateCheck: true,
    ramWarnPercent: 80,
    ramDangerPercent: 90,
    idlePortMinutes: 20,
    notify: { ramLow: true, claudeWaiting: true, heavyOverlap: true, agentDone: true },
    dependencyDirs: [
      'node_modules',
      '.next',
      '.nuxt',
      '.turbo',
      '.vite',
      'dist',
      'build',
      'out',
      'target',
      '.gradle'
    ],
    extraRepos: [],
    hiddenServers: [],
    workspaceAliases: {}
  })
  expect(DEFAULT_SETTINGS.heavyPatterns).toEqual([
    'tsc',
    'vue-tsc',
    'vite build',
    'webpack',
    'next build',
    'nuxt build',
    'ng build',
    'gradle build',
    'gradlew build',
    'mvn',
    'cargo build'
  ])
})

test('갱신 주기: 빠르게 2/10초, 보통 5/30초, 절약 15/120초', () => {
  expect(REFRESH_INTERVALS).toEqual({
    fast: { openMs: 2000, closedMs: 10000 },
    normal: { openMs: 5000, closedMs: 30000 },
    saver: { openMs: 15000, closedMs: 120000 }
  })
})

test('고를 수 있는 값이 아니면 기본값', () => {
  expect(
    normalizeSettings({ refresh: 'turbo', theme: 'pink', launchAtLogin: 'yes' })
  ).toMatchObject({
    refresh: 'normal',
    theme: 'auto',
    launchAtLogin: true
  })
  expect(
    normalizeSettings({ refresh: 'saver', theme: 'dark', launchAtLogin: false, updateCheck: false })
  ).toMatchObject({ refresh: 'saver', theme: 'dark', launchAtLogin: false, updateCheck: false })
})

test('RAM 기준: 경고 50~98, 위험은 경고+1~99, 반올림', () => {
  expect(normalizeSettings({ ramWarnPercent: 10, ramDangerPercent: 200 })).toMatchObject({
    ramWarnPercent: 50,
    ramDangerPercent: 99
  })
  expect(normalizeSettings({ ramWarnPercent: 85.6, ramDangerPercent: 80 })).toMatchObject({
    ramWarnPercent: 86,
    ramDangerPercent: 87
  })
  expect(normalizeSettings({ ramWarnPercent: 99, ramDangerPercent: 99 })).toMatchObject({
    ramWarnPercent: 98,
    ramDangerPercent: 99
  })
  expect(normalizeSettings({ ramWarnPercent: '70', ramDangerPercent: NaN })).toMatchObject({
    ramWarnPercent: 80,
    ramDangerPercent: 90
  })
})

test('안 쓰는 포트 기준은 1~1440분', () => {
  expect(normalizeSettings({ idlePortMinutes: 0 }).idlePortMinutes).toBe(1)
  expect(normalizeSettings({ idlePortMinutes: 5000 }).idlePortMinutes).toBe(1440)
  expect(normalizeSettings({ idlePortMinutes: 30.4 }).idlePortMinutes).toBe(30)
  expect(normalizeSettings({ idlePortMinutes: Infinity }).idlePortMinutes).toBe(20)
})

test('무거운 명령 패턴: 공백 정리·빈 값·중복(대소문자 무시) 제거, 100자·50개 제한', () => {
  const s = normalizeSettings({
    heavyPatterns: [
      '  vue-tsc  ',
      '',
      'Vite   Build',
      'vite build',
      7,
      'x'.repeat(101),
      ...Array.from({ length: 60 }, (_, i) => `job${i}`)
    ]
  })
  expect(s.heavyPatterns.slice(0, 3)).toEqual(['vue-tsc', 'Vite Build', 'job0'])
  expect(s.heavyPatterns).toHaveLength(50)
  expect(normalizeSettings({ heavyPatterns: [] }).heavyPatterns).toEqual([])
  expect(normalizeSettings({ heavyPatterns: 'tsc' }).heavyPatterns).toEqual(
    DEFAULT_SETTINGS.heavyPatterns
  )
})

test('알림은 항목별로, 빠진 항목은 기본값', () => {
  expect(
    normalizeSettings({ notify: { ramLow: false, heavyOverlap: 'no', agentDone: false } }).notify
  ).toEqual({
    ramLow: false,
    claudeWaiting: true,
    heavyOverlap: true,
    agentDone: false
  })
})

test('의존성 폴더 이름은 폴더 이름 하나만(경로·상위 폴더·.git 불가), 20개까지', () => {
  const s = normalizeSettings({
    dependencyDirs: [
      'node_modules',
      '..',
      '.',
      '.git',
      'a/b',
      'a\\b',
      'C:',
      'x*',
      ' .venv ',
      'NODE_MODULES',
      '/abs',
      ''
    ]
  })
  expect(s.dependencyDirs).toEqual(['node_modules', '.venv'])
  expect(
    normalizeSettings({ dependencyDirs: Array.from({ length: 30 }, (_, i) => `d${i}`) })
      .dependencyDirs
  ).toHaveLength(20)
  // 빈 목록은 그대로 둔다(디스크 정리를 쓰지 않겠다는 뜻).
  expect(normalizeSettings({ dependencyDirs: [] }).dependencyDirs).toEqual([])
})

test('추가 저장소는 절대 경로만, 50개까지', () => {
  const s = normalizeSettings({
    extraRepos: [
      'C:\\work\\shop-web',
      'relative/repo',
      '/Users/dev/repo',
      '\\\\nas\\share\\repo',
      'C:\\work\\shop-web',
      'D:/x'
    ]
  })
  expect(s.extraRepos).toEqual(['C:\\work\\shop-web', '/Users/dev/repo', 'D:/x'])
  expect(
    normalizeSettings({ extraRepos: Array.from({ length: 60 }, (_, i) => `C:\\r${i}`) }).extraRepos
  ).toHaveLength(50)
})

test('모르는 키는 버린다', () => {
  expect(normalizeSettings({ hacker: true })).toEqual(DEFAULT_SETTINGS)
})

test('숨긴 서버는 :포트(1~65535) 또는 프로세스 이름(경로 없이 100자까지), 중복 없이 50개까지', () => {
  expect(
    normalizeSettings({
      hiddenServers: [
        ' :3000 ',
        ':0',
        ':70000',
        ':80a',
        'Docker Desktop.exe',
        'C:\\bin\\x.exe',
        '',
        ':3000',
        'a'.repeat(101),
        1
      ]
    }).hiddenServers
  ).toEqual([':3000', 'Docker Desktop.exe'])
  expect(
    normalizeSettings({ hiddenServers: Array.from({ length: 60 }, (_, i) => `:${3000 + i}`) })
      .hiddenServers
  ).toHaveLength(50)
})

test('작업 공간 별칭은 절대 경로 → 이름(공백 정리, 40자까지), 50개까지', () => {
  expect(
    normalizeSettings({
      workspaceAliases: {
        'C:\\work\\ws': '  쇼핑   작업 공간 ',
        'relative\\path': '안 됨',
        '/Users/dev/ws': 'x'.repeat(41),
        '/Users/dev/ok': '',
        '\\\\server\\share': '네트워크'
      }
    }).workspaceAliases
  ).toEqual({ 'C:\\work\\ws': '쇼핑 작업 공간' })
  const many = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`C:\\w${i}`, `w${i}`]))
  expect(Object.keys(normalizeSettings({ workspaceAliases: many }).workspaceAliases)).toHaveLength(
    50
  )
  expect(normalizeSettings({ workspaceAliases: ['x'] }).workspaceAliases).toEqual({})
})
