# pitwall 4단계(작업 묶음·편의 기능) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 개발 서버를 서버·작업 공간 단위로 보고 정리하며, 에이전트·서버 데이터의 정확도(Codex 상태·사용 흔적·기록 이어 쓰기)와 편의(알림·트레이 요약 창·숨기기)를 더한다.

**Architecture:** 메인 프로세스의 스냅샷 단위를 "포트 한 줄"에서 "서버(포트를 연 프로세스 트리의 맨 위) 한 줄"로 바꾸고, 판단(정리 후보·메모리 증가·작업 공간)은 순수 함수로 계산해 스냅샷에 담는다. 렌더러는 스냅샷을 그대로 보여 주며 NeoHtop 의 트리 보기·메뉴바 요약 창 모양을 따른다. Codex 는 세션 기록(rollout) 읽기 + 사용자가 켜는 hooks 연동(Claude 연동과 같은 훅 서버)으로 상태를 안다.

**Tech Stack:** Electron 45, electron-vite 6, Vue 3.5, TypeScript 5.9, Tailwind 4(NeoHtop 클래스), Vitest 5(+happy-dom), simple-icons.

**Spec:** `docs/superpowers/specs/2026-11-09-pitwall-4-features-design.md` (앞선 설계: `2026-11-06-pitwall-design.md`)

## Global Constraints

- 한국어 화면·문구, Pretendard. 화면 모양은 NeoHtop(MIT) 실제 부품을 따른다(트리 보기 = NeoHtop ToolBar "List/Tree" + 트리 행, 요약 창 = NeoHtop MenuBarOverview).
- 끄기·지우기는 모두 메인의 OS 확인 창을 거친다. 확인 창 전후로 다시 샘플링하고, 에이전트를 자손으로 둔 프로세스는 끄지 않는다(`planKill`).
- 무거운 작업은 끄지 않는다(묶음 정리에서도). 에이전트도 끄지 않는다.
- 실제 `~/.claude/settings.json`·`~/.codex/hooks.json`(또는 `config.toml`)은 사용자가 앱에서 켤 때만 바꾼다. 개발·테스트는 임시 `CLAUDE_CONFIG_DIR`·`CODEX_HOME`. `~/.codex/auth.json` 은 열지 않는다. Codex 세션 기록은 줄의 `type`·이벤트 이름·시각·`cwd`·`error` 여부만 읽고 대화 내용은 버린다.
- 공개 레포: 회사 이름·경로·티켓·사용자 이름 금지. 테스트 표본은 `C:\work\shop-web`, `/Users/dev/...` 같은 일반 경로. 커밋 전 스테이징한 변경에 회사 고유 문자열(회사·제품 이름, 티켓 번호, 사내 폴더 이름)이 없는지 검사한다.
- 판단은 순수 함수로 나누고 테스트한다. 버그 수정은 실패하는 테스트부터.
- 부하 목표: 창 닫힘 평균 CPU 1% 미만, 앱 전체 RAM 300MB 미만(보통 갱신 주기).
- 기준값(사용자 결정·Claude 판단): 작업 끝남 알림은 "작업 중" 2분 이상 뒤 끝날 때만, 메모리 증가 = 30분 이상에서 +50% 그리고 +1 GB 그리고 1분 변화의 80% 이상이 줄지 않음, 기록 이어 쓰기 = 꺼진 시간 10분 이하, 기록 보관 = RAM 2시간(30초 간격)·서버 메모리 60분(1분 간격).
- 디스크 정리 기본 폴더: `node_modules`, `.next`, `.nuxt`, `.turbo`, `.vite`, `dist`, `build`, `out`, `target`, `.gradle`. git 이 무시하는 폴더만 지운다.

## Review Focus

