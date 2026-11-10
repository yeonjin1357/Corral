import { lstat, opendir, readFile, realpath, rename, rm, stat, writeFile } from 'fs/promises'
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
import { defaultBranch, finishedEvidence, gitCommonDir, ignoredFolders, listWorktrees } from './git'
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

/** 스냅샷에 나온 워크트리(서버(숨긴 서버 포함)·에이전트·남은 프로세스·무거운 작업). */
export function snapshotWorktrees(s: DashboardSnapshot | null): WorktreeInfo[] {
  if (!s) return []
  return [...s.servers, ...s.hiddenServers, ...s.agents, ...s.leftovers, ...s.heavyJobs].flatMap(
    (r) => (r.worktree ? [r.worktree] : [])
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
  /**
   * 모든 프로세스의 작업 폴더(macOS: lsof). 수집이 일부 프로세스의 작업 폴더만 읽는 경우,
   * 지우기 직전에 그 워크트리 안에 있는 셸·도구를 알아보는 데 쓴다. 없으면 null.
   */
  fullCwds?: () => Promise<Record<number, string> | null>
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

/** 이 수집 방식은 모든 프로세스의 작업 폴더를 읽는다(Windows 보조 코드). */
function hasAllCwds(sample: RawSample): boolean {
  return sample.collectMode === 'helper-dll' || sample.collectMode === 'helper-memory'
}

/** git 이 없거나(ENOENT) macOS 명령줄 도구가 없는 경우(xcrun 오류). */
function isGitMissing(e: unknown): boolean {
  if (errorCode(e) === 'ENOENT') return true
  const message = e instanceof Error ? e.message : String(e)
  return /xcrun: error|no developer tools|CommandLineTools/i.test(message)
}

export function createDiskManager(deps: DiskDeps): {
  /** manual 이 아니면(주기 실행) git 이 없다고 확인된 뒤에는 다시 찾지 않는다(macOS 설치 창 반복 방지). */
  scan(opts?: { manual?: boolean }): Promise<DiskReport>
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
  let gitMissing = false
  const busy = new Set<string>()

  /**
   * 그 워크트리에서 무언가 실행 중: 스냅샷의 포트·에이전트·남은 프로세스·무거운 작업이 그 안이거나,
   * 에이전트가 그 상위 폴더(여러 저장소를 묶은 작업 공간)에서 일한다.
   */
  function inUse(row: DiskRow): boolean {
    const latest = deps.latest()
    if (snapshotWorktrees(latest).some((w) => agentCovers([row.worktreeRoot], w.root))) return true
    return (latest?.agents ?? []).some(
      (a) => !!a.worktree && agentCovers([a.worktree.root], row.worktreeRoot)
    )
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

  /**
   * 워크트리 바로 아래의 지울 수 있는 폴더. 링크는 건너뛰고, git 이 무시하는 폴더만 지울 대상으로 둔다
   * (저장소에 올라간 build/ 같은 소스 폴더는 이름이 같아도 지우지 않는다). git 확인이 안 되면 모두 건너뛴다.
   */
  async function dependencyFolders(root: string): Promise<DiskFolder[]> {
    const folders: DiskFolder[] = []
    for (const name of deps.settings().dependencyDirs.filter(isDependencyDirName)) {
      const path = join(root, name)
      const st = await lstat(path).catch(() => null)
      if (!st) continue
      if (st.isSymbolicLink()) folders.push({ name, path, bytes: null, skipped: 'link' })
      else if (st.isDirectory()) folders.push({ name, path, bytes: null })
    }
    const candidates = folders.filter((f) => !f.skipped).map((f) => f.name)
    if (candidates.length === 0) return folders
    const ignored = await ignoredFolders(root, candidates).catch(() => null)
    for (const folder of folders) {
      if (folder.skipped) continue
      if (!ignored) folder.skipped = 'unreadable'
      else if (!ignored.has(folder.name)) folder.skipped = 'tracked'
    }
    return folders
  }

  async function repoList(): Promise<string[]> {
    const extra = await Promise.all(deps.settings().extraRepos.map((p) => gitCommonDir(p)))
    const all: string[] = []
    const real: string[] = []
    for (const dir of [...deps.knownRepos(), ...extra]) {
      // 네트워크 공유는 응답이 없으면 찾기 전체가 멈출 수 있어 보지 않는다(설정의 추가 저장소와 같은 규칙).
      if (!dir || /^[\\/]{2}/.test(dir)) continue
      // 같은 저장소를 다른 경로(정션·subst·8.3 이름)로 알 수 있어 실제 경로로 겹침을 가린다.
      const canonical = await realpath(dir).catch(() => dir)
      if (real.some((d) => samePath(d, canonical))) continue
      real.push(canonical)
      all.push(dir)
    }
    return all
  }

  /** 저장소 하나의 끝난 워크트리. 그 저장소만의 문제(지워짐·시간 초과)는 빈 목록으로, git 이 없으면 던진다. */
  async function rowsOf(commonDir: string): Promise<DiskRow[]> {
    const found: DiskRow[] = []
    try {
      const list = await listWorktrees(commonDir)
      // 첫 항목은 메인 체크아웃(또는 bare 저장소)이라 대상이 아니다. 연결된 워크트리가 없으면 더 볼 것도 없다.
      if (list.length < 2) return found
      const defaultRef = await defaultBranch(commonDir)
      for (const wt of list.slice(1)) {
        // 잠긴 워크트리는 다른 도구가 쓰는 중이라는 표시다.
        if (wt.bare || wt.prunable || wt.locked || !wt.branch) continue
        const isDir = await stat(wt.path).then(
          (s) => s.isDirectory(),
          () => false
        )
        if (!isDir) continue
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
    } catch (e) {
      if (isGitMissing(e)) throw e
    }
    return found
  }

  async function findRows(): Promise<DiskRow[]> {
    const found: DiskRow[] = []
    for (const commonDir of await repoList()) found.push(...(await rowsOf(commonDir)))
    return found
  }

  async function runScan(): Promise<DiskReport> {
    try {
      rows = await findRows()
      error = null
      gitMissing = false
      scannedAt = deps.now()
      emit()
      for (const row of rows) {
        for (const folder of row.folders) {
          if (folder.skipped) continue
          try {
            folder.bytes = await measureCached(folder.path)
          } catch {
            // 읽을 수 없는 폴더는 "재는 중"으로 남기지 않고 건너뛴다고 보인다.
            folder.skipped = 'unreadable'
          }
        }
        row.totalBytes = row.folders.reduce((sum, f) => sum + (f.bytes ?? 0), 0)
        emit()
      }
      rows.sort((a, b) => (b.totalBytes ?? 0) - (a.totalBytes ?? 0))
    } catch (e) {
      rows = []
      gitMissing = isGitMissing(e)
      error = gitMissing
        ? text.disk.gitMissing
        : text.disk.scanFailed(e instanceof Error ? e.message : String(e))
    }
    return report()
  }

  function scan(opts: { manual?: boolean } = {}): Promise<DiskReport> {
    if (gitMissing && !opts.manual) return Promise.resolve(report())
    if (!scanning) {
      scanning = runScan().finally(() => {
        scanning = null
        emit()
      })
      emit()
    }
    return scanning.then(() => report())
  }

  /**
   * 지워도 되는지: 아직 메인이 아닌 연결된 워크트리이고 여전히 끝났고, 그 워크트리를 쓰는 것이 없다.
   * 확인 창 앞뒤로 두 번 부른다(창을 띄운 사이 npm install·개발 서버·에이전트를 시작했을 수 있다).
   */
  async function checkRemovable(
    row: DiskRow
  ): Promise<{ problem: KillResult } | { allCwds: boolean }> {
    const list = await listWorktrees(row.commonDir)
    const index = list.findIndex((w) => samePath(w.path, row.worktreeRoot))
    if (index <= 0) return { problem: { status: 'gone' } }
    const evidence = await finishedEvidence(
      row.commonDir,
      list[index],
      await defaultBranch(row.commonDir)
    )
    if (!evidence || list[index].locked)
      return { problem: { status: 'failed', message: text.disk.notFinished } }

    if (inUse(row)) return { problem: { status: 'failed', message: text.disk.inUse } }
    // 작업 폴더를 모르는 에이전트는 이 워크트리에서 일하고 있을 수 있다(불확실하면 지우지 않는다).
    if ((deps.latest()?.agents ?? []).some((a) => !a.worktree))
      return { problem: { status: 'failed', message: text.disk.unknownAgent } }

    const sample = await deps.resample()
    let allCwds = hasAllCwds(sample)
    if (!allCwds && deps.fullCwds) {
      const extra = await deps.fullCwds().catch(() => null)
      if (extra) {
        sample.cwds = { ...sample.cwds, ...extra }
        allCwds = true
      }
    }
    const user = processUsing(sample, row.worktreeRoot)
    if (user)
      return { problem: { status: 'failed', message: text.disk.inUseBy(user.name, user.pid) } }
    return { allCwds }
  }

  async function removeRow(row: DiskRow): Promise<KillResult> {
    // 1) 지워도 되는지.
    const before = await checkRemovable(row)
    if ('problem' in before) return before.problem

    // 2) 확인 창.
    const targets = (await dependencyFolders(row.worktreeRoot)).filter((f) => !f.skipped)
    if (targets.length === 0) return { status: 'gone' }
    const known = new Map(row.folders.map((f) => [f.name, f.bytes ?? 0]))
    const total = targets.reduce((sum, f) => sum + (known.get(f.name) ?? 0), 0)
    const names = targets.map((f) => f.name).join(', ')
    const ok = await deps.confirm({
      title: text.disk.confirmTitle,
      message: text.disk.confirmMessage(basename(row.worktreeRoot), names, formatBytes(total)),
      detail: text.disk.confirmDetail(
        targets.map((f) => f.path),
        before.allCwds
      ),
      buttons: [text.disk.confirm, text.kill.cancel],
      defaultId: 1,
      cancelId: 1
    })
    if (!ok) return { status: 'cancelled' }

    // 3) 확인 창을 띄운 동안 시간이 지났으니 한 번 더 본다.
    const after = await checkRemovable(row)
    if ('problem' in after) return after.problem

    // 4) 지우기: 이름 규칙·경로·링크 여부를 한 번 더 본 뒤에만.
    const failed: string[] = []
    const removed: string[] = []
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
      sizeCache.delete(path)
      if (
        await lstat(path).then(
          () => true,
          () => false
        )
      )
        failed.push(folder.name)
      else {
        freed += known.get(folder.name) ?? 0
        removed.push(folder.name)
      }
    }

    // 5) 목록 갱신: 지울 것이 남지 않았으면 행을 뺀다.
    const remaining = (await dependencyFolders(row.worktreeRoot)).filter((f) => !f.skipped)
    if (remaining.length === 0) rows = rows.filter((r) => r !== row)
    else {
      // 일부만 지워졌으면 크기를 다시 잰다.
      row.folders = row.folders.filter((f) => f.skipped || remaining.some((r) => r.name === f.name))
      for (const folder of row.folders) {
        if (folder.skipped) continue
        folder.bytes = await measureCached(folder.path).catch(() => null)
      }
      row.totalBytes = row.folders.reduce((sum, f) => sum + (f.bytes ?? 0), 0)
    }
    emit()
    if (failed.length > 0)
      return { status: 'failed', message: text.disk.partial(failed.join(', ')) }
    return {
      status: 'killed',
      message: text.disk.removed(names, formatBytes(freed)),
      freed: { count: removed.length, memoryBytes: freed, commitBytes: null, names: removed }
    }
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
