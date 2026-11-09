import { lstat, opendir, readFile, rename, rm, stat, writeFile } from 'fs/promises'
import { basename, join } from 'path'
import type {
  DashboardSnapshot,
  DiskFolder,
  DiskReport,
  DiskRow,
  KillResult,
  RawSample,
  WorktreeInfo
} from '../shared/types'
import { agentCovers, formatBytes } from '../shared/format'
import { isDependencyDirName } from '../shared/settings'
import { text } from '../shared/text'
import { defaultBranch, finishedEvidence, gitCommonDir, listWorktrees } from './git'
import type { KillConfirm } from './kill'

/* 디스크 정리(스펙 §3-8): 끝난 연결된 워크트리의 의존성 폴더 크기를 보여 주고, 확인 후 지운다. */

const MEASURE_CONCURRENCY = 32
const MEASURE_CACHE_MS = 24 * 60 * 60 * 1000

/**
 * 폴더 안 파일 크기의 합. 링크(심볼릭 링크·Windows 정션)는 따라가지 않는다 — pnpm 처럼 바깥 저장소를 가리키는
 * 링크까지 세면 지워도 확보되지 않는 크기가 잡힌다. 읽을 수 없는 항목은 건너뛴다. 없는 폴더는 0.
 */
export async function measureDir(root: string): Promise<{ bytes: number; files: number }> {
  let bytes = 0
  let files = 0
  const queue: string[] = [root]
  let active = 0
  await new Promise<void>((resolve) => {
    const pump = (): void => {
      if (queue.length === 0 && active === 0) return resolve()
      while (active < MEASURE_CONCURRENCY && queue.length > 0) {
        const dir = queue.pop()!
        active++
        void visit(dir).finally(() => {
          active--
          pump()
        })
      }
    }
    const visit = async (dir: string): Promise<void> => {
      let handle
      try {
        handle = await opendir(dir)
      } catch {
        return
      }
      const fileStats: Promise<void>[] = []
      for await (const entry of handle) {
        const path = join(dir, entry.name)
        if (entry.isSymbolicLink()) continue
        if (entry.isDirectory()) queue.push(path)
        else if (entry.isFile())
          fileStats.push(
            lstat(path).then(
              (s) => {
                bytes += s.size
                files++
              },
              () => {}
            )
          )
      }
      await Promise.all(fileStats)
    }
    pump()
  })
  return { bytes, files }
}

/** 디스크 정리에서 살펴볼 저장소(git 공용 폴더)를 기억한다. 에이전트·개발 서버가 한 번이라도 관찰된 저장소. */
export function createRepoMemory(
  file: string,
  max = 200
): {
  load(): Promise<void>
  add(dirs: Iterable<string | null | undefined>): void
  list(): string[]
  flush(): Promise<void>
} {
  let repos: string[] = []
  let writing: Promise<void> = Promise.resolve()
  const key = (p: string): string => p.replace(/[\\/]+$/, '').toLowerCase()

  async function save(): Promise<void> {
    const tmp = `${file}.tmp-${process.pid}`
    await writeFile(tmp, JSON.stringify({ repos }, null, 2) + '\n')
    await rename(tmp, file)
  }

  return {
    async load() {
      try {
        const value = JSON.parse(await readFile(file, 'utf8')) as { repos?: unknown }
        repos = Array.isArray(value?.repos)
          ? value.repos.filter((r): r is string => typeof r === 'string' && !!r).slice(-max)
          : []
      } catch {
        repos = []
      }
    },
    add(dirs) {
      let changed = false
      for (const dir of dirs) {
        if (!dir) continue
        if (repos.some((r) => key(r) === key(dir))) continue
        repos.push(dir)
        changed = true
      }
      if (!changed) return
      while (repos.length > max) repos.shift()
      writing = writing.then(save).catch(() => {})
    },
    list: () => [...repos],
    flush: () => writing
  }
}

/** 스냅샷에 나온 워크트리(포트·에이전트·남은 프로세스·무거운 작업). */
export function snapshotWorktrees(s: DashboardSnapshot | null): WorktreeInfo[] {
  if (!s) return []
  return [...s.ports, ...s.agents, ...s.leftovers, ...s.heavyJobs].flatMap((r) =>
    r.worktree ? [r.worktree] : []
  )
}

export interface DiskDeps {
  settings: () => { dependencyDirs: string[]; extraRepos: string[] }
  /** 기억해 둔 저장소 공용 폴더. */
  knownRepos: () => string[]
  latest: () => DashboardSnapshot | null
  /** 지우기 직전 그 워크트리를 쓰는 프로세스가 있는지 보는 최신 샘플. */
  resample: () => Promise<RawSample>
  confirm: (o: KillConfirm) => Promise<boolean>
  now: () => number
  onChange: (report: DiskReport) => void
  /** 기본 fs.rm(재귀, 링크는 따라가지 않음). 테스트에서 바꿔 끼운다. */
  removeDir?: (path: string) => Promise<void>
}

