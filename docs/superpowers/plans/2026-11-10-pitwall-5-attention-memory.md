# pitwall 5단계(메모리 압박·에이전트 주의·작업 공간 보기) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 메모리가 부족할 때도 맞는 숫자(커밋·남은 메모리)를 보이고, 에이전트의 최근 활동으로 정리 판단과 주의 알림을 고치며, 작업 공간 단위 보기·기록·토큰을 더한다.

**Architecture:** 수집(샘플) → 순수 함수(스냅샷·판단·기록·합계) → 스냅샷 한 덩어리를 렌더러가 그대로 보이는 지금 구조를 지킨다. 새 값은 모두 "모르면 null"이고 화면은 null 을 숨긴다. 훅 이벤트의 내용(제목·프롬프트·도구)은 세션 맵(메모리)에만 두고 디스크에 쓰지 않는다. 기록은 스냅샷에 싣지 않고 따로 보낸다.

**Tech Stack:** Electron 45, electron-vite 6, Vue 3.5, TypeScript 5.9, Tailwind 4(NeoHtop 클래스), Vitest 5(+happy-dom). 새 의존성 없음.

**Spec:** `docs/superpowers/specs/2026-11-10-pitwall-5-attention-memory-design.md` (앞선 설계: `2026-11-06-pitwall-design.md`, `2026-11-09-pitwall-4-features-design.md`)

## Global Constraints

- 한국어 화면·문구(`src/shared/text.ts` 에만), Pretendard, NeoHtop 부품 모양. 컴포넌트 scoped 스타일에 `:global(` 금지.
- 끄기·지우기는 모두 메인의 OS 확인 창을 거친다. 에이전트는 끄지 않는다. 무거운 작업도 pitwall 이 끄지 않는다.
- 실제 `~/.claude/settings.json`·`~/.codex` 는 사용자가 앱에서 켤 때만 바꾼다. 테스트는 임시 폴더. `statusLine` 은 건드리지 않는다.
- 프롬프트·명령·대화 내용은 디스크(history.json·기록·로그)에 쓰지 않고 pitwall 밖으로 보내지 않는다. `showAgentActivity`·`readUsage` 가 꺼져 있으면 받는 순간 버리고 파일을 열지 않는다.
- 모르는 값은 null(지어내지 않음). 화면은 null 인 칸·줄을 숨긴다. macOS·보조 코드가 막힌 PC 에서 커밋 값은 null 이다.
- 불확실하면 정리 후보에서 빼는 쪽. 오래 쉬는 에이전트의 서버는 "확인해볼 것"까지만(정리 후보·정리 추천 금지).
- 같은 프로세스를 두 번 세지 않는다(작업 공간 합계 포함).
- 공개 레포: 회사 이름·경로·티켓·사용자 이름 금지. 테스트 표본은 `C:\work\shop-web`, `/Users/dev/...` 같은 일반 경로.
- 기준값: 오래 쉬는 세션 180분(`agentParkedMinutes`), 조용함 15분, 다시 알림 10분(`waitingReminderMinutes`, 0=끔), 자리 비움 10분, 오래 안 쓴 워크트리 14일(`staleWorktreeDays`, 0=끔), RAM 알림 재무장 5분, 기록 300개·24시간, 프롬프트 200자·명령 160자, G7 은 같은 세션·패턴을 10분 안에 두 번까지 거절. 커밋 단계는 RAM 과 같은 경고·위험 기준 %.
- 기본값: `showAgentActivity`·`readUsage`·`notifyClickFocus`·`notify.agentQuiet`·`notify.agentGone` = true, `heavyGuard` = false.
- 부하 목표: 창 닫힘 평균 CPU 1% 미만, 앱 전체 RAM 300 MB 미만(보통 갱신 주기). 수집 1회 시간이 눈에 띄게 늘지 않는다(지금 약 1.1초).
- G7 의 동기 훅이 Bash 실행에 더하는 시간: pitwall 이 켜져 있을 때 300 ms 이하, 꺼져 있을 때 600 ms 이하(Windows 는 닫힌 로컬 포트 연결이 2초쯤 걸리므로 curl `--connect-timeout 0.3` 을 쓴다).
- OS 알림에는 명령·프롬프트를 넣지 않는다(알림 센터가 디스크에 남긴다). 도구 이름까지만.
- Claude Code 의 실행 중 세션 파일(`<Claude 설정 폴더>/sessions/<pid>.json`)은 읽기만 하고, 같은 폴더의 `.key` 파일은 열지 않는다. 내부 형식이라 모양이 다르면 버린다(지어내지 않음).
- 판단은 순수 함수로 나누고 테스트한다. 규칙을 바꾸는 작업은 실패하는 테스트부터. 각 작업 끝에 `npm run typecheck && npm run lint && npm test` 통과.
- 작업은 이 계획을 실행하는 워크트리(브랜치 `feat/stage5`)에서만 한다. 원래 체크아웃에서는 사용자의 앱이 돌고 있으니 건드리지 않는다. 개발 중 앱을 띄울 때는 사용자의 앱과 겹치지 않게 별도 프로필로 띄우고, 사용자의 창을 앞으로 가져오거나 훔치지 않는다.

## Review Focus

1. **커밋을 모르는 PC**(macOS, 보조 코드 막힘, 일부 프로세스만 읽힘, 수집 방식이 중간에 바뀜): 커밋 칸·문구가 사라지고 합계·추천·알림은 RAM 만으로 자연스럽게 나온다. 수집 방식이 바뀌어도 "메모리 증가"가 가짜로 뜨지 않는다. → Task 2·3·4 에 테스트.
2. **pitwall 을 막 켠 직후**: 활동 시각을 모르는 에이전트(세션 파일도 훅도 없음)가 곧바로 "오래 쉼"이 되어 서버가 "확인해볼 것"으로 뜨지 않는다(처음 본 시각부터 센다). 세션 파일이 있으면 그 시각을 믿는다. → Task 5·6·7.
3. **같은 폴더의 세션 둘, `/clear` 로 바뀐 세션, 아직 짝이 없는 새 세션**: 상태·하는 일·토큰이 다른 프로세스 것으로 섞이지 않는다. → Task 5·8·19.
4. **훅 본문의 이상한 값**(1 MB 명령, 줄바꿈·제어 문자, 문자열이 아닌 `tool_input`, 없는 `session_title`): 한 줄로 잘라 담고 예외 없이 지나간다. 설정을 끄면 이미 들고 있던 내용도 지운다. → Task 8.
5. **G7 이 에이전트를 막지 않아야 할 때**: pitwall 꺼짐, 스냅샷이 오래됨, RAM 정상, `cd x && vue-tsc` 처럼 이어 쓴 명령, 같은 명령 세 번째, pitwall 이 제때 답하지 못함(훅은 2초 안에 끝나고 종료 코드 0). → Task 21.

---

## File Structure

| 파일 | 맡는 일 |
| --- | --- |
| `src/shared/types.ts` | 새 값: 커밋·시스템 메모리, 에이전트 활동·오래 쉼·조용함·하는 일·토큰, 작업 공간 행, 다른 포트, 한도 |
| `src/shared/settings.ts` | 새 설정과 범위(`SETTINGS_VERSION` 3) |
| `src/shared/events.ts` (새) | 기록 한 줄의 모양(`PitEvent`) |
| `src/shared/format.ts`, `text.ts`, `recommend.ts` | 확보량·토큰 표기, 문구, 추천의 커밋 |
| `src/main/collect/windows.ts` | 보조 코드: 커밋, 시스템 커밋·커널, 창 찾기·앞으로 |
| `src/main/snapshot.ts`, `processSummary.ts`, `agents.ts` | 커밋 합, 메모리 요약, 다른 앱의 띄운 앱, 다른 포트 |
| `src/main/sessions.ts` | 세션의 활동 시각·하는 일, 프로세스 단위 상태 |
| `src/main/judge.ts` | 오래 쉬는 에이전트·계속 재는 타이머 |
| `src/main/activity.ts` (새) | 활동 시각·오래 쉼·조용함 계산(순수) |
| `src/main/notifier.ts`, `tray.ts`, `pixelArt.ts` | 알림(내용·다시 알림·조용함·꺼짐·원인), 아이콘 점 |
| `src/main/quickActions.ts`, `focusWindow.ts` (새) | 경로 복사·폴더·터미널, 창으로 가기 |
| `src/main/events.ts` (새) | 스냅샷 차이 → 기록, 기록 보관 |
| `src/main/workspaces.ts`, `gitStatus.ts` (새) | 작업 공간 합계, 커밋 안 한 변경 수 |
| `src/main/disk.ts`, `git.ts` | 저장소 기억 정리, 오래 안 쓴 워크트리 |
| `src/main/claudeUsage.ts` (새), `codexRollout.ts` | 토큰·한도 읽기 |
| `src/main/heavyGuard.ts` (새), `hookServer.ts`, `claudeHooks.ts`, `claudeIntegration.ts` | G7 판단·응답·훅 설치 |
| `src/main/collector.ts`, `index.ts`, `historyStore.ts`, `serverHistory.ts` | 배선, 기록 파일 v2 |
| `src/renderer/src/rows.ts` + `components/*`, `App.vue`, `TrayView.vue` | 칸·카드·상세·탭 |

---

### Task 1: 수집 — 프로세스 커밋, 시스템 커밋·커널 (G1)

**Files:**
- Modify: `src/shared/types.ts`, `src/main/collect/windows.ts`
- Test: `src/main/collect/windows.test.ts`

**Interfaces:**
- Produces:
  - `ProcessInfo.commitBytes?: number | null` — 커밋 크기(Windows `PrivateUsage`). 모르면 null·없음.
  - `interface SystemMemory { commitUsedBytes: number; commitLimitBytes: number; kernelBytes: number }`, `RawSample.system?: SystemMemory | null`
  - PowerShell 출력에 `commit`(pid → 바이트), `system`(`commitTotal`·`commitLimit`·`kernel` 바이트) 추가.
- C#: `PitwallMemRow.Commit` = 같은 버퍼의 72번째 바이트(`Marshal.ReadInt64(buf, 72)`). 새 `PitwallSys.Read()` 는 `psapi.dll GetPerformanceInfo` 를 `[StructLayout(LayoutKind.Sequential)]` 구조체(`cb`·`CommitTotal`·`CommitLimit`·`CommitPeak`·`PhysicalTotal`·`PhysicalAvailable`·`SystemCache`·`KernelTotal`·`KernelPaged`·`KernelNonpaged`·`PageSize`·`HandleCount`·`ProcessCount`·`ThreadCount`, 크기 값은 `UIntPtr`)로 읽고 쪽 수 × `PageSize` 를 바이트로 낸다. `kernel = KernelPaged + KernelNonpaged`. 실패하면 `system` 은 null.

- [ ] **Step 1: 실패하는 테스트** (`windows.test.ts`)
  - `test('커밋 크기(commit)를 프로세스마다 읽고, 없거나 숫자가 아니면 null')` — `commit: {"10": 4096}` 인 표본에서 pid 10 은 `commitBytes === 4096`, pid 11 은 `null`.
  - `test('시스템 커밋·커널을 읽고, 한도가 0 이하·값이 없으면 null')` — `system: {commitTotal: 100, commitLimit: 200, kernel: 5}` → `{commitUsedBytes: 100, commitLimitBytes: 200, kernelBytes: 5}`; `system: null`·`commitLimit: 0` → `sample.system === null`.
  - `test('스크립트는 PrivateUsage(72)와 GetPerformanceInfo 를 읽는다')` — `WINDOWS_SAMPLE_SCRIPT` 에 `ReadInt64(buf, 72)`, `GetPerformanceInfo` 포함.
  - 실제 Windows 묶음에 `test('실제 스크립트가 커밋과 시스템 커밋을 낸다')` — 프로세스 절반 이상이 `commitBytes > 0`, 자기 프로세스는 `commitBytes >= memoryBytes * 0.5`, `system.commitLimitBytes >= os.totalmem()`, `0 < system.commitUsedBytes <= system.commitLimitBytes`, `system.kernelBytes > 0`.
- [ ] **Step 2: 실패 확인** — `npx vitest run src/main/collect/windows.test.ts`
- [ ] **Step 3: 구현** — C# 보조 코드와 스크립트의 JSON, `parseWindowsSample`. 제한 모드 대체 스크립트와 macOS 는 그대로(값 없음).
- [ ] **Step 4: 통과 확인** — 같은 명령 + `npm run typecheck`. 명령줄 길이 제한 테스트(32767자)가 그대로 통과하는지 본다.
- [ ] **Step 5: 커밋** — `feat(collect): 프로세스 커밋 크기와 시스템 커밋·커널 메모리를 같이 모은다`

