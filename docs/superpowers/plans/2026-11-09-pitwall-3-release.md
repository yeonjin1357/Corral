# pitwall 3단계(나머지 기능·설정·출시 준비) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 스펙 §3 의 나머지(무거운 작업 겹침 경고, 메모리 부족 경고와 정리 추천, 디스크 정리)와 §8 의 설정·OS 알림·자동 실행을 만들고, 실제 데이터와 대조해 정확도를 보정한 뒤, Windows·macOS 설치 파일을 만들 수 있는 출시 준비(업데이트·CI·README)까지 끝낸다.

**Architecture:** 설정은 앱 데이터 폴더의 `config.json`(훅 설정과 같은 파일)에 두고, 한 곳(`updateConfig`)에서 순서대로 읽고 써서 동시에 저장해도 서로 덮어쓰지 않는다. 수집기는 설정을 매 수집마다 읽어 기준값·무거운 명령 패턴을 바로 반영한다. 무거운 작업·정리 추천은 스냅샷에 들어가고, 디스크 정리는 느린 작업이라 별도 관리자(diskManager)가 가끔(시작 1분 뒤, 30분마다, 요청 시) 계산해 스냅샷에 붙인다. OS 알림은 스냅샷 변화의 "넘어가는 순간"에만 보낸다. 화면은 Uptime Kuma 의 설정 페이지(왼쪽 메뉴 + 오른쪽 내용)와 기존 목록·상세 구성을 따른다.

**Tech Stack:** 1·2단계와 같음. 새 의존성: `electron-updater`(MIT, Windows 자동 업데이트).

**Spec:** `docs/superpowers/specs/2026-11-06-pitwall-design.md` (§3 의 2·6·7·8, §5, §6, §8 설정·알림·자동 실행·갱신 주기)

## Global Constraints

- 1·2단계 Global Constraints 를 그대로 따른다(공개 레포에 회사 정보 없음, 끄기·지우기는 항상 네이티브 확인 창, 문구는 `src/shared/text.ts`, Windows·macOS 둘 다, 실제 `~/.claude/settings.json` 은 앱에서 켜기를 눌렀을 때만).
- **디스크 정리는 연결된 워크트리 바로 아래의 의존성 폴더만 지운다.** 메인 체크아웃·워크트리 자체·링크(심볼릭 링크·정션)를 따라간 곳은 절대 지우지 않는다. 지우기 직전 최신 프로세스 목록으로 그 워크트리를 쓰는 프로세스가 있으면 지우지 않는다.
- **"끝난 워크트리" 판단은 보수적으로:** 원격 브랜치가 지워졌거나([gone]), 원격에 올린 적 있는 브랜치가 기본 브랜치에 완전히 들어갔을 때만. 원격에 올린 적 없는 브랜치는 기본 브랜치와 같은 커밋이어도 끝난 것이 아니다(막 만든 워크트리일 수 있음). 네트워크(fetch)는 하지 않는다.
- 무거운 작업은 경고만 한다. 막거나 줄 세우지 않는다(스펙 §4).
- OS 알림은 상태가 "넘어가는 순간"에만, 항목별로 끌 수 있다. 앱 시작 직후 이미 그런 상태는 알리지 않는다.
- 네트워크 접속은 업데이트 확인(GitHub) 하나뿐이고 설정에서 끌 수 있다.
- 로그인 시 자동 실행은 설치된 앱에서만 OS 에 등록한다(개발 실행에서는 등록하지 않음). 기본값 켬(스펙 §8).
- 설정 값 범위: RAM 경고 50~98%, 위험 경고+1~99%, 안 쓰는 포트 기준 1~1440분, 무거운 명령 패턴 최대 50개(각 100자), 의존성 폴더 이름 최대 20개, 추가 저장소 최대 50개.
- 갱신 주기: 빠르게(창 열림 2초/닫힘 10초), 보통(5초/30초), 절약(15초/120초).

## Review Focus

1. **디스크 정리 안전** — node_modules 안의 정션·심볼릭 링크, 설정에 `..`·`a/b`·절대 경로 같은 폴더 이름, 메인 체크아웃, 지우는 순간 그 워크트리를 쓰는 프로세스, 잠긴 파일(EBUSY)로 일부만 지워진 경우. 링크 너머와 메인 체크아웃은 절대 지워지면 안 되고, 일부 실패는 그대로 알려야 한다. → Task 5
2. **끝난 워크트리 오판** — 막 만든 브랜치(기본 브랜치 끝과 같은 커밋, 원격 없음), detached HEAD, origin/HEAD 가 없는 저장소, 사라진 워크트리 폴더. 끝났다고 보면 안 된다. → Task 5
3. **설정 파일** — 훅 설정과 일반 설정을 동시에 저장해도 둘 다 남고, 범위를 벗어난 값은 고쳐지고, 깨진 파일이어도 앱이 뜬다. → Task 1
4. **알림 폭주** — RAM 이 기준선 근처에서 오르내릴 때, 시작 시 권한 대기 세션이 여럿일 때, 같은 알림 반복. → Task 6
5. **무거운 작업 중복·오판** — `cmd → node vue-tsc` 사슬은 하나로, 개발 서버·에이전트 자체는 무거운 작업이 아니고, 패턴 `tsc` 가 `tsconfig.json` 에 걸리면 안 된다. → Task 3

