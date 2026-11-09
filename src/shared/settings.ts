/** 사용자 설정(앱 데이터 폴더의 config.json 의 settings). 메인·렌더러가 같이 쓴다. */

export type RefreshSpeed = 'fast' | 'normal' | 'saver'
export type ThemeChoice = 'auto' | 'light' | 'dark'

export interface NotifySettings {
  /** RAM 이 위험 기준을 넘을 때. */
  ramLow: boolean
  /** Claude 가 권한을 기다릴 때(Claude 연동이 켜져 있을 때만 알 수 있다). */
  claudeWaiting: boolean
  /** 무거운 작업이 겹치고 RAM 이 경고 기준을 넘을 때. */
  heavyOverlap: boolean
}

export interface Settings {
  refresh: RefreshSpeed
  theme: ThemeChoice
  /** 로그인할 때 트레이로 시작(설치된 앱에서만 OS 에 등록). */
  launchAtLogin: boolean
  /** GitHub 에서 새 버전을 확인(pitwall 이 하는 유일한 네트워크 접속). */
  updateCheck: boolean
  ramWarnPercent: number
  ramDangerPercent: number
  /** 에이전트 없는 워크트리의 포트가 이 시간 이상 안 쓰이면 정리 후보. */
  idlePortMinutes: number
  /** "명령 이름 [인자…]" — 예: `vue-tsc`, `vite build`. */
  heavyPatterns: string[]
  notify: NotifySettings
  /** 끝난 워크트리에서 지울 의존성 폴더 이름(워크트리 바로 아래). */
  dependencyDirs: string[]
  /** 디스크 정리에서 살펴볼 저장소(에이전트·개발 서버를 본 저장소는 자동으로 기억한다). */
  extraRepos: string[]
}

export const REFRESH_INTERVALS: Record<RefreshSpeed, { openMs: number; closedMs: number }> = {
  fast: { openMs: 2000, closedMs: 10000 },
  normal: { openMs: 5000, closedMs: 30000 },
  saver: { openMs: 15000, closedMs: 120000 }
}

export const SETTINGS_LIMITS = {
  ramWarn: { min: 50, max: 98 },
  ramDangerMax: 99,
  idlePortMinutes: { min: 1, max: 1440 },
  heavyPatterns: 50,
  patternLength: 100,
  dependencyDirs: 20,
  extraRepos: 50
} as const

export const DEFAULT_SETTINGS: Settings = {
  refresh: 'normal',
  theme: 'auto',
  launchAtLogin: true,
  updateCheck: true,
  ramWarnPercent: 80,
  ramDangerPercent: 90,
  idlePortMinutes: 20,
  heavyPatterns: [
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
  ],
  notify: { ramLow: true, claudeWaiting: true, heavyOverlap: true },
  dependencyDirs: ['node_modules'],
  extraRepos: []
}

function oneOf<T extends string>(value: unknown, choices: readonly T[], fallback: T): T {
  return choices.includes(value as T) ? (value as T) : fallback
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function int(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

/** 문자열 목록: 공백 정리, 빈 값·조건 불통과·중복(대소문자 무시) 제거, 개수 제한. 배열이 아니면 기본값. */
function list(
  value: unknown,
  fallback: string[],
  max: number,
  clean: (s: string) => string | null
): string[] {
  if (!Array.isArray(value)) return [...fallback]
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (typeof item !== 'string') continue
    const cleaned = clean(item)
    if (!cleaned) continue
    const key = cleaned.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(cleaned)
    if (out.length >= max) break
  }
  return out
}

function cleanPattern(s: string): string | null {
  const t = s.trim().replace(/\s+/g, ' ')
  return t && t.length <= SETTINGS_LIMITS.patternLength ? t : null
}

/** 폴더 이름 하나(경로 구분자·드라이브·와일드카드·`.`·`..`·`.git` 불가). 지우기 대상이라 엄격하게 본다. */
export function isDependencyDirName(name: string): boolean {
  return (
    /^[^\\/:*?"<>|\0]+$/.test(name) &&
    name !== '.' &&
    name !== '..' &&
    name.toLowerCase() !== '.git' &&
    name.trim() === name
  )
}

function cleanDirName(s: string): string | null {
  const t = s.trim()
  return t && isDependencyDirName(t) ? t : null
}

/** 로컬 절대 경로만(네트워크 공유는 느리거나 막힐 수 있어 받지 않는다). */
function cleanRepoPath(s: string): string | null {
  const t = s.trim()
  if (/^[\\/]{2}/.test(t)) return null
  return /^[A-Za-z]:[\\/]/.test(t) || /^\/(?!\/)/.test(t) ? t : null
}

export function normalizeSettings(value: unknown): Settings {
  const v = (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as Record<
    string,
    unknown
  >
  const d = DEFAULT_SETTINGS
  const warn = int(
    v.ramWarnPercent,
    SETTINGS_LIMITS.ramWarn.min,
    SETTINGS_LIMITS.ramWarn.max,
    d.ramWarnPercent
  )
  // 위험 기준은 항상 경고보다 높다. 경고 기준을 옮기면 위험 기본값도 그 위로 밀린다.
  const danger = int(
    v.ramDangerPercent,
    warn + 1,
    SETTINGS_LIMITS.ramDangerMax,
    Math.min(SETTINGS_LIMITS.ramDangerMax, Math.max(d.ramDangerPercent, warn + 1))
  )
  const notify = (v.notify && typeof v.notify === 'object' ? v.notify : {}) as Record<
    string,
    unknown
  >
  return {
    refresh: oneOf(v.refresh, ['fast', 'normal', 'saver'] as const, d.refresh),
    theme: oneOf(v.theme, ['auto', 'light', 'dark'] as const, d.theme),
    launchAtLogin: bool(v.launchAtLogin, d.launchAtLogin),
    updateCheck: bool(v.updateCheck, d.updateCheck),
    ramWarnPercent: warn,
    ramDangerPercent: danger,
    idlePortMinutes: int(
      v.idlePortMinutes,
      SETTINGS_LIMITS.idlePortMinutes.min,
      SETTINGS_LIMITS.idlePortMinutes.max,
      d.idlePortMinutes
    ),
    heavyPatterns: list(
      v.heavyPatterns,
      d.heavyPatterns,
      SETTINGS_LIMITS.heavyPatterns,
      cleanPattern
    ),
    notify: {
      ramLow: bool(notify.ramLow, d.notify.ramLow),
      claudeWaiting: bool(notify.claudeWaiting, d.notify.claudeWaiting),
      heavyOverlap: bool(notify.heavyOverlap, d.notify.heavyOverlap)
    },
    dependencyDirs: list(
      v.dependencyDirs,
      d.dependencyDirs,
      SETTINGS_LIMITS.dependencyDirs,
      cleanDirName
    ),
    extraRepos: list(v.extraRepos, d.extraRepos, SETTINGS_LIMITS.extraRepos, cleanRepoPath)
  }
}