1. 한 프로세스 트리가 포트를 여럿 열 때(같은 pid 여러 포트, 부모·자식이 나눠 염) 메모리·연결·끄기·추천이 한 번만 세지고 한 번만 끈다.
2. 저장소 안에 만든 병렬 워크트리(`<repo>/.claude/worktrees/x`)는 메인 체크아웃과 한 작업 공간으로 묶이지 않는다(묶음 정리가 다른 세션 서버를 끄지 않게).
3. 폴링하는 대시보드 탭: 새 연결이 계속 생겨도 "확인해볼 것" 타이머는 이어지고, 연결 0 타이머만 사용 흔적으로 되돌아간다.
4. 다시 켰을 때 꺼진 시간이 10분을 넘으면 정리 판단 기억을 버린다(꺼진 동안 쓰였는지 모름). 기록 파일이 깨졌거나 형식이 다르면 무시하고 새로 시작한다.
5. Codex 세션 기록: 압축(`.jsonl.zst`)·resume·첫 입력 전(파일 없음)·강제 종료(`task_started` 만 남음)에서 상태를 지어내지 않는다(모르면 CPU 추정으로).

---

### Task 1: 스냅샷에 서버 단위 행 더하기(+ TIME_WAIT)

**Files:**
- Modify: `src/shared/types.ts` (`ServerRow`, `WorkspaceInfo`, `MemoryGrowth`, `TcpState`에 `'TimeWait'`), `src/shared/keys.ts`, `src/main/snapshot.ts`, `src/main/collect/windows.ts`(`toState`), `src/main/collect/darwin.ts`(그대로 Listen/Established)
- Test: `src/main/snapshot.test.ts`, `src/main/collect/windows.test.ts`

**Interfaces:**
- Produces:
  - `type TcpState = 'Listen' | 'Established' | 'TimeWait' | 'Other'`
  - `interface WorkspaceInfo { root: string; name: string; branch: string | null; outer: boolean }` (outer=false 면 그 워크트리 자체)
  - `interface MemoryGrowth { fromBytes: number; toBytes: number; minutes: number }`
  - `interface ServerRow { pid; ports: number[]; processName; commandLine; worktree: WorktreeInfo | null; workspace: WorkspaceInfo | null; unresolvable; memoryBytes; descendantPids; clientCount; startedAt; judgement: PortJudgement | null; idleSince: number | null; agentInWorktree: boolean; cpuPercent: number | null; memoryGrowth: MemoryGrowth | null }`
  - `DashboardSnapshot.servers: ServerRow[]` (이 Task 에서는 `ports` 도 남겨 둔다 — Task 3 에서 지운다)
  - `selectionKey.server(row: Pick<ServerRow,'pid'|'startedAt'>) => 'server:<pid>:<startedAt>'`
- 서버 합치기 규칙: 개발용 LISTEN 포트를 연 프로세스 중, 조상(제한 없이) 가운데 다른 포트 프로세스가 있으면 그 맨 위 조상의 서버에 포트를 더한다. 포트는 오름차순, 메모리 = 맨 위 프로세스 + 모든 자손(한 번씩). `clientCount` = 그 서버 트리의 pid 들이 연 포트에 붙은 ESTABLISHED 합. 판별 불가(중계)는 서버 하나 = 그 프로세스.

- [ ] **Step 1: 실패하는 테스트**
  - `snapshot.test.ts` `describe('서버 행')`:
    - `test('같은 pid 가 포트 둘을 열면 서버 한 줄에 포트 둘, 메모리는 한 번')` — pid 4100 이 8081·9091 → `servers` 길이 1, `ports` `[8081, 9091]`, `memoryBytes` = 그 프로세스+자손 합.
    - `test('포트를 연 자식은 포트를 연 부모 서버에 합친다')` — 부모 6176, 자식 8081·9091 → 한 줄 `[6176, 8081, 9091]`, `pid` 는 부모, 메모리 한 번.
    - `test('연결 수는 서버의 모든 포트 연결 합')`.
    - `test('IPv4·IPv6 로 같은 포트를 열어도 포트는 한 번')`.
  - `windows.test.ts`: `test('TIME_WAIT 은 TimeWait 상태로 읽는다')`.
- [ ] **Step 2: 실패 확인** — `npx vitest run src/main/snapshot.test.ts src/main/collect/windows.test.ts` → 새 테스트 FAIL.
- [ ] **Step 3: 구현** — `buildSnapshot` 에서 기존 포트 행을 만든 뒤 위 규칙으로 `servers` 를 만든다(`workspace: null`, `cpuPercent: null`, `memoryGrowth: null` — 뒤 Task 에서 채움). `toState('TimeWait')`.
- [ ] **Step 4: 통과 확인** — 같은 명령 PASS, `npm test` 전체 PASS.
- [ ] **Step 5: 커밋** — `feat(snapshot): 서버 단위 행(한 프로세스 트리의 포트를 한 줄로), TIME_WAIT 읽기`

