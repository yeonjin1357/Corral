import { readFileSync } from 'fs'
import { join } from 'path'
import { pinUserData } from './userData'

/** Electron app 의 가짜(appData 경로, --user-data-dir 유무). getPath·setPath 호출을 모은다. */
function fakeApp(switches: string[] = []): {
  app: Parameters<typeof pinUserData>[0]
  getPath: ReturnType<typeof vi.fn>
  setPath: ReturnType<typeof vi.fn>
} {
  const getPath = vi.fn(() => 'C:\\Users\\dev\\AppData\\Roaming')
  const setPath = vi.fn()
  return {
    app: {
      getPath,
      setPath,
      commandLine: { hasSwitch: (name) => switches.includes(name) }
    },
    getPath,
    setPath
  }
}

/** 경로 합치기의 가짜(OS 마다 다른 구분자 대신 '/'). */
const fakeJoin = (...parts: string[]): string => parts.join('/')

test('설정 폴더는 이름이 바뀌어도 appData/pitwall 로 고정한다', () => {
  const { app, getPath, setPath } = fakeApp()
  expect(pinUserData(app, fakeJoin)).toBe('C:\\Users\\dev\\AppData\\Roaming/pitwall')
  // userData(이름이 바뀌면 Corral 폴더)가 아니라 appData 에서 계산한다.
  expect(getPath).toHaveBeenCalledWith('appData')
  expect(setPath).toHaveBeenCalledTimes(1)
  expect(setPath).toHaveBeenCalledWith('userData', 'C:\\Users\\dev\\AppData\\Roaming/pitwall')
})

test('--user-data-dir 이 있으면 고정하지 않는다', () => {
  // 측정·검증용 별도 프로필은 Chromium 이 그 폴더를 쓴다.
  const { app, setPath } = fakeApp(['user-data-dir'])
  expect(pinUserData(app, fakeJoin)).toBeNull()
  expect(setPath).not.toHaveBeenCalled()
})

test('index.ts 는 다른 어떤 것보다 먼저 설정 폴더를 고정한다', () => {
  // 다른 모듈이 불러올 때 userData 를 읽거나 단일 인스턴스 잠금을 잡기 전에 고정해야 한다.
  const source = readFileSync(join(__dirname, 'index.ts'), 'utf8')
  const first = /^import\b[\s\S]*?['"]([^'"]+)['"]/m.exec(source)
  expect(first?.[1]).toBe('./pinUserData')
})