### Task 2: 스냅샷 — 커밋 합과 메모리 요약 (G1)

**Files:**
- Modify: `src/shared/types.ts`, `src/shared/snapshot.ts`, `src/shared/recommend.ts`, `src/shared/format.ts`, `src/shared/text.ts`, `src/main/snapshot.ts`, `src/main/processSummary.ts`, `src/main/agents.ts`, `src/main/leftovers.ts`, `src/main/heavy.ts`, `src/main/kill.ts`, `src/main/notifier.ts`, `src/renderer/src/testing/fixtures.ts`
- Test: `src/main/snapshot.test.ts`, `src/main/agents.test.ts`, `src/shared/recommend.test.ts`, `src/shared/format.test.ts`, `src/main/kill.test.ts`(문구)

**Interfaces:**
- Consumes: Task 1 의 `ProcessInfo.commitBytes`, `RawSample.system`.
- Produces:
  - `commitBytes: number | null` 을 `ServerRow`·`AgentRow`·`LeftoverRow`·`HeavyJobRow`·`AppUsage`·`ProcessSummary`·`GroupUsage` 에. 구성 프로세스의 커밋을 더하고, **하나도 모르면 null**(일부만 알면 아는 것의 합).
  - `interface CommitSummary { usedBytes: number; limitBytes: number; percent: number; level: MemoryLevel }`
  - `MemorySummary` 에 `availableBytes: number`(total − used), `ramLevel: MemoryLevel`, `commit: CommitSummary | null`, `kernelBytes: number | null`. `level` = `ramLevel` 과 `commit.level` 중 높은 쪽(normal < warn < danger). `commit.percent` 는 소수 1자리.
  - `RecommendItem.commitBytes: number | null`, `Recommendation.totalCommitBytes: number | null`. 정렬은 `(commitBytes ?? memoryBytes)` 큰 순, 같으면 pid.
  - `formatFreed(memoryBytes: number, commitBytes: number | null): string` — 커밋을 알면 `"RAM 약 1.2 GB · 커밋 약 4.2 GB"`, 모르면 `"약 1.2 GB"`.
  - 확인 창·결과·알림 문구(`text.killMany.message`·`killed`, `text.cleanupWorkspace.message`, `text.notify.ramBody`)는 `formatFreed` 결과 문자열을 받게 바꾼다.
  - `blankSnapshot` 의 `memory` 에 새 값(`availableBytes: 0, ramLevel: 'normal', commit: null, kernelBytes: null`).

- [ ] **Step 1: 실패하는 테스트**
  - `snapshot.test.ts`: `test('서버·묶음·다른 앱의 커밋은 구성 프로세스의 합, 하나도 모르면 null')`; `test('일부 프로세스의 커밋만 알면 아는 것만 더한다')`; `test('커밋 사용률이 위험 기준을 넘으면 RAM 이 정상이어도 level 은 danger, ramLevel 은 normal')` — total 100, free 60, `system {commitUsedBytes: 95, commitLimitBytes: 100}` → `level 'danger'`, `ramLevel 'normal'`, `commit.percent 95`; `test('시스템 값을 모르면 commit·kernelBytes 는 null 이고 level 은 RAM 만으로')`; `test('availableBytes 는 total − used')`.
  - `recommend.test.ts`: `test('커밋 큰 순으로, 커밋을 모르면 RAM 큰 순')`, `test('totalCommitBytes 는 하나도 모르면 null')`.
  - `format.test.ts`: `formatFreed(1.2GB, 4.2GB) === 'RAM 약 1.2 GB · 커밋 약 4.2 GB'`, `formatFreed(1.2GB, null) === '약 1.2 GB'`.
- [ ] **Step 2: 실패 확인** — `npx vitest run src/main/snapshot.test.ts src/shared`
- [ ] **Step 3: 구현** — `summarizeMemory(total, free, thresholds, system)`; 행을 만드는 곳마다 합. `fixtures.ts` 기본값은 `commitBytes: null`.
- [ ] **Step 4: 통과 확인** — `npm run typecheck && npm test`
- [ ] **Step 5: 커밋** — `feat(snapshot): 커밋 합과 남은 메모리·커밋 단계를 스냅샷에 담는다`

### Task 3: 메모리 증가는 커밋으로, 기록 파일 v2, RAM 알림 재무장 (G1)

**Files:**
- Modify: `src/main/serverHistory.ts`, `src/main/historyStore.ts`, `src/main/notifier.ts`, `src/shared/text.ts`
- Test: `src/main/serverHistory.test.ts`, `src/main/historyStore.test.ts`, `src/main/notifier.test.ts`

**Interfaces:**
- Produces:
  - `MemorySample { t: number; bytes: number; commit?: boolean }`. `record()` 는 `commitBytes ?? memoryBytes` 를 적고, 직전 표본과 종류(커밋·작업 세트)가 다르면 그 서버의 기록을 비우고 새로 시작한다.
  - `HistoryFile.version: 2`. version 1 파일은 `loadHistory` 가 null(새로 시작). `serverMemo` 항목에 `shielded?: boolean` 을 보존한다(Task 7 이 쓴다).
  - 알림: `level` 이 danger 가 아닌 상태가 5분(`RAM_REARM_MS`) 이어지거나 normal 이 되면 다시 무장. 제목은 `memory.ramLevel === 'danger'` 면 지금 문구, 아니면 `text.notify.commitTitle(percent)` = `메모리 한도에 가까워요 (커밋 ${percent}%)`.

- [ ] **Step 1: 실패하는 테스트**
  - `serverHistory.test.ts`: `test('커밋이 있으면 커밋으로 적는다')`; `test('작업 세트 기록 뒤에 커밋 기록이 이어지면 처음부터 다시 센다(가짜 증가 없음)')` — 작업 세트 1 GB × 35분 뒤 커밋 4 GB 한 점 → `growthOf` null.
  - `historyStore.test.ts`: `test('version 1 파일은 버린다')`, `test('serverMemo 의 shielded 를 보존한다')`.
  - `notifier.test.ts`: `test('위험과 경고를 오가며 정상으로 안 내려와도, 위험 아래로 5분 있었으면 다시 알린다(30분 간격은 지킨다)')`; `test('커밋 때문에 위험이면 제목이 커밋 문구')`.
- [ ] **Step 2: 실패 확인** — `npx vitest run src/main/serverHistory.test.ts src/main/historyStore.test.ts src/main/notifier.test.ts`
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — `npm run typecheck && npm test`
- [ ] **Step 5: 커밋** — `feat: 메모리 증가는 커밋으로 재고, RAM 알림은 위험 아래로 5분 내려갔으면 다시 알린다`

### Task 4: 화면 — 커밋 칸, 메모리 카드·상세, 확보 문구 (G1)

**Files:**
- Modify: `src/renderer/src/rows.ts`, `components/StatsBar.vue`, `components/MemorySheet.vue`, `components/ItemSheet.vue`, `components/ItemTable.vue`(묶음 머리의 커밋), `App.vue`(추천 카드), `TrayView.vue`, `src/main/tray.ts`, `src/shared/text.ts`
- Test: `src/renderer/src/rows.test.ts`, `components/StatsBar.test.ts`, `components/MemorySheet.test.ts`, `components/ItemSheet.test.ts`, `TrayView.test.ts`

**Interfaces:**
- Consumes: Task 2 의 `commitBytes`, `MemorySummary` 새 값, `formatFreed`.
- Produces:
  - 표 칸 `commit`(제목 "커밋", 오른쪽 정렬, 너비 96): `ports`·`agents`·`leftovers`·`heavy`·`apps` 표에서 메모리 칸 바로 뒤. **그 표의 모든 행이 null 이면 칸을 빼고**, 일부만 null 이면 그 칸은 `—`.
  - `ServerGroup.commitBytes: number | null`(묶음 머리).
  - 메모리 카드: 사용률 아래 줄을 `"63.7 GB 중 56.8 GB 사용 · 남은 6.5 GB"`, 커밋을 알면 한 줄 더 `"커밋 104.8 / 127.7 GB (82%)"`(커밋 단계가 warn·danger 면 그 색). 경고 배지 옆에 원인이 커밋이면 "커밋".
  - 메모리 상세: 사실 카드에 "남은 메모리", "커밋", "커밋 한도". "시스템·공유" 줄 아래에 `kernelBytes` 를 알면 "커널 n GB 포함". 설명 문구 `text.ui.sheet.commitNote` = `커밋은 프로세스가 차지하기로 한 메모리 전체(RAM 에 올라온 것 + 페이지 파일로 밀려난 것)예요. 메모리가 부족하면 RAM 값은 줄어도 커밋은 그대로예요.`
  - 상세 패널 메모리 카드의 보조 줄에 `커밋 4.2 GB`. 추천 카드·트레이 요약은 `formatFreed`.

- [ ] **Step 1: 실패하는 테스트**
  - `rows.test.ts`: `test('커밋을 하나라도 알면 커밋 칸이 메모리 칸 뒤에, 하나도 모르면 칸이 없다')`, `test('커밋 칸은 커밋으로 정렬하고 모르는 행은 —')`.
  - `StatsBar.test.ts`: `test('메모리 카드에 남은 메모리와 커밋 사용률')`, `test('커밋을 모르면 커밋 줄이 없다')`.
  - `MemorySheet.test.ts`: `test('커밋·한도·남은 메모리·커널 몫을 보인다, 모르면 숨긴다')`.
  - `ItemSheet.test.ts`: `test('서버 메모리 카드에 커밋')`.
- [ ] **Step 2: 실패 확인** — `npx vitest run src/renderer`
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — `npm run typecheck && npm run lint && npm test`
- [ ] **Step 5: 커밋** — `feat(ui): 커밋 칸과 남은 메모리·커밋 사용률을 보인다`

### Task 5: 세션의 활동 시각, 프로세스 단위 상태, 오래 쉬는 세션 (G2·G3a)

**Files:**
- Create: `src/main/activity.ts`, `src/main/activity.test.ts`
- Modify: `src/shared/types.ts`, `src/shared/settings.ts`, `src/main/sessions.ts`, `src/main/agents.ts`, `src/main/codexRollout.ts`, `src/main/collector.ts`, `src/main/historyStore.ts`, `src/renderer/src/testing/fixtures.ts`
- Test: `src/main/sessions.test.ts`, `src/main/agents.test.ts`, `src/main/collector.test.ts`, `src/shared/settings.test.ts`, `src/main/codexRollout.test.ts`

**Interfaces:**
- Produces:
  - `ClaudeSession.lastActivityAt: number` — 활동 이벤트(SessionStart·UserPromptSubmit·PreToolUse·PostToolUse·PermissionRequest·Stop·StopFailure·Interrupt, 그리고 `permission_prompt`·`elicitation_dialog` 알림)가 온 시각. `idle_prompt` 등 다른 알림은 바꾸지 않는다.
  - `interface HookView { state: AgentState; since: number; lastActivityAt: number; sessionId: string }`
  - `hookViewForAgent(sessions, agent: { key: string; rootKey: string | null; tool: AgentTool }, rootOfCwd): HookView | null` — `processKey === agent.key` 인 세션이 있으면 그 가운데 우선순위(`waiting` > `working` > `error` > `idle`, 같으면 가장 오래된 `since`)로. 없으면 `processKey` 가 null 이고 같은 워크트리·같은 도구인 세션에서. 다른 프로세스와 짝지은 세션은 쓰지 않는다. `lastActivityAt` 은 고른 세션들 가운데 가장 최근.
  - `buildAgents` 의 `hookStates` 를 `hookFor?: (agent: { key: string; worktreeRoot: string | null; tool: AgentTool }) => HookView | null` 로 바꾼다. 반환에 `members: Map<string, number[]>`(agentKey → 자기 + 센 자손 pid) 추가.
  - `RolloutState.lastEventAt: number`(읽은 이벤트 가운데 가장 늦은 시각).
  - `reconcileSessions`: 살아 있는 프로세스와 짝지은 세션은 6시간 소식이 없어도 버리지 않는다(짝 없는 세션만 만료). 며칠째 쉬는 세션의 마지막 활동·제목을 잃지 않게.
  - `AgentRow.lastActiveAt: number | null`, `AgentRow.parked: boolean`.
  - `src/main/activity.ts`:
    - `type SeenMemo = Map<string, { firstSeen: number; lastWorking: number | null }>`
    - `trackSeen(agents: Pick<AgentRow,'pid'|'startedAt'|'state'>[], previous: SeenMemo, now: number): SeenMemo` — 지금 있는 에이전트만 남긴다.
    - `lastActiveOf(agent: Pick<AgentRow,'stateSource'>, exact: number | null, seen: { firstSeen: number; lastWorking: number | null }): number` — 훅·세션 기록이면 `exact`(없으면 seen 값), CPU 추정이면 `lastWorking ?? firstSeen`.
    - `isParked(agent: Pick<AgentRow,'state'|'lastActiveAt'>, now: number, parkedMs: number): boolean` — 상태가 `idle`·`error`·`unknown` 이고 `lastActiveAt != null && now - lastActiveAt >= parkedMs`.
  - `Settings.agentParkedMinutes: number`(10~10080, 기본 180), `CollectOptions.agentParkedMs`. `SETTINGS_VERSION = 3`.
  - `CollectorState.agentSeen`(history.json 의 `agentSeen`, 10분 안에 다시 켜면 이어 쓴다).