---

### Task 1: 설정 저장과 즉시 반영

**Files:** Create `src/shared/settings.ts`(+test); Modify `src/main/config.ts`(+test), `src/main/collector.ts`(+test), `src/main/scheduler.ts`(+test), `src/main/claudeIntegration.ts`, `src/main/index.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`

```ts
export type RefreshSpeed = 'fast' | 'normal' | 'saver'
export type ThemeChoice = 'auto' | 'light' | 'dark'
export interface Settings {
  refresh: RefreshSpeed; theme: ThemeChoice; launchAtLogin: boolean; updateCheck: boolean
  ramWarnPercent: number; ramDangerPercent: number; idlePortMinutes: number
  heavyPatterns: string[]
  notify: { ramLow: boolean; claudeWaiting: boolean; heavyOverlap: boolean }
  dependencyDirs: string[]; extraRepos: string[]
}
export const DEFAULT_SETTINGS: Settings
export const REFRESH_INTERVALS: Record<RefreshSpeed, { openMs: number; closedMs: number }>
export function normalizeSettings(value: unknown): Settings
```
- 잘못된 형식은 기본값, 숫자는 반올림·범위 안으로, 목록은 앞뒤 공백 제거·빈 값·중복 제거·개수 제한. 의존성 폴더 이름은 구분자·`:*?"<>|`·`.`·`..`·`.git` 불가. 추가 저장소는 절대 경로만.
- `config.ts`: `PitwallConfig { hook; settings }`, `updateConfig(userData, mutate)` — 같은 파일에 대한 읽기·고치기·쓰기를 한 줄로 세워(약속 사슬) 동시에 불려도 서로 지우지 않는다. `ensureHookConfig`·훅 저장도 이것을 쓴다.
- 수집기는 `options()` 로 매번 기준값(RAM·안 쓰는 포트 시간·무거운 명령 패턴)을 읽는다. 스케줄러에 `setIntervals()`.
- IPC: `settings.get()`, `settings.save(next)`(정규화 후 저장·반영한 값을 돌려줌), `settings.pickFolder()`(폴더 고르기 창).
- 테스트: 정규화 표, 동시 저장(훅+설정) 둘 다 남음, 깨진 파일이면 기본값, `setIntervals` 즉시 재예약, 바뀐 기준값이 다음 수집에 반영.

### Task 2: 데이터 정확도 보정

**Files:** Modify `src/shared/types.ts`, `src/shared/format.ts`(+test), `src/main/snapshot.ts`(+test), `src/main/judge.ts`(+test), `src/main/collector.ts`(+test)

실제 PC 대조(2026-11-09)에서 메모리·포트·연결 수·워크트리는 OS 값과 일치했다. 아래를 보정한다.
- **상위 폴더 에이전트:** 에이전트의 워크트리가 포트·남은 프로세스 워크트리의 상위 폴더면(예: 여러 저장소를 묶은 상위 저장소 안의 하위 저장소) 같은 워크트리에 에이전트가 있는 것으로 본다. `agentCovers(agentRoots: string[], root: string): boolean`(대소문자·구분자 정규화, 폴더 경계).
- **pitwall 의 조상이 연 포트**(개발 실행 시 electron-vite 서버)는 목록에서 뺀다(내리면 pitwall 자신이 꺼짐).
- **CPU 표시:** 스냅샷에 `platform`, `cpuCount`. Windows 는 작업 관리자처럼 전체 CPU 대비(코어 1개 기준 값 ÷ 논리 코어 수), macOS 는 활성 상태 보기처럼 코어 1개 = 100%. 판단(2%)은 그대로.
- **메모리 묶음:** `devServer | agent | heavy | otherApps | system`. otherApps = 나머지 프로세스 전용 메모리 합(사용량을 넘지 않게), system = 사용량 − 나머지 전부(커널·드라이버·공유·읽지 못한 프로세스). `topApps`: 나머지 프로세스를 이름별로 묶은 상위 5개 `{ name; memoryBytes; processCount }`.

### Task 3: 무거운 작업

**Files:** Create `src/main/heavy.ts`(+test); Modify `src/shared/types.ts`, `src/main/snapshot.ts`(+test), `src/main/collector.ts`

