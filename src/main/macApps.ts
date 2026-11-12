/**
 * macOS 의 "다른 앱"을 어떻게 묶을지: 실행 파일 경로로 그 프로세스가 어느 앱의 것인지, macOS 가 기본으로 띄우는
 * 백그라운드 프로세스인지 가린다. Windows 는 한 앱의 프로세스가 대개 같은 이름이라 이름별로 묶으면 되지만, macOS 는
 * 보조 프로세스마다 이름이 달라(`… Helper (Renderer)`) 앱 하나가 여러 줄로 쪼개지고 시스템 프로세스만 수백 개다.
 */

export type MacProcessClass =
  /** 앱 묶음(.app) 안의 프로세스: 맨 바깥 묶음의 이름과 경로. */
  | { kind: 'app'; name: string; bundle: string }
  /** macOS 가 기본으로 띄우는 백그라운드 프로세스. */
  | { kind: 'system' }

/** 맨 바깥 `.app` 묶음(보조 앱·XPC 서비스는 그 안에 든다). */
const OUTER_BUNDLE = /^(\/.*?\/([^/]+)\.app)(?:\/|$)/
/** macOS 가 차지하는 폴더. /usr/bin·/bin 은 사용자가 띄우는 도구·셸이라 넣지 않는다. */
const SYSTEM_DIR = /^\/(System|usr\/libexec|usr\/sbin|sbin|Library\/Apple)\//
/** 시스템 폴더 안이어도 Applications 아래의 앱(Terminal·Mail·Safari)은 사용자가 쓰는 앱이다. */
const IN_APPLICATIONS = /\/Applications\//

/**
 * 실행 파일 경로로 가린다. 앱도 시스템도 아니면(Homebrew 로 깐 프로그램, 셸, 경로를 모르는 것) null — 이름별로 묶는다.
 */
export function classifyMacProcess(exePath: string | null): MacProcessClass | null {
  if (!exePath || !exePath.startsWith('/')) return null
  const bundle = OUTER_BUNDLE.exec(exePath)
  const system = SYSTEM_DIR.test(exePath)
  if (bundle && !(system && !IN_APPLICATIONS.test(bundle[1])))
    return { kind: 'app', name: bundle[2], bundle: bundle[1] }
  return system ? { kind: 'system' } : null
}