- [ ] **Step 1: 실패하는 테스트**
  - `sessions.test.ts`: `test('같은 워크트리의 두 프로세스는 각자 짝지은 세션의 상태를 본다')` — 세션 A(processKey p1, waiting)·B(p2, idle) → p1 `waiting`, p2 `idle`; `test('짝 없는 새 세션은 그 워크트리의 짝 없는 에이전트에만 보인다')`; `test('idle_prompt 알림은 활동 시각을 바꾸지 않는다')`; `test('/clear 로 세션이 바뀌면 그 프로세스는 새 세션의 상태를 본다')`.
  - `activity.test.ts`: `test('CPU 추정은 마지막으로 작업 중이던 시각, 본 적 없으면 처음 본 시각')`; `test('pitwall 이 막 본 에이전트는 오래 쉬는 세션이 아니다')` — firstSeen = now → `isParked` false; `test('작업 중·권한 대기는 아무리 오래여도 아니다')`; `test('쉬는 중이고 마지막 활동이 180분 전이면 오래 쉬는 세션')`.
  - `collector.test.ts`: `test('훅으로 아는 에이전트의 lastActiveAt 은 그 세션의 마지막 활동 시각')`, `test('agentParkedMs 를 넘긴 쉬는 에이전트는 parked')`.
  - `sessions.test.ts`: `test('살아 있는 프로세스와 짝지은 세션은 6시간이 지나도 남고, 짝 없는 세션은 만료된다')`.
  - `settings.test.ts`: `agentParkedMinutes` 범위·기본값.
- [ ] **Step 2: 실패 확인** — `npx vitest run src/main/sessions.test.ts src/main/activity.test.ts src/main/collector.test.ts src/shared/settings.test.ts`
- [ ] **Step 3: 구현** — `collector.collect`·`restate` 모두 `hookViewForAgent` 를 쓴다(`exactSinceFor` 포함). `notifier`·`codexTranscriptFor` 는 그대로.
- [ ] **Step 4: 통과 확인** — `npm run typecheck && npm test`
- [ ] **Step 5: 커밋** — `feat: 에이전트 상태를 프로세스 단위로, 마지막 활동 시각과 오래 쉬는 세션을 안다`

### Task 6: Claude 실행 중 세션 파일 — 정확한 짝과 훅 없는 상태 (G3a)

**Files:**
- Create: `src/main/claudeSessionFiles.ts`, `src/main/claudeSessionFiles.test.ts`
- Modify: `src/shared/types.ts`, `src/main/sessions.ts`, `src/main/collector.ts`, `src/main/index.ts`, `src/renderer/src/components/StatsBar.vue`, `components/ItemSheet.vue`, `src/shared/text.ts`
- Test: `src/main/claudeSessionFiles.test.ts`, `src/main/sessions.test.ts`, `src/main/collector.test.ts`, `src/main/notifier.test.ts`

**Interfaces:**
- Consumes: Task 5 의 `hookViewForAgent`, `lastActiveOf`, `SeenMemo`.
- Produces:
  - `interface ClaudeSessionFile { pid: number; sessionId: string; status: 'idle' | 'busy' | null; statusUpdatedAt: number | null; name: string | null }`
  - `createSessionFileReader(o: { dir: string; slackMs?: number; maxBytes?: number }): { read(agents: { pid: number; startedAt: number | null }[], now: number): Promise<Map<number, ClaudeSessionFile>> }` — 에이전트 pid 마다 `<dir>/<pid>.json` 만 읽는다(`.key` 등 다른 파일은 열지 않는다, 64 KB 초과는 버림). 받아들이는 조건: JSON 객체, `pid` 가 파일 이름과 같음, `sessionId` 가 200자 이하 문자열, `startedAt` 이 그 프로세스 시작 시각과 60초(`slackMs`) 안(프로세스 시작 시각을 모르거나 벗어나면 버림 — 다시 쓰인 pid 의 옛 파일). `status` 는 `'idle'`·`'busy'` 만(그 밖은 null), `statusUpdatedAt` 은 유한하고 `now + slackMs` 이하일 때만, `name` 은 문자열이면 그대로(자르는 것은 쓰는 쪽). 읽기·해석 실패는 그 pid 만 건너뛴다.
  - `pairBySessionFile(sessions: Sessions, files: Map<number, ClaudeSessionFile>, keyOfPid: (pid: number) => string | null): void`(`sessions.ts`) — 파일의 `sessionId` 와 같은 세션이 있으면 `processKey` 를 그 프로세스로 고친다. 같은 `processKey` 를 가진 다른 Claude 세션은 버린다(그 프로세스가 새 세션으로 넘어감). Codex 세션은 건드리지 않는다.
  - `AgentRow.stateSource: 'hook' | 'cpu' | 'rollout' | 'file'`. `text.ui.agent.sources.file` = `Claude 세션 파일`.
  - `CollectorDeps.claudeSessionFiles?: (agents: { pid: number; startedAt: number | null }[], now: number) => Promise<Map<number, ClaudeSessionFile>>`.
  - 수집 순서: 세션 파일 읽기 → `pairBySessionFile` → `reconcileSessions` → `buildAgents`(훅) → 훅 상태가 없는 Claude 에이전트(`stateSource === 'cpu'`)에 파일 상태를 입힌다: `busy` → `working`, `idle` → `idle`, `stateSource: 'file'`, 상태 시작 시각 = `statusUpdatedAt`(없으면 지금처럼 처음 본 시각). 마지막 활동: `busy` 면 수집 시각, `idle` 이면 `statusUpdatedAt`. `restate()` 는 훅 상태가 생기지 않은 `file` 행을 그대로 둔다.
  - **훅과 파일이 둘 다 있을 때**: 더 늦은 근거를 따른다 — 파일의 `statusUpdatedAt` 이 훅 세션의 `lastActivityAt` 보다 5초(`FILE_NEWER_SLACK_MS`) 넘게 늦으면 파일 상태(`stateSource: 'file'`), 아니면 훅. 훅 전달이 끊겼거나(그 세션은 훅을 켜기 전에 시작됨) 끝 이벤트를 놓친 세션이 옛 상태로 굳지 않게 한다. 권한 대기는 훅만 알므로, 권한 요청 이벤트가 파일의 busy 시각보다 늦으면 그대로 훅이 이긴다.
  - CPU 를 한 번도 읽지 못해 상태가 `unknown` 인 CPU 추정 에이전트는 `lastActiveAt: null`(오래 쉬는 세션으로 보지 않는다 — 근거가 없다). `lastActiveOf` 가 그 경우 null 을 돌려주게 고친다(반환 타입 `number | null`).
  - 화면: 상세 패널의 상태 출처에 "Claude 세션 파일", 설명 `text.ui.agent.fileNote` = `Claude Code 가 남기는 세션 파일로 작업 중·쉬는 중을 알아요. 권한 대기는 Claude 연동을 켜야 알 수 있어요.` 에이전트 카드의 "상태 · …" 줄은 훅이 켜져 있으면 지금 문구, 아니고 `file` 출처 에이전트가 있으면 `세션 파일`, 아니면 `CPU 추정`.
- 작업 끝남 알림은 `stateSource !== 'cpu'` 를 정확한 상태로 보므로 `file` 도 포함된다(훅 없이도 "작업 끝남"을 안다). 조용함(Task 9)은 훅 상태에만 붙는다.

- [ ] **Step 1: 실패하는 테스트**
  - `claudeSessionFiles.test.ts`(임시 폴더): `test('pid.json 에서 세션 id·상태·시각을 읽는다')`; `test('.key 파일과 목록에 없는 pid 의 파일은 열지 않는다')`; `test('파일의 pid 가 이름과 다르거나 시작 시각이 60초 넘게 다르면 버린다(다시 쓰인 pid)')`; `test('모르는 상태 글자는 null, 미래 시각은 null')`; `test('깨진 JSON·너무 큰 파일은 그 pid 만 건너뛴다')`.
  - `sessions.test.ts`: `test('세션 파일이 가리키는 프로세스로 짝을 고치고, 그 프로세스의 예전 세션은 버린다')`.
  - `collector.test.ts`: `test('훅이 없어도 세션 파일로 작업 중·쉬는 중과 그 시작 시각을 안다')`; `test('훅과 파일이 둘 다 있으면 더 늦은 근거를 따른다: 훅은 쉬는 중(5시간 전)인데 파일이 방금 busy 면 작업 중')`; `test('권한 요청이 파일의 busy 시각보다 늦으면 권한 대기(훅)')`; `test('훅과 파일의 시각이 5초 안이면 훅')`; `test('CPU 를 읽지 못해 확인 중인 에이전트는 lastActiveAt 이 null 이고 오래 쉬는 세션이 아니다')`; `test('막 켠 pitwall 도 세션 파일의 시각으로 오래 쉬는 세션을 안다')`; `test('세션 파일이 없으면 지금처럼 CPU 추정')`.
  - `notifier.test.ts`: `test('세션 파일로 안 상태도 2분 넘게 일하고 끝나면 작업 끝남을 알린다')`.
  - 실제 Windows 묶음: `test('실제 세션 폴더를 읽어도 예외가 없다(폴더가 없으면 빈 결과)')`.
- [ ] **Step 2: 실패 확인** — `npx vitest run src/main/claudeSessionFiles.test.ts src/main/sessions.test.ts src/main/collector.test.ts`
- [ ] **Step 3: 구현** — `index.ts` 는 `createSessionFileReader({ dir: join(claudeConfigDir(...), 'sessions') })` 를 넘긴다.
- [ ] **Step 4: 통과 확인** — `npm run typecheck && npm run lint && npm test`
- [ ] **Step 5: 커밋** — `feat: Claude 세션 파일로 프로세스와 세션을 정확히 잇고, 훅 없이도 작업 중·쉬는 중을 안다`

### Task 7: 정리 판단 — 오래 쉬는 에이전트는 보호하지 않는다 (G2)

**Files:**
- Modify: `src/shared/types.ts`, `src/main/judge.ts`, `src/main/collector.ts`, `src/renderer/src/rows.ts`, `components/ItemSheet.vue`, `components/StatsBar.vue`, `components/SettingsView.vue`, `src/shared/text.ts`, `src/renderer/src/testing/fixtures.ts`
- Test: `src/main/judge.test.ts`, `src/renderer/src/rows.test.ts`, `components/StatsBar.test.ts`

**Interfaces:**
- Consumes: Task 5 의 `AgentRow.parked`·`lastActiveAt`, Task 3 의 `serverMemo.shielded`.
- Produces:
  - `ServerRow.parkedAgent: boolean`.
  - `ServerMemo = Map<string, { state: 'idle' | 'tabs'; since: number; shielded?: boolean }>`.
  - `judgeServers` 규칙(판별 불가·워크트리 없음은 지금처럼 판단하지 않는다):
    1. 덮는 에이전트 = 워크트리를 덮거나 같은 작업 공간의 에이전트. 그 가운데 `parked` 가 아닌 것이 "활동 중".
    2. 타이머는 항상 잰다: `since = (이전 상태가 같고 흔적이 없으면) 이전 since, 아니면 now`.
    3. 활동 중인 에이전트가 없을 때 `since` 의 아래 한계: 덮는 에이전트(모두 오래 쉼)가 있으면 그들의 `lastActiveAt` 중 가장 늦은 값, 없고 지난 샘플에 `shielded` 였으면 `now`(떠나면 처음부터).
    4. 활동 중인 에이전트가 있으면 `judgement: null, agentInWorktree: true, parkedAgent: false, idleSince: since`, memo `shielded: true`.
    5. 없으면 기준 시간이 지났을 때 `연결 0 && 덮는 에이전트 없음 && 작업 폴더 모르는 에이전트 없음` 이면 `candidate`, 그 밖은 `check`. `agentInWorktree` = 덮는 에이전트가 있음, `parkedAgent` = 덮는 에이전트가 있음(모두 오래 쉼).
  - 상태 문구: `parkedAgent` 이고 판단이 `check` 면 `확인해볼 것 · 에이전트가 ${기간}째 쉼`(기간 = 가장 늦은 lastActiveAt 부터 — 행에 `parkedSince: number | null` 추가), 판단 전이면 `에이전트 오래 쉼`. 에이전트 상태 칸에 배지 `오래 쉼`. 에이전트 카드의 셋째 칸 아래에 `오래 쉼 n`.
  - 설정 > 기준값에 "오래 쉬는 세션 기준(분)"과 도움말 `text.ui.settings.agentParkedHelp` = `에이전트가 이 시간 넘게 입력·도구 사용이 없으면 오래 쉬는 세션으로 봐요. 그 에이전트만 있는 워크트리의 서버는 정리 후보가 아니라 확인해볼 것까지만 올려요.`