### Task 2: 작업 공간 판별

**Files:**
- Modify: `src/main/collect/worktree.ts` (`resolveWorkspace`), `src/main/collector.ts`, `src/main/snapshot.ts`, `src/shared/types.ts` (`LeftoverRow`·`HeavyJobRow`·`AgentRow` 에 `workspace: WorkspaceInfo | null`)
- Test: `src/main/collect/worktree.test.ts`, `src/main/collector.test.ts`

**Interfaces:**
- Produces: `resolveWorkspace(worktree: WorktreeInfo, deps?: { exists, readFile }): Promise<WorkspaceInfo>` — 워크트리 루트의 부모부터 위로 `.git`(폴더·파일)이 있는 첫 폴더를 찾는다. 그 저장소의 git 공용 폴더(`readCommonDir`)가 워크트리의 `commonDir` 와 같으면 `outer: false`(그 워크트리 자체). 없으면 `outer: false`. 브랜치는 바깥 저장소 HEAD. 결과는 루트별로 캐시.
- `ServerRow.workspace`, `LeftoverRow.workspace`, `HeavyJobRow.workspace`, `AgentRow.workspace` 를 채운다(에이전트는 자기 워크트리 자체가 작업 공간 루트일 수 있음 → 같은 함수).

- [ ] **Step 1: 실패하는 테스트** (`gitFixture` 로 실제 폴더):
  - `test('다른 저장소 안의 저장소는 바깥 저장소가 작업 공간')` — `C:\...\ws\.git` + `ws\repos\front\.git` → `{ root: ws, name: 'ws', outer: true }`.
  - `test('같은 저장소 안에 만든 워크트리는 묶지 않는다')` — `repo\.claude\worktrees\x` (repo 의 연결된 워크트리) → `{ root: x, outer: false }`.
  - `test('바깥 저장소가 없으면 자기 자신')`.
  - `collector.test.ts`: `test('서버·남은 프로세스·무거운 작업·에이전트에 작업 공간을 붙인다')`.
- [ ] **Step 2–4:** 실패 확인 → 구현 → `npm test` PASS.
- [ ] **Step 5: 커밋** — `feat(collect): 작업 공간(바깥 저장소) 판별`

### Task 3: 포트 단위 소비자를 서버 단위로 옮기기

**Files:**
- Modify: `src/main/judge.ts`(`judgeServers`), `src/main/kill.ts`(`killServer`), `src/shared/recommend.ts`, `src/main/notifier.ts`, `src/main/tray.ts`, `src/main/disk.ts`, `src/main/icons.ts`, `src/main/collector.ts`, `src/main/index.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`, `src/shared/types.ts`(`ports` 삭제), `src/shared/keys.ts`(`portKey`·`selectionKey.port` 삭제), 렌더러 `rows.ts`·`App.vue`·`StatsBar.vue`·`ItemSheet.vue`·`history.ts`·`testing/fixtures.ts`(`serverRow`)
- Test: 각 파일의 기존 테스트를 서버 단위로 고친다.

**Interfaces:**
- Consumes: Task 1 `ServerRow`, `selectionKey.server`.
- Produces:
  - `judgeServers(rows: ServerRow[], agents: AgentRow[], previous: ServerMemo, now, thresholdMs, activity: Map<serverKey, boolean>)` (Task 4 에서 activity 를 채운다. 이 Task 에서는 빈 Map)
  - `killServer(pid: number): Promise<KillResult>` (IPC `pitwall:kill-server`), `killPort` 삭제. `openPort(port)` 는 그대로(서버의 첫 포트를 연다).
  - `RecommendItem.kind: 'server' | 'leftover'`, 제목은 `:3000 · :3001` 처럼 포트 목록.
  - 렌더러 표: 개발 서버 탭 행 = 서버, 포트 칸 텍스트 `:6176 · :8081 · :9091`, 정렬 값은 첫 포트. 카드 큰 숫자 = 서버 수, 아래 줄 "포트 n개".
