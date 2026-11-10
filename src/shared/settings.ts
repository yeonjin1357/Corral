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
  /** 정확한 상태를 아는 에이전트(Claude 훅·Codex)가 2분 넘게 일한 뒤 끝났을 때. */
  agentDone: boolean
  /** 훅으로 작업 중인 에이전트가 조용해졌을 때(G3c — 15분 넘게 이벤트도 CPU 사용도 없음). */
  agentQuiet: boolean
  /** 정확한 상태로 작업 중·권한 대기이던 에이전트가 꺼졌을 때. */
  agentGone: boolean
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
  /** 쉬는 에이전트의 마지막 활동이 이 시간 이상 전이면 오래 쉬는 세션(G2). */
  agentParkedMinutes: number
  /** 권한 대기가 이 시간 넘게 이어지면 다시 알린다(그 뒤로도 이 간격마다). 0 이면 다시 알리지 않는다. */
  waitingReminderMinutes: number
  /** "명령 이름 [인자…]" — 예: `vue-tsc`, `vite build`. */
  heavyPatterns: string[]
  notify: NotifySettings
  /** 끝난 워크트리에서 지울 의존성·빌드 결과 폴더 이름(워크트리 바로 아래, git 이 무시하는 것만 지운다). */
  dependencyDirs: string[]
  /**
   * 저장 형식 버전. 2: 지울 폴더 기본값에 빌드 결과 폴더를 더함(그 전에 저장한 기본값 node_modules 하나는
   * 새 기본값으로 옮긴다). 3: 오래 쉬는 세션 기준(agentParkedMinutes)을 더함. 없으면 그 전 형식.
   */
  settingsVersion: number
  /** 디스크 정리에서 살펴볼 저장소(에이전트·개발 서버를 본 저장소는 자동으로 기억한다). */
  extraRepos: string[]
  /**
   * 목록에서 숨길 서버: `:3000`(포트) 또는 프로세스 이름(`Docker Desktop.exe`). 숨긴 서버는 개수·정리 판단·추천·
   * 알림·트레이에서 빠진다.
   */
  hiddenServers: string[]
  /** 작업 공간 경로 → 보여 줄 이름. */
  workspaceAliases: Record<string, string>
  /**
   * 에이전트가 하는 일(G3b — 세션 제목·요청 첫 줄·도구 이름과 요약)을 보인다. 메모리에만 두고 파일로 남기지 않는다.
   * 끄면 훅이 알려 준 내용을 받는 순간 버리고, 들고 있던 것도 지운다.
   */
  showAgentActivity: boolean
}

export const SETTINGS_VERSION = 3
/** 지울 폴더 기본값을 새 기본값으로 옮긴 형식 버전(이 버전부터 저장한 목록은 그대로 둔다). */
const DEPENDENCY_DIRS_MIGRATED_VERSION = 2

export const REFRESH_INTERVALS: Record<RefreshSpeed, { openMs: number; closedMs: number }> = {
  fast: { openMs: 2000, closedMs: 10000 },
  normal: { openMs: 5000, closedMs: 30000 },
  saver: { openMs: 15000, closedMs: 120000 }
}

export const SETTINGS_LIMITS = {
  ramWarn: { min: 50, max: 98 },
  ramDangerMax: 99,
  idlePortMinutes: { min: 1, max: 1440 },
  agentParkedMinutes: { min: 10, max: 10080 },
  waitingReminderMinutes: { min: 0, max: 120 },
  heavyPatterns: 50,
  patternLength: 100,
  dependencyDirs: 20,
  extraRepos: 50,
  hiddenServers: 50,
  hiddenLength: 100,
  workspaceAliases: 50,
  aliasLength: 40
} as const