- [ ] **Step 1: 실패하는 테스트** (`judge.test.ts`)
  - `test('활동 중인 에이전트가 있으면 판단하지 않지만 연결 타이머는 잰다')` — 30분 연결 0, 에이전트 working → `judgement null`, `idleSince` = 30분 전.
  - `test('덮는 에이전트가 모두 오래 쉬면 확인해볼 것까지만(연결 0 이어도 정리 후보가 아니다)')`.
  - `test('오래 쉬는 세션이 된 서버의 타이머는 그 에이전트의 마지막 활동보다 앞설 수 없다')`.
  - `test('에이전트가 꺼지면 그때부터 다시 센다')` — 이전 memo `shielded: true`, 에이전트 없음 → `since === now`.
  - `test('오래 쉬는 에이전트와 활동 중인 에이전트가 같이 있으면 판단하지 않는다')`.
  - `test('같은 작업 공간의 오래 쉬는 에이전트도 같은 규칙')`.
  - 기존 테스트 가운데 "에이전트가 있으면 idleSince null"을 새 규칙으로 고친다.
- [ ] **Step 2: 실패 확인** — `npx vitest run src/main/judge.test.ts`
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — `npm run typecheck && npm run lint && npm test`
- [ ] **Step 5: 커밋** — `feat(judge): 오래 쉬는 에이전트의 서버는 확인해볼 것까지 올리고, 연결 타이머는 에이전트가 있어도 잰다`

### Task 8: 하는 일 보기 — 제목·프롬프트·도구 (G3b)

**Files:**
- Modify: `src/shared/types.ts`, `src/shared/settings.ts`, `src/main/sessions.ts`, `src/main/claudeHooks.ts`(`CLAUDE_HOOK_EVENTS` 에 `PreToolUse`), `src/main/collector.ts`, `src/main/index.ts`, `src/renderer/src/rows.ts`, `components/ItemSheet.vue`, `components/SettingsView.vue`, `src/shared/text.ts`
- Test: `src/main/sessions.test.ts`, `src/main/claudeHooks.test.ts`, `src/main/collector.test.ts`, `src/renderer/src/rows.test.ts`, `components/ItemSheet.test.ts`

**Interfaces:**
- Produces:
  - `interface AgentActivity { title: string | null; prompt: string | null; tool: { name: string; summary: string | null; since: number } | null; waiting: { tool: string | null; summary: string | null } | null }`, `AgentRow.activity: AgentActivity | null`.
  - `applyHookEvent(sessions, input, now, tool = 'claude', opts: { activity: boolean } = { activity: true })`. `opts.activity` 가 false 면 내용 값을 저장하지 않는다.
  - `clearActivity(sessions: Sessions): void` — 들고 있던 내용 값을 모두 지운다(설정을 끌 때 `index.ts` 가 부른다).
  - `oneLine(value: unknown, max: number): string | null` — 문자열이 아니면 null, 제어 문자·줄바꿈 뒤는 버리고(첫 줄만) 공백을 정리해 `max` 자로 자른다(넘으면 끝에 `…`). 빈 글은 null.
  - `toolSummary(name: string, input: unknown): string | null` — `Bash`·`PowerShell`: `input.command` 첫 줄 160자. `Read`·`Edit`·`Write`·`MultiEdit`·`NotebookEdit`: `file_path`(또는 `notebook_path`)의 파일 이름. `Grep`·`Glob`: `pattern` 80자. `WebFetch`: URL 의 호스트. `Task`·`Agent`: `description` 80자. 그 밖·형식이 다르면 null.
  - 세션 값: `title` = `session_title` 80자(오면 덮어씀. 훅 제목이 없으면 Task 6 의 세션 파일 `name` 80자를 행의 제목으로 쓴다 — `showAgentActivity` 가 켜져 있을 때만), `prompt` = UserPromptSubmit 의 `prompt` 첫 줄 200자, `tool` = PreToolUse 에 채우고 같은 이름의 PostToolUse·Stop·StopFailure·Interrupt·UserPromptSubmit 에 비운다, `waiting` = PermissionRequest 에 채우고 상태가 `waiting` 을 벗어나면 비운다.
  - `Settings.showAgentActivity: boolean`(기본 true).
  - 화면: 에이전트 표에 "하는 일" 칸(너비 260, 상태 칸 뒤): 권한 대기면 `권한: Bash · npm run build`, 도구 실행 중이면 `Bash · npm run build`, 아니면 제목, 없으면 프롬프트, 없으면 `—`. 검색 대상에 제목. 상세 패널 정보에 제목·마지막 요청·실행 중인 도구, 아래 설명 `text.ui.agent.activityNote` = `에이전트 연동이 알려 준 내용이에요. pitwall 은 이것을 메모리에만 두고 파일로 남기지 않아요. 설정 > 에이전트 연동에서 끌 수 있어요.`
  - 설정 > 에이전트 연동에 체크 "에이전트가 하는 일 보기".
- Claude 훅 이벤트가 하나 늘어 이미 켠 설정은 `partial`("다시 켜 주세요")이 된다 — 의도한 동작이다.

- [ ] **Step 1: 실패하는 테스트**
  - `sessions.test.ts`: `test('PreToolUse 에 실행 중인 도구를 담고 같은 도구의 PostToolUse 에 비운다')`; `test('PermissionRequest 의 도구와 명령 요약을 담고, 승인되면 비운다')`; `test('프롬프트는 첫 줄 200자, 제목은 80자')`; `test('1 MB 명령·제어 문자·문자열이 아닌 tool_input 도 예외 없이 한 줄로')` — `command: 'a'.repeat(1_000_000)` → 길이 160 이하, `tool_input: 42` → summary null; `test('activity 를 끄면 내용 값을 저장하지 않는다(상태는 그대로)')`; `test('clearActivity 는 들고 있던 내용을 지운다')`.
  - `collector.test.ts`: `test('같은 워크트리의 두 세션은 각자의 하는 일을 본다')`.
  - `claudeHooks.test.ts`: `test('PreToolUse 에도 훅을 넣는다')`, `test('PreToolUse 가 없는 예전 설정은 partial')`.
  - `rows.test.ts`: `test('하는 일 칸: 권한 대기 > 실행 중인 도구 > 제목 > 프롬프트')`.
- [ ] **Step 2: 실패 확인** — `npx vitest run src/main/sessions.test.ts src/main/claudeHooks.test.ts src/renderer/src/rows.test.ts`
- [ ] **Step 3: 구현** — `HookView` 에 `activity: AgentActivity | null` 을 더해 행으로 넘긴다. Codex 훅도 같은 이름의 값이 오면 쓰고 없으면 null.
- [ ] **Step 4: 통과 확인** — `npm run typecheck && npm run lint && npm test`
- [ ] **Step 5: 커밋** — `feat: 에이전트가 하는 일(제목·요청·도구)을 메모리에만 두고 보인다`

### Task 9: 조용한 에이전트 (G3c)

**Files:**
- Modify: `src/shared/types.ts`, `src/main/activity.ts`, `src/main/collector.ts`, `src/renderer/src/rows.ts`, `components/ItemSheet.vue`, `src/shared/text.ts`
- Test: `src/main/activity.test.ts`, `src/main/collector.test.ts`, `src/renderer/src/rows.test.ts`

**Interfaces:**
- Produces:
  - `AgentRow.quietSince: number | null`.
  - `QUIET_MS = 15 * 60 * 1000`, `type CalmMemo = Map<string, number>`(agentKey → 조건이 이어진 첫 시각).
  - `trackQuiet(agents: AgentRow[], previous: CalmMemo, now: number): { agents: AgentRow[]; memo: CalmMemo }` — 조건 = `stateSource === 'hook' && state === 'working' && cpuPercent != null && cpuPercent < WORKING_CPU_PERCENT`. 조건이 맞으면 `calm = previous.get(key) ?? now`, `start = max(calm, lastActiveAt ?? calm)`, `now - start >= QUIET_MS` 면 `quietSince = start`. 조건이 아니면 memo 에서 빼고 null.
  - `restate()` 는 새 이벤트가 온 에이전트(`lastActiveAt > quietSince`)의 `quietSince` 를 null 로.
  - 화면: 상태 칸 배지 `조용함`(주황), 풍선말 `${n}분째 이벤트가 없고 CPU 를 거의 쓰지 않아요`. 상세 패널 설명 `text.ui.agent.quietNote` = `작업 중인데 한동안 이벤트가 없고 CPU 도 거의 쓰지 않아요. 오래 걸리는 명령을 기다리는 중일 수도, 멈춘 것일 수도 있어요.`

- [ ] **Step 1: 실패하는 테스트** (`activity.test.ts`)
  - `test('훅으로 작업 중이고 CPU 가 낮은 채 15분이면 조용함')`; `test('그 사이 CPU 를 쓰면 처음부터')`; `test('그 사이 이벤트가 오면 그 시각부터 다시 센다')`; `test('CPU 추정·세션 기록 상태, 쉬는 중·권한 대기에는 붙지 않는다')`; `test('CPU 를 모르면(null) 붙지 않는다')`.
- [ ] **Step 2–4:** 실패 확인 → 구현 → `npm run typecheck && npm run lint && npm test`
- [ ] **Step 5: 커밋** — `feat: 작업 중인데 조용한 에이전트를 표시한다`

### Task 10: 알림과 트레이 아이콘 점 (G3d·G3e)

**Files:**
- Modify: `src/shared/settings.ts`, `src/main/notifier.ts`, `src/main/tray.ts`, `src/main/pixelArt.ts`, `src/main/index.ts`, `components/SettingsView.vue`, `src/shared/text.ts`
- Test: `src/main/notifier.test.ts`, `src/main/tray.test.ts`, `src/main/pixelArt.test.ts`, `src/shared/settings.test.ts`

**Interfaces:**
- Consumes: `AgentRow.activity`(Task 8), `quietSince`(Task 9).
- Produces:
  - `NotifySettings` 에 `agentQuiet: boolean`, `agentGone: boolean`(기본 true). `Settings.waitingReminderMinutes: number`(0~120, 기본 10).
  - `createNotifier` deps 에 `reminderMs: () => number`. `Notice` 에 `focusAgentKey?: string`(Task 12 이 쓴다 — 에이전트 하나에 대한 알림이면 그 선택 키).
  - 권한 대기 본문: `activity.waiting?.tool` 이 있으면 `${폴더 · 브랜치} — ${도구 이름}`. **명령·프롬프트 요약은 알림에 넣지 않는다**(OS 알림 센터가 디스크에 남긴다).
  - 다시 알림: 계속 권한 대기이고 마지막으로 알린 뒤 `reminderMs`(> 0)가 지났으면 `text.notify.waitingStillTitle(tool, duration)` = `${tool} 가 ${duration}째 권한을 기다려요`.
  - 조용함: `quietSince` 가 null → 값이 될 때 한 번. `text.notify.quietTitle(folder, tool)` = `${folder} 의 ${tool} 가 조용해요`, 본문 `text.notify.quietBody(duration)` = `${duration}째 이벤트가 없어요. 멈췄는지 확인해 보세요.`
  - 꺼짐: 지난 스냅샷에 정확한 상태(`stateSource !== 'cpu'`)로 `working`·`waiting` 이던 에이전트가 이번에 없으면 `text.notify.goneTitle(folder, tool)` = `${folder} 의 ${tool} 가 꺼졌어요`, 본문 `작업 중이었어요.` / `권한을 기다리던 중이었어요.`
  - 모두 첫 스냅샷은 기준선, 창이 앞에 있으면 보내지 않음, stale 스냅샷은 건너뜀(지금 규칙).
  - `trayBadge(s: DashboardSnapshot | null): boolean` — `state === 'waiting'` 이거나 `quietSince != null` 인 에이전트가 있음. `makeIcon(level, badge)`; `renderSmallIcon(color, size, dot?: string)` 은 오른쪽 위에 주황(`#fab387`) 점(16px 에서 지름 5px, 테두리 1px 어두운 색). `trayTooltip` 은 권한 대기가 있으면 ` · 권한 대기 ${n}` 을 붙인다.
  - 설정 > 알림에 조용함·꺼짐 체크, "권한 대기 다시 알림(분, 0 이면 끔)".