- [ ] **Step 1: 실패하는 테스트**
  - `recommend.test.ts`: `test('포트가 둘인 서버는 추천에 한 번, 메모리도 한 번')`.
  - `kill.test.ts`: `test('서버를 끄면 서버 트리 전체를 한 번만 끈다')`.
  - `tray.test.ts`: `test('트레이 개발 서버 수는 서버 수')`.
  - 렌더러 `rows.test.ts`: `test('한 서버의 여러 포트를 한 칸에')`.
- [ ] **Step 2–4:** 실패 확인 → 구현 → `npm run typecheck && npm run lint && npm test` 모두 통과.
- [ ] **Step 5: 커밋** — `refactor: 판단·끄기·추천·알림·트레이·화면을 서버 단위로`

### Task 4: 사용 흔적으로 "연결 0" 타이머 보강 (F9)

**Files:** Modify `src/main/judge.ts`, `src/main/collector.ts`. Test `src/main/judge.test.ts`.

**Interfaces:**
- Produces: `activityOf(servers: ServerRow[], tcp: TcpEntry[], previous: Map<string, Set<string>>): { activity: Map<string, boolean>; connections: Map<string, Set<string>> }` — 서버 포트에 TimeWait 이 있거나(pid 무관, 로컬 포트로 맞춤), 지난 샘플에 없던 ESTABLISHED 상대(주소:포트)가 생기면 true.
- `judgeServers`: activity 가 true 면 **idle(연결 0) 상태의 since 만** now 로 되돌린다. tabs(연결 있음) 상태는 그대로.
- [ ] **Step 1: 실패하는 테스트**
  - `test('연결 0 이어도 TIME_WAIT 흔적이 있으면 정리 후보 시간을 다시 센다')`.
  - `test('새 연결이 생기면 연결 0 시간을 다시 센다')`.
  - `test('연결이 이어지는 서버(폴링 탭)는 새 연결이 생겨도 확인해볼 것 시간이 이어진다')`.
  - `test('처음 본 연결 목록은 흔적으로 치지 않는다(첫 샘플)')`.
- [ ] **Step 2–5:** 실패 확인 → 구현 → `npm test` → 커밋 `feat(judge): 사용 흔적(TIME_WAIT·새 연결)으로 연결 0 타이머 보강`

### Task 5: 서버 CPU(F5)와 에이전트 상태 시작 시각(F3)

**Files:** Modify `src/main/agents.ts`(`cpuDelta` 내보내기), `src/main/collector.ts`, `src/main/sessions.ts`(`stateSince`), `src/shared/types.ts`(`AgentRow.stateSince: number | null`). Test `src/main/collector.test.ts`, `src/main/sessions.test.ts`, `src/main/agents.test.ts`.

**Interfaces:**
- `ServerRow.cpuPercent`: 서버 트리 CPU, 에이전트와 같은 계산(`MIN_CPU_WINDOW_MS` 규칙 포함).
- `AgentRow.stateSince`: 훅 상태면 그 세션이 지금 상태가 된 이벤트 시각, CPU 추정이면 pitwall 이 지금 상태를 처음 본 시각(메모: 에이전트 키 → {state, since}).
- [ ] **Step 1: 실패하는 테스트**
  - `test('서버 CPU 는 서버 트리의 누적 CPU 변화로 잰다')`.
  - `test('훅 상태의 시작 시각은 상태가 바뀐 이벤트 시각, 같은 상태 이벤트가 또 와도 그대로')`.
  - `test('CPU 추정 상태의 시작 시각은 처음 본 시각, 상태가 바뀌면 새로')`.
- [ ] **Step 2–5:** → 커밋 `feat: 서버 CPU, 에이전트 상태 경과 시간`

### Task 6: 메모리가 계속 느는 서버(F6)

**Files:** Create `src/main/serverHistory.ts`, Test `src/main/serverHistory.test.ts`. Modify `src/main/collector.ts`.

