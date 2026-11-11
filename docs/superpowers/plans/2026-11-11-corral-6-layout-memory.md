# 6단계(이름 Corral·화면 배치·메모리를 눈으로) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 보이는 이름을 Corral 로 바꾸고, 메인 창의 카드 영역을 세 단계로 접고 카드를 고를 수 있게 하며, 메모리를 묶음별 쌓은 막대·표의 배경 막대·메모리 지도·묶음 추이로 눈에 보이게 한다.

**Architecture:** 판단은 순수 함수(`src/renderer/src/memory.ts`·`layoutState.ts`·`treemap.ts`·`memoryMap.ts`, `rows.ts` 의 비중 채우기, `src/main/userData.ts`, `historyStore.ts` 의 묶음 기록)에 두고 테스트한다. 화면은 지금 컴포넌트(`StatsBar.vue`·`ItemTable.vue`·`MemorySheet.vue`·`App.vue`)를 넓히고 새 컴포넌트(`TopSplitter.vue`, 새 카드 세 장, `MemoryMap.vue`, `StackedTrend.vue`)를 더한다. 화면 배치는 `localStorage`, 묶음 기록은 메인의 `history.json`(판 2 그대로, 선택 칸 `groups`).

**Tech Stack:** Electron 45 · electron-vite 6 · Vue 3.5 · TypeScript 5.9 · Tailwind 4 · Vitest 5 + happy-dom + @vue/test-utils.

**Spec:** `docs/superpowers/specs/2026-11-11-corral-6-layout-memory-design.md`

## Global Constraints

- 화면 문구는 모두 `src/shared/text.ts` 에(한국어). 주석·테스트 이름·커밋 메시지도 한국어.
- 판단은 의존성을 주입받는 순수 함수로 두고 테스트한다. 화면은 Vitest + happy-dom 컴포넌트·App 테스트.
- 매 작업 끝에 `npm run typecheck && npm run lint && npm test` 가 경고 없이 통과한다.
- 내부 이름은 바꾸지 않는다: 앱 ID `io.github.yeonjin1357.pitwall`, 실행 파일 이름 `pitwall`(`executableName`), 설정 폴더 `pitwall`, 훅 주소 `/pitwall-hook/…`, IPC 이름 `pitwall:…`·`window.pitwall`, `localStorage` 키 `pitwall.…`, 보조 DLL·백업 파일 이름, C# 도우미 클래스 이름, GitHub 주소 `yeonjin1357/pitwall`.
- 공개 저장소: 코드·테스트·문서에 실제 로컬 경로·사람 이름·회사 이름을 넣지 않는다(예시는 `C:\Users\dev\…` 같은 일반 값).
- 1280×820 창에서 창 전체에 가로 스크롤이 생기지 않는다(카드 줄 자체의 가로 스크롤은 허용).
- `localStorage` 값은 `src/renderer/src/viewState.ts` 와 같은 방식으로 읽고 쓴다(저장소를 주입, 모든 읽기·쓰기를 try/catch, 실패하면 기본값).
- 같은 메모리를 두 번 세지 않는다. 비중은 0~1 로 자른다.
- 이 PC 에서 하면 안 되는 것: 사용자가 쓰는 메인 체크아웃(실행 중인 개발 앱이 도는 폴더)을 건드리기, 앱의 메인 프로세스를 이 PC 의 실제 설정 폴더(`%APPDATA%\pitwall`)로 띄우기, 설치 파일 실행, 데스크톱에 창 띄우기·초점 옮기기, 사용자의 `~/.claude`·`~/.codex` 읽기·쓰기.
- 커밋 꼬리말은 구현하는 세션이 받은 안내의 줄을 쓴다.

## Review Focus

1. **업그레이드해도 설정이 그대로**: 설정 폴더 고정이 다른 어떤 모듈이 `userData` 를 읽기 전에 돈다. `--user-data-dir` 이 있으면 고정하지 않는다. → Task 1 의 순서 테스트·순수 함수 테스트.
2. **막대 비중이 맞다**: 검색 전 줄 합 기준, 100% 를 넘지 않음, 작업 공간 탭은 사용 중 RAM 기준, 다른 포트 보기는 막대 없음, 묶음 머리 줄도 같은 기준. → Task 3.
3. **배치 값이 깨져도 화면이 선다**: 모르는 카드·중복·빈 목록·JSON 이 아님·저장소 막힘 → 기본 배치. 마지막 보이는 카드는 숨기지 못한다. → Task 4·5.
4. **새 버전이 쓴 기록을 예전 버전이 읽어도 기록이 남는다**: `history.json` 판은 2 그대로, `groups` 는 선택 칸. `groups` 가 없는 예전 파일은 빈 묶음 기록. → Task 6.
5. **접기·간단히에서도 표가 남는 높이를 다 쓰고, 편집 모드는 접기에서 자세히로 바뀐다.** → Task 4·5 의 App 테스트와 컨트롤러 화면 확인.

