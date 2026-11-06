# pitwall 1단계(기반 + 메인 화면) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 트레이에 상주하는 Electron 앱의 뼈대를 세우고, 실제 PC 데이터(RAM·개발 서버 포트·프로세스 묶음)를 Uptime Kuma 스타일 카드 대시보드에 보여주며, 포트를 확인 창을 거쳐 내릴 수 있게 한다. 이 단계 결과물로 디자인을 실제 화면에서 다듬는다.

**Architecture:** Electron 메인 프로세스가 OS 별 샘플러(Windows: PowerShell 1회 호출로 프로세스+TCP 를 JSON 으로, macOS: `ps`+`lsof`)로 원시 데이터를 모으고, 순수 함수(worktree 판별 → 스냅샷 조립)를 거쳐 `DashboardSnapshot` 을 만든다. 스케줄러가 창 열림/닫힘에 따라 주기를 바꿔 렌더러(Vue 3)로 IPC 전송한다. 종료 같은 위험한 동작은 항상 메인 프로세스에서 재확인 + 네이티브 확인 창을 거친다.

**Tech Stack:** Electron 45, electron-vite 6, Vite 8, Vue 3.5, TypeScript 5.9, Bootstrap 5.3 + Sass(Uptime Kuma 스타일 이식), Vitest 5 + @vue/test-utils 2.5 + happy-dom.

**Spec:** `docs/superpowers/specs/2026-11-06-pitwall-design.md`

**전체 로드맵(이 문서는 1단계만 다룬다):**
1. **1단계(이 문서)** — 뼈대, 수집기, RAM·포트·프로세스 묶음 카드, 포트 내리기, 트레이 메뉴.
2. 2단계 — 에이전트 현황(Claude 훅 연동·Codex 탐지), 안 쓰는 포트 두 단계 판단, 남겨진 프로세스 정리, 작업 중 워크트리 보호.
3. 3단계 — 무거운 작업 겹침 경고, 메모리 부족 경고·정리 추천, OS 알림, 디스크 정리, 설정 화면(톱니바퀴·갱신 주기·자동 실행).
4. 4단계 — 패키징, GitHub Actions(Windows + macOS universal), Releases, Windows 자동 업데이트, README 설치 안내.

## Global Constraints

- 지원 OS: Windows + macOS. macOS 코드 경로는 이 단계에서 함께 작성하되 작성자는 검증 불가(macOS 미검증).
- 버전: `electron@^45.2.3`, `electron-vite@^6.0.0`, `vite@^8.3.6`, `vue@^3.5.45`, `typescript@~5.9.3`(vue-tsc 가 TS 컴파일러 JS API 를 쓰므로 7.x 금지), `vitest@^5.1.0`, `@vue/test-utils@^2.5.1`, `happy-dom`, `sass@^1.108.0`, `bootstrap@^5.3.8`. 개발 Node 22.
- 레포는 공개다. 코드·테스트 픽스처·문서에 회사 이름·사내 경로·실제 계정을 넣지 않는다. 픽스처 경로 예: `C:\Users\김개발\work\shop-web`, `/Users/dev/work/shop-web`.
- 무언가를 끄는 동작은 반드시 메인 프로세스의 네이티브 확인 창을 거친다. 자동 종료 없음.
- 이 단계는 `~/.claude`, `~/.codex` 등 다른 도구의 설정 파일을 읽지도 쓰지도 않는다.
- UI 문구는 한국어, `src/renderer/src/text.ts` 한 곳에 모은다(나중 다국어 대비).
- RAM 단계 기본값: 사용률 80% 이상 `warn`, 90% 이상 `danger` (`src/shared/defaults.ts`). 3단계 설정 화면에서 바꿀 수 있게 된다.
- 수집 주기 기본값: 창 열림 5000ms, 창 닫힘 30000ms(갱신 주기 "보통"에 해당).
- 부하 초기 목표치(측정 후 조정): 창이 닫힌 상태 평균 CPU 1% 미만, 앱 전체 RAM 300MB 미만.
- Uptime Kuma(MIT)에서 가져온 파일은 머리 주석에 원본 경로·커밋 SHA 를 적고, `THIRD_PARTY_NOTICES.md` 에 MIT 전문을 남긴다.
- 커밋만 하고 push 는 사용자 확인 후.

## Review Focus

1. **PID 재사용·오래된 스냅샷으로 엉뚱한 프로세스 종료** — 스냅샷과 종료 사이에 프로세스가 바뀌었으면 종료하지 않고 `changed`/`gone` 을 돌려줘야 한다. → Task 6 `planKill` 테스트.
2. **한글(비 ASCII) 경로** — 사용자 폴더가 `C:\Users\김개발` 같으면 PowerShell 출력 인코딩이 깨져 worktree 판별이 전부 실패한다. → Task 2 스크립트에 UTF-8 출력 강제 + 한글 경로 픽스처 테스트, Task 4 한글 경로 해석 테스트.
3. **명령줄 경로 형태** — 따옴표로 감싼 `"C:\Program Files\..."`, `node_modules\.bin/../vite` 처럼 섞인 슬래시, `--port=3000` 같은 인자. → Task 4 `extractPathCandidates` 테스트.
4. **같은 포트를 IPv4·IPv6 로 동시에 여는 서버**(`0.0.0.0:3000` + `[::]:3000`) — 한 줄로 합쳐야 한다. 또 `ConvertTo-Json` 은 항목이 1개면 배열이 아닌 객체를 낸다. → Task 5 중복 제거 테스트, Task 2 단일 객체 테스트.
5. **수집 명령이 느리거나 실패할 때** — PowerShell 이 주기보다 오래 걸리면 호출이 쌓이고, 실패하면 화면이 비거나 앱이 죽는다. 마지막 정상 스냅샷을 유지하고 `stale` 로 표시해야 한다. → Task 6 스케줄러 테스트.

