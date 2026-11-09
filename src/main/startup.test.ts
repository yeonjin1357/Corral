import { HIDDEN_ARG, loginItemOptions, shouldStartHidden } from './startup'

test('로그인 항목: 설치된 앱에서만, 켜면 숨김 시작 인자와 함께', () => {
  expect(loginItemOptions({ launchAtLogin: true }, true)).toEqual({
    openAtLogin: true,
    args: [HIDDEN_ARG]
  })
  expect(loginItemOptions({ launchAtLogin: false }, true)).toEqual({ openAtLogin: false, args: [] })
  // 개발 실행(electron .)을 로그인 항목으로 등록하면 electron.exe 가 뜨므로 건드리지 않는다.
  expect(loginItemOptions({ launchAtLogin: true }, false)).toBeNull()
})

test('숨김 시작: Windows 는 인자로, macOS 는 로그인으로 켜졌는지로', () => {
  expect(shouldStartHidden(['pitwall.exe', HIDDEN_ARG], 'win32', false)).toBe(true)
  expect(shouldStartHidden(['pitwall.exe'], 'win32', false)).toBe(false)
  expect(shouldStartHidden(['pitwall'], 'darwin', true)).toBe(true)
  expect(shouldStartHidden(['pitwall'], 'darwin', false)).toBe(false)
})