---

### Task 1: 이름 Corral (G1)

**Files:**
- Create: `src/main/userData.ts`, `src/main/userData.test.ts`, `src/main/pinUserData.ts`
- Modify: `src/main/index.ts`(맨 첫 import, GitHub `User-Agent`), `package.json`(`name`·`productName`), `electron-builder.yml`(`productName`; `executableName` 은 `pitwall` 그대로임을 주석으로), `src/renderer/index.html`(`<title>`), `src/shared/text.ts`, `README.md`, `docs/measurements.md`(제품 이름만), 예전 이름을 단언하던 테스트들(`tray.test.ts`·`heavyGuard.test.ts`·`App.test.ts`·`TrayView`·`ItemSheet` 테스트 등)
- Test: `src/main/userData.test.ts`, `src/shared/text.test.ts`(없으면 만든다)

**Interfaces:**
- Produces:
  - `export const USER_DATA_FOLDER = 'pitwall'`
  - `export function pinUserData(app: { getPath(name: 'appData'): string; setPath(name: 'userData', path: string): void; commandLine: { hasSwitch(name: string): boolean } }, join: (...parts: string[]) => string): string | null` — `--user-data-dir` 이 있으면 아무것도 하지 않고 null, 아니면 `join(appData, 'pitwall')` 로 고정하고 그 경로.
  - `src/main/pinUserData.ts`: `import { app } from 'electron'; import { join } from 'path'; pinUserData(app, join)` 만 하는 모듈. `index.ts` 의 **첫 import**.
  - 이름 바뀜: `package.json` `name: "corral"`, `productName: "Corral"`; `electron-builder.yml` `productName: Corral`; `index.html` `<title>Corral</title>`; `text.ts` 안의 제품 이름 `pitwall` → `Corral`(질문 훅 문구 머리말 `Corral:`·`Corral 참고:` 포함); `User-Agent: Corral`.

- [ ] **Step 1: 실패하는 테스트**
  - `userData.test.ts`: `test('설정 폴더는 이름이 바뀌어도 appData/pitwall 로 고정한다')`(가짜 app: `getPath('appData')` = `'C:\\Users\\dev\\AppData\\Roaming'`, `setPath` 가 `('userData', 'C:\\Users\\dev\\AppData\\Roaming/pitwall')` 로 한 번 불림 — `join` 도 가짜로); `test('--user-data-dir 이 있으면 고정하지 않는다')`(`setPath` 안 불림, null); `test('index.ts 는 다른 어떤 것보다 먼저 설정 폴더를 고정한다')`(`src/main/index.ts` 원문에서 첫 `import` 문이 `'./pinUserData'` 인지).
  - `text.test.ts`: `test('화면 문구에 예전 제품 이름이 남지 않는다')`(`src/shared/text.ts` 원문에서 주석을 뺀 부분에 `/pitwall/i` 가 없다); `test('질문 훅 문구의 머리말은 Corral')`(`text.guard.defer('vue-tsc', 91)` 이 `'Corral:'` 로 시작, `text.guard.note(...)` 가 `'Corral 참고:'` 로 시작).
- [ ] **Step 2: 실패 확인** — `npx vitest run src/main/userData.test.ts src/shared/text.test.ts`
- [ ] **Step 3: 구현** — 위 Interfaces 대로. 예전 이름을 단언하던 테스트는 새 이름으로(내부 이름을 단언하는 테스트 — `/pitwall-hook/`, `window.pitwall`, `pitwall.` 키, `pitwall.exe` 프로세스 표본 — 는 그대로). README·`docs/measurements.md` 의 제품 이름을 Corral 로 바꾸고 README 맨 위에 한 줄: 예전 이름 pitwall, 설정 폴더·자동 실행·연동은 그대로 이어진다.
- [ ] **Step 4: 통과 확인** — `npm run typecheck && npm run lint && npm test`
- [ ] **Step 5: 커밋** — `feat: 이름을 Corral 로 바꾼다(설정 폴더·앱 ID·훅 주소 등 내부 이름은 그대로)`