**Interfaces:**
- `createServerHistory(): { record(servers: ServerRow[], now: number): void; growthOf(key: string, now: number): MemoryGrowth | null; export(): ServerHistoryData; import(data, now): void }` — 1분에 한 번 기록, 60분 보관, 사라진 서버는 지운다.
- `memoryGrowth(samples: { t: number; bytes: number }[], now: number): MemoryGrowth | null` — Global Constraints 의 기준.
- [ ] **Step 1: 실패하는 테스트**
  - `test('30분 동안 +50% 그리고 +1GB 이고 대부분 줄지 않으면 메모리 증가')`.
  - `test('30분이 안 되면 아직 판단하지 않는다')`, `test('오르내림이 크면(줄어든 변화가 20% 넘음) 아니다')`, `test('1GB 미만 증가는 아니다')`.
- [ ] **Step 2–5:** → 커밋 `feat: 메모리가 계속 느는 서버 표시`

### Task 7: 기록 이어 쓰기(F8)

**Files:** Create `src/main/historyStore.ts`, Test `src/main/historyStore.test.ts`. Modify `src/main/collector.ts`(메모 export/import), `src/main/index.ts`(5분마다·종료 시 저장, 시작 시 불러오기), `src/shared/ipc.ts`·`src/preload/index.ts`(`history.ram(): Promise<Point[]>`), 렌더러 `App.vue`(처음에 RAM 추이 채우기).

**Interfaces:**
- 파일 `userData/history.json`: `{ version: 1, savedAt, ram: Point[], servers: ServerHistoryData, serverMemo, agentStates }`.
- `loadHistory(path, now): Promise<Loaded | null>` — 형식이 다르거나 깨지면 null. `now - savedAt > 10분` 이면 판단 기억(serverMemo·agentStates)은 버리고 RAM·서버 메모리 기록만.
- `saveHistory(path, data)`: 임시 파일에 쓰고 바꿔 넣는다(config 와 같은 방식).
- RAM 기록: 30초 간격으로 줄여 2시간.
- [ ] **Step 1: 실패하는 테스트**
  - `test('10분 안에 다시 켜면 정리 판단 기억을 이어 쓴다')`, `test('10분이 넘으면 판단 기억은 버리고 RAM 기록만')`, `test('깨진 파일·다른 버전은 무시')`, `test('RAM 기록은 30초 간격·2시간만')`.
- [ ] **Step 2–5:** → 커밋 `feat: 다시 켜도 기록과 정리 판단 이어 쓰기`

### Task 8: 숨기기·별칭(F11)

**Files:** Modify `src/shared/settings.ts`(`hiddenServers: string[]`, `workspaceAliases: Record<string, string>`, 한도), `src/main/snapshot.ts` 또는 `collector.ts`(숨김 분리·별칭 적용), `src/shared/types.ts`(`DashboardSnapshot.hiddenServers: ServerRow[]`). Test `src/shared/settings.test.ts`, `src/main/collector.test.ts`.

**Interfaces:**
- 숨김 항목 형식: `:3000`(포트) 또는 프로세스 이름(`foo.exe`). 서버의 포트 중 하나가 맞거나 이름이 같으면 숨김. 숨긴 서버는 `servers` 에서 빠져 `hiddenServers` 로 → 개수·판단·추천·알림·트레이에 들어가지 않는다.
- 별칭: `workspaceAliases[root]` 가 있으면 `WorkspaceInfo.name`.
- 설정 한도: 숨김 50개(각 100자), 별칭 50개(이름 40자).
- [ ] **Step 1: 실패하는 테스트** — `test('숨긴 서버는 목록·추천·트레이에서 빠지고 숨김 목록에 있다')`, `test('별칭이 있으면 작업 공간 이름')`, `test('설정 한도·형식을 고친다')`.
- [ ] **Step 2–5:** → 커밋 `feat: 서버 숨기기·작업 공간 별칭`

### Task 9: 작업 공간 한 번에 정리(F2)

**Files:** Modify `src/main/kill.ts`(`cleanupWorkspace`), `src/shared/text.ts`, `src/shared/ipc.ts`·`src/preload/index.ts`(`cleanupWorkspace(root)`), `src/main/index.ts`. Test `src/main/kill.test.ts`.