---

## File Structure

```
pitwall/
  electron.vite.config.ts        # electron-vite 설정 (템플릿)
  vitest.config.ts               # 테스트 설정
  THIRD_PARTY_NOTICES.md         # Uptime Kuma MIT 고지
  src/
    shared/
      types.ts                   # 메인·렌더러 공용 타입
      defaults.ts                # 기본 임계값·주기
      format.ts                  # 바이트·worktree 라벨 포맷 (메인·렌더러 공용)
    main/
      index.ts                   # 앱 수명주기, 창, 트레이, IPC 연결 (얇게)
      collect/
        runCommand.ts            # 명령 실행 + 타임아웃
        windows.ts               # PowerShell 스크립트 + JSON 파서
        darwin.ts                # ps / lsof 파서
        sample.ts                # 플랫폼별 샘플러 선택
        worktree.ts              # 명령줄 → 경로 후보 → git worktree 판별
      snapshot.ts                # 원시 샘플 → DashboardSnapshot (순수)
      scheduler.ts               # 주기 실행, 겹침 방지, stale 처리
      kill.ts                    # 종료 재확인·확인창 문구·명령 생성 (순수) + 실행
      tray.ts                    # 트레이 메뉴 구성·아이콘 점 생성 (순수) + 연결
    preload/
      index.ts                   # window.pitwall API 노출
    renderer/src/
      main.ts, App.vue
      text.ts                    # UI 문구
      styles/vars.scss, app.scss # Uptime Kuma 에서 이식
      components/
        StatusBadge.vue, RamBar.vue, DashCard.vue,
        PortsCard.vue, MemoryGroupsCard.vue
  docs/measurements.md           # Task 9 측정 기록
```

테스트는 대상 파일 옆 `*.test.ts`. 컴포넌트 테스트 파일은 첫 줄에 `// @vitest-environment happy-dom`.

---

### Task 1: 프로젝트 뼈대 + 테스트 도구 + 출처 고지

**Files:**
- Create: electron-vite `vue-ts` 템플릿 전체(레포 루트로), `vitest.config.ts`, `THIRD_PARTY_NOTICES.md`, `src/shared/defaults.ts`, `src/shared/defaults.test.ts`
- Keep: 기존 `LICENSE`, `docs/`

**Interfaces:**
- Produces: `npm run dev`, `npm run build`, `npm test`(= `vitest run`), `npm run typecheck` 스크립트. `src/shared/defaults.ts`:
  ```ts
  export const DEFAULT_THRESHOLDS = { ramWarnPercent: 80, ramDangerPercent: 90 } as const
  export const DEFAULT_INTERVALS = { openMs: 5000, closedMs: 30000 } as const
  export const COMMAND_TIMEOUT_MS = 15000
  ```

- [ ] **Step 1: 템플릿 생성** — 스크래치 폴더에서 `npm create @quick-start/electron@latest pitwall-scaffold -- --template vue-ts` 실행 후, `.git` 을 제외한 내용을 레포 루트로 복사(`LICENSE`·`docs/` 유지). `package.json` 의 `name` 은 `pitwall`, `productName` 은 `pitwall`.
- [ ] **Step 2: 버전 맞추기** — Global Constraints 의 버전으로 `package.json` 을 맞추고 `npm i -D vitest@^5.1.0 @vue/test-utils@^2.5.1 happy-dom sass@^1.108.0` , `npm i bootstrap@^5.3.8`. `typescript` 는 `~5.9.3` 로 고정.
- [ ] **Step 3: `vitest.config.ts`** — `@vitejs/plugin-vue` 사용, `test.include: ['src/**/*.test.ts']`, 기본 environment `node`.
- [ ] **Step 4: 실패하는 테스트 작성** `src/shared/defaults.test.ts`

```ts
import { DEFAULT_THRESHOLDS, DEFAULT_INTERVALS } from './defaults'
test('기본 임계값과 주기', () => {
  expect(DEFAULT_THRESHOLDS).toEqual({ ramWarnPercent: 80, ramDangerPercent: 90 })
  expect(DEFAULT_INTERVALS).toEqual({ openMs: 5000, closedMs: 30000 })
})
```

- [ ] **Step 5: `npm test` → FAIL**(모듈 없음) 확인 후 `src/shared/defaults.ts` 작성 → **PASS**.
- [ ] **Step 6: `THIRD_PARTY_NOTICES.md`** — "Uptime Kuma (https://github.com/louislam/uptime-kuma), MIT License, Copyright (c) 2021 Louis Lam" + MIT 전문(원본 레포 `LICENSE` 에서 그대로 복사).
- [ ] **Step 7: 확인** — `npm run typecheck` 0 에러, `npm run build` 성공, `npm run dev` 로 창이 뜬다.
- [ ] **Step 8: Commit** — `chore: electron-vite Vue 뼈대와 테스트 도구 구성`