### Task 2: 메모리 카드의 구성 막대 (G4)

**Files:**
- Create: `src/renderer/src/memory.ts`, `src/renderer/src/memory.test.ts`
- Modify: `src/renderer/src/components/StatsBar.vue`(메모리 카드), `src/renderer/src/components/MemorySheet.vue`(묶음 색을 `GROUP_COLOR` 로), `src/shared/text.ts`
- Test: `memory.test.ts`, `components/StatsBar.test.ts`

**Interfaces:**
- Consumes: `MemorySummary`(`totalBytes`·`usedBytes`), `GroupUsage[]`(`group: ProcessGroup` = `devServer|agent|heavy|otherApps|system`, `memoryBytes`).
- Produces:
  - `export const GROUP_ORDER: ProcessGroup[] = ['devServer', 'agent', 'heavy', 'otherApps', 'system']`
  - `export const GROUP_COLOR: Record<ProcessGroup, string>` — 지금 색 그대로(`devServer` `var(--chart-1)`, `agent` `var(--chart-2)`, `heavy` `var(--chart-3)`, `otherApps` `var(--chart-4)`, `system` `var(--status-idle)`).
  - `export interface CompositionPart { group: ProcessGroup; bytes: number; share: number }` (share = 전체 RAM 대비 0~1)
  - `export interface MemoryComposition { parts: CompositionPart[]; freeBytes: number; freeShare: number }` — `parts` 는 `GROUP_ORDER` 순서, 0 인 묶음도 들어 있다.
  - `export function memoryComposition(memory: Pick<MemorySummary, 'totalBytes' | 'usedBytes'>, groups: GroupUsage[]): MemoryComposition | null` — `totalBytes <= 0` 이면 null. 묶음 합이 `usedBytes` 를 넘으면 모든 묶음을 `usedBytes / 합` 으로 줄인다. `freeBytes = max(0, total − used)`.
  - 문구: `text.ui.cards.memoryPart(name: string, bytes: string, percent: number)` = `` `${name} ${bytes} · 전체 RAM 의 ${percent}%` ``, `text.ui.cards.memoryFree` = `'남은 메모리'`.
- 메모리 카드: 지금의 묶음별 작은 막대 네 개를 쌓은 막대 하나(높이 약 10px, 둥근 끝) + 2×2 범례(개발 서버·에이전트·다른 앱·시스템·공유 — 이름 + `n%`; 무거운 작업은 0 보다 클 때만 다섯째로)로 바꾼다. 막대 조각마다 풍선말 `memoryPart`. 10분 추이는 그대로. % 는 반올림, 0 보다 크고 1 보다 작으면 `<1%`.

- [ ] **Step 1: 실패하는 테스트**
  - `memory.test.ts`: `test('묶음은 정해진 순서로, 전체 RAM 대비 비율과 남은 메모리')`(total 100, used 60, 묶음 10·5·0·30·15 → share 0.1·0.05·0·0.3·0.15, free 40·0.4); `test('묶음 합이 사용량을 넘으면 같은 비율로 줄여 사용량에 맞춘다')`(used 60, 묶음 합 80 → 각 ×0.75, free 40); `test('전체를 모르면(0) null')`; `test('없는 묶음은 0')`.
  - `StatsBar.test.ts`: `test('메모리 카드: 전체 RAM 을 묶음별로 쌓은 막대와 묶음별 %')`(조각 수·너비 비율·범례 글자); `test('무거운 작업은 0 보다 클 때만 범례에')`; `test('메모리를 아직 모르면 쌓은 막대가 없다')`. 지금 묶음 막대를 단언하던 테스트는 새 모양으로.
- [ ] **Step 2–4:** 실패 확인 → 구현 → `npm run typecheck && npm run lint && npm test`
- [ ] **Step 5: 커밋** — `feat(ui): 메모리 카드에 전체 RAM 을 묶음별로 쌓은 막대와 % 를 보인다`

### Task 3: 표의 메모리 막대 (G5)

