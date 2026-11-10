import type { DashboardSnapshot } from '../shared/types'
import { exePathOf } from '../shared/exePath'

/**
 * 화면이 보이는 OS 앱 아이콘(NeoHtop 이 프로세스마다 앱 아이콘을 보이는 것처럼).
 * 화면이 아무 파일이나 물어보지 못하게, 지금 스냅샷에 나온 실행 파일 경로에만 답한다.
 */
export function iconPathsOf(s: DashboardSnapshot | null): Set<string> {
  const paths = new Set<string>()
  if (!s) return paths
  for (const app of s.apps) if (app.exePath) paths.add(app.exePath)
  for (const row of [...s.servers, ...s.leftovers, ...s.heavyJobs]) {
    const path = exePathOf(row.commandLine, s.platform)
    if (path) paths.add(path)
  }
  return paths
}

interface IconImage {
  isEmpty(): boolean
  toDataURL(): string
}

const CACHE_LIMIT = 200

export function createIconSource(deps: {
  latest: () => DashboardSnapshot | null
  /** Electron app.getFileIcon. */
  getFileIcon: (path: string) => Promise<IconImage>
}): { get(path: unknown): Promise<string | null> } {
  const cache = new Map<string, string | null>()
  return {
    async get(path) {
      if (typeof path !== 'string' || !iconPathsOf(deps.latest()).has(path)) return null
      if (cache.has(path)) return cache.get(path) ?? null
      let icon: string | null
      try {
        const image = await deps.getFileIcon(path)
        icon = image.isEmpty() ? null : image.toDataURL()
      } catch {
        icon = null
      }
      cache.set(path, icon)
      if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
      return icon
    }
  }
}