---

### Task 2: 공용 타입 + Windows 샘플러

**Files:**
- Create: `src/shared/types.ts`, `src/main/collect/runCommand.ts`, `src/main/collect/windows.ts`, `src/main/collect/windows.test.ts`

**Interfaces:**
- Produces (`src/shared/types.ts`):
  ```ts
  export type Platform = 'win32' | 'darwin'
  export interface ProcessInfo { pid: number; ppid: number; name: string; commandLine: string; memoryBytes: number }
  export type TcpState = 'Listen' | 'Established' | 'Other'
  export interface TcpEntry { pid: number; localAddress: string; localPort: number; remoteAddress: string; remotePort: number; state: TcpState }
  export interface RawSample { processes: ProcessInfo[]; tcp: TcpEntry[] }
  export interface WorktreeInfo { root: string; branch: string | null; isLinkedWorktree: boolean }
  export type ProcessGroup = 'devServer' | 'agent' | 'other'
  export type MemoryLevel = 'normal' | 'warn' | 'danger'
  export interface MemorySummary { totalBytes: number; usedBytes: number; usedPercent: number; level: MemoryLevel }
  export interface PortRow { port: number; pid: number; processName: string; commandLine: string; worktree: WorktreeInfo | null; unresolvable: boolean; memoryBytes: number; descendantPids: number[]; clientCount: number }
  export interface GroupUsage { group: ProcessGroup; memoryBytes: number; processCount: number }
  export interface DashboardSnapshot { takenAt: number; memory: MemorySummary; ports: PortRow[]; groups: GroupUsage[]; agentProcessCount: number; stale: boolean; error: string | null }
  ```
- Produces: `runCommand(argv: string[], opts?: { timeoutMs?: number }): Promise<{ stdout: string; exitCode: number }>` (타임아웃 시 reject `Error('timeout')`), `WINDOWS_SAMPLE_SCRIPT: string`, `parseWindowsSample(json: string): RawSample`, `sampleWindows(): Promise<RawSample>`.

- [ ] **Step 1: 실패하는 테스트 작성** `windows.test.ts`

```ts
import { parseWindowsSample, WINDOWS_SAMPLE_SCRIPT } from './windows'
const vite = '"C:\\Program Files\\nodejs\\node.exe" C:\\Users\\김개발\\work\\shop-web\\node_modules\\.bin/../vite/bin/vite.js --port 3000'
const json = JSON.stringify({
  processes: [
    { ProcessId: 4100, ParentProcessId: 4000, Name: 'node.exe', CommandLine: vite, WorkingSetSize: 1048576000 },
    { ProcessId: 8, ParentProcessId: 0, Name: 'System', CommandLine: null, WorkingSetSize: 8192 },
  ],
  tcp: [
    { OwningProcess: 4100, LocalAddress: '0.0.0.0', LocalPort: 3000, RemoteAddress: '0.0.0.0', RemotePort: 0, State: 'Listen' },
    { OwningProcess: 4100, LocalAddress: '::1', LocalPort: 3000, RemoteAddress: '::1', RemotePort: 51234, State: 'Established' },
    { OwningProcess: 0, LocalAddress: '::1', LocalPort: 3000, RemoteAddress: '::1', RemotePort: 51000, State: 'TimeWait' },
  ],
})
test('프로세스·TCP 파싱, 한글 경로 보존, null 명령줄은 빈 문자열', () => {
  const s = parseWindowsSample(json)
  expect(s.processes[0]).toEqual({ pid: 4100, ppid: 4000, name: 'node.exe', commandLine: vite, memoryBytes: 1048576000 })
  expect(s.processes[1].commandLine).toBe('')
  expect(s.tcp.map(t => t.state)).toEqual(['Listen', 'Established', 'Other'])
})
test('ConvertTo-Json 이 단일 객체를 내도 배열로 처리', () => {
  const one = JSON.stringify({ processes: { ProcessId: 1, ParentProcessId: 0, Name: 'a', CommandLine: 'a', WorkingSetSize: 1 }, tcp: null })
  const s = parseWindowsSample(one)
  expect(s.processes).toHaveLength(1)
  expect(s.tcp).toEqual([])
})
test('스크립트는 UTF-8 출력을 강제하고 enum 을 문자열로 낸다', () => {
  expect(WINDOWS_SAMPLE_SCRIPT).toContain('[Console]::OutputEncoding = [System.Text.Encoding]::UTF8')
  expect(WINDOWS_SAMPLE_SCRIPT).toContain('Get-NetTCPConnection')
  expect(WINDOWS_SAMPLE_SCRIPT).toContain('.State.ToString()')
})
```