**Files:**
- Modify: `src/renderer/src/rows.ts`, `src/renderer/src/components/ItemTable.vue`, `src/renderer/src/App.vue`, `src/shared/text.ts`, `src/styles` 또는 `src/renderer/src/styles/app.css`
- Test: `src/renderer/src/rows.test.ts`, `components/ItemTable.test.ts`, `App.test.ts`

**Interfaces:**
- Produces:
  - `Cell.share?: number` — 0~1. 메모리 칸에만.
  - `Column.hint?: string` — 머리글 풍선말. 메모리 칸에 기준을 적는다.
  - `GroupHead.memoryShare?: number` — 묶음 머리 줄의 비중.
  - `export type MemoryShareBase = { kind: 'rows' } | { kind: 'used'; bytes: number } | { kind: 'none' }`
  - `export function withMemoryShares(table: Table, base: MemoryShareBase, totalRamBytes: number): Table` — `rows`: 분모 = 표 줄들의 `cells.memory.sort`(0 보다 큰 수) 합. `used`: 분모 = `bytes`. 분모가 0 이하이거나 `none` 이면 그대로. 메모리 칸에 `share`(0~1 로 자름)와 `title`(`memoryShareRows` 또는 `memoryShareUsed`), 메모리 칸 `Column.hint` 를 채운다.
  - 기준: 개발 서버(목록·묶음)·숨긴 서버·에이전트·남은 프로세스·무거운 작업·다른 앱 = `{ kind: 'rows' }`; 작업 공간 = `{ kind: 'used', bytes: snapshot.memory.usedBytes }`; 다른 포트 = `{ kind: 'none' }`.
  - 비중은 **검색으로 거르기 전 표**에 채운다(App 의 거르기 전). 묶음 머리(`groupServers`·`groupWorkspaces`)의 `memoryShare` 는 같은 분모로(개발 서버 묶음 = 표 줄 합, 작업 공간 = 사용 중 RAM).
  - 문구: `text.ui.table.memoryShareRows(bytes: string, ofTable: number, ofRam: number)` = `` `${bytes} · 이 표 합의 ${ofTable}% · 전체 RAM 의 ${ofRam}%` ``; `text.ui.table.memoryShareUsed(bytes: string, ofUsed: number)` = `` `${bytes} · 사용 중 RAM 의 ${ofUsed}%` ``; `text.ui.table.memoryHintRows` = `'막대: 이 표의 메모리 합 대비'`; `text.ui.table.memoryHintUsed` = `'막대: 사용 중인 RAM 대비'`.
- 그리기: 메모리 칸(과 묶음 머리 줄의 메모리 칸) 배경에 왼쪽부터 `share` 만큼 옅은 막대(묶음 색 `var(--chart-1)` 에 투명도, 칸 높이의 아래쪽 또는 전체 — 글자보다 뒤). 칸 너비는 그대로. 선택·마우스 올림·묶음 머리 배경 위에서도 글자가 읽혀야 한다. 머리글 버튼에 `title = hint`.

- [ ] **Step 1: 실패하는 테스트**
  - `rows.test.ts`: `test('메모리 비중은 표 줄 합 대비이고 0~1 로 자른다')`; `test('작업 공간 표는 사용 중 RAM 대비')`; `test('다른 포트 보기는 막대 없음')`; `test('풍선말에 표 합 대비와 전체 RAM 대비 %')`; `test('개발 서버 묶음 머리 줄의 비중은 같은 분모')`.
  - `ItemTable.test.ts`: `test('메모리 칸에 비중만큼 배경 막대를 그린다(글자는 그대로)')`; `test('메모리 머리글에 기준 풍선말')`.
  - `App.test.ts`: `test('검색해도 메모리 막대 길이는 그대로')`.
- [ ] **Step 2–4:** 실패 확인 → 구현 → `npm run typecheck && npm run lint && npm test`
- [ ] **Step 5: 커밋** — `feat(ui): 표의 메모리 칸에 그 표 안에서의 비중을 막대로 보인다`

### Task 4: 위아래 세 단계 (G2)