**Interfaces:**
- `cleanupWorkspace(root: string): Promise<KillResult>` — 대상 = `servers` 중 `workspace.root === root` + `leftovers` 중 같은 작업 공간. 무거운 작업·에이전트는 넣지 않는다. 확인 창: 항목 목록·메모리 합, 그 작업 공간에 에이전트가 있으면 경고 문장. `killMany` 와 같은 전후 재샘플링·`planKill`.
- [ ] **Step 1: 실패하는 테스트** — `test('작업 공간의 서버와 남은 프로세스를 확인 창 한 번으로 끈다')`, `test('무거운 작업·에이전트는 끄지 않는다')`, `test('에이전트가 있으면 확인 창에 경고')`, `test('확인 창 사이에 바뀐 항목은 건너뛴다')`.
- [ ] **Step 2–5:** → 커밋 `feat: 작업 공간 한 번에 정리`

### Task 10: 작업 끝남 알림(F4)

**Files:** Modify `src/main/notifier.ts`, `src/shared/settings.ts`(`notify.agentDone`, 기본 true), `src/shared/text.ts`. Test `src/main/notifier.test.ts`, `src/shared/settings.test.ts`.

**Interfaces:** 정확한 상태(`stateSource` 가 `'hook'` 또는 Codex 의 `'rollout'`·`'hook'`)인 에이전트가 working(`stateSince` 로 2분 이상) → idle 이 되면 알림. 창이 앞이면 보내지 않음, 여럿이면 하나로. 누르면 그 에이전트로 이동.
- [ ] **Step 1: 실패하는 테스트** — `test('2분 넘게 일한 뒤 끝나면 알린다')`, `test('2분이 안 된 짧은 답은 알리지 않는다')`, `test('CPU 추정 상태로는 알리지 않는다')`, `test('창이 앞에 있으면 알리지 않는다')`, `test('설정에서 끄면 알리지 않는다')`.
- [ ] **Step 2–5:** → 커밋 `feat: 에이전트 작업 끝남 알림`

### Task 11: Codex 세션 기록 읽기(F7 기본)

**Files:** Create `src/main/codexRollout.ts`, Test `src/main/codexRollout.test.ts`. Modify `src/main/collector.ts`, `src/shared/types.ts`(`AgentRow.stateSource: 'hook' | 'cpu' | 'rollout'`).

**Interfaces:**
- `codexHome(env)`: `CODEX_HOME` 또는 `~/.codex`. `auth.json` 은 열지 않는다.
- `findRollout(home, agent: { cwd, startedAt }, deps)`: 오늘·어제 날짜 폴더의 `rollout-*.jsonl` 중 `session_meta.cwd` 가 같고 파일명 시각이 프로세스 시작 이후인 가장 최근 파일. `.jsonl.zst`(압축)는 건너뛴다.
- `rolloutState(lines: string[]): { state: 'working' | 'idle' | 'error'; since: number } | null` — 줄마다 `type`·`payload.type`·`timestamp` 만 꺼낸다. 마지막 `task_started` 뒤에 `task_complete`/`turn_aborted` 가 없으면 working, `task_complete.payload.error` 가 있으면 error, 그 밖 idle. 근거가 없으면 null(CPU 추정으로).
- 파일 끝 64KB 만 읽는다(큰 파일 부하).
- [ ] **Step 1: 실패하는 테스트** (임시 `CODEX_HOME`): `test('task_started 뒤 끝 이벤트가 없으면 작업 중')`, `test('task_complete 면 쉬는 중, error 가 있으면 오류')`, `test('turn_aborted 는 쉬는 중')`, `test('기록 파일이 없거나 압축됐거나 형식이 다르면 null')`, `test('대화 내용 필드는 읽은 결과에 남지 않는다')`, `test('작업 폴더·시작 시각이 맞는 파일을 고른다')`.
- [ ] **Step 2–5:** → 커밋 `feat: Codex 상태를 세션 기록으로`

### Task 12: Codex 연동 켜기(F7 hooks)

**Files:** Create `src/main/codexHooks.ts`, Test `src/main/codexHooks.test.ts`. Modify `src/main/claudeIntegration.ts`(훅 서버에 `/pitwall-hook/codex` 경로) 또는 새 `codexIntegration.ts`, `src/main/sessions.ts`(도구 구분), `src/shared/ipc.ts`·`src/preload/index.ts`(`codexHook.status/enable/disable`), `src/shared/types.ts`(`DashboardSnapshot.codexHook`), 렌더러 설정 "Codex 연동" 카드.

