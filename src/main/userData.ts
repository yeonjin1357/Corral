/**
 * 설정 폴더 이름. 앱 이름은 Corral 로 바뀌었지만 기존 설치의 설정·기록·localStorage·연동 포트·토큰이 모두
 * 이 폴더에 있으므로 예전 이름 그대로 둔다.
 */
export const USER_DATA_FOLDER = 'pitwall'

/**
 * 설정 폴더를 `<appData>/pitwall` 로 고정하고 그 경로를 돌려준다. Electron 은 productName 으로 설정 폴더를
 * 정하므로(그대로 두면 `<appData>/Corral`) 다른 어떤 모듈보다 먼저 불러야 한다(pinUserData.ts).
 * 명령줄에 `--user-data-dir` 이 있으면(측정·검증용 별도 프로필) 아무것도 하지 않고 null.
 */
export function pinUserData(
  app: {
    getPath(name: 'appData'): string
    setPath(name: 'userData', path: string): void
    commandLine: { hasSwitch(name: string): boolean }
  },
  join: (...parts: string[]) => string
): string | null {
  if (app.commandLine.hasSwitch('user-data-dir')) return null
  const path = join(app.getPath('appData'), USER_DATA_FOLDER)
  app.setPath('userData', path)
  return path
}