**Files:**
- Create: `src/renderer/src/layoutState.ts`, `src/renderer/src/layoutState.test.ts`, `src/renderer/src/components/TopSplitter.vue`, `src/renderer/src/components/TopSplitter.test.ts`
- Modify: `src/renderer/src/components/StatsBar.vue`(간단히 모양), `src/renderer/src/App.vue`, `src/renderer/src/styles/app.css`(카드 영역 높이·반응형 규칙·`.table-section`), `src/shared/text.ts`
- Test: `layoutState.test.ts`, `TopSplitter.test.ts`, `StatsBar.test.ts`, `App.test.ts`

**Interfaces:**
- Produces:
  - `export type TopMode = 'full' | 'compact' | 'collapsed'`
  - `export function readTopMode(storage: StorageLike | null): TopMode` — 키 `pitwall.topMode`, 모르는 값·실패는 `'full'`. `export function writeTopMode(storage: StorageLike | null, mode: TopMode): void`.
  - `export function snapTopMode(heightPx: number, heights: Record<TopMode, number>): TopMode` — 가장 가까운 단계(같으면 큰 쪽).
  - `TopSplitter.vue`: props `mode: TopMode`(v-model:mode), `heights: Record<TopMode, number>`, `editing?: boolean`; emits `update:mode`, `edit`, `drag: [heightPx: number | null]`(끄는 동안 높이, 놓으면 null). 단계 버튼 세 개(`aria-pressed`), 가운데 손잡이(포인터로 끌기, 더블클릭 = 자세히 ↔ 접기), 초점 있을 때 ↑ = 한 단계 작게, ↓ = 한 단계 크게, 오른쪽 `카드 편집` 버튼(→ `edit`; Task 5 가 연다).
  - `StatsBar.vue` prop `compact?: boolean` — 카드마다 제목·큰 값·짧은 설명 한 줄(높이 약 72px). 메모리 카드는 % 와 얇은 쌓은 막대(Task 2 의 `memoryComposition`).
  - App: 카드 영역 높이를 단계(끄는 동안은 그 높이)에 맞추고, 표 영역이 남는 높이를 다 쓴다. 단계는 `readTopMode(window.localStorage)` 로 시작하고 바뀔 때 `writeTopMode`.
  - 문구: `text.ui.layout.modes = { full: '자세히', compact: '간단히', collapsed: '접기' }`, `text.ui.layout.handle = '끌어서 위아래 크기 조절 · 더블클릭: 자세히 ↔ 접기'`, `text.ui.layout.editCards = '카드 편집'`.

- [ ] **Step 1: 실패하는 테스트**
  - `layoutState.test.ts`: `test('단계는 저장한 값, 모르거나 읽지 못하면 자세히')`; `test('놓은 높이에 가장 가까운 단계')`.
  - `TopSplitter.test.ts`: `test('단계 버튼으로 바꾸고 더블클릭은 자세히 ↔ 접기')`; `test('끌어서 놓으면 가까운 단계에 붙는다')`(pointerdown/move/up); `test('↑·↓ 로 한 단계씩')`; `test('카드 편집 버튼은 edit 를 보낸다')`.
  - `StatsBar.test.ts`: `test('간단히: 카드마다 제목·큰 값·한 줄')`.
  - `App.test.ts`: `test('접기를 고르면 카드가 없고 다시 켜도 기억한다')`; `test('간단히에서도 표가 보인다')`.
- [ ] **Step 2–4:** 실패 확인 → 구현 → `npm run typecheck && npm run lint && npm test`
- [ ] **Step 5: 커밋** — `feat(ui): 카드 영역을 손잡이로 자세히·간단히·접기 세 단계로 바꾼다`

### Task 5: 카드 고르기 (G3)

**Files:**
- Create: `src/renderer/src/components/cards/WaitingCard.vue`, `TokensCard.vue`, `EventsCard.vue`(각 테스트와 함께)
- Modify: `src/renderer/src/layoutState.ts`(+테스트), `src/renderer/src/components/StatsBar.vue`(+테스트), `src/renderer/src/App.vue`(+테스트), `src/shared/text.ts`