- [ ] **Step 2: `npx vitest run src/main/collect/windows.test.ts` → FAIL**
- [ ] **Step 3: 구현** — `WINDOWS_SAMPLE_SCRIPT` 는 `Get-CimInstance Win32_Process`(ProcessId, ParentProcessId, Name, CommandLine, WorkingSetSize)와 `Get-NetTCPConnection -State Listen,Established,TimeWait -ErrorAction SilentlyContinue`(OwningProcess, LocalAddress, LocalPort, RemoteAddress, RemotePort, State 는 `.State.ToString()`)를 `@{ processes = ...; tcp = ... } | ConvertTo-Json -Compress -Depth 3` 로 한 번에 출력. 상태 매핑: `Listen`→`Listen`, `Established`→`Established`, 그 외 `Other`. `sampleWindows()` 는 `runCommand(['powershell.exe','-NoProfile','-NonInteractive','-Command', WINDOWS_SAMPLE_SCRIPT], { timeoutMs: COMMAND_TIMEOUT_MS })` 후 stdout 을 UTF-8 로 파싱. `runCommand` 는 `child_process.execFile`(shell 없음, `windowsHide: true`, `maxBuffer` 32MB).
- [ ] **Step 4: 테스트 → PASS**
- [ ] **Step 5: Commit** — `feat: 공용 타입과 Windows 샘플러`

---

### Task 3: macOS 샘플러

**Files:**
- Create: `src/main/collect/darwin.ts`, `src/main/collect/darwin.test.ts`, `src/main/collect/sample.ts`

**Interfaces:**
- Consumes: `ProcessInfo`, `TcpEntry`, `RawSample`, `runCommand`
- Produces: `parsePsOutput(stdout: string): ProcessInfo[]`(입력: `ps -axww -o pid=,ppid=,rss=,args=`), `parseLsofOutput(stdout: string): TcpEntry[]`(입력: `lsof -nP -iTCP -FpnT`), `sampleDarwin(): Promise<RawSample>`, `sample(platform: Platform): Promise<RawSample>`(sample.ts, 플랫폼별 분기)

- [ ] **Step 1: 실패하는 테스트 작성** `darwin.test.ts`

```ts
import { parsePsOutput, parseLsofOutput } from './darwin'
test('ps: rss(KB)→바이트, 이름은 첫 토큰의 basename', () => {
  const out = '  4100  4000 1024000 /usr/local/bin/node /Users/dev/work/shop-web/node_modules/.bin/vite --port 3000\n'
  expect(parsePsOutput(out)).toEqual([{ pid: 4100, ppid: 4000, name: 'node', memoryBytes: 1024000 * 1024,
    commandLine: '/usr/local/bin/node /Users/dev/work/shop-web/node_modules/.bin/vite --port 3000' }])
})
test('lsof -F: LISTEN·ESTABLISHED·IPv6 주소', () => {
  const out = ['p4100', 'f23', 'n*:3000', 'TST=LISTEN', 'TQR=0', 'f24', 'n[::1]:3000->[::1]:51234', 'TST=ESTABLISHED',
    'p5200', 'f30', 'n127.0.0.1:51234->127.0.0.1:3000', 'TST=CLOSE_WAIT'].join('\n')
  expect(parseLsofOutput(out)).toEqual([
    { pid: 4100, localAddress: '*', localPort: 3000, remoteAddress: '', remotePort: 0, state: 'Listen' },
    { pid: 4100, localAddress: '::1', localPort: 3000, remoteAddress: '::1', remotePort: 51234, state: 'Established' },
    { pid: 5200, localAddress: '127.0.0.1', localPort: 51234, remoteAddress: '127.0.0.1', remotePort: 3000, state: 'Other' },
  ])
})
```

- [ ] **Step 2: → FAIL** · **Step 3: 구현** — `sampleDarwin` 은 두 명령을 병렬 실행. `lsof` 종료 코드 1(결과 없음)은 빈 배열로 취급.
- [ ] **Step 4: → PASS** · **Step 5: Commit** — `feat: macOS 샘플러`

---

### Task 4: 명령줄 → git worktree 판별

**Files:**
- Create: `src/main/collect/worktree.ts`, `src/main/collect/worktree.test.ts`

**Interfaces:**
- Consumes: `ProcessInfo`, `WorktreeInfo`
- Produces: `extractPathCandidates(commandLine: string): string[]`, `resolveWorktree(path: string): Promise<WorktreeInfo | null>`(결과 캐시, `.git` 을 위로 올라가며 찾음), `resolveProcessWorktrees(processes: ProcessInfo[]): Promise<Map<number, WorktreeInfo>>`

- [ ] **Step 1: 실패하는 테스트 작성** `worktree.test.ts` — `fs.mkdtemp` 로 임시 폴더를 만들어 git 구조를 파일로 흉내 낸다(실제 git 실행 없음).