```ts
export interface HeavyJobRow { pid; label: string; processName; commandLine; worktree: WorktreeInfo | null; memoryBytes; descendantPids: number[]; startedAt }
export function heavyMatch(commandLine: string, patterns: string[]): string | null
export function findHeavyJobs(sample: RawSample, worktrees: Map<number, WorktreeInfo>, o: { patterns: string[]; exclude: Set<number> }): HeavyJobRow[]
```
- 패턴은 "명령 이름 [인자…]". 명령줄 토큰의 파일 이름(경로·`.exe .cmd .bat .js .mjs .cjs .ps1` 제외, 소문자)이 첫 단어와 같고, 이어지는 토큰이 나머지 단어와 같으면 일치. `tsc` 는 `tsconfig.json` 에 걸리지 않는다.
- 한 트리에서 가장 위의 일치 프로세스 하나만(자손은 그 행의 일부). 개발 서버 트리·에이전트 프로세스 자체·pitwall 은 제외(에이전트가 띄운 타입 검사는 포함).
- 스냅샷: `heavyJobs`, `heavyOverlap = heavyJobs.length >= 2 && memory.level !== 'normal'`, 묶음 `heavy`(에이전트 묶음에서 빠짐). 무거운 작업 pid 도 워크트리 조회 대상.
- 기본 패턴: `tsc`, `vue-tsc`, `vite build`, `webpack`, `next build`, `nuxt build`, `ng build`, `gradle build`, `gradlew build`, `mvn`, `cargo build`.

### Task 4: 메모리 부족 정리 추천

**Files:** Create `src/shared/recommend.ts`(+test); Modify `src/main/kill.ts`(+test), `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/index.ts`, `src/shared/text.ts`

```ts
export interface RecommendItem { kind: 'port' | 'leftover'; key: string; pid: number; label: string; memoryBytes: number }
export function cleanupRecommendation(s: DashboardSnapshot): { items: RecommendItem[]; totalBytes: number }
```
- 항목: 정리 후보 포트(판별 불가 제외) + 에이전트가 없는 워크트리의 남은 프로세스. 메모리 큰 순.
- `killer.killMany(keys)`: 최신 스냅샷의 추천과 겹치는 것만, 최신 샘플로 각각 확인 → 확인 창 하나(최대 10줄 + "외 n개", 합계) → 한 번 더 최신 샘플로 확인 → 끔. 결과 `{ killed, skipped, failed }` 문장.

### Task 5: 디스크 정리

**Files:** Create `src/main/disk.ts`(+test), `src/main/git.ts`(+test); Modify `src/main/collect/worktree.ts`(+test), `src/shared/types.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/index.ts`

- `WorktreeInfo.commonDir?: string | null` — git 공용 폴더(연결된 워크트리는 `<gitdir>/commondir`).
- 저장소 기억: 앱 데이터 폴더 `state.json` `{ repos: string[] }`(공용 폴더, 최대 200). 스냅샷 행의 워크트리에서 더하고, 설정의 추가 저장소는 `git rev-parse --git-common-dir` 로 찾는다.
- `git.ts`: `runGit(args, { cwd?, timeoutMs })`(execFile, 창 숨김), `parseWorktreeList(porcelain)`, `defaultBranch(commonDir)`(origin/HEAD → origin/main → origin/master), `finishedEvidence(commonDir, wt): 'upstreamGone' | 'merged' | null`.
- `DiskRow { worktreeRoot; commonDir; branch; evidence; folders: { name; path; bytes: number | null; skipped?: 'link' }[]; totalBytes: number | null; inUse: boolean }`, `DiskReport { rows; scannedAt: number | null; scanning: boolean; error: string | null }`. 대상은 메인이 아닌, 폴더가 있는, 끝난 워크트리 중 의존성 폴더가 있는 것.
- `measureDir(path)`: lstat 으로 링크는 따라가지 않고 합산, 동시 32개, 폴더 수정 시각이 같으면 24시간 캐시.
- `createDiskManager(deps)` → `{ scan(), report(), remove(worktreeRoot) }`. remove: 행 재확인 → 최신 샘플에서 명령줄·작업 폴더가 그 워크트리 안인 프로세스가 있으면 거절 → 확인 창(경로·크기) → 폴더마다 `rm(recursive, force, maxRetries 3)` → 남은 것 확인 → 확보량·실패 보고.
- 계산 시점: 앱 시작 1분 뒤, 30분마다, 화면에서 요청 시, 설정(폴더 이름·저장소) 변경 시. 스냅샷에 `disk` 를 붙인다.

### Task 6: OS 알림

**Files:** Create `src/main/notifier.ts`(+test); Modify `src/main/index.ts`, `src/shared/text.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`