**Interfaces:**
- Consumes: Task 4 의 `TopSplitter` `edit` 이벤트·`layoutState.ts`.
- Produces:
  - `export type CardId = 'memory' | 'servers' | 'agents' | 'heavy' | 'leftovers' | 'disk' | 'waiting' | 'tokens' | 'events'`
  - `export const DEFAULT_CARDS: CardId[] = ['memory', 'servers', 'agents', 'heavy', 'leftovers', 'disk']`, `export const EXTRA_CARDS: CardId[] = ['waiting', 'tokens', 'events']`
  - `export interface CardLayout { order: CardId[]; hidden: CardId[] }`
  - `export function normalizeCardLayout(raw: unknown): CardLayout` — 모르는 이름·중복 버림, `order` 에 없는 기본 카드는 끝에 붙임, `hidden` 은 `order` 에 있는 것만, 보이는 카드가 없으면 기본 배치(`{ order: DEFAULT_CARDS, hidden: [] }`).
  - `export function readCardLayout(storage: StorageLike | null): CardLayout`(키 `pitwall.cards`, JSON) · `export function writeCardLayout(storage: StorageLike | null, layout: CardLayout): void`
  - `export function visibleCards(l: CardLayout): CardId[]`
  - `export function setCardHidden(l: CardLayout, id: CardId, hidden: boolean): CardLayout` — 마지막 보이는 카드를 숨기려 하면 그대로 돌려준다.
  - `export function addCard(l: CardLayout, id: CardId): CardLayout`(새 카드만, 끝에) · `export function removeCard(l: CardLayout, id: CardId): CardLayout`(새 카드만; 기본 카드는 그대로)
  - `export function moveCard(l: CardLayout, id: CardId, to: number): CardLayout` — `order` 안에서 그 자리로(범위 밖은 양 끝).
  - `StatsBar.vue`: props 더함 `layout: CardLayout`(v-model:layout), `editing: boolean`(v-model:editing), `events: PitEvent[]`. `visibleCards`(편집 중이면 `order` 전체, 숨긴 것은 흐리게) 순서로 카드를 그린다. 카드 너비는 지금 비율(메모리 1.5배)·최소 200px, 넘치면 카드 줄만 가로 스크롤. 편집 모드: 카드마다 `숨기기`/`보이기`, 새 카드엔 `빼기`, `←`·`→`, 끌어서 놓기; 카드 줄 아래 "더할 수 있는 카드" 칩(`+ 이름`)·`기본값으로`·`완료`.
  - 새 카드: `WaitingCard` props `agents: AgentRow[]`, `now: number` emits `select: [key: string]`(응답 대기 에이전트 최대 3줄: 폴더 · 이유(`waitReason` 문구 또는 기다리는 도구) · 기다린 시간); `TokensCard` props `agents: AgentRow[]`, `limits: CodexLimits | null`, `now: number` emits `tab`(가장 큰 `usage.contextTokens` 의 값·폴더, Codex 한도 두 창 — Task 20 의 `codexLimitView` 를 쓴다); `EventsCard` props `events: PitEvent[]`, `now: number` emits `tab`(최근 3건, `eventText`). 세 카드 모두 간단히 모양(`compact`)도.
  - App: 배치를 `readCardLayout(window.localStorage)` 로 시작, 바뀔 때 `writeCardLayout`. 편집 모드에 들어갈 때 단계가 접기면 자세히로.
  - 문구(`text.ui.cardsEdit`): `title: { memory: '메모리', servers: '개발 서버', agents: '에이전트', heavy: '무거운 작업', leftovers: '남은 프로세스', disk: '디스크 정리', waiting: '응답 대기', tokens: '토큰·한도', events: '최근 기록' }`, `hide: '숨기기'`, `show: '보이기'`, `remove: '빼기'`, `left: '앞으로'`, `right: '뒤로'`, `addable: '더할 수 있는 카드'`, `reset: '기본값으로'`, `done: '완료'`; 새 카드 빈 상태: `waitingNone: '기다리는 에이전트가 없어요'`, `tokensNone: '아직 읽은 토큰이 없어요'`, `eventsNone: '아직 기록이 없어요'`.