```ts
test('경로 후보: 따옴표·섞인 슬래시·node_modules 앞에서 자르기·인자 무시', () => {
  const cl = '"C:\\Program Files\\nodejs\\node.exe" C:\\Users\\김개발\\work\\shop-web\\node_modules\\.bin/../vite/bin/vite.js --port=3000'
  expect(extractPathCandidates(cl)).toEqual(['C:\\Program Files\\nodejs\\node.exe', 'C:\\Users\\김개발\\work\\shop-web'])
  expect(extractPathCandidates('/usr/local/bin/node /Users/dev/work/shop-web/node_modules/.bin/vite'))
    .toEqual(['/usr/local/bin/node', '/Users/dev/work/shop-web'])
  expect(extractPathCandidates('claude')).toEqual([])
})
test('메인 체크아웃: .git 폴더 + 브랜치', async () => {
  // <tmp>/shop-web/.git/HEAD = 'ref: refs/heads/develop\n', 하위 폴더 <tmp>/shop-web/src
  expect(await resolveWorktree(join(repo, 'src'))).toEqual({ root: repo, branch: 'develop', isLinkedWorktree: false })
})
test('연결된 worktree: .git 파일의 gitdir 을 따라가 HEAD 읽기', async () => {
  // <tmp>/wt-a/.git = 'gitdir: <repo>/.git/worktrees/wt-a\n', 그 폴더 HEAD = 'ref: refs/heads/feat/a\n'
  expect(await resolveWorktree(wt)).toEqual({ root: wt, branch: 'feat/a', isLinkedWorktree: true })
})
test('detached HEAD 는 branch null', async () => {
  // HEAD = '3f2a9c0d1e2b3a4f5a6b7c8d9e0f1a2b3c4d5e6f\n'
  expect((await resolveWorktree(detachedRepo))?.branch).toBeNull()
})
test('git 이 없으면 null', async () => {
  expect(await resolveWorktree(plainDir)).toBeNull()
})
test('한글 폴더명 저장소도 해석', async () => {
  // <tmp>/김개발/shop-web/.git/HEAD = 'ref: refs/heads/main\n'
  expect((await resolveWorktree(join(koreanRepo, 'src')))?.root).toBe(koreanRepo)
})
```

- [ ] **Step 2: → FAIL** · **Step 3: 구현** — 따옴표 인지 토큰 분리 후 절대 경로(`/^[A-Za-z]:[\\/]/` 또는 `/^\//`)만 남기고, `node_modules` 세그먼트가 있으면 그 앞까지 자른다. `resolveProcessWorktrees` 는 각 프로세스의 후보를 순서대로 시도해 첫 결과를 쓴다.
- [ ] **Step 4: → PASS** · **Step 5: Commit** — `feat: 프로세스 명령줄로 git worktree 판별`

---

### Task 5: 스냅샷 조립 (순수 함수)

**Files:**
- Create: `src/main/snapshot.ts`, `src/main/snapshot.test.ts`

**Interfaces:**
- Consumes: Task 2·4 타입, `DEFAULT_THRESHOLDS`
- Produces:
  ```ts
  export const RELAY_PROCESS_NAMES: readonly string[] // ['wslrelay.exe','com.docker.backend.exe','com.docker.backend','vpnkit','com.docker.vpnkit','docker-proxy']
  export function classifyAgent(p: ProcessInfo): boolean // 이름 /^(claude|codex)(\.exe)?$/i 또는 명령줄에 '@anthropic-ai/claude-code' | '@openai/codex'
  export function levelOf(usedPercent: number, t?: { ramWarnPercent: number; ramDangerPercent: number }): MemoryLevel // t 기본값 DEFAULT_THRESHOLDS
  export function buildSnapshot(input: { sample: RawSample; worktrees: Map<number, WorktreeInfo>; totalBytes: number; freeBytes: number; thresholds: { ramWarnPercent: number; ramDangerPercent: number }; now: number }): DashboardSnapshot
  ```
  규칙:
  - **포트 행:** `Listen` 항목을 `(port, pid)` 로 중복 제거하고 포트 1024 미만은 버린다. 포함 조건:
    - 그 pid 또는 3단계 위까지의 조상 프로세스에 worktree 가 있으면 행으로 넣는다.
    - 아니면, 프로세스 이름이 `RELAY_PROCESS_NAMES` 에 있으면 `unresolvable: true`, `worktree: null` 로 넣는다.
    - 둘 다 아니면 제외한다.
  - **포트 행 값:**
    - `memoryBytes` = 자기 + 모든 자손 프로세스.
    - `descendantPids` = 자손 pid 목록.
    - `clientCount` = `Established` 이고 `localPort===port && pid===행 pid` 인 항목 수.
  - **묶음(groups):**
    - `devServer` = 포트 행 프로세스와 그 자손.
    - `agent` = `classifyAgent` 인 프로세스와 그 자손 가운데 `devServer` 에 이미 들어가지 않은 것.
    - `other` = `usedBytes` − 위 둘.
  - **memory:** `usedBytes = totalBytes − freeBytes`, `usedPercent` 는 소수 첫째 자리까지. `≥ ramDangerPercent` 이면 `danger`, `≥ ramWarnPercent` 이면 `warn`, 그 외 `normal`. `stale: false`, `error: null`.

- [ ] **Step 1: 실패하는 테스트 작성** — 픽스처(`MB = 1024 * 1024`):
  - vite: 4100, 1000MB, 포트 3000 을 IPv4·IPv6 로 Listen. 자식 4101(esbuild, 200MB). Established 1개, TimeWait 1개.
  - claude: 5000, 400MB. 자식 vite 5100(ppid 5000, 900MB, 포트 3003 Listen).
  - wslrelay.exe: 6000, 포트 8080 Listen.
  - System: 4, 포트 445 Listen.
  - `worktrees` 에는 4100·5100 이 들어 있다.