**Interfaces:**
- **먼저 확인(Step 0):** 공식 문서(learn.chatgpt.com/docs/hooks)와 openai/codex 소스에서 `hooks.json` 의 정확한 형식(이벤트 키, 항목 모양, `commandWindows`)을 확인해 테스트 표본에 적는다. 형식을 확신할 수 없으면 이 Task 는 "연동 켜기" 버튼을 숨긴 채 끝내고(세션 기록만), 원장에 Ruling 으로 남긴다.
- 켜기: `$CODEX_HOME/hooks.json` 에 pitwall 항목만 더한다(기존 항목 보존, 백업, 확인 창). 이벤트: UserPromptSubmit·PreToolUse·PostToolUse·PermissionRequest·Stop·Interrupt·SessionStart·SessionEnd. 명령은 Claude 와 같은 `curl` 방식(표준입력 → 로컬 포트, 출력 없음·바로 종료). 끄기: pitwall 항목만 걷어낸다.
- 상태 매핑: UserPromptSubmit·PreToolUse·PostToolUse → working, PermissionRequest → waiting, Stop·Interrupt → idle. 연동을 켜면 "Codex 에서 `/hooks` 승인을 한 번 해 주세요" 안내.
- [ ] **Step 1: 실패하는 테스트** — `test('켜면 pitwall 항목만 더하고 기존 훅을 지키며 백업한다')`, `test('끄면 pitwall 항목만 걷어낸다')`, `test('깨진 hooks.json 은 고치지 않고 알린다')`, `test('Codex 훅 이벤트로 작업 중·권한 대기·쉬는 중')`, `test('토큰이 틀린 요청은 버린다')`.
- [ ] **Step 2–5:** → 커밋 `feat: Codex 연동 켜기(hooks)`

### Task 13: 디스크 정리 범위(F12)

**Files:** Modify `src/shared/settings.ts`(기본 폴더 목록), `src/main/disk.ts`(git 무시 확인), `src/main/git.ts`(`isIgnored(worktreeRoot, names): Promise<Set<string>>` — `git check-ignore`), `src/shared/types.ts`(`DiskFolder.skipped` 에 `'tracked'`), `src/shared/text.ts`. Test `src/main/disk.test.ts`, `src/main/git.test.ts`.

- [ ] **Step 1: 실패하는 테스트** — `test('git 이 무시하는 폴더만 지울 대상')`, `test('저장소에 올라간 build 폴더는 건너뛴다(tracked)')`, `test('기본 폴더 목록에 빌드 결과 폴더가 있다')`.
- [ ] **Step 2–5:** → 커밋 `feat(disk): 빌드 결과 폴더도, git 이 무시하는 폴더만`

### Task 14: 화면 — 묶음 보기·서버 줄·카드·상세·설정

**Files:** Modify 렌더러 `rows.ts`(묶음 행 만들기 `groupServers`), `components/ItemTable.vue`(트리 행: 펼치기·들여쓰기·묶음 머리), `components/ToolBar.vue`(개발 서버 탭에 "목록 / 묶음" 전환), `App.vue`(보기 기억, 묶음 정리·이름 바꾸기·숨기기 동작), `components/StatsBar.vue`(서버 수·포트 수·작업 공간 수), `components/ItemSheet.vue`(포트 목록·CPU·메모리 증가·작업 공간·숨기기 버튼), `components/SettingsView.vue`(알림 "작업 끝남", 숨긴 서버 목록, Codex 연동 카드, 디스크 폴더 기본값 안내), `shared/text.ts`. Test `rows.test.ts`, `components/ItemTable.test.ts`.

