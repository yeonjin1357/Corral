import type { Platform } from './types'

/**
 * 명령줄에서 실행 파일 경로를 꺼낸다(OS 앱 아이콘을 찾는 데 쓴다. NeoHtop 이 프로세스마다 앱 아이콘을 보이는 것처럼).
 * - Windows: 맨 앞이 절대 경로 .exe 일 때만(따옴표 있거나 없거나). 네트워크 경로는 쓰지 않는다.
 * - macOS: 앱 묶음 안이면 그 .app 묶음(앱 아이콘), 아니면 첫 낱말이 절대 경로일 때. ps 의 args 는 따옴표가 없어
 *   띄어쓰기가 든 앱 이름은 `.app/` 로 끊는다.
 * 모르면 null(화면은 브랜드·기본 아이콘을 쓴다).
 */
export function exePathOf(commandLine: string, platform: Platform | null): string | null {
  const line = commandLine.trim()
  if (!line) return null
  if (platform === 'win32') {
    const quoted = /^"([^"]+)"/.exec(line)
    const path = quoted ? quoted[1] : line.split(/\s+/, 1)[0]
    return /^[A-Za-z]:\\/.test(path) && /\.exe$/i.test(path) ? path : null
  }
  if (platform === 'darwin') {
    // 인자( -로 시작)를 넘어서 .app 을 찾지 않는다.
    const bundle = /^(\/(?:(?! -).)+?\.app)(?:\/|$)/.exec(line)
    if (bundle) return bundle[1]
    const first = line.split(/\s+/, 1)[0]
    return first.startsWith('/') ? first : null
  }
  return null
}