- [ ] **Step 1: 실패하는 테스트**
  - `notifier.test.ts`: `test('권한 대기 본문에 도구 이름은 있고 명령 요약은 없다')`; `test('10분 넘게 계속 기다리면 다시 알리고, 0 이면 다시 알리지 않는다')`; `test('조용함은 생길 때 한 번')`; `test('작업 중이던 에이전트가 사라지면 꺼짐 알림, CPU 추정이던 것은 알리지 않는다')`; `test('쉬는 중이던 에이전트가 사라지면 알리지 않는다')`.
  - `tray.test.ts`: `test('권한 대기가 있으면 점이 있는 아이콘, 없어지면 점 없는 아이콘')`, `test('풍선말에 권한 대기 수')`.
  - `pixelArt.test.ts`: `test('점을 주면 오른쪽 위 픽셀이 주황')`.
- [ ] **Step 2–4:** 실패 확인 → 구현 → `npm run typecheck && npm run lint && npm test`
- [ ] **Step 5: 커밋** — `feat: 권한 대기 다시 알림·조용함·꺼짐 알림, 트레이 아이콘에 대기 점`

### Task 11: 바로 가기 — 경로 복사·폴더 열기·터미널 열기 (G3f)

**Files:**
- Create: `src/main/quickActions.ts`, `src/main/quickActions.test.ts`
- Modify: `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/index.ts`, `components/ItemSheet.vue`, `App.vue`, `src/shared/text.ts`
- Test: `src/main/quickActions.test.ts`, `components/ItemSheet.test.ts`, `src/renderer/src/App.test.ts`

**Interfaces:**
- Produces:
  - `type QuickKind = 'copy' | 'folder' | 'terminal'`
  - `knownPaths(s: DashboardSnapshot | null): string[]` — 서버(숨긴 것 포함)·에이전트·남은 프로세스·무거운 작업의 워크트리 루트와 작업 공간 루트, 디스크 행의 `worktreeRoot`.
  - `createQuickActions(deps: { latest: () => DashboardSnapshot | null; platform: Platform; openPath: (p: string) => Promise<string>; writeClipboard: (text: string) => void; spawn: (command: string, args: string[], options: { cwd?: string; detached: true; stdio: 'ignore' }) => { on(event: 'error', cb: () => void): void; unref(): void } }): { run(kind: QuickKind, path: string): Promise<boolean> }` — `path` 가 `knownPaths` 에 없으면(대소문자·끝 구분자 무시, `worktreeKey`) false 를 돌려주고 아무것도 하지 않는다.
  - 터미널: Windows 는 `wt.exe -d <path>` 를 먼저 띄우고 `error` 가 나면 `cmd.exe`(인자 없음, `cwd: path`, `detached`)로. macOS 는 `/usr/bin/open -a Terminal <path>`. 셸 문자열을 만들지 않는다(인자 배열만).
  - IPC `IPC.quick = 'pitwall:quick'`, `PitwallApi.quick(kind: QuickKind, path: string): Promise<boolean>`(본 창에서만).
  - 화면: 상세 패널의 동작 줄에 `경로 복사`·`폴더 열기`·`터미널 열기`(워크트리를 아는 항목만). 실패하면 한 줄 알림 `text.ui.quick.failed` = `열지 못했어요. 폴더가 없어졌을 수 있어요.`, 복사하면 `경로를 복사했어요.`

- [ ] **Step 1: 실패하는 테스트** (`quickActions.test.ts`)
  - `test('스냅샷에 없는 경로는 열지 않는다')`; `test('대소문자·끝 구분자가 달라도 같은 경로로 본다')`; `test('Windows 는 wt.exe -d 경로, 없으면 cmd 를 그 폴더에서')`; `test('macOS 는 open -a Terminal 경로')`; `test('복사는 스냅샷의 경로 그대로')`.
- [ ] **Step 2–4:** 실패 확인 → 구현 → `npm run typecheck && npm run lint && npm test`
- [ ] **Step 5: 커밋** — `feat: 상세 패널에서 경로 복사·폴더 열기·터미널 열기`

### Task 12: 창으로 가기 (G3f)

**Files:**
- Create: `src/main/focusWindow.ts`, `src/main/focusWindow.test.ts`
- Modify: `src/shared/types.ts`, `src/shared/settings.ts`, `src/main/agents.ts`, `src/main/collect/windows.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/index.ts`, `components/ItemSheet.vue`, `components/SettingsView.vue`, `src/shared/text.ts`
- Test: `src/main/focusWindow.test.ts`, `src/main/agents.test.ts`, `src/main/collect/windows.test.ts`

**Interfaces:**
- Produces:
  - `AgentRow.host: { pids: number[]; app: string | null }` — `pids` = 에이전트의 조상 pid(가까운 순, 최대 12), `app` = 조상 가운데 명령줄이 `…/<이름>.app/Contents/MacOS/…` 인 첫 것의 `.app` 경로(없으면 null).
  - C# `PitwallWindow.Find(int[] pids)` → 주어진 순서에서 보이는(`IsWindowVisible`), 소유자 없는(`GetWindow(h, GW_OWNER) == 0`), 제목이 있는 최상위 창을 가진 첫 pid 의 `{ Pid, Hwnd(long), Title }`(없으면 null). `PitwallWindow.Focus(long hwnd)` → 최소화돼 있으면 `ShowWindow(h, 9)`, `SetForegroundWindow(h)`, 그 뒤 `GetForegroundWindow() == h` 를 돌려준다.
  - `focusScript(helperDllPath: string | null, pids: number[], mode: 'find' | 'focus'): string` — 보조 코드를 불러(지금 수집 스크립트와 같은 방법) `{ pid, title, focused }` JSON 한 줄을 낸다. `pids` 는 숫자만 받는다.
  - `createFocuser(deps: { platform: Platform; latest: () => DashboardSnapshot | null; run: Runner; helperDllPath: () => string | null }): { focusAgent(key: string): Promise<boolean>; findHost(key: string): Promise<{ pid: number; title: string } | null> }` — 키가 지금 스냅샷의 에이전트가 아니면 false. macOS 는 `host.app` 이 있으면 `/usr/bin/open <app>` 의 종료 코드 0 이 true.
  - IPC `IPC.focusAgent = 'pitwall:focus-agent'`, `PitwallApi.focusAgent(key: string): Promise<boolean>`.
  - `Settings.notifyClickFocus: boolean`(기본 true). 알림을 누르면 `notice.focusAgentKey` 가 있고 설정이 켜져 있으면 `focusAgent` 를 해 보고, false 면 지금처럼 pitwall 을 연다.
  - 화면: 에이전트 상세 패널 동작 줄 맨 앞에 `창으로 가기`. 실패 알림 `text.ui.quick.focusFailed` = `그 에이전트의 창을 찾지 못했어요.`
- **개발 중 확인은 `findHost` 까지만**(읽기 전용). `focusAgent` 를 실제 창에 실행하지 않는다 — 사용자의 화면을 훔친다.

- [ ] **Step 1: 실패하는 테스트**
  - `agents.test.ts`: `test('host.pids 는 가까운 조상부터 최대 12개')`, `test('host.app 은 .app 번들 조상의 경로')`.
  - `focusWindow.test.ts`: `test('스크립트는 pid 를 숫자로만 넣고 find 에서는 Focus 를 부르지 않는다')`; `test('스냅샷에 없는 키는 실행하지 않고 false')`; `test('찾은 창이 앞으로 오지 않았으면 false')`; `test('macOS 는 host.app 을 open 으로, 없으면 false')`.
  - `windows.test.ts`(실제 Windows): `test('find 는 이 테스트 프로세스의 조상 가운데 창을 가진 프로세스를 찾거나 null 을 돌려주고 예외를 내지 않는다')`.
- [ ] **Step 2–4:** 실패 확인 → 구현 → `npm run typecheck && npm run lint && npm test`
- [ ] **Step 5: 커밋** — `feat: 에이전트의 터미널 창으로 가기(알림을 눌러도)`

### Task 13: 기록 — 일어난 일을 기억한다 (G3g, 메인)

**Files:**
- Create: `src/shared/events.ts`, `src/main/events.ts`, `src/main/events.test.ts`
- Modify: `src/shared/types.ts`(`KillResult.freed?`), `src/main/kill.ts`, `src/main/disk.ts`, `src/main/historyStore.ts`, `src/main/index.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`
- Test: `src/main/events.test.ts`, `src/main/historyStore.test.ts`, `src/main/kill.test.ts`

**Interfaces:**
- Produces:
  - ```ts
    export type PitEventKind =
      | 'agent-start' | 'agent-end' | 'agent-done' | 'agent-waiting' | 'agent-error' | 'agent-quiet'
      | 'server-start' | 'server-end' | 'heavy-start' | 'heavy-end'
      | 'memory-level' | 'cleanup' | 'disk-remove' | 'heavy-defer'
    export interface PitEvent {
      id: number; t: number; kind: PitEventKind
      tool?: AgentTool
      /** 폴더 이름 · 브랜치(worktreeLabel). */
      where?: string
      /** 포트 목록·무거운 작업 이름·지운 폴더 이름. */
      label?: string
      /** 그 항목이 아직 있으면 고를 수 있는 선택 키. */
      key?: string
      ms?: number; bytes?: number; count?: number; percent?: number
      level?: MemoryLevel
      /** agent-end: 작업 중·권한 대기이던 것이 꺼짐. */
      abnormal?: boolean
    }
    ```
  - `diffEvents(prev: DashboardSnapshot | null, next: DashboardSnapshot, peaks: Map<string, number>): Omit<PitEvent, 'id'>[]` — `prev` 가 null 이거나 둘 중 하나가 stale 이면 빈 목록. 에이전트(키 `agentKey`): 새로 보임 `agent-start`, 사라짐 `agent-end`(`abnormal` = 정확한 상태로 working·waiting 이었음). 정확한 상태(`stateSource !== 'cpu'`)의 변화만: working → idle 이고 일한 시간 ≥ 2분이면 `agent-done`(`ms`), → waiting `agent-waiting`, → error `agent-error`. `quietSince` null → 값 `agent-quiet`. 서버(보이는 것, 키 `selectionKey.server`): `server-start`·`server-end`(`label` = 포트 목록). 무거운 작업(키 `heavy:pid:startedAt`): `heavy-start`, `heavy-end`(`ms` = 시작부터, `bytes` = `peaks` 의 최대 `commitBytes ?? memoryBytes`). `memory.level` 이 바뀌면 `memory-level`(`level`·`percent` = RAM %). `peaks` 는 이 함수가 갱신한다.
  - `createEventLog(o: { max?: number; keepMs?: number; onAdded?: (events: PitEvent[]) => void }): { add(events: Omit<PitEvent,'id'>[]): void; list(): PitEvent[]; export(): PitEvent[]; import(data: unknown, now: number): void }` — 기본 300개·24시간. `import` 는 모양이 맞는 것만, 24시간이 지난 것은 버리고, id 는 이어서 센다.
  - `KillResult.freed?: { count: number; memoryBytes: number; commitBytes: number | null }`(하나 끄기·한꺼번에 끄기·작업 공간 정리·디스크 지우기 성공 때). `index.ts` 의 IPC 처리기가 `cleanup`·`disk-remove` 기록을 더한다.
  - `HistoryFile.events?: PitEvent[]`(없으면 빈 목록).
  - `selectionKey.heavy(row: Pick<HeavyJobRow, 'pid' | 'startedAt'>) => 'heavy:<pid>:<startedAt>'` 를 `src/shared/keys.ts` 에 더하고, 화면이 따로 만들던 무거운 작업 키를 이것으로 바꾼다.
  - IPC `IPC.eventsGet = 'pitwall:events-get'`, `IPC.eventsAdded = 'pitwall:events-added'`; `PitwallApi.events: { get(): Promise<PitEvent[]>; onAdded(cb: (events: PitEvent[]) => void): () => void }`.
- 기록에는 프롬프트·명령·제목을 담지 않는다.