```ts
test('IPv4/IPv6 중복 제거, 시스템 포트 제외, 릴레이는 판별 불가', () => {
  const s = buildSnapshot(input)
  expect(s.ports.map(p => [p.port, p.unresolvable])).toEqual([[3000, false], [3003, false], [8080, true]])
})
test('clientCount 는 서버 쪽 Established 만, 메모리는 자손 포함', () => {
  const row = buildSnapshot(input).ports.find(p => p.port === 3000)!
  expect(row.clientCount).toBe(1)
  expect(row.memoryBytes).toBe(1000 * MB + 200 * MB)
  expect(row.descendantPids).toEqual([4101])
})
test('에이전트 자손인 개발 서버는 devServer 로만 센다', () => {
  const g = Object.fromEntries(buildSnapshot(input).groups.map(x => [x.group, x.memoryBytes]))
  expect(g.agent).toBe(400 * MB) // 5100 vite 는 제외
  expect(g.devServer).toBe(1200 * MB + 900 * MB)
})
test('RAM 단계 경계값', () => {
  expect(levelOf(79.9)).toBe('normal'); expect(levelOf(80)).toBe('warn'); expect(levelOf(90)).toBe('danger')
})
```

- [ ] **Step 2: → FAIL** · **Step 3: 구현** · **Step 4: → PASS** · **Step 5: Commit** — `feat: 원시 샘플을 대시보드 스냅샷으로 조립`

---

### Task 6: 스케줄러 + 안전한 포트 내리기 + IPC

**Files:**
- Create: `src/main/scheduler.ts`, `src/main/scheduler.test.ts`, `src/main/kill.ts`, `src/main/kill.test.ts`, `src/preload/index.ts`
- Modify: `src/main/index.ts`(연결만)

**Interfaces:**
- Consumes: `sample`, `resolveProcessWorktrees`, `buildSnapshot`
- Produces:
  ```ts
  // scheduler.ts
  export function createScheduler(o: { collect: () => Promise<DashboardSnapshot>; intervals: { openMs: number; closedMs: number }; onSnapshot: (s: DashboardSnapshot) => void }): { start(): void; stop(): void; setWindowOpen(open: boolean): void; refreshNow(): Promise<void> }
  // kill.ts
  export type KillResult = { status: 'killed' | 'cancelled' | 'gone' | 'changed' | 'failed'; message?: string }
  export function planKill(row: PortRow, fresh: ProcessInfo | undefined): { ok: true; pids: number[] } | { ok: false; reason: 'gone' | 'changed' }
  export function buildKillConfirm(row: PortRow): { title: string; message: string; detail: string; buttons: string[]; defaultId: number; cancelId: number }
  export function buildKillCommands(platform: Platform, pids: number[]): string[][]
  export async function killPort(port: number, pid: number, deps: { latest: () => DashboardSnapshot | null; resample: () => Promise<RawSample>; confirm: (o: ReturnType<typeof buildKillConfirm>) => Promise<boolean>; run: typeof runCommand; platform: Platform }): Promise<KillResult>
  ```
  IPC: 메인→렌더러 `pitwall:snapshot`(DashboardSnapshot), 렌더러→메인 invoke `pitwall:kill-port`({ port, pid }) → `KillResult`. preload 는 `window.pitwall = { onSnapshot(cb): () => void; killPort(port, pid): Promise<KillResult> }` 를 `contextBridge` 로 노출하고 타입 선언을 `src/preload/index.d.ts` 에 둔다.

- [ ] **Step 1: 실패하는 테스트 작성** `scheduler.test.ts`(가짜 타이머)

```ts
test('창 열림 5초, 닫힘 30초 주기', ...)                 // 열림: 5000ms 마다 collect 1회 / setWindowOpen(false) 후 30000ms
test('수집이 주기보다 길면 겹쳐 실행하지 않는다', ...)     // collect 가 12초 걸리면 그동안 추가 호출 0
test('실패 시 마지막 정상 스냅샷을 stale 로 다시 보낸다', ...) // onSnapshot 마지막 인자: { ...prev, stale: true, error: 'timeout' }
```

- [ ] **Step 2: 실패하는 테스트 작성** `kill.test.ts`

```ts
test('재샘플에 없으면 gone, 이름·명령줄이 다르면 changed', () => {
  expect(planKill(row, undefined)).toEqual({ ok: false, reason: 'gone' })
  expect(planKill(row, { ...proc, commandLine: 'other' })).toEqual({ ok: false, reason: 'changed' })
  expect(planKill(row, proc)).toEqual({ ok: true, pids: [4100, 4101] })
})
test('확인 창 문구', () => {
  expect(buildKillConfirm(row)).toEqual({ title: '포트 내리기', message: ':3000 (shop-web · develop) 을(를) 내릴까요?',
    detail: 'node.exe (PID 4100) 와 하위 프로세스 1개가 종료돼요.', buttons: ['내리기', '취소'], defaultId: 1, cancelId: 1 })
})
test('플랫폼별 종료 명령', () => {
  expect(buildKillCommands('win32', [4100, 4101])).toEqual([['taskkill', '/PID', '4100', '/T', '/F']])
  expect(buildKillCommands('darwin', [4100, 4101])).toEqual([['kill', '-TERM', '4100', '4101']])
})
test('판별 불가 행, 확인 취소, 스냅샷에 없는 포트는 종료 명령을 실행하지 않는다', async () => {
  // unresolvable 행 → { status: 'failed' }, confirm false → 'cancelled', latest 에 없음 → 'gone'; 세 경우 모두 run 호출 0회
})
```