- [ ] **Step 1: 실패하는 테스트**
  - `layoutState.test.ts`: `test('모르는 이름·중복은 버리고 빠진 기본 카드는 끝에 붙인다')`; `test('보이는 카드가 없거나 JSON 이 아니면 기본 배치')`; `test('마지막 보이는 카드는 숨길 수 없다')`; `test('새 카드는 더하고 뺄 수 있고 기본 카드는 뺄 수 없다')`; `test('순서 옮기기는 범위 밖이면 양 끝')`.
  - `StatsBar.test.ts`: `test('배치 순서대로 보이고 숨긴 카드는 없다')`; `test('편집 모드: 숨긴 카드는 흐리게, 보이기·숨기기·빼기·앞으로·뒤로')`; `test('더할 수 있는 카드 칩·기본값으로·완료')`.
  - `WaitingCard.test.ts`: `test('응답 대기 에이전트 최대 세 줄, 누르면 그 에이전트')`; `test('없으면 안내 문구')`. `TokensCard.test.ts`: `test('가장 큰 컨텍스트와 Codex 한도')`; `test('모르면 안내 문구')`. `EventsCard.test.ts`: `test('최근 기록 세 줄, 누르면 기록 탭')`.
  - `App.test.ts`: `test('카드 배치를 바꾸면 다시 켜도 기억한다')`; `test('접기에서 카드 편집을 누르면 자세히로 바뀐다')`.
- [ ] **Step 2–4:** 실패 확인 → 구현 → `npm run typecheck && npm run lint && npm test`
- [ ] **Step 5: 커밋** — `feat(ui): 카드를 숨기고 순서를 바꾸고 응답 대기·토큰과 한도·최근 기록 카드를 더한다`

### Task 6: 묶음 기록·메모리 지도·묶음 추이 (G6)

**Files:**
- Create: `src/renderer/src/treemap.ts`(+테스트), `src/renderer/src/memoryMap.ts`(+테스트), `src/renderer/src/components/MemoryMap.vue`(+테스트), `src/renderer/src/components/StackedTrend.vue`(+테스트)
- Modify: `src/shared/types.ts`(`GroupPoint`), `src/main/historyStore.ts`(+테스트), `src/main/index.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`, `src/renderer/src/history.ts`(+테스트), `src/renderer/src/components/MemorySheet.vue`(+테스트), `src/renderer/src/App.vue`(+테스트), `src/shared/text.ts`

**Interfaces:**
- Produces:
  - `export interface GroupPoint { t: number; devServer: number; agent: number; heavy: number; otherApps: number; system: number }`(바이트)
  - `historyStore.ts`: `HistoryFile.groups?: GroupPoint[]`(판은 `2` 그대로); `LoadedHistory.groups: GroupPoint[]`(없거나 깨진 점은 버림 → 빈 목록); `export function createGroupHistory(): { record(t: number, groups: GroupUsage[]): void; points(): GroupPoint[]; import(points: GroupPoint[], now: number): void }` — RAM 기록과 같은 30초·2시간 규칙. `index.ts` 는 RAM 을 남기는 바로 그 자리에서 함께 남기고, 저장할 때 `groups` 도 쓴다.
  - IPC: `IPC.historyGroups = 'pitwall:history-groups'`, `PitwallApi.historyGroups(): Promise<GroupPoint[]>`(메인 창에서만 값, 아니면 빈 목록 — `historyRam` 과 같음). preload 에 더한다. 테스트의 가짜 `window.pitwall` 에도.
  - 렌더러 `history.ts`: `History.groups: GroupPoint[]`; `appendSnapshot` 이 스냅샷마다 묶음 점을 더하고 RAM 과 같은 규칙으로 솎는다; `export function seedGroups(history: History, points: GroupPoint[]): History`(`seedRam` 과 같은 규칙).
  - `treemap.ts`: `export interface TreemapRect { x: number; y: number; w: number; h: number }`; `export function squarify<T extends { value: number }>(items: T[], rect: TreemapRect): (TreemapRect & { item: T })[]` — 0 이하 값은 빼고, 넓이는 값에 비례, 직사각형을 빈틈없이 채움, 큰 값부터.
  - `memoryMap.ts`: `export interface MapTile { id: string; label: string; bytes: number; key: string | null }`; `export interface MapGroup { group: ProcessGroup; bytes: number; tiles: MapTile[] }`; `export function memoryMapGroups(s: DashboardSnapshot): MapGroup[]` — 묶음 = `memoryComposition` 의 바이트(0 은 빼고), 타일 = 개발 서버(`이름 · 작업 공간`, key = 서버 선택 키; 숨긴 서버는 key null), 에이전트, 무거운 작업, 다른 앱(큰 순 12개 + `기타 n개`, key null), 시스템(한 칸, key null). 타일 합 > 묶음이면 같은 비율로 줄이고, 합 < 묶음이면 `그 밖` 타일(key null)을 더한다.
  - `MemoryMap.vue`: props `snapshot`; emits `select: [key: string]`. `squarify` 로 두 단계 배치, 누를 수 있는 칸만 버튼, 작은 칸은 글자 대신 풍선말.
  - `StackedTrend.vue`: props `points: GroupPoint[]`, `windowMs: number`, `totalBytes: number`, `gapMs?: number | null`. 묶음을 `GROUP_ORDER` 순서로 쌓은 영역 그래프(`GROUP_COLOR`), 끊긴 구간은 잇지 않는다.
  - `MemorySheet.vue`: 지금 내용 위에 메모리 지도, RAM 추이 아래에 묶음 추이. props 더함 `groupHistory: GroupPoint[]`; emits 더함 `select: [key: string]`. App 은 `select` 를 받으면 메모리 상세를 닫고 `select(key)`.
  - 문구: `text.ui.memorySheet.mapTitle = '메모리 지도'`, `mapHint = '사각형 크기 = 쓰는 메모리. 누르면 그 줄의 상세'`, `mapOthers(n: number) = \`기타 ${n}개\``, `mapRest = '그 밖'`, `trendGroupsTitle = '묶음별 추이'`, `freeLine(free: string) = \`남은 메모리 ${free}\``(지도 위 한 줄).