- [ ] **Step 1: 실패하는 테스트** (`events.test.ts`)
  - `test('첫 스냅샷은 기준선이라 기록이 없다')`; `test('에이전트가 사라지면 agent-end, 작업 중이었으면 abnormal')`; `test('2분 넘게 일하고 끝나면 agent-done 에 걸린 시간, 짧으면 없다')`; `test('CPU 추정 상태의 변화는 적지 않는다')`; `test('무거운 작업이 끝나면 걸린 시간과 그동안의 최대 메모리')`; `test('메모리 단계가 바뀌면 memory-level')`; `test('stale 스냅샷으로는 사라졌다고 보지 않는다')`; `test('기록은 300개까지, 24시간이 지나면 버린다')`; `test('기록 한 줄에 activity(제목·프롬프트·명령)가 들어가지 않는다')` — `JSON.stringify(events)` 에 표본의 프롬프트 글자가 없다.
- [ ] **Step 2–4:** 실패 확인 → 구현 → `npm run typecheck && npm test`
- [ ] **Step 5: 커밋** — `feat: 일어난 일을 기록한다(에이전트·서버·무거운 작업·메모리·정리)`

### Task 14: 기록 탭과 "자리 비운 사이" (G3g, 화면)

**Files:**
- Create: `src/renderer/src/events.ts`, `src/renderer/src/events.test.ts`
- Modify: `src/renderer/src/rows.ts`(`TabKey` 에 `events`), `components/ToolBar.vue`, `App.vue`, `src/shared/text.ts`
- Test: `src/renderer/src/events.test.ts`, `src/renderer/src/App.test.ts`, `components/ToolBar.test.ts`

**Interfaces:**
- Consumes: Task 13 의 `PitEvent`, `PitwallApi.events`.
- Produces:
  - `eventsTable(events: PitEvent[], s: DashboardSnapshot): Table` — 칸: 시각(`오전 9:10`, 오늘이 아니면 날짜도) · 종류 · 대상(`where ?? label`) · 내용. 최신 순. `key` 는 그 선택 키가 지금 스냅샷에 있을 때만(누르면 상세 패널).
  - `eventText(e: PitEvent): { kind: string; detail: string }` — 문구는 `text.ui.events`: `agent-done` → `작업 끝남` / `${duration} 동안 일했어요`, `agent-end` → `꺼짐` / (`abnormal` 이면 `작업 중이었어요`), `heavy-end` → `무거운 작업 끝` / `${duration} · 최대 ${bytes}`, `memory-level` → `메모리 ${단계}` / `RAM ${percent}%`, `cleanup` → `정리` / `${count}개를 껐어요 · ${formatFreed}`, `heavy-defer` → `에이전트를 기다리게 함` / `${label}`.
  - `awaySummary(events: PitEvent[], ram: TrendPoint[], since: number, now: number): { minutes: number; done: number; waiting: number; gone: number; quiet: number; maxRam: number | null } | null` — `since` 뒤의 기록에서 세고, 넷이 모두 0 이면 null. `gone` 은 `abnormal` 인 `agent-end` 만.
  - `App.vue`: `document.visibilityState` 가 hidden 이 된 시각을 기억했다가 다시 보일 때 10분(`AWAY_MS`) 이상이면 `awaySummary` 로 닫을 수 있는 카드를 띄운다. 문구 `text.ui.away.summary` = `${minutes}분 동안: ` + 0 이 아닌 것만 ` · ` 로(`작업 끝남 2`, `권한 대기 1`, `꺼진 에이전트 1`, `조용함 1`, `RAM 최고 96%`). 버튼 `기록 보기`(기록 탭으로).
  - 탭 순서의 맨 끝에 `기록`. 탭 숫자는 기록 수.

- [ ] **Step 1: 실패하는 테스트**
  - `events.test.ts`: `test('최신 순, 지금 없는 항목은 고를 수 없다')`; `test('자리 비운 사이: since 뒤의 것만 세고, 셀 것이 없으면 null')`; `test('꺼진 에이전트는 작업 중이던 것만 센다')`.
  - `App.test.ts`: `test('10분 넘게 숨겼다가 다시 보면 자리 비운 사이 카드, 기록 보기로 기록 탭')`; `test('10분이 안 됐으면 카드가 없다')`.
- [ ] **Step 2–4:** 실패 확인 → 구현 → `npm run typecheck && npm run lint && npm test`
- [ ] **Step 5: 커밋** — `feat(ui): 기록 탭과 자리 비운 사이 요약`

### Task 15: 작업 공간 합계와 커밋 안 한 변경 (G4, 메인)

**Files:**
- Create: `src/main/workspaces.ts`, `src/main/workspaces.test.ts`, `src/main/gitStatus.ts`, `src/main/gitStatus.test.ts`
- Modify: `src/shared/types.ts`, `src/shared/snapshot.ts`, `src/main/collector.ts`, `src/main/index.ts`, `src/renderer/src/testing/fixtures.ts`
- Test: 위 둘, `src/main/collector.test.ts`

**Interfaces:**
- Consumes: Task 5 의 `buildAgents().members`.
- Produces:
  - ```ts
    export interface WorkspaceRow {
      /** `ws:<worktreeKey(root)>`, 작업 공간을 모르는 것은 `ws:?`. */
      key: string
      root: string | null
      name: string
      outer: boolean
      /** 구성 프로세스(pid 마다 한 번)의 합. */
      memoryBytes: number
      commitBytes: number | null
      processCount: number
      agentKeys: string[]; serverKeys: string[]; heavyKeys: string[]; leftoverKeys: string[]
      /** 든 워크트리들의 커밋 안 한 변경 수 합. 하나도 모르면 null. */
      changedFiles: number | null
      /** 든 에이전트의 가장 늦은 lastActiveAt. */
      lastActiveAt: number | null
    }
    ```
    `DashboardSnapshot.workspaces: WorkspaceRow[]`(메모리 큰 순, `ws:?` 는 맨 끝). 숨긴 서버는 넣지 않는다.
  - `buildWorkspaces(input: { processes: ProcessInfo[]; servers: ServerRow[]; agents: AgentRow[]; heavyJobs: HeavyJobRow[]; leftovers: LeftoverRow[]; agentMembers: Map<string, number[]>; changed: (worktreeRoot: string) => number | null; unknownName: string }): WorkspaceRow[]` — 작업 공간 키별로 pid 집합을 합쳐(서버 `pid + descendantPids`, 무거운 작업·남은 프로세스도 같음, 에이전트는 `agentMembers`) 한 번씩 더한다.
  - `createChangeCounter(deps: { run: (root: string) => Promise<number | null>; now: () => number; ttlMs?: number; concurrency?: number }): { get(root: string): number | null; want(roots: string[]): void }` — `get` 은 기억한 값(없으면 null)을 바로 돌려주고 기다리지 않는다. `want` 는 5분(`ttlMs`)이 지났거나 처음 보는 루트를 뒤에서 한 번에 2개씩 다시 센다. 네트워크 경로(`\\`)는 세지 않는다.
  - `countChanges(root: string): Promise<number | null>` — `git -C <root> status --porcelain`(환경 `GIT_OPTIONAL_LOCKS=0`, 제한 10초)의 빈 줄이 아닌 줄 수. 실패하면 null.
  - `CollectorDeps.changedFiles?: { get(root: string): number | null; want(roots: string[]): void }`.

- [ ] **Step 1: 실패하는 테스트**
  - `workspaces.test.ts`: `test('에이전트 아래에서 도는 무거운 작업을 두 번 세지 않는다')` — 에이전트 멤버 pid 에 무거운 작업 pid 가 들어 있어도 합은 한 번; `test('작업 공간을 모르는 항목은 ws:? 한 줄, 맨 끝')`; `test('커밋은 하나도 모르면 null')`; `test('변경 수는 든 워크트리의 합, 하나도 모르면 null')`; `test('숨긴 서버는 넣지 않는다')`.
  - `gitStatus.test.ts`: `test('get 은 기다리지 않고 기억한 값을 준다')`; `test('5분 안에는 다시 세지 않는다')`; `test('한 번에 둘까지만 돈다')`; 임시 저장소로 `test('바꾼 파일·새 파일 수를 센다')`.
- [ ] **Step 2–4:** 실패 확인 → 구현 → `npm run typecheck && npm test`
- [ ] **Step 5: 커밋** — `feat: 작업 공간별 합계(프로세스마다 한 번)와 커밋 안 한 변경 수`

### Task 16: 작업 공간 탭 (G4, 화면)

**Files:**
- Modify: `src/renderer/src/rows.ts`, `components/ItemTable.vue`, `components/ToolBar.vue`, `App.vue`, `src/shared/text.ts`
- Test: `src/renderer/src/rows.test.ts`, `components/ItemTable.test.ts`, `src/renderer/src/App.test.ts`, `components/ToolBar.test.ts`

**Interfaces:**
- Consumes: Task 15 의 `WorkspaceRow`, Task 11 의 `quick`.
- Produces:
  - `TabKey` 에 `workspaces`(맨 앞, 처음 켰을 때 기본 탭). 탭 숫자 = 작업 공간 수.
  - 묶음 머리를 일반화: `interface GroupHead { key: string; root: string | null; name: string; outer: boolean; count: number; memoryBytes: number; commitBytes: number | null; agentBadges: { key: string; icon: RowIcon; title: string }[]; status: Cell; summary?: string; actions: ('rename' | 'cleanup' | 'folder')[] }`. 지금의 `ServerGroup` 은 이것의 별칭으로 두고 `serverCount` → `count`.
  - `workspaceTable(s: DashboardSnapshot): Table` — 구성원 한 줄씩. 칸: 이름(종류 아이콘 + 서버는 폴더 이름, 에이전트는 폴더 이름, 무거운 작업·남은 프로세스는 그 이름) · 종류(`서버`·`에이전트`·`무거운 작업`·`남은 프로세스`) · 상태(각 탭과 같은 문구) · 포트 · CPU · 메모리 · 커밋. 행의 `key`·동작은 각 탭과 같다.
  - `groupWorkspaces(rows: Row[], s: DashboardSnapshot, now: number): GroupedRows[]` — 모든 작업 공간이 머리를 갖는다(구성원이 하나여도). `summary` = `서버 3 · 무거운 작업 1 · 남은 프로세스 2 · 변경 12`(0 과 null 은 뺀다. 작업 중·권한 대기인 에이전트가 없고 `lastActiveAt` 을 알면 끝에 `마지막 활동 3시간 전`). `status` 는 에이전트가 권한 대기면 `권한 대기`(warn), 조용하면 `조용함`(warn), 작업 중이면 `작업 중`(running), 아니면 서버 요약(지금 `groupStatus`). `ws:?` 는 동작이 없다.
  - 작업 공간 탭에서 항목을 고르면 탭을 옮기지 않고 상세 패널만 연다(`select` 가 탭을 바꾸는 것은 다른 탭에서 온 이동일 때만).
  - 머리 동작: 이름 바꾸기·작업 공간 정리(지금 것)·폴더 열기(`quick('folder', root)`).
  - 접은 묶음은 지금처럼 화면이 기억한다. 정렬 기본은 메모리 큰 순.

- [ ] **Step 1: 실패하는 테스트**
  - `rows.test.ts`: `test('작업 공간 표: 에이전트·서버·무거운 작업·남은 프로세스가 한 표에, 머리의 합은 스냅샷의 workspaces 값')`; `test('머리 요약에서 0 과 모르는 값은 뺀다')`; `test('권한 대기 에이전트가 있으면 머리 상태가 권한 대기')`.
  - `App.test.ts`: `test('처음 탭은 작업 공간')`; `test('작업 공간 탭에서 서버를 누르면 탭은 그대로, 상세 패널이 열린다')`; `test('머리의 정리는 그 작업 공간 루트로 cleanupWorkspace 를 부른다')`. 기존 "처음 탭은 개발 서버"에 기대는 테스트는 탭을 먼저 고르게 고친다.
- [ ] **Step 2–4:** 실패 확인 → 구현 → `npm run typecheck && npm run lint && npm test`
- [ ] **Step 5: 커밋** — `feat(ui): 작업 공간 탭 — 한 작업의 에이전트·서버·빌드를 한 줄로`

### Task 17: 디스크 — 기억한 저장소 정리, 오래 안 쓴 워크트리 (G5a·G5d)

**Files:**
- Modify: `src/shared/types.ts`, `src/shared/settings.ts`, `src/main/disk.ts`, `src/main/git.ts`, `src/main/index.ts`, `src/renderer/src/rows.ts`, `components/StatsBar.vue`, `components/ItemSheet.vue`, `components/SettingsView.vue`, `src/shared/text.ts`
- Test: `src/main/disk.test.ts`, `src/main/git.test.ts`, `src/renderer/src/rows.test.ts`, `src/shared/settings.test.ts`

