import type { ProcessInfo, ProcessSummary } from '../shared/types'
import { text } from '../shared/text'

const BROWSER_NAME =
  /^(chrome|chromium|msedge|firefox|headless_shell|pw_run|MiniBrowser|WebKit\w*)(\.exe)?$/i

/** 목록에 보일 알아보기 쉬운 이름. 모르면 프로세스 이름. */
export function processLabel(p: ProcessInfo): string {
  const cmd = p.commandLine.replace(/\\/g, '/')
  const labels = text.leftoverLabels
  if (/KotlinCompileDaemon/i.test(cmd)) return labels.kotlinDaemon
  if (/GradleDaemon/i.test(cmd)) return labels.gradleDaemon
  if (/@playwright\/mcp|playwright-mcp/i.test(cmd)) return labels.playwrightMcp
  if (/playwright/i.test(cmd))
    return BROWSER_NAME.test(p.name) ? labels.playwrightBrowser : labels.playwright
  if (/--remote-debugging-pipe|--headless/i.test(cmd)) return labels.headlessBrowser
  if (/vitest/i.test(cmd)) return 'Vitest'
  if (/jest-worker/i.test(cmd)) return labels.jestWorker
  if (/esbuild/i.test(cmd)) return 'esbuild'
  if (/webpack/i.test(cmd)) return 'webpack'
  if (/tsserver/i.test(cmd)) return labels.tsserver
  const bin = /node_modules\/\.bin\/([^/\s"']+)/i.exec(cmd)
  if (bin) return bin[1]
  return p.name
}

const MAX_HINT = 60
/** 상세 패널에 보일 묶음 수 상한(스냅샷을 작게). */
export const PROCESS_SUMMARY_LIMIT = 30

/** 따옴표를 뗀 명령줄 낱말(`/` 경로로 바꿈). 따옴표 안의 공백은 한 낱말로 둔다. */
function words(commandLine: string): string[] {
  const out: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(commandLine))) out.push((m[1] ?? m[2] ?? m[3]).replace(/\\/g, '/'))
  return out
}

const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

/** `@scope/name@1.2.3`·`name@latest` 의 버전 꼬리를 뗀다. */
function withoutVersion(pkg: string): string {
  const at = pkg.lastIndexOf('@')
  return at > 0 ? pkg.slice(0, at) : pkg
}

const RUNNER = /^(npx|uvx|bunx|pipx)(\.cmd|\.exe)?$/i
const SCRIPT = /\.(m?js|cjs|ts|mts|py|jar)$/i
const PACKAGE = /node_modules\/((?:@[^/\s]+\/)?[^/\s.][^/\s]*)\//g

/**
 * 프로세스가 무엇인지 알 수 있는 짧은 이름. 이미 아는 개발 도구 이름 → node_modules 안 패키지(겹치면 마지막) →
 * npx·uvx 로 띄운 패키지 → `python -m` 모듈 → 스크립트 파일 이름 순. 셸·콘솔처럼 알 수 없으면 null.
 * 명령줄의 다른 인자(토큰·주소 등)는 담지 않는다.
 */
export function processHint(p: ProcessInfo): string | null {
  const hint = findHint(p)
  return hint ? hint.slice(0, MAX_HINT) : null
}

function findHint(p: ProcessInfo): string | null {
  if (!p.commandLine) return null
  const known = processLabel(p)
  if (known !== p.name) return known
  const cmd = p.commandLine.replace(/\\/g, '/')
  const packages = [...cmd.matchAll(PACKAGE)].map((m) => m[1])
  if (packages.length) return packages[packages.length - 1]
  const list = words(p.commandLine)
  for (let i = 0; i < list.length; i++) {
    const w = list[i]
    if (RUNNER.test(baseName(w))) {
      const pkg = list.slice(i + 1).find((x) => !x.startsWith('-'))
      if (pkg) return withoutVersion(pkg)
    }
    if (w === '-m' && list[i + 1]) return list[i + 1]
  }
  // 첫 낱말(실행 파일) 뒤에서 처음 나오는 스크립트 파일.
  const script = list.slice(1).find((w) => !w.startsWith('-') && SCRIPT.test(w))
  return script ? baseName(script) : null
}

/** 이름(대소문자 무시)·짧은 이름별로 묶어 메모리 큰 순(같으면 개수·이름 순)으로 한도만큼. */
export function summarizeProcesses(
  members: ProcessInfo[],
  limit = PROCESS_SUMMARY_LIMIT
): ProcessSummary[] {
  const groups = new Map<string, ProcessSummary>()
  for (const p of members) {
    const hint = processHint(p)
    const key = `${p.name.toLowerCase()}\0${hint ?? ''}`
    const g = groups.get(key)
    if (g) {
      g.count++
      g.memoryBytes += p.memoryBytes
    } else groups.set(key, { name: p.name, hint, count: 1, memoryBytes: p.memoryBytes })
  }
  return [...groups.values()]
    .sort(
      (a, b) => b.memoryBytes - a.memoryBytes || b.count - a.count || a.name.localeCompare(b.name)
    )
    .slice(0, limit)
}