- `createNotifier({ show, settings, isFocused, now })` → `{ update(s) }`. 첫 스냅샷은 기준선(알림 없음).
- RAM 부족: `danger` 로 넘어갈 때(정리 추천 합계 포함). `normal` 로 내려와야 다시 알릴 수 있고, 30분 안에는 다시 알리지 않는다.
- Claude 권한 대기: 훅 상태가 `waiting` 으로 바뀐 에이전트마다(키 `pid:startedAt`), pitwall 창이 앞에 있으면 알리지 않는다.
- 무거운 작업 겹침: `heavyOverlap` 이 켜질 때. 꺼져야 다시, 10분 쿨다운.
- 알림을 누르면 창을 열고 해당 항목(또는 한눈에 보기)으로 간다(`pitwall:navigate`).

### Task 7: 설정 화면

**Files:** Create `src/renderer/src/components/SettingsView.vue`(+test); Modify `App.vue`, `theme.ts`(+test), `src/shared/text.ts`, `src/main/tray.ts`(+test)

- Uptime Kuma `Settings.vue`: 왼쪽 메뉴(일반·기준값·무거운 작업·알림·디스크 정리·Claude 연동·정보) + 오른쪽 내용, `settings-content-header`, `form-label`/`form-select`/`btn-group btn-check`/`form-check`/`form-text`, 아래 "저장" 버튼.
- 테마(자동·밝게·어둡게)는 바로 반영. 정보: 버전·GitHub·라이선스·업데이트 상태.
- 트레이 메뉴에 "설정" 항목.

### Task 8: 대시보드 화면

**Files:** Create `DiskListItem.vue`, `DiskDetail.vue`; Modify `HomeView.vue`, `PortList.vue`, `App.vue`, `chart.ts`(+test), `PortDetail.vue`, `AgentDetail.vue`, `history.ts`, `text.ts`, `components.test.ts`

- 한눈에 보기: 메모리가 경고 이상이면 "메모리 정리 추천" 상자(항목·합계·"모두 정리"), 무거운 작업이 있으면 "무거운 작업" 상자(겹침 경고), 묶음 표 5줄 + 다른 앱 상위 5개.
- 왼쪽 목록에 "디스크 정리" 묶음(알약 = 크기), 상세: 경로·브랜치·끝났다고 본 근거·폴더별 크기·"의존성 폴더 지우기".
- 다듬기: 차트 세로축을 MB/GB 단위의 둥근 눈금으로, 긴 브랜치 이름은 말줄임+전체 이름 툴팁, CPU 표시(Task 2), 에이전트 상세 하트비트 아래 확인 주기 문구.

### Task 9: 자동 실행·업데이트·패키징·CI·README

**Files:** Create `src/main/updates.ts`(+test), `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `scripts/make-icon.mjs`; Modify `electron-builder.yml`, `package.json`, `src/main/index.ts`, `README.md`, `THIRD_PARTY_NOTICES.md`, `build/icon.*`

- 자동 실행: 설치된 앱에서만 `app.setLoginItemSettings({ openAtLogin, args: ['--hidden'] })`. 로그인으로 켜지면 창 없이 트레이로 시작.
- 업데이트: Windows 는 electron-updater(GitHub 게시본, 내려받은 뒤 종료 시 설치), macOS 는 서명이 없어 GitHub 최신 릴리스만 확인해 "새 버전" 링크를 보여 준다. 시작 시·6시간마다, 설정에서 끔.
- electron-builder: Windows NSIS x64, macOS dmg x64·arm64, Linux 제거, `publish: github yeonjin1357/pitwall`, 아이콘은 헤더 로고와 같은 모양(초록 원 + Font Awesome flag-checkered)으로 만든다.
- CI: push·PR 에 Windows·macOS 에서 typecheck·lint·test·build. 태그 `v*` 에 설치 파일을 만들어 초안 릴리스에 올린다(macOS 는 "미검증" 문구).
- README: 기능, 설치(서명 없음 경고 넘기는 법), 무엇을 읽고 무엇을 바꾸는지, Claude 연동, macOS 미검증, 개발.

### Task 10: 실제 확인·성능·최종 검토

- 실제 데이터 대조 스크립트(메모리·포트·연결·워크트리·에이전트·무거운 작업)를 다시 돌린다. 진짜 무거운 작업 두 개를 겹쳐 띄워 감지·메모리를 본다.
- 모든 화면을 밝게·어둡게, 1280×820 과 최소 800×560 에서 캡처해 본다.
- 창을 닫은 상태 10분 동안 pitwall CPU·RAM 을 잰다(목표 CPU 평균 1% 미만, RAM 300MB 미만).
- 임시 저장소(원격 지워진 브랜치의 연결된 워크트리 + 가짜 node_modules + 정션)로 디스크 정리를 실제로 해 본다.
- 가장 뛰어난 모델로 브랜치 전체 검토 → 중요 이상은 테스트로 재현해 고친다.