export const DEFAULT_SETTINGS: Settings = {
  refresh: 'normal',
  theme: 'auto',
  launchAtLogin: true,
  updateCheck: true,
  ramWarnPercent: 80,
  ramDangerPercent: 90,
  idlePortMinutes: 20,
  agentParkedMinutes: 180,
  waitingReminderMinutes: 10,
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
  notify: {
    ramLow: true,
    claudeWaiting: true,
    heavyOverlap: true,
    agentDone: true,
    agentQuiet: true,
    agentGone: true
  },
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
  settingsVersion: SETTINGS_VERSION,
  extraRepos: [],
  hiddenServers: [],
  workspaceAliases: {},
  showAgentActivity: true
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

/** 워크트리 항목(`<절대 경로>:<포트>`)의 경로 길이 상한. */
const HIDDEN_PATH_LENGTH = 1024
const validPort = (p: string): boolean => Number(p) >= 1 && Number(p) <= 65535

/** 숨김 항목을 나눈다: `:포트`, `<워크트리 절대 경로>:<포트>`, 프로세스 이름. 형식이 아니면 null. */
function parseHidden(
  entry: string
):
  | { kind: 'port'; port: number }
  | { kind: 'worktree'; root: string; port: number }
  | { kind: 'name'; name: string }
  | null {
  const t = entry.trim()
  if (!t) return null
  const port = /^:(\d{1,5})$/.exec(t)
  if (port) return validPort(port[1]) ? { kind: 'port', port: Number(port[1]) } : null
  const scoped = /^(.+):(\d{1,5})$/.exec(t)
  if (scoped && cleanRepoPath(scoped[1]) && scoped[1].length <= HIDDEN_PATH_LENGTH)
    return validPort(scoped[2])
      ? { kind: 'worktree', root: scoped[1], port: Number(scoped[2]) }
      : null
  if (t.startsWith(':') || t.length > SETTINGS_LIMITS.hiddenLength || /[\\/]/.test(t)) return null
  return { kind: 'name', name: t }
}

/** `:포트`(1~65535), `<워크트리 절대 경로>:<포트>`(그 워크트리의 그 포트 서버만), 또는 경로가 아닌 프로세스 이름. */
function cleanHidden(s: string): string | null {
  return parseHidden(s) ? s.trim() : null
}

const pathKey = (p: string): string =>
  p
    .replace(/[\\/]+$/, '')
    .replace(/\\/g, '/')
    .toLowerCase()

/** 숨김 항목이 이 서버에 맞는지(포트 중 하나, 프로세스 이름, 또는 같은 워크트리의 포트). 대소문자는 가리지 않는다. */
export function hiddenMatches(
  entry: string,
  row: { ports: readonly number[]; processName: string; worktree: { root: string } | null }
): boolean {
  const h = parseHidden(entry)
  if (!h) return false
  if (h.kind === 'port') return row.ports.includes(h.port)
  if (h.kind === 'name') return h.name.toLowerCase() === row.processName.toLowerCase()
  return (
    !!row.worktree && pathKey(row.worktree.root) === pathKey(h.root) && row.ports.includes(h.port)
  )
}

/** 화면에 보일 숨김 항목 이름: 워크트리 항목은 `폴더 이름 :포트`, 나머지는 그대로. */
export function hiddenLabel(entry: string): string {
  const h = parseHidden(entry)
  if (h?.kind !== 'worktree') return entry.trim()
  const parts = h.root.split(/[\\/]+/).filter(Boolean)
  return `${parts[parts.length - 1] ?? h.root} :${h.port}`
}

/** 별칭: 키는 로컬 절대 경로, 이름은 공백을 정리해 40자까지. 객체가 아니면 빈 값. */
function aliases(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, string> = {}
  for (const [key, name] of Object.entries(value)) {
    if (Object.keys(out).length >= SETTINGS_LIMITS.workspaceAliases) break
    const path = cleanRepoPath(key)
    if (!path || typeof name !== 'string') continue
    const label = name.trim().replace(/\s+/g, ' ')
    if (!label || label.length > SETTINGS_LIMITS.aliasLength) continue
    out[path] = label
  }
  return out
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
  // 버전 2 전에 저장한 지울 폴더가 그때 기본값(node_modules 하나)이면 새 기본값으로 옮긴다. git 이 무시하고
  // 추적하는 파일이 없는 폴더만 지우므로 빌드 결과 폴더가 더해져도 소스를 지우지 않는다.
  const oldDefaultDirs =
    !(
      typeof v.settingsVersion === 'number' && v.settingsVersion >= DEPENDENCY_DIRS_MIGRATED_VERSION
    ) &&
    Array.isArray(v.dependencyDirs) &&
    v.dependencyDirs.length === 1 &&
    typeof v.dependencyDirs[0] === 'string' &&
    v.dependencyDirs[0].trim().toLowerCase() === 'node_modules'
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
    agentParkedMinutes: int(
      v.agentParkedMinutes,
      SETTINGS_LIMITS.agentParkedMinutes.min,
      SETTINGS_LIMITS.agentParkedMinutes.max,
      d.agentParkedMinutes
    ),
    waitingReminderMinutes: int(
      v.waitingReminderMinutes,
      SETTINGS_LIMITS.waitingReminderMinutes.min,
      SETTINGS_LIMITS.waitingReminderMinutes.max,
      d.waitingReminderMinutes
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
      heavyOverlap: bool(notify.heavyOverlap, d.notify.heavyOverlap),
      agentDone: bool(notify.agentDone, d.notify.agentDone),
      agentQuiet: bool(notify.agentQuiet, d.notify.agentQuiet),
      agentGone: bool(notify.agentGone, d.notify.agentGone)
    },
    dependencyDirs: oldDefaultDirs
      ? [...d.dependencyDirs]
      : list(v.dependencyDirs, d.dependencyDirs, SETTINGS_LIMITS.dependencyDirs, cleanDirName),
    settingsVersion: SETTINGS_VERSION,
    extraRepos: list(v.extraRepos, d.extraRepos, SETTINGS_LIMITS.extraRepos, cleanRepoPath),
    hiddenServers: list(
      v.hiddenServers,
      d.hiddenServers,
      SETTINGS_LIMITS.hiddenServers,
      cleanHidden
    ),
    workspaceAliases: aliases(v.workspaceAliases),
    showAgentActivity: bool(v.showAgentActivity, d.showAgentActivity)
  }
}