- [ ] **Step 3: → FAIL** · **Step 4: 구현** — `killPort` 순서: latest 에서 행 찾기 → unresolvable 거부 → `resample` 로 최신 프로세스 확인(`planKill`) → `confirm` → 명령 실행. darwin 은 3000ms 뒤 살아 있는 pid 에 `kill -KILL`. `index.ts` 는 `dialog.showMessageBox` 를 `confirm` 에, `os.totalmem/freemem` 와 샘플러를 `collect` 에 연결.
- [ ] **Step 5: → PASS** · **Step 6: Commit** — `feat: 수집 스케줄러와 확인을 거치는 포트 내리기`

---

### Task 7: 렌더러 — Uptime Kuma 스타일 이식 + 대시보드

**Files:**
- Create: `src/renderer/src/styles/vars.scss`, `src/renderer/src/styles/app.scss`, `src/renderer/src/text.ts`, `src/shared/format.ts`, `src/shared/format.test.ts`(메인의 트레이·확인 창도 쓰므로 shared), `components/{StatusBadge,RamBar,DashCard,PortsCard,MemoryGroupsCard}.vue`, 각 `*.test.ts`
- Modify: `src/renderer/src/App.vue`, `src/renderer/src/main.ts`

**Interfaces:**
- Consumes: `window.pitwall`, `DashboardSnapshot`, `PortRow`, `GroupUsage`, `MemorySummary`
- Produces:
  - `formatBytes(bytes: number): string` — 1GiB 이상이면 `'1.2 GB'`(소수 1자리), 미만이면 `'512 MB'`(정수).
  - `worktreeLabel(w: WorktreeInfo | null): string` — `'shop-web · develop'`, branch 가 null 이면 `'shop-web · (detached)'`, w 가 null 이면 `text.unresolvable`(`'판별 불가'`).
  - `StatusBadge` props: `{ tone: 'primary' | 'warning' | 'danger' | 'secondary'; text: string }`. Uptime Kuma `Status.vue` 의 `badge rounded-pill bg-*` 마크업을 그대로 쓴다.
  - `RamBar` props: `{ memory: MemorySummary }`.
  - `DashCard` props: `{ title: string; summary: string; expanded: boolean; pending?: boolean }`, emits `toggle`, slot `detail`.
  - `PortsCard` props: `{ ports: PortRow[] }`, emits `kill(port: number, pid: number)`.
  - `MemoryGroupsCard` props: `{ groups: GroupUsage[] }`.

- [ ] **Step 1: 스타일 이식** — Uptime Kuma `master` 의 다음 파일을 가져온다. 각 파일 머리 주석에 원본 경로와 커밋 SHA 를 적는다.
  - `src/assets/vars.scss` 전체.
  - `src/assets/app.scss` 에서 Bootstrap import, `.shadow-box`, `.btn`·`.btn-sm`·`.btn-primary`·`.btn-normal`·`.btn-warning`·`.btn-danger` 계열, `.bg-maintenance`, `.dark { ... }` 블록(그 안의 `.shadow-box`·`.btn-*`·`.list-group` 포함), `.slide-fade-*` 전환만.
  - `multiselect`·`localization`·에디터 관련 import 와 규칙은 뺀다.
  - 다크 모드는 `matchMedia('(prefers-color-scheme: dark)')` 로 `body.dark` 를 켜고 끈다.
- [ ] **Step 2: 실패하는 테스트 작성**

```ts
// format.test.ts
expect(formatBytes(1288490188)).toBe('1.2 GB'); expect(formatBytes(536870912)).toBe('512 MB')
expect(worktreeLabel({ root: 'C:\\work\\shop-web', branch: 'develop', isLinkedWorktree: false })).toBe('shop-web · develop')
expect(worktreeLabel(null)).toBe('판별 불가')
// PortsCard.test.ts (happy-dom)
// - 행 3개 렌더, 3000 행 '연결 1'(primary), 연결 0 인 행 '연결 없음'(secondary)
// - unresolvable 행에는 '내리기' 버튼이 없다
// - 3000 행 '내리기' 클릭 → emitted('kill')[0] 가 [3000, 4100]
// RamBar.test.ts: level warn → 막대에 bg-warning, 문구 '26.3 GB / 32.0 GB (82%)'
// DashCard.test.ts: 헤더 클릭 → emitted('toggle'), expanded 일 때만 detail 슬롯 렌더, pending 이면 '다음 단계에서 추가돼요' 표시
```

- [ ] **Step 3: → FAIL** · **Step 4: 구현** — `App.vue` 구성:
  - 맨 위: 헤더(`pitwall`, 오른쪽 위 톱니바퀴는 3단계까지 비활성), 그 아래 `RamBar`.
  - 카드 그리드: 포트 · 메모리 묶음 · 에이전트(`agentProcessCount` 만, 상세는 pending) · 남겨진 프로세스(pending) · 무거운 작업(pending) · 디스크(pending).
  - 펼침은 한 번에 카드 하나.
  - `stale` 이면 헤더에 '업데이트 지연' warning 배지를 단다.
  - `kill` 이벤트 → `window.pitwall.killPort`. 결과가 `killed` 가 아니면 카드 안에 결과 문구를 보여준다(`text.ts` 에 상태별 문구).