- [ ] **Step 1: 실패하는 테스트**
  - `historyStore.test.ts`: `test('묶음 기록은 판 2 파일의 선택 칸 groups 로 남고 다시 읽힌다')`; `test('groups 가 없는 예전 파일은 빈 묶음 기록, 다른 기록은 그대로')`; `test('묶음 기록도 30초에 한 번, 2시간까지')`.
  - `treemap.test.ts`: `test('넓이는 값에 비례하고 직사각형을 빈틈없이 채운다')`; `test('0 이하 값은 빠진다')`; `test('가로세로 비가 한쪽으로 치우치지 않는다(가장 긴 변/짧은 변 ≤ 4, 항목이 비슷할 때)')`.
  - `memoryMap.test.ts`: `test('2단계 합이 묶음보다 크면 줄여 맞추고 작으면 그 밖 칸')`; `test('다른 앱은 큰 순 12개 + 기타 n개')`; `test('누를 수 있는 칸만 선택 키를 가진다')`; `test('0 인 묶음은 지도에 없다')`.
  - `history.test.ts`: `test('스냅샷마다 묶음 점을 더하고 메인 기록으로 처음 채운다')`.
  - `MemoryMap.test.ts`: `test('칸을 누르면 그 줄의 키로 select')`. `StackedTrend.test.ts`: `test('묶음을 쌓아 그린다')`.
  - `App.test.ts`: `test('메모리 지도에서 서버를 누르면 메모리 상세를 닫고 그 서버의 상세 패널')`.
- [ ] **Step 2–4:** 실패 확인 → 구현 → `npm run typecheck && npm run lint && npm test`
- [ ] **Step 5: 커밋** — `feat: 메모리 상세에 메모리 지도와 묶음별 추이(묶음 기록을 history.json 에 함께 남김)`

### Task 7: 문서

**Files:** Modify `README.md`, `docs/superpowers/specs/2026-11-11-corral-6-layout-memory-design.md`(상태 → 구현됨, 구현 중 바뀐 결정)
- [ ] **Step 1:** README "무엇을 보여 주나요"에 화면 배치(세 단계·카드 편집·새 카드), 메모리 구성 막대·표의 메모리 막대·메모리 지도·묶음 추이를 넣는다. "무엇을 읽고, 무엇을 바꾸나요"에 `history.json` 에 묶음별 메모리(바이트)도 2시간 남긴다는 것, 화면 배치는 이 PC 의 앱 저장소(`localStorage`)에 남는다는 것. English summary 도 맞춘다.
- [ ] **Step 2:** `npm run typecheck && npm run lint && npm test && npx electron-vite build`
- [ ] **Step 3: 커밋** — `docs: 6단계(Corral·화면 배치·메모리 구성·메모리 지도) 반영`

### Final: 브랜치 전체 검토

- [ ] 새 검토자가 `feat/neohtop-ui..feat/stage6` 전체를 설계 문서·Review Focus 와 대조해 본다. 지적은 실패하는 테스트부터 고친다.
- [ ] 컨트롤러가 1280×820 에서 세 단계·편집 모드·메모리 카드·표 막대·메모리 상세를 그려 확인한다.