**Interfaces:**
- `groupServers(rows: Row[], servers: ServerRow[], agents: AgentRow[]): GroupRow[]` — 작업 공간별, 머리 = 이름·에이전트(로고·상태)·서버 수·메모리 합(한 번씩)·상태 요약. 혼자인 작업 공간은 머리 없이 바로 서버 줄.
- 표 상태 칸: 에이전트 "작업 중 · 12분"(F3), 서버 "메모리 증가" 배지(F6). 개발 서버 탭에 CPU 칸(F5).
- 표 바닥: 숨긴 서버가 있으면 "숨김 n개" 버튼 → 숨긴 서버 보기·풀기.
- [ ] **Step 1: 실패하는 테스트** — `test('작업 공간별로 묶고 머리에 서버 수·메모리 합')`, `test('혼자인 작업 공간은 머리 없이')`, `test('묶음 머리를 접으면 서버 줄이 숨는다')`, `test('목록/묶음 전환은 기억한다')`, `test('에이전트 상태 칸에 경과 시간')`.
- [ ] **Step 2–5:** → 실제 앱으로 화면 확인(밝게·어둡게·800×560) → 커밋 `feat(ui): 작업 공간 묶음 보기와 새 정보 표시`

### Task 15: 트레이 요약 창(F10)

**Files:** Create `src/renderer/src/TrayView.vue`, `src/main/trayWindow.ts`(창 만들기·위치·닫기 규칙), Test `src/main/trayWindow.test.ts`(위치 계산), Modify `src/main/index.ts`, `src/main/tray.ts`(왼쪽 클릭 = 요약 창, 오른쪽 클릭 = 메뉴), `src/renderer/src/main.ts`(`?view=tray` 면 TrayView).

**Interfaces:**
- `trayWindowBounds(trayBounds, display, size, platform): Rectangle` — Windows 는 트레이 위(작업 표시줄 위치에 따라), macOS 는 메뉴바 아이콘 아래. 화면 밖으로 나가지 않게.
- 창: 테두리 없음·작업 표시줄에 안 보임·포커스를 잃으면 숨김. NeoHtop MenuBarOverview 모양(RAM 막대, 에이전트 상태, 작업 공간별 서버 수, 정리 추천 버튼, "앱 열기"·"설정"·"종료").
- [ ] **Step 1: 실패하는 테스트** — `test('Windows 아래 작업 표시줄이면 트레이 위에')`, `test('위 작업 표시줄이면 아래에')`, `test('macOS 는 메뉴바 아이콘 아래')`, `test('화면 밖으로 나가지 않는다')`, `test('왼쪽 클릭은 요약 창, 오른쪽 클릭은 메뉴')`.
- [ ] **Step 2–5:** → 실제 앱으로 확인 → 커밋 `feat: 트레이 요약 창`

### Task 16: 화면 동작 테스트 다시 쓰기(R1)

**Files:** Create `src/renderer/src/App.test.ts`(happy-dom, `window.pitwall` 가짜).

- [ ] 테스트: `test('서버를 끄면 결과 알림이 제목줄 아래에')`, `test('디스크 정리 결과 알림')`, `test('OS 알림에서 온 이동은 그 탭·그 항목 상세를 연다')`, `test('저장 안 한 설정은 대시보드를 다녀와도 남는다')`, `test('검색·탭·정렬')`, `test('묶음 정리 버튼은 작업 공간 정리를 부른다')`, `test('설정 저장은 IPC 로 보낼 수 있는 값으로 보낸다')`.
- [ ] `npm test` PASS → 커밋 `test(ui): 새 화면 기준 동작 테스트`

### Task 17: 부하·설치 파일·문서(R2–R4)

- [ ] 부하: 설치본(`packaged-profile`, 자동 실행·업데이트 끔)으로 창 닫힘 10분 평균 CPU·앱 전체 RAM 측정 → `docs/measurements.md` 에 추가. 목표를 넘으면 원인을 찾아 고친다.
- [ ] `npx electron-vite build && npx electron-builder --win` 으로 설치 파일 다시 만들기.
- [ ] README(화면 설명·기능 목록), 첫 설계 §7 디자인 기반 줄(NeoHtop), THIRD_PARTY_NOTICES 를 고친다.
- [ ] 커밋 `docs: 4단계 기능·NeoHtop 화면 반영, 부하 측정`

### Final: 전체 검토(R5)

- [ ] `review-package` → 가장 좋은 모델의 새 검토자 → Critical·Important 는 실패하는 테스트부터 고침, Minor 는 원장에.