**Interfaces:**
- Produces:
  - `createRepoMemory(file, max = 200, opts?: { tempDir?: string })` — `add` 는 `tempDir`(기본 `os.tmpdir()`) 아래 경로를 받지 않는다. 새 `prune(exists: (dir: string) => Promise<boolean | null>): Promise<void>` — `false`(없음, ENOENT)인 것만 빼고 저장한다. `null`(모름)은 둔다. 시작할 때와 디스크를 찾을 때마다 부른다.
  - `DiskRow.evidence: 'upstreamGone' | 'merged' | 'stale'`, `DiskRow.staleDays?: number`.
  - `lastTouched(wt: { path: string; head: string | null }, commonDir: string): Promise<number | null>` — 마지막 커밋 시각(`git --git-dir <commonDir> log -1 --format=%ct <head>`)과 그 워크트리 git 폴더의 `index` 파일 수정 시각 중 늦은 쪽(ms). 하나라도 모르면 null.
  - 규칙: 끝난 근거가 없는 연결된 워크트리(잠김·prunable 제외, **detached 포함**)에 대해 `staleWorktreeDays > 0` 이고 `now - lastTouched >= days` 면 `evidence: 'stale'`. 지우기 직전 확인(`checkRemovable`)도 stale 행은 같은 조건을 다시 본다(아니면 `text.disk.notStale` = `이 워크트리를 다시 쓰기 시작해 지우지 않았어요.`).
  - `Settings.staleWorktreeDays: number`(0~365, 기본 14).
  - 화면: 끝난 근거 칸 `오래 안 씀(21일)`, 상태는 사용 중이 아니면 `확인해볼 것`(warn). 디스크 카드 아래 줄 `끝난 워크트리 n곳 · 오래 안 쓴 m곳`. 상세 설명 `text.ui.disk.evidenceNote.stale` = `끝났다는 근거는 없지만 ${days}일 동안 커밋도 변경도 없었어요. 의존성 폴더만 지우고 워크트리와 소스는 그대로 둬요.` 설정 > 디스크 정리에 "오래 안 쓴 워크트리 기준(일, 0 이면 끔)".

- [ ] **Step 1: 실패하는 테스트**
  - `disk.test.ts`: `test('임시 폴더 아래 저장소는 기억하지 않는다')`; `test('없어진 저장소는 prune 으로 빠지고, 모르는 것은 남는다')`; 임시 저장소로 `test('14일 넘게 커밋·변경이 없는 워크트리는 오래 안 씀으로 뜬다, detached 도')`; `test('0 이면 오래 안 쓴 워크트리를 찾지 않는다')`; `test('오래 안 쓴 워크트리도 실행 중인 것이 있으면 지우지 않는다')`; `test('확인 창 사이에 다시 쓰기 시작하면 지우지 않는다')`.
  - `git.test.ts`: `test('lastTouched 는 커밋 시각과 index 수정 시각 중 늦은 쪽')`.
- [ ] **Step 2–4:** 실패 확인 → 구현 → `npm run typecheck && npm run lint && npm test`
- [ ] **Step 5: 커밋** — `feat(disk): 없어진 저장소는 잊고, 오래 안 쓴 워크트리도 확인해볼 것으로 보인다`

### Task 18: 다른 앱의 띄운 앱, 다른 포트 (G5b·G5c)

**Files:**
- Modify: `src/shared/types.ts`, `src/shared/snapshot.ts`, `src/main/snapshot.ts`, `src/renderer/src/rows.ts`, `App.vue`, `components/ItemTable.vue`(빈 화면의 권유), `components/MemorySheet.vue`, `src/shared/text.ts`, `src/renderer/src/testing/fixtures.ts`
- Test: `src/main/snapshot.test.ts`, `src/renderer/src/rows.test.ts`, `src/renderer/src/App.test.ts`

**Interfaces:**
- Produces:
  - `AppUsage.owner: string | null`. 런타임(`node`·`java`·`javaw`·`python*`·`pythonw`·`bun`·`deno`·`dotnet`·`ruby`·`php`)은 가장 가까운 조상(최대 8단계) 가운데 런타임·셸(`cmd`·`bash`·`sh`·`zsh`·`pwsh`·`powershell`·`conhost`·`OpenConsole`)이 아닌 것의 이름(`.exe` 뗌)을 `owner` 로, `(이름, owner)` 별로 묶는다. 화면 이름 `node (Cursor)`.
  - `interface OtherPort { port: number; pid: number; processName: string; memoryBytes: number; commitBytes: number | null; exePath: string | null }`, `DashboardSnapshot.otherPorts: OtherPort[]` — LISTEN·1024 이상·개발 서버(숨긴 것 포함)가 아님·pitwall 자신과 그 조상이 아님. `(port, pid)` 한 번, 포트 순, 300개까지.
  - `otherPortsTable(s): Table` — 칸: 포트 · 프로세스 · PID · 메모리 (· 커밋). 고를 수 없고 동작이 없다.
  - 개발 서버 탭 바닥에 `다른 포트 n개` 전환(숨긴 서버 전환과 같은 자리·모양, 둘 중 하나만 켜진다). 검색어가 포트 번호이고 개발 서버에 없는데 `otherPorts` 에 있으면 빈 화면에 `다른 포트에서 찾기` 버튼(누르면 검색어를 둔 채 다른 포트 보기로).

- [ ] **Step 1: 실패하는 테스트**
  - `snapshot.test.ts`: `test('런타임 프로세스는 띄운 앱별로 나뉜다(셸·런타임 조상은 건너뛴다)')`; `test('띄운 앱을 모르면 owner null 로 지금처럼 묶인다')`; `test('개발 서버가 아닌 LISTEN 포트는 otherPorts 에, 개발 서버·pitwall 자신의 포트는 없다')`; `test('1024 미만은 넣지 않는다')`.
  - `rows.test.ts`: `test('다른 앱 이름은 node (Cursor)')`, `test('다른 포트 표는 고를 수 없다')`.
  - `App.test.ts`: `test('찾는 포트가 개발 서버에 없고 다른 포트에 있으면 다른 포트에서 찾기를 권한다')`.
- [ ] **Step 2–4:** 실패 확인 → 구현 → `npm run typecheck && npm run lint && npm test`
- [ ] **Step 5: 커밋** — `feat: 다른 앱의 런타임을 띄운 앱별로, 개발 서버가 아닌 포트도 찾는다`

### Task 19: 토큰·한도 읽기 (G6, 메인)

**Files:**
- Create: `src/main/claudeUsage.ts`, `src/main/claudeUsage.test.ts`
- Modify: `src/shared/types.ts`, `src/shared/settings.ts`, `src/shared/snapshot.ts`, `src/main/codexRollout.ts`, `src/main/sessions.ts`(Claude 세션도 `transcriptPath`), `src/main/collector.ts`, `src/main/index.ts`, `src/renderer/src/testing/fixtures.ts`
- Test: `src/main/claudeUsage.test.ts`, `src/main/codexRollout.test.ts`, `src/main/collector.test.ts`, `src/main/sessions.test.ts`

**Interfaces:**
- Produces:
  - `interface AgentUsage { contextTokens: number | null; contextWindow: number | null; outputTokens: number | null; totalTokens: number | null; model: string | null }`, `AgentRow.usage: AgentUsage | null`.
  - `interface LimitWindow { usedPercent: number; windowMinutes: number; resetsAt: number | null }`, `interface CodexLimits { primary: LimitWindow | null; secondary: LimitWindow | null; planType: string | null; at: number }`, `DashboardSnapshot.codexLimits: CodexLimits | null`(지금 도는 Codex 가운데 가장 최근 값, 없으면 null). `resetsAt` 은 ms.
  - `createClaudeUsageReader(o: { projectsDir: string; maxFullBytes?: number; tailBytes?: number }): { usageFor(transcriptPath: string): Promise<AgentUsage | null> }` — `.jsonl` 이고 실제 경로가 `projectsDir` 안일 때만 연다. 덧붙은 만큼만 읽는다(파일이 줄면 처음부터). 줄에 `"usage"` 가 있을 때만 JSON 으로 읽고, `type === 'assistant'` 이고 `message.usage` 가 객체일 때만 쓴다. `outputTokens` = `message.id` 별 마지막 `output_tokens` 의 합, `contextTokens` = `isSidechain` 이 아닌 마지막 줄의 `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`, `model` = 그 줄의 `message.model`. `contextWindow`·`totalTokens` 는 null. 파일이 `maxFullBytes`(기본 64 MB)보다 크면 끝 `tailBytes`(16 MB)만 읽고 `outputTokens` 는 null. 숫자가 아닌 값은 0 이 아니라 "없음"으로 본다. 읽을 수 없으면 null.
  - Codex: `createCodexReader(home, o?: { usage?: () => boolean })`, 새 메서드 `infoFor(agent, now): Promise<{ state: RolloutState | null; usage: AgentUsage | null; limits: CodexLimits | null }>`(`stateFor` 는 그대로). `token_count` 이벤트의 `info.total_token_usage.total_tokens`·`output_tokens`, `info.last_token_usage.total_tokens`(컨텍스트), `info.model_context_window`, `rate_limits.primary`·`secondary`(`used_percent`·`window_minutes`·`resets_at` 초 → ms)·`plan_type`. `usage()` 가 false 면 `token_count` 줄을 읽지 않는다.
  - `Settings.readUsage: boolean`(기본 true). `CollectorDeps.claudeUsage?: (transcriptPath: string) => Promise<AgentUsage | null>`, `codexInfo?`(지금 `codexState` 를 대신).
  - Claude 는 그 프로세스와 짝지은 세션(Task 5)의 `transcriptPath` 로만 읽는다(짝이 없으면 null).

- [ ] **Step 1: 실패하는 테스트**
  - `claudeUsage.test.ts`: `test('같은 message.id 는 마지막 값 하나로 출력 합을 센다')`; `test('컨텍스트는 사이드체인이 아닌 마지막 요청의 입력 + 캐시')`; `test('덧붙은 줄만 더 읽는다')`; `test('projectsDir 밖의 경로·.jsonl 이 아닌 경로는 열지 않는다')`; `test('usage 가 없거나 모양이 다르면 null(지어내지 않음)')`; `test('64 MB 보다 크면 끝만 읽고 출력 합은 null')`(작은 한도로 시험); `test('결과에 대화 내용이 남지 않는다')`.
  - `codexRollout.test.ts`: `test('token_count 에서 합계·컨텍스트·한도를 읽는다')`(실제 모양의 표본: `primary.used_percent 14, window_minutes 300, resets_at 1794227066`); `test('usage 를 끄면 token_count 를 읽지 않는다')`.
  - `collector.test.ts`: `test('짝지은 세션이 있는 Claude 만 usage 를 갖는다')`, `test('codexLimits 는 가장 최근 값')`.
- [ ] **Step 2–4:** 실패 확인 → 구현 → `npm run typecheck && npm test`
- [ ] **Step 5: 커밋** — `feat: 세션 기록에서 토큰 숫자와 Codex 사용 한도를 읽는다`

### Task 20: 토큰 화면 (G6)

**Files:**
- Modify: `src/shared/format.ts`, `src/renderer/src/rows.ts`, `components/ItemSheet.vue`, `components/StatsBar.vue`, `components/SettingsView.vue`, `src/shared/text.ts`
- Test: `src/shared/format.test.ts`, `src/renderer/src/rows.test.ts`, `components/ItemSheet.test.ts`, `components/StatsBar.test.ts`

**Interfaces:**
- Consumes: Task 19 의 `AgentRow.usage`, `DashboardSnapshot.codexLimits`.
- Produces:
  - `formatTokens(n: number): string` — `850`, `12.3k`, `132k`(100k 이상은 소수 없음), `1.2M`.
  - 에이전트 표 "컨텍스트" 칸(오른쪽 정렬, 너비 110, CPU 칸 앞): `132k`, 한도를 알면 `132k / 258k`. 모든 행이 null 이면 칸을 뺀다.
  - 상세 패널 카드 "토큰": 큰 값 컨텍스트, 보조 줄 `출력 합 48.2k · claude-…`(아는 것만).
  - 에이전트 카드에 `codexLimits` 가 있으면 한 줄 `Codex 한도 5시간 14% · 주간 31%`(풍선말에 초기화 시각).
  - 설정 > 에이전트 연동에 체크 "토큰 사용량 보기"와 도움말 `text.ui.settings.readUsageHelp` = `세션 기록 파일에서 토큰 숫자만 읽어요. 대화 내용은 남기지 않아요. Claude 의 사용 한도는 보여 주지 않아요(상태 줄 설정을 건드려야 해서요).`