- [ ] **Step 5: → PASS** · **Step 6: Commit** — `feat: Uptime Kuma 스타일 카드 대시보드`

---

### Task 8: 트레이 메뉴 + 창 동작

**Files:**
- Create: `src/main/tray.ts`, `src/main/tray.test.ts`
- Modify: `src/main/index.ts`

**Interfaces:**
- Consumes: `DashboardSnapshot`, `MemoryLevel`, `formatBytes`(`src/shared/format.ts`). 표시용 퍼센트는 정수 반올림.
- Produces:
  ```ts
  export function buildTrayMenu(s: DashboardSnapshot | null, actions: { open(): void; quit(): void }): Electron.MenuItemConstructorOptions[]
  export function trayTooltip(s: DashboardSnapshot | null): string
  export function createDotIcon(rgbHex: string, size: number): Buffer // RGBA, 원 바깥은 투명
  export const LEVEL_COLORS: Record<MemoryLevel, string> // normal '#5cdd8b', warn '#f8a306', danger '#dc3545' (Uptime Kuma vars.scss)
  ```

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
test('메뉴 항목', () => {
  const labels = buildTrayMenu(snap, actions).map(i => i.type === 'separator' ? '---' : i.label)
  expect(labels).toEqual(['RAM 82% (26.3 GB / 32.0 GB)', '개발 서버 포트 3개', '---', '앱 열기', '---', '종료'])
  expect(buildTrayMenu(null, actions)[0].label).toBe('RAM 확인 중…')
})
test('툴팁', () => { expect(trayTooltip(snap)).toBe('pitwall — RAM 82%') })
test('점 아이콘: 크기와 가운데·모서리 픽셀', () => {
  const b = createDotIcon('#5cdd8b', 16)
  expect(b.length).toBe(16 * 16 * 4)
  expect([...b.subarray((8 * 16 + 8) * 4, (8 * 16 + 8) * 4 + 4)]).toEqual([0x5c, 0xdd, 0x8b, 255])
  expect(b[3]).toBe(0) // (0,0) 투명
})
```

- [ ] **Step 2: → FAIL** · **Step 3: 구현** — 동작 규칙:
  - 아이콘은 `nativeImage.createFromBitmap` 으로 만들고 macOS 용 @2x(32px)를 함께 넣는다. 스냅샷이 올 때마다 메뉴·툴팁·아이콘 색을 갱신한다.
  - 창 닫기(X)는 숨김이고, 종료는 트레이 메뉴의 '종료'로만 한다.
  - `app.requestSingleInstanceLock()` 을 쓰고, 두 번째 실행 시 기존 창을 보여준다.
  - 창을 보이거나 숨길 때 `scheduler.setWindowOpen` 을 호출한다.
- [ ] **Step 4: → PASS** · **Step 5: Commit** — `feat: 트레이 메뉴와 창 숨김 동작`

---

### Task 9: Windows 실제 확인 + 부하 측정

**Files:**
- Create: `docs/measurements.md`

- [ ] **Step 1: 전체 검사** — `npm run typecheck` 0 에러, `npm test` 전부 통과, `npm run build` 성공.
- [ ] **Step 2: 실제 데이터 대조** — `npm run dev` 로 띄운 뒤 PowerShell `Get-NetTCPConnection -State Listen` 결과와 포트 카드를 비교한다. 띄워둔 개발 서버 포트가 모두 보이고, worktree 이름·브랜치가 맞고, 시스템 포트는 없어야 한다.
- [ ] **Step 3: 내리기 확인** — 아무 git 저장소에서 `node -e "require('http').createServer().listen(4555)"` 를 띄우고 다음을 차례로 확인한다.
  1. 카드에 :4555 가 '연결 없음'으로 보인다.
  2. '내리기' → 확인 창 → '취소'를 누르면 프로세스가 살아 있다.
  3. 다시 '내리기' → '내리기'를 누르면 종료되고, 다음 갱신에서 행이 사라진다.
- [ ] **Step 4: 한글 경로 확인** — 사용자 폴더 아래 한글 이름 폴더의 저장소에서 서버를 띄웠을 때도 worktree 가 판별되는지 본다.
- [ ] **Step 5: 부하 측정** — `npm run build` 결과물을 실행하고 창을 닫은 채 10분을 둔다. 그동안 pitwall 관련 프로세스 전체의 CPU 평균과 RAM 합계를 PowerShell `Get-Process` 로 1분마다 기록한다. `docs/measurements.md` 에 측정 환경(CPU·RAM·떠 있는 개발 서버 수)과 결과, 목표(평균 CPU 1% 미만·RAM 300MB 미만) 충족 여부를 적는다. 넘으면 원인 추정과 조정안(주기·네이티브 헬퍼)을 함께 적는다.
- [ ] **Step 6: Commit** — `docs: 1단계 Windows 확인과 부하 측정 기록`
