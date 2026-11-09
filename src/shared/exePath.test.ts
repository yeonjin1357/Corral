import { exePathOf } from './exePath'

describe('Windows: 명령줄 맨 앞의 절대 경로 .exe', () => {
  test('따옴표로 감싼 경로(띄어쓰기 포함)', () => {
    expect(
      exePathOf(
        '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --type=renderer',
        'win32'
      )
    ).toBe('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  })
  test('따옴표 없는 경로', () => {
    expect(exePathOf('C:\\Users\\dev\\AppData\\Local\\Figma\\Figma.exe --x', 'win32')).toBe(
      'C:\\Users\\dev\\AppData\\Local\\Figma\\Figma.exe'
    )
  })
  test('상대 이름·.exe 가 아닌 것·네트워크 경로는 null', () => {
    expect(exePathOf('node server.js', 'win32')).toBeNull()
    expect(exePathOf('"C:\\tools\\run.bat" x', 'win32')).toBeNull()
    expect(exePathOf('\\\\server\\share\\app.exe', 'win32')).toBeNull()
    expect(exePathOf('', 'win32')).toBeNull()
  })
})

describe('macOS: 앱 묶음(.app) 또는 절대 경로', () => {
  test('앱 안의 실행 파일이면 .app 묶음 경로(띄어쓰기 포함, 따옴표 없음)', () => {
    expect(
      exePathOf(
        '/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper --type=gpu',
        'darwin'
      )
    ).toBe('/Applications/Google Chrome.app')
  })
  test('앱 묶음이 아니면 첫 낱말 절대 경로, 상대 경로는 null', () => {
    expect(exePathOf('/usr/local/bin/node server.js', 'darwin')).toBe('/usr/local/bin/node')
    expect(exePathOf('node server.js', 'darwin')).toBeNull()
    expect(exePathOf('/usr/bin/foo --config /x.app/y', 'darwin')).toBe('/usr/bin/foo')
  })
})

test('플랫폼을 모르면 null', () => {
  expect(exePathOf('C:\\a\\b.exe', null)).toBeNull()
})