- [ ] **Step 1: 실패하는 테스트** — `format.test.ts`: `formatTokens(850) === '850'`, `(12345) === '12.3k'`, `(132000) === '132k'`, `(1234567) === '1.2M'`. `rows.test.ts`: `test('컨텍스트 칸은 아는 행이 있을 때만')`. `StatsBar.test.ts`: `test('Codex 한도 줄')`.
- [ ] **Step 2–4:** 실패 확인 → 구현 → `npm run typecheck && npm run lint && npm test`
- [ ] **Step 5: 커밋** — `feat(ui): 에이전트의 컨텍스트·토큰과 Codex 한도`

### Task 21: 무거운 작업이 겹치면 에이전트가 기다리게 하기 (G7)

**Files:**
- Create: `src/main/heavyGuard.ts`, `src/main/heavyGuard.test.ts`
- Modify: `src/shared/settings.ts`, `src/main/hookServer.ts`, `src/main/hookHub.ts`, `src/main/claudeHooks.ts`, `src/main/claudeIntegration.ts`, `src/main/codexHooks.ts`(바뀐 규격에 맞춤), `src/main/index.ts`, `components/SettingsView.vue`, `src/shared/text.ts`
- Test: `src/main/heavyGuard.test.ts`, `src/main/hookServer.test.ts`, `src/main/claudeHooks.test.ts`, `src/main/claudeIntegration.test.ts`

**Interfaces:**
- Consumes: `heavyMatch`(`src/main/heavy.ts`), Task 13 의 기록(`heavy-defer`).
- Produces:
  - `splitShell(command: string): string[]` — 따옴표 밖의 `&&`·`||`·`;`·`|`·줄바꿈으로 나눈다.
  - `type GuardVerdict = { kind: 'none' } | { kind: 'defer'; pattern: string; reason: string } | { kind: 'note'; pattern: string; note: string }`
  - `commandSegments(command: string, cwd: string | null, readScripts: (dir: string) => Record<string, string> | null): string[]` — `splitShell` 로 나눈 조각에, 패키지 스크립트 실행이면 그 스크립트 본문 조각을 **한 단계만** 더한다: `npm run|run-script <s>`·`npm test`·`npm start`, `pnpm|yarn|bun run <s>`, `pnpm|yarn|bun <s>`(그 이름이 scripts 에 있을 때). 스크립트는 `cwd`(맨 앞 조각이 `cd <dir>` 이면 그 폴더 — 상대 경로는 `cwd` 기준)의 `package.json` `scripts` 에서 찾는다. `cwd` 를 모르거나 파일이 없으면 더하지 않는다.
  - `readPackageScripts(dir: string): Record<string, string> | null` — `<dir>/package.json`(1 MB 이하)의 `scripts` 가운데 문자열 값만. 다른 값은 읽어 두지 않는다.
  - `createHeavyGuard(o?: { windowMs?: number; maxDefers?: number; readScripts?: (dir: string) => Record<string, string> | null }): { decide(input: { event: Record<string, unknown>; snapshot: DashboardSnapshot | null; patterns: string[]; now: number; maxAgeMs: number }): GuardVerdict }` — 기본 10분·2번. 끼어드는 조건(모두): `hook_event_name === 'PreToolUse'`, `tool_name` 이 `Bash` 또는 `PowerShell`, `tool_input.command` 가 문자열이고 조각(`commandSegments`) 가운데 하나가 `heavyMatch` 에 맞음, 스냅샷이 있고 stale 이 아니고 `now - takenAt <= maxAgeMs`, `snapshot.heavyJobs.length >= 1`, `snapshot.memory.level !== 'normal'`. 같은 `(session_id, pattern)` 을 `windowMs` 안에 `maxDefers` 번 거절했으면 `note`, 아니면 `defer`. 조건이 아니면 `none`.
  - `guardResponse(v: GuardVerdict): string | null` — `defer`: `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":<reason>}}`, `note`: `{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":<note>}}`, `none`: null.
  - 문구: `text.guard.defer(running, percent)` = `pitwall: 지금 다른 무거운 작업(${running})이 돌고 있고 메모리 사용률이 ${percent}% 예요. 이 명령은 지금 실행하지 말고 1분쯤 뒤에 같은 명령을 다시 실행해 주세요. 그동안 다른 일을 먼저 해도 돼요. 검사를 건너뛰지는 마세요.` / `text.guard.note(running, percent)` = `pitwall 참고: 다른 무거운 작업(${running})과 겹쳐 실행됐고 메모리 사용률이 ${percent}% 예요.`
  - `hookServer`: 경로 `GUARD_PATH = '/pitwall-hook/claude/guard'`, 옵션 `onGuard?: (event) => string | null`. 본문이 있으면 200 + `Content-Type: application/json`, 없으면 204. 토큰·Origin 검사는 같다.
  - 훅 규격: `interface HookItem { event: string; entry: ClaudeHookEntry; matcher?: string }`. `addPitwallHooks(text, items, spec)`·`inspectPitwallHooks(text, items, spec)`·`installPitwallHooks({ dir, items, now, spec })` 로 바꾼다(`spec.events` 는 지운다 — pitwall 훅인지는 지금처럼 주소로 안다). `on` = 모든 항목이 그 이벤트에 정확히 하나씩 있고 다른 pitwall 훅이 없음. `ClaudeHookEntry.async?: true`.
  - `guardCommand(platform, port, token, systemRoot?): ClaudeHookEntry` — `hookCommand` 와 같되 주소가 `GUARD_PATH`, 출력을 버리지 않고(`-o` 없음) `--connect-timeout 0.3 -m 2`, `timeout: 3`, `async` 없음. 항목은 `{ event: 'PreToolUse', matcher: 'Bash|PowerShell', entry }`.
  - `ClaudeIntegrationDeps.guard: () => boolean`. 항목 목록 = 알림 훅들 + (guard 면) 질문 훅.
  - `Settings.heavyGuard: boolean`(기본 false). 저장할 때 값이 바뀌었고 Claude 연동이 `on`·`partial` 이면 `claude.enable()`(확인 창)로 다시 설치하고, 사용자가 취소하면 설정을 이전 값으로 되돌린다. 연동이 꺼져 있으면 값만 저장한다.
  - 설정 > 무거운 작업에 체크 "겹치면 에이전트가 기다리게 하기(Claude Code)"와 도움말 `text.ui.settings.heavyGuardHelp` = `켜면 Claude 가 Bash 명령을 실행하기 전에 pitwall 에 물어봐요. 무거운 작업이 이미 돌고 있고 메모리가 경고 기준을 넘었을 때만, 같은 명령을 두 번까지 1분 뒤로 미루게 해요. Claude 설정 파일에 훅을 하나 더 넣어요(확인 창·백업). pitwall 이 꺼져 있으면 아무 일도 없어요.`
  - `index.ts` 는 `defer` 때 기록에 `heavy-defer`(`where` = 그 이벤트 `cwd` 의 폴더 이름, `label` = 패턴)를 더한다. 명령 글자는 기록하지 않는다.
- Codex 훅은 건드리지 않는다(알림 훅만).

- [ ] **Step 1: 실패하는 테스트** (`heavyGuard.test.ts`)
  - `test('무거운 작업이 돌고 있고 메모리가 경고면 미루게 한다')`; `test('메모리가 정상이면 끼어들지 않는다')`; `test('도는 무거운 작업이 없으면 끼어들지 않는다')`; `test('스냅샷이 없거나 stale 이거나 오래됐으면 끼어들지 않는다')`; `test('cd shop-web && npx vue-tsc --noEmit 도 알아본다')`; `test('git commit -m "fix tsc" 는 무거운 명령이 아니다')`; `test('같은 세션·패턴은 두 번까지 거절하고 세 번째는 참고 문구만')`; `test('10분이 지나면 다시 센다')`; `test('Bash·PowerShell 이 아니거나 command 가 문자열이 아니면 none')`; `test('npm run typecheck 는 그 폴더 package.json 의 스크립트(vue-tsc --noEmit)로 알아본다')`; `test('cd web && pnpm build 는 web 폴더의 스크립트를 본다')`; `test('스크립트가 또 다른 스크립트를 부르면 한 단계까지만 본다')`; `test('package.json 이 없거나 깨졌으면 스크립트 없이 판단한다')`; `test('거절 응답은 permissionDecision deny, 참고 응답은 additionalContext')`.
  - `hookServer.test.ts`: `test('guard 경로는 답이 있으면 200 과 JSON, 없으면 204')`, `test('guard 경로도 토큰이 틀리면 403')`.
  - `claudeHooks.test.ts`: `test('guard 를 켜면 PreToolUse 에 matcher Bash|PowerShell 인 동기 훅이 하나 더')`, `test('끄면 pitwall 훅을 모두 뺀다(guard 포함)')`, `test('guard 설정과 파일이 다르면 partial')`, `test('질문 훅 명령은 연결 0.3초·전체 2초 제한이고 항상 종료 코드 0, 출력을 버리지 않는다')`.
- [ ] **Step 1b: 실제 시간 재기(Windows)** — 만든 질문 훅 명령을 Git Bash 로 다섯 번씩 실행해 걸린 시간의 가운데 값을 잰다: (가) 닫힌 포트(pitwall 꺼짐) (나) 204 를 답하는 임시 로컬 서버. 목표: (가) 600 ms 이하, (나) 300 ms 이하. 넘으면 DONE_WITH_CONCERNS 로 알리고 숫자를 보고서에 적는다(Task 22 가 `docs/measurements.md` 에 옮긴다).
- [ ] **Step 2–4:** 실패 확인 → 구현 → `npm run typecheck && npm run lint && npm test`
- [ ] **Step 5: 커밋** — `feat: 무거운 작업이 겹치고 메모리가 부족하면 에이전트가 미루게 한다(기본 끔)`

### Task 22: 문서와 부하 (R)

**Files:**
- Modify: `README.md`, `docs/measurements.md`, `docs/superpowers/specs/2026-11-10-pitwall-5-attention-memory-design.md`(상태), `docs/superpowers/specs/2026-11-06-pitwall-design.md`(§4 비목표에 "5단계에서 바뀜" 한 줄)

- [ ] **Step 1: README** — "무엇을 보여 주나요" 표에 커밋·작업 공간 탭·기록·토큰·바로 가기·오래 쉬는 세션·조용함을 반영. "무엇을 읽고, 무엇을 바꾸나요"에: 훅 이벤트의 제목·프롬프트 첫 줄·도구 요약을 메모리에만 둔다(끄는 곳), 세션 기록에서 토큰 숫자만 읽는다(끄는 곳), Claude 훅에 PreToolUse 가 늘어 다시 켜야 한다, `heavyGuard` 를 켜면 동기 훅이 하나 더 들어가고 두 번까지 미루게 한다. "알려진 한계"에: macOS 는 커밋 값 없음, 창으로 가기는 탭을 고르지 못하고 Windows 제한으로 안 될 수 있음, Claude 토큰은 내부 형식이라 안 보일 수 있음, Claude 사용 한도는 보이지 않음, 조용함은 긴 대기 명령에서도 뜸. English 요약도 고친다.
- [ ] **Step 2: 부하 측정** — `npx electron-vite build` 뒤 압축 풀린 실행(`npm run build:unpack`)을 **별도 프로필**(`--user-data-dir=<임시 폴더>`, `--hidden`, 자동 실행·업데이트 확인 끔 — 4단계 측정과 같은 방법)로 띄워 1분 예열 뒤 10분: pitwall 프로세스 CPU 평균, working set 합, 수집 1회 시간. 목표를 넘으면 원인을 찾아 줄인다. `docs/measurements.md` 에 "5단계" 절로 적는다. 측정 뒤 띄운 프로세스와 임시 프로필을 정리한다.
- [ ] **Step 3: 전체 검사** — `npm run typecheck && npm run lint && npm test && npx electron-vite build`
- [ ] **Step 4: 커밋** — `docs: 5단계(커밋·작업 공간 탭·기록·토큰·바로 가기) 반영, 부하 측정`

### Final: 브랜치 전체 검토

- [ ] 가장 좋은 모델의 새 검토자가 `feat/neohtop-ui..feat/stage5` 전체를 설계 문서·Review Focus 와 대조해 본다. 지적은 실패하는 테스트부터 고친다.
- [ ] 스테이징한 변경에 회사 고유 문자열이 없는지 검사한다.