function errorCode(e: unknown): string | undefined {
  return typeof e === 'object' && e !== null && 'code' in e
    ? String((e as { code: unknown }).code)
    : undefined
}

function samePath(a: string, b: string): boolean {
  return agentCovers([a], b) && agentCovers([b], a)
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 명령줄이나 작업 폴더가 그 워크트리 안인 프로세스(에디터·셸·서버 등). */
export function processUsing(
  sample: RawSample,
  root: string
): { name: string; pid: number } | null {
  const rootKey = root.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  const inLine = new RegExp(`(^|[\\s"'=])${escapeRegExp(rootKey)}($|[\\s"'/])`)
  for (const p of sample.processes) {
    const line = p.commandLine.replace(/\\/g, '/').toLowerCase()
    const cwd = sample.cwds?.[p.pid]
    if (inLine.test(line) || (cwd && agentCovers([root], cwd))) return { name: p.name, pid: p.pid }
  }
  return null
}

export function createDiskManager(deps: DiskDeps): {
  scan(): Promise<DiskReport>
  report(): DiskReport
  remove(worktreeRoot: string): Promise<KillResult>
} {
  const removeDir =
    deps.removeDir ??
    ((path: string) => rm(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }))
  const sizeCache = new Map<string, { mtimeMs: number; bytes: number; at: number }>()
  let rows: DiskRow[] = []
  let scannedAt: number | null = null
  let error: string | null = null
  let scanning: Promise<DiskReport> | null = null
  const busy = new Set<string>()

  function inUse(row: DiskRow): boolean {
    return snapshotWorktrees(deps.latest()).some((w) => agentCovers([row.worktreeRoot], w.root))
  }

  function report(): DiskReport {
    return {
      rows: rows.map((r) => ({ ...r, folders: r.folders.map((f) => ({ ...f })), inUse: inUse(r) })),
      scannedAt,
      scanning: scanning !== null,
      error
    }
  }

  const emit = (): void => deps.onChange(report())

  async function measureCached(path: string): Promise<number> {
    const st = await stat(path)
    const hit = sizeCache.get(path)
    if (hit && hit.mtimeMs === st.mtimeMs && deps.now() - hit.at < MEASURE_CACHE_MS)
      return hit.bytes
    const { bytes } = await measureDir(path)
    sizeCache.set(path, { mtimeMs: st.mtimeMs, bytes, at: deps.now() })
    return bytes
  }

  async function dependencyFolders(root: string): Promise<DiskFolder[]> {
    const folders: DiskFolder[] = []
    for (const name of deps.settings().dependencyDirs.filter(isDependencyDirName)) {
      const path = join(root, name)
      const st = await lstat(path).catch(() => null)
      if (!st) continue
      if (st.isSymbolicLink()) folders.push({ name, path, bytes: null, skipped: 'link' })
      else if (st.isDirectory()) folders.push({ name, path, bytes: null })
    }
    return folders
  }

  async function repoList(): Promise<string[]> {
    const extra = await Promise.all(deps.settings().extraRepos.map((p) => gitCommonDir(p)))
    const all: string[] = []
    for (const dir of [...deps.knownRepos(), ...extra]) {
      if (dir && !all.some((d) => samePath(d, dir))) all.push(dir)
    }
    return all
  }

  async function findRows(): Promise<DiskRow[]> {
    const found: DiskRow[] = []
    for (const commonDir of await repoList()) {
      let list
      try {
        list = await listWorktrees(commonDir)
      } catch (e) {
        if (errorCode(e) === 'ENOENT') throw e
        continue // 지워진 저장소 등은 건너뛴다.
      }
      const defaultRef = await defaultBranch(commonDir)
      // 첫 항목은 메인 체크아웃(또는 bare 저장소)이라 대상이 아니다.
      for (const wt of list.slice(1)) {
        if (wt.bare || wt.prunable || !wt.branch) continue
        if (
          !(await stat(wt.path).then(
            (s) => s.isDirectory(),
            () => false
          ))
        )
          continue
        const evidence = await finishedEvidence(commonDir, wt, defaultRef)
        if (!evidence) continue
        const folders = await dependencyFolders(wt.path)
        if (folders.length === 0) continue
        found.push({
          worktreeRoot: wt.path,
          commonDir,
          branch: wt.branch,
          evidence,
          folders,
          totalBytes: null,
          inUse: false
        })
      }
    }
    return found
  }

  async function runScan(): Promise<DiskReport> {
    try {
      rows = await findRows()
      error = null
      scannedAt = deps.now()
      emit()
      for (const row of rows) {
        for (const folder of row.folders) {
          if (folder.skipped) continue
          folder.bytes = await measureCached(folder.path).catch(() => null)
        }
        row.totalBytes = row.folders.reduce((sum, f) => sum + (f.bytes ?? 0), 0)
        emit()
      }
      rows.sort((a, b) => (b.totalBytes ?? 0) - (a.totalBytes ?? 0))
    } catch (e) {
      rows = []
      error =
        errorCode(e) === 'ENOENT'
          ? text.disk.gitMissing
          : text.disk.scanFailed(e instanceof Error ? e.message : String(e))
    }
    return report()
  }

  function scan(): Promise<DiskReport> {
    if (!scanning) {
      scanning = runScan().finally(() => {
        scanning = null
        emit()
      })
      emit()
    }
    return scanning.then(() => report())
  }

  async function removeRow(row: DiskRow): Promise<KillResult> {
    // 1) 아직 메인이 아닌 연결된 워크트리이고, 여전히 끝난 상태인지.
    const list = await listWorktrees(row.commonDir)
    const index = list.findIndex((w) => samePath(w.path, row.worktreeRoot))
    if (index <= 0) return { status: 'gone' }
    const evidence = await finishedEvidence(
      row.commonDir,
      list[index],
      await defaultBranch(row.commonDir)
    )
    if (!evidence) return { status: 'failed', message: text.disk.notFinished }

    // 2) 그 워크트리를 쓰는 것이 없어야 한다.
    if (inUse(row)) return { status: 'failed', message: text.disk.inUse }
    const user = processUsing(await deps.resample(), row.worktreeRoot)
    if (user) return { status: 'failed', message: text.disk.inUseBy(user.name, user.pid) }

    // 3) 확인 창.
    const targets = (await dependencyFolders(row.worktreeRoot)).filter((f) => !f.skipped)
    if (targets.length === 0) return { status: 'gone' }
    const known = new Map(row.folders.map((f) => [f.name, f.bytes ?? 0]))
    const total = targets.reduce((sum, f) => sum + (known.get(f.name) ?? 0), 0)
    const names = targets.map((f) => f.name).join(', ')
    const ok = await deps.confirm({
      title: text.disk.confirmTitle,
      message: text.disk.confirmMessage(basename(row.worktreeRoot), names, formatBytes(total)),
      detail: text.disk.confirmDetail(targets.map((f) => f.path)),
      buttons: [text.disk.confirm, text.kill.cancel],
      defaultId: 1,
      cancelId: 1
    })
    if (!ok) return { status: 'cancelled' }

    // 4) 지우기: 이름 규칙·경로·링크 여부를 한 번 더 본 뒤에만.
    const failed: string[] = []
    let freed = 0
    for (const folder of targets) {
      const path = join(row.worktreeRoot, folder.name)
      const st = await lstat(path).catch(() => null)
      if (!st) continue
      if (!isDependencyDirName(folder.name) || st.isSymbolicLink() || !st.isDirectory()) {
        failed.push(folder.name)
        continue
      }
      try {
        await removeDir(path)
      } catch {
        // 아래에서 남았는지로 판단한다.
      }
      if (
        await lstat(path).then(
          () => true,
          () => false
        )
      )
        failed.push(folder.name)
      else {
        freed += known.get(folder.name) ?? 0
        sizeCache.delete(path)
      }
    }

    // 5) 목록 갱신: 지울 것이 남지 않았으면 행을 뺀다.
    const remaining = (await dependencyFolders(row.worktreeRoot)).filter((f) => !f.skipped)
    if (remaining.length === 0) rows = rows.filter((r) => r !== row)
    else
      row.folders = row.folders.filter((f) => f.skipped || remaining.some((r) => r.name === f.name))
    emit()
    if (failed.length > 0)
      return { status: 'failed', message: text.disk.partial(failed.join(', ')) }
    return { status: 'killed', message: text.disk.removed(names, formatBytes(freed)) }
  }

  async function remove(worktreeRoot: string): Promise<KillResult> {
    if (typeof worktreeRoot !== 'string' || !worktreeRoot)
      return { status: 'failed', message: text.killResult.invalid }
    const row = rows.find((r) => samePath(r.worktreeRoot, worktreeRoot))
    if (!row) return { status: 'gone' }
    const key = row.worktreeRoot.toLowerCase()
    if (busy.has(key)) return { status: 'failed', message: text.killResult.busy }
    busy.add(key)
    try {
      return await removeRow(row)
    } catch (e) {
      return { status: 'failed', message: e instanceof Error ? e.message : String(e) }
    } finally {
      busy.delete(key)
    }
  }

  return { scan, report, remove }
}
