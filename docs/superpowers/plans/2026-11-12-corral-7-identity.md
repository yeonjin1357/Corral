# 7단계: Corral 다운 얼굴 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 색을 흑회색 + 민트로 바꾸고, 레이아웃의 큰 틀은 둔 채 카드 줄·탭·표를 NeoHtop 과 다른 Corral 의 결로 바꾼다(할 일 띠·픽셀 추이 포함).

**Architecture:** 색은 `app.css` 토큰과 메인 프로세스의 몇 개 상수만 바꾼다. 화면 변화는 기존 컴포넌트(StatsBar·ItemTable·ToolBar·SettingsView·App)를 고치고, 새 부품은 순수 로직(`attention.ts`, `pixelTrend.ts`)과 그것을 그리는 작은 컴포넌트(`AttentionStrip.vue`, `PixelTrend.vue`, `ui/TabBar.vue`)로 나눈다. 수집·판단 규칙은 건드리지 않는다.

**Tech Stack:** Electron, Vue 3 `<script setup>` + TypeScript, Tailwind v4(`app.css` 토큰), Vitest(+ happy-dom, @vue/test-utils).

**Spec:** `docs/superpowers/specs/2026-11-12-corral-7-identity-design.md`

## Global Constraints

- 작업 폴더 `C:\exem\pitwall-stage7`(브랜치 `feat/stage7`). 사용자의 개발 실행은 `C:\exem\pitwall` 에서 돈다 — 그 폴더는 건드리지 않는다.
- 색 값은 설계 §5 G1 의 표 그대로(어둡게·밝게). 화면 코드는 색을 직접 쓰지 않고 토큰만 쓴다(예외: `TitleBar.vue` 테마 견본, 메인의 `windowChrome.ts`·`tray.ts`·`pixelArt.ts`).
- 대비: 글자 4.5:1 이상(바탕·카드·알약 위), 글자 아닌 점·막대·띠·테두리 3:1 이상.
- 노랑 = 응답 대기·확인해볼 것·경고, 빨강 = 정리 후보·오류·위험. 카드 아이콘 칩(`--chart-*`)에는 노랑·빨강 계열을 쓰지 않는다.
- 1280×820 창에서 할 일 띠가 없을 때 카드 줄·탭 줄·표의 높이는 지금과 같다(탭 줄 높이 유지).
- 문구(새로 넣는 것): 조용한 카드 `없음`, 에이전트 간단히 줄 `응답 대기 {n} · {도구} {경과}`, 서버 간단히 줄 `정리 후보 {n}`, 탭 `더 보기`, 어둡게 테마 부제 `흑회색`, 정리 후보 줄 `{경과} 동안 아무도 안 써요`, 넘친 줄 `외 {n}개`, 띠 이름 `할 일`. 그 밖의 문구는 지금 문구를 그대로 쓴다.
- 커밋 메시지는 한국어 conventional(`feat(ui): …`), 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- 작업마다 끝에 `npm test`(관련 파일)·`npm run typecheck`·`npm run lint`·`npx prettier --check src` 가 통과해야 커밋한다.

## Review Focus

- 응답 대기가 6개쯤 쌓였을 때: 띠는 3줄 + `외 n개`, 갱신마다 줄 순서가 그대로(스냅샷의 에이전트 순서가 바뀌어도).
- 응답 대기 시작 시각을 모르는 에이전트(`stateSince: null`): 띠·카드 줄에 엉뚱한 경과("0초")가 아니라 경과 없이(`응답 대기 1 · Codex`) 보이고, 정렬은 맨 뒤.
- 밝은 테마의 상태 알약 글자: 토큰 값만으로 4.5:1 을 넘는다(테스트가 `app.css` 를 읽어 계산).
- 1200px 이하 좁은 창·카드 편집 중: 조용한 카드 칸이 104px 로 고정되되 편집 중에는 접지 않는다.
- 탭을 키보드로: ←·→ 가 탭과 "더 보기" 사이를 돌고, "더 보기" 안의 탭을 고르면 그 자리에 그 이름이 보인다.

---

## File Structure

| 파일                                                                                | 하는 일                                                    |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `src/renderer/src/styles/app.css`                                                   | 색 토큰(어둡게·밝게), 알약·묶음 막대·가지 선·카드 강조 CSS |
| `src/main/palette.test.ts`(새)                                                      | 옛 색이 남지 않았는지, 토큰이 다 있는지, 밝은 테마 대비    |
| `src/main/windowChrome.ts`, `src/main/tray.ts`, `src/main/pixelArt.ts`              | 창 제목줄·트레이·앱 아이콘 색                              |
| `src/renderer/src/rows.ts`                                                          | `TONE_COLOR`, `Cell.sub`, 작업 공간 탭 구성원 이름         |
| `src/renderer/src/memory.ts`                                                        | 메모리 묶음 색 → 전용 토큰                                 |
| `src/renderer/src/components/ItemTable.vue`                                         | 상태 알약, 묶음 머리 막대, 가지 선, 이름 옆 흐린 글자      |
| `src/renderer/src/ui/TabBar.vue`(새)                                                | 밑줄 탭 + 더 보기 메뉴                                     |
| `src/renderer/src/components/ToolBar.vue`, `SettingsView.vue`                       | TabBar 사용                                                |
| `src/renderer/src/layoutState.ts`, `components/StatsBar.vue`                        | 조용한 카드 너비, 카드 강조                                |
| `src/renderer/src/attention.ts`(새), `components/AttentionStrip.vue`(새), `App.vue` | 할 일 띠                                                   |
| `src/renderer/src/pixelTrend.ts`(새), `components/PixelTrend.vue`(새)               | 픽셀 추이                                                  |
| `src/shared/text.ts`                                                                | 새 문구                                                    |
| `THIRD_PARTY_NOTICES.md`, `README.md`, `docs/images/*.png`, `docs/details.md`       | 고지·문서·스크린샷                                         |

---

### Task 1: 색 바꾸기(G1)

**Files:**

- Modify: `src/renderer/src/styles/app.css:1-7,85-194`(머리 주석, `:root`·`.dark` 토큰)
- Modify: `src/renderer/src/rows.ts:54-62`, `src/renderer/src/memory.ts:11-18`
- Modify: `var(--peach)`·`var(--red)` 를 쓰는 곳 — `ConfirmDialog.vue:25-26`, `ItemTable.vue:468`, `cards/WaitingCard.vue:54`, `TrayView.vue:67,165,242`, `SettingsView.vue:491,698`, `TitleBar.vue:68`, `StatsBar.vue:207,688,762,870,886`
- Modify: `StatsBar.vue:786,793`(무거운 작업 겹침: 빨강 → 노랑)
- Modify: `src/main/windowChrome.ts:11-14`, `src/main/tray.ts:7-14`, `src/main/pixelArt.ts:13`, `TitleBar.vue:42-45`, `src/shared/text.ts:314`(어둡게 부제)
- Modify: `THIRD_PARTY_NOTICES.md:5-12`(NeoHtop 항목)
- Regenerate: `build/icon.png`, `build/icon.ico`, `resources/icon.png`, `resources/icon-small.png`(`npm run icon`)
- Create: `src/main/palette.test.ts`
- Test(고침): 색 글자를 기대하는 기존 테스트(`IconChip.test.ts`, `StatsBar.test.ts`, `TrayView.test.ts`, `windowChrome`·`tray`·`pixelArt` 테스트 등 — `npx vitest run` 으로 찾는다)

**Interfaces:**

- Produces(토큰, 어둡게·밝게 모두 정의): `--status-running`, `--status-waiting`(새, 지금 `--peach` 자리), `--status-stopped`, `--status-idle`, `--info`(새), `--group-dev`·`--group-agent`·`--group-heavy`·`--group-apps`·`--group-system`(새), `--chart-1~5`, 그리고 shadcn 토큰(`--background`… `--ring`). Catppuccin 이름 토큰(`--base`·`--mantle`·`--crust`·`--text`·`--subtext*`·`--surface*`·`--overlay*`·`--blue`·`--lavender`·`--sapphire`·`--sky`·`--red`·`--maroon`·`--peach`·`--yellow`·`--green`·`--teal`)은 없앤다.
- Produces: `TONE_COLOR.warn === 'var(--status-waiting)'`, `TONE_COLOR.stopped === 'var(--status-stopped)'`; `GROUP_COLOR = { devServer: 'var(--group-dev)', agent: 'var(--group-agent)', heavy: 'var(--group-heavy)', otherApps: 'var(--group-apps)', system: 'var(--group-system)' }`.

- [ ] **Step 1: 실패하는 테스트 — `src/main/palette.test.ts`**

`app.css`·`src/**` 를 읽어 검사한다(대비 계산 함수는 테스트 안에 둔다: sRGB 상대 휘도, `(L1+0.05)/(L2+0.05)`).

```ts
test('옛 Catppuccin·GitHub Light 색이 앱 코드에 남아 있지 않다', ...)
// src 아래 .ts·.vue·.css(테스트 파일 제외)에 다음 hex 가 하나도 없다(대소문자 무시):
// #1e1e2e #181825 #11111b #cdd6f4 #89b4fa #b4befe #fab387 #f38ba8 #a6e3a1 #f9e2af #94e2d5
// #0969da #24292f #f6f8fa #8250df #cf222e #1a7f37 #bc4c00 #9a6700
test('어둡게·밝게 모두 역할 토큰을 정의한다', ...)
// :root 와 .dark 블록 각각에 --status-running --status-waiting --status-stopped --status-idle --info
// --group-dev --group-agent --group-heavy --group-apps --group-system --chart-1..5 --primary --destructive 가 있다.
test('밝은 테마 글자 대비가 4.5:1 이상(바탕·카드·옅은 알약 위)', ...)
// :root 의 --status-running/-waiting/-stopped/-idle, --info, --muted-foreground, --primary 각각:
// 대비(색, --background) >= 4.5, 대비(색, --card) >= 4.5, 대비(색, mix(색 13%, --card)) >= 4.5
// 대비(--primary-foreground, --primary) >= 4.5, 대비(--destructive-foreground, --destructive) >= 4.5
test('어두운 테마 글자 대비도 4.5:1 이상', ...)  // 같은 검사를 .dark 로(알약 바탕은 14%)
```

- [ ] **Step 2: 실행해 실패 확인** — `npx vitest run src/main/palette.test.ts` → 옛 hex 가 발견되고 새 토큰이 없어 실패.

- [ ] **Step 3: 토큰 바꾸기** — `app.css` 의 `:root`(밝게)·`.dark`(어둡게)를 설계 §5 G1 표·칩 색·묶음 색 값으로 다시 쓰고, Catppuccin 이름 토큰을 지운다. `--scrollbar-thumb`·`-hover` 는 어둡게 `#4a4d52`/`#5d6066`, 밝게 `#b7b9b2`/`#9a9d96`. `--status-running`=`--primary`, `--ring`=`--primary`. 머리 주석은 "색은 Corral 고유(흑회색 + 민트), 표·카드 규칙은 NeoHtop app.css 에서 가져옴" 으로.

- [ ] **Step 4: 쓰는 곳 고치기** — `var(--peach)` → `var(--status-waiting)`, `var(--red)` → `var(--status-stopped)`. `TONE_COLOR`·`GROUP_COLOR` 는 Interfaces 대로. 무거운 작업 카드의 겹침 칩 색·배지를 노랑으로(배지는 `ItemTable.vue:468` 처럼 `variant="outline"` + 노랑 테두리·글자).

- [ ] **Step 5: 메인·아이콘·고지** — `windowChrome.ts` 의 `COLORS` 를 설계 값으로, `tray.ts` `LEVEL_COLORS = { normal: '#8fdcaa', warn: '#f0b45c', danger: '#f07a6e' }`·`BADGE_COLOR = '#f2925a'`, `pixelArt.ts` `APP_LINE = '#8fdcaa'` 후 `npm run icon`. `TitleBar.vue` 견본·`text.ts` 부제(`흑회색`). `THIRD_PARTY_NOTICES.md` NeoHtop 항목에서 테마 색을 가져왔다는 말을 빼고 "색은 Corral 고유"를 적는다.

- [ ] **Step 6: 테스트 통과** — `npx vitest run` 전체. 색 글자를 기대하던 테스트는 새 토큰·값으로 고친다(동작 테스트는 그대로 통과해야 한다).

- [ ] **Step 7: 눈으로 확인** — 아래 "예시 화면" 방법으로 어둡게·밝게 첫 화면을 찍어 옛 보랏빛이 없는지 본다(커밋하지 않는 파일).

- [ ] **Step 8: 커밋** — `feat(ui): 색을 Corral 고유의 흑회색 + 민트로(어둡게·밝게·창 제목줄·트레이·아이콘)`

> **예시 화면(작업 7·8 에서도 쓴다)**: 커밋하지 않는 세 파일 — `vite.demo.config.ts`(root `src/renderer`, `@vitejs/plugin-vue`+`@tailwindcss/vite`, `cacheDir: node_modules/.vite-demo`, `127.0.0.1:5199`), `src/renderer/demo.html`(`/src/demo.ts` 를 부름), `src/renderer/src/demo.ts`(`testing/fixtures` 로 지어낸 스냅샷 — 작업 공간 shop-web-coupon·shop-web·admin-console, Claude 작업 중·Codex 응답 대기·Claude 쉬는 중, vite :5173·api :8080/:9090·next :3000 정리 후보, Playwright 남은 프로세스, 디스크 4줄 — 을 넣은 가짜 `window.pitwall` 뒤 `import('./main')`). `npx vite --config vite.demo.config.ts` 로 띄우고 Playwright 로 1280×904 에서 찍는다. 끝나면 세 파일을 지운다.

---

### Task 2: 상태 알약·묶음 머리 막대·가지 선(G5)

**Files:**

- Modify: `src/renderer/src/components/ItemTable.vue:235-240`(머리 줄), `:307-328`(머리 상태), `:394-445`(구성원 줄 이름 칸), `:455-471`(상태 칸)
- Modify: `src/renderer/src/styles/app.css`(아래 CSS)
- Test: `src/renderer/src/components/ItemTable.test.ts`

**Interfaces:**

- Consumes: Task 1 의 `--status-*` 토큰, `TONE_COLOR`.
- Produces(마크업 — 뒤 작업·테스트가 이 선택자를 쓴다):
  - 상태 알약: `<span class="status-pill" data-pill :data-tone="tone">…</span>` — `Cell.dot` 이 있는 칸만. 점(`size-1.5 rounded-full`)은 알약 안에서 없앤다. `badge`(메모리 증가 등)는 알약 밖 오른쪽에 그대로.
  - 묶음 머리 `<tr data-group … :data-tone="block.group.status.text ? (block.group.status.dot ?? 'idle') : 'idle'">`; 머리 상태 글자도 같은 `status-pill`.
  - 구성원 줄 이름 칸 안 맨 앞(묶음 안일 때만) `<span data-tree aria-hidden="true">`.
- CSS(`app.css`): `.status-pill`(inline-flex, `px-2 rounded-full text-xs`, 배경 `color-mix(in srgb, var(--pill) 13%, transparent)`, 글자 `var(--pill)`), `[data-tone=running|warn|stopped|idle]` 가 `--pill` 을 `--status-running|waiting|stopped|idle` 로. `.group-head[data-tone] > td:first-child { box-shadow: inset 3px 0 var(--pill) }`. `[data-tree]`: 이름 칸 왼쪽 들여쓰기(지금 28px) 안에 `└` 모양 1px 선, 색 `color-mix(in srgb, var(--border), var(--foreground) 15%)`.

- [ ] **Step 1: 실패하는 테스트**

```ts
test('상태 칸은 그 칸의 색(Tone)을 가진 알약으로 보인다', ...)
// 응답 대기 에이전트 줄의 상태 칸: find('[data-pill]').attributes('data-tone') === 'warn', 글자 '응답 대기 · 3분'
test('묶음 머리 줄은 머리 상태 색을 data-tone 으로 갖고, 상태 글자가 없으면 idle', ...)
test('묶음 안 구성원 줄의 이름 칸에는 가지 선이 있고, 묶음 없는 표에는 없다', ...)
// grouped: findAll('tr[data-depth="1"] [data-tree]').length === 구성원 수; 묶음 없는 탭: [data-tree] 없음
test('메모리 증가 배지는 알약 밖에 그대로 있다', ...)
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/renderer/src/components/ItemTable.test.ts`
- [ ] **Step 3: 마크업·CSS 구현**(Interfaces 대로)
- [ ] **Step 4: 통과 확인** — 같은 명령 + `npx vitest run`(점 선택자를 쓰던 다른 테스트가 있으면 알약 선택자로 고친다)
- [ ] **Step 5: 커밋** — `feat(ui): 표 상태를 색 알약으로, 작업 공간 묶음에 상태 막대와 가지 선`

---

### Task 3: 작업 공간 탭 구성원 이름(G5)

**Files:**

- Modify: `src/renderer/src/rows.ts:78-91`(`Cell.sub`), `:486-520`(`memberLine`, `workspaceRows`)
- Modify: `src/renderer/src/components/ItemTable.vue`(이름 뒤 `sub`)
- Test: `src/renderer/src/rows.test.ts`, `src/renderer/src/App.test.ts`(작업 공간 탭 이름을 폴더 이름으로 기대하던 곳)

**Interfaces:**

- Produces: `Cell.sub?: string` — 이름 뒤에 흐리게(`text-xs text-muted-foreground`, 앞에 간격) 붙는 글자. ItemTable 은 `name` 칸에서만 그린다.
- Produces: `memberLine(line: Row, kind: MemberKind, who: { name: string; worktree: WorktreeInfo | null; workspaceRoot: string | null }): Row` — `name.text = who.name`, `name.sub` = 워크트리가 있고 `workspaceRoot` 가 있고 두 경로가 다르면(`agentCovers` 양방향으로 같은 경로인지 본다 — `disk.ts` 의 `samePath` 와 같은 규칙, 렌더러에 같은 함수가 있으면 쓰고 없으면 `rows.ts` 에 둔다) `` `${folderOf(worktree)} · ${worktree.branch ?? text.detached}` ``, 아니면 없음. `name.title`·`icon` 은 원래 줄 그대로. 검색 글자에 `who.name` 을 더한다.
- 이름: 에이전트 `text.ui.agent.toolNames[a.tool]`, 서버 `serverName(p, s.platform)`, 무거운 작업 `j.label`, 남은 프로세스 `l.label`. `workspaceRoot` 는 그 줄의 키가 든 `s.workspaces` 줄의 `root`.
- Produces: `export function serverName(row: ServerRow, platform: Platform | null): string` — `serverIcon(row, platform).brand?.title ?? row.processName.replace(/\.exe$/i, '')`(Task 6 이 쓴다).
- Produces: `agentLine` 을 `rows.ts` 에서 export 한다(Task 6 이 상태·하는 일 글자를 같은 문구로 쓰려고).

- [ ] **Step 1: 실패하는 테스트(`rows.test.ts`)**

```ts
test('작업 공간 탭 구성원 이름은 무엇인지 — 도구·브랜드·이름', ...)
// agentRow(tool 'codex') → 'Codex'; serverRow(commandLine 'node node_modules/vite/bin/vite.js') → 'Vite';
// serverRow(commandLine 'java -jar api.jar', processName 'java.exe') → 'java'; leftoverRow(label 'Playwright 브라우저') → 그대로
test('바깥 작업 공간에 든 다른 워크트리면 이름 뒤에 폴더 · 브랜치, 같은 폴더면 없다', ...)
// workspace root 'C:\\work\\ws', 에이전트 worktree 'C:\\work\\ws\\api'(feat/api) → sub 'api · feat/api'
// worktree root === workspace root(대소문자·끝 구분자만 다름) → sub undefined
test('다른 탭의 이름 칸은 그대로 폴더 이름이다', ...)  // tableFor('agents', s) 의 name.text === 폴더 이름
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/renderer/src/rows.test.ts`
- [ ] **Step 3: 구현**(Interfaces 대로) + ItemTable 에 `sub` 그리기
- [ ] **Step 4: 통과 확인** — `npx vitest run`(작업 공간 탭에서 폴더 이름을 기대하던 테스트를 새 이름으로 고친다)
- [ ] **Step 5: 커밋** — `feat(ui): 작업 공간 탭 구성원 이름을 무엇인지로(Claude Code·Vite 등), 다른 워크트리면 폴더 · 브랜치`

---

### Task 4: 밑줄 탭(G4)

**Files:**

- Create: `src/renderer/src/ui/TabBar.vue`, `src/renderer/src/ui/TabBar.test.ts`
- Modify: `src/renderer/src/components/ToolBar.vue:38-74`, `src/renderer/src/components/SettingsView.vue:237-247`
- Modify: `src/shared/text.ts`(`ui.tabs.more: '더 보기'`)
- Test(고침): `ToolBar.test.ts`, `App.test.ts`(`openTab`·`pressedTab`·`toggle-group-item` 선택자), 그 밖에 탭을 `toggle-group-item` 으로 찾는 테스트

**Interfaces:**

- Produces `TabBar.vue`:
  - `defineModel<string>({ required: true })`
  - props `{ options: TabOption[]; more?: TabOption[]; moreLabel?: string; ariaLabel?: string }`, `TabOption = { value: string; label: string; icon?: Component; count?: number | null }`(`ToggleOption` 과 같은 모양 — `ToggleGroup.vue` 에서 가져다 쓰거나 같은 꼴로 export).
  - 마크업: `<div role="tablist" :aria-label>`; 탭마다 `<button role="tab" data-slot="tab" :data-value :aria-selected :tabindex="selected ? 0 : -1">`, 아이콘·이름·`count`(작고 흐리게, 고른 탭이면 민트). 고른 탭: 굵게 + 아래 2px `var(--primary)`. 탭 줄 높이는 지금 `ToggleGroup`(sm) 과 같게.
  - 더 보기(`more` 가 있을 때만): `<button data-slot="tab-more" aria-haspopup="menu" :aria-expanded>` — 고른 값이 `more` 안이면 그 이름 + ▾ 를 고른 탭 모양으로, 아니면 `moreLabel` + ▾. 메뉴는 `ui/Popover.vue`(`kind="menu"`) 안에 `<button role="menuitemradio" data-slot="tab-more-item" :data-value :aria-checked>`.
  - 키보드: 탭·더 보기 단추에서 ←/→ 로 이웃한 칸(끝에서 처음으로 돈다)에 초점 + 탭이면 고르기. 더 보기는 Enter·Space·↓ 로 메뉴 열기.
- ToolBar: `options` = 작업 공간·개발 서버·에이전트·남은 프로세스·무거운 작업·디스크 정리(지금 숫자 규칙 그대로), `more` = 다른 앱·기록(숫자 없음), `moreLabel = text.ui.tabs.more`.
- SettingsView: 구역 전환을 TabBar 로(아이콘 그대로, `more` 없음). 목록/묶음·자세히/간단히/접기 전환은 `ToggleGroup` 그대로.

- [ ] **Step 1: 실패하는 테스트(`TabBar.test.ts`)**

```ts
test('tablist 안 탭마다 aria-selected 와 data-value, 고른 탭만 tabindex 0', ...)
test('탭을 누르면 v-model 이 바뀐다', ...)
test('→ 는 다음 탭을 고르고 끝에서는 더 보기 단추로, 거기서 → 는 처음 탭으로', ...)
test('더 보기에서 기록을 고르면 v-model 이 events, 단추 글자가 "기록"', ...)
test('more 가 없으면 더 보기 단추도 없다', ...)
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/renderer/src/ui/TabBar.test.ts`
- [ ] **Step 3: TabBar 구현, ToolBar·SettingsView 에 쓰기, `text.ui.tabs.more` 추가**
- [ ] **Step 4: 기존 테스트 고치기** — `App.test.ts` 의 `openTab(w, tab)` 은 `apps`·`events` 면 `[data-slot="tab-more"]` → `[data-slot="tab-more-item"][data-value=…]`, 아니면 `[data-slot="tab"][data-value=…]` 를 누른다. `pressedTab` 은 `[data-slot="tab"][aria-selected="true"]`(없으면 더 보기 단추의 고른 값). `ToolBar.test.ts` 는 여섯 탭 순서와 더 보기 안 두 탭을 확인하게.
- [ ] **Step 5: 통과 확인** — `npx vitest run`
- [ ] **Step 6: 커밋** — `feat(ui): 탭을 밑줄 탭으로, 다른 앱·기록은 더 보기로(설정 화면 구역도 같은 탭)`

---

### Task 5: 카드 강조·조용한 카드(G2)

**Files:**

- Modify: `src/renderer/src/layoutState.ts:148-154`(`cardColumns`)
- Modify: `src/renderer/src/components/StatsBar.vue`(카드 칸 `:418-446`, 서버 `:595-671`, 에이전트 `:674-777`, 무거운 작업·남은 프로세스·응답 대기 카드)
- Modify: `src/renderer/src/styles/app.css`(카드 강조), `src/shared/text.ts`(`ui.cards.none: '없음'`, `ui.cards.waitingLine(n, tool, duration | null)`, `ui.cards.candidateLine(n)`)
- Test: `src/renderer/src/layoutState.test.ts`, `src/renderer/src/components/StatsBar.test.ts`

**Interfaces:**

- Produces: `cardColumns(ids: CardId[], quiet: CardId[] = []): string` — `quiet` 에 든 카드는 `minmax(104px, 104px)`, 나머지는 지금 그대로.
- StatsBar 안(내보내지 않음): `attention: Partial<Record<CardId, 'warn' | 'stopped'>>` — `agents`·`waiting` 은 응답 대기가 있으면 `warn`, `servers` 는 정리 후보가 있으면 `stopped`. `quiet: CardId[]` — 편집 중이면 `[]`, 아니면 `heavy`(무거운 작업 0), `leftovers`(`s.leftovers.length === 0`), `servers`(서버 0), `agents`(에이전트 0), `waiting`(응답 대기 0). 칸 `div[data-card]` 에 `:data-attention`·`:data-quiet`.
- 조용한 카드 모양: 자세히 `h-60`·간단히 지금 높이 그대로, 아이콘 칩(회색) + 제목 + `없음`(흐리게). 누르면 지금처럼 그 탭으로.
- `waitingLine(n, tool, duration)`: duration 이 있으면 `` `응답 대기 ${n} · ${tool} ${duration}` ``, null 이면 `` `응답 대기 ${n} · ${tool}` ``. 도구·경과는 응답 대기 에이전트 가운데 `stateSince` 가 가장 이른 것(`null` 은 맨 뒤 — 모두 null 이면 첫 에이전트, 경과 null), 경과는 `formatDuration(now − stateSince)`.
- CSS: `[data-card][data-attention] [data-slot='card']` 위쪽 3px 띠(`box-shadow: inset 0 3px 0 var(--attn)`)와 링 색 `color-mix(in srgb, var(--attn) 45%, var(--border))`, `--attn` 은 `warn` → `--status-waiting`, `stopped` → `--status-stopped`.

- [ ] **Step 1: 실패하는 테스트**

```ts
// layoutState.test.ts
test('조용한 카드 칸은 104px 고정, 나머지는 그대로', ...)
// cardColumns(['memory','heavy'], ['heavy']) === 'minmax(240px, 1.5fr) minmax(104px, 104px)'
// StatsBar.test.ts
test('무거운 작업·남은 프로세스가 0 이면 그 카드는 조용한 카드(없음), 편집 중에는 접지 않는다', ...)
test('응답 대기가 있으면 에이전트 카드에 data-attention="warn", 간단히 단계 줄은 "응답 대기 2 · Codex 3분"', ...)
test('응답 대기 시작 시각을 모르면 간단히 줄은 경과 없이 "응답 대기 1 · Codex"', ...)
test('정리 후보가 있으면 개발 서버 카드에 data-attention="stopped", 간단히 줄은 "정리 후보 1"', ...)
test('할 일이 없으면 data-attention 이 없다', ...)
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/renderer/src/layoutState.test.ts src/renderer/src/components/StatsBar.test.ts`
- [ ] **Step 3: 구현**(Interfaces 대로. 자세히 단계는 줄을 더하지 않고 "응답 대기 n"·"정리 후보 n" 숫자를 상태 색 굵은 글자로)
- [ ] **Step 4: 통과 확인** — `npx vitest run`
- [ ] **Step 5: 커밋** — `feat(ui): 할 일이 있는 카드는 상태 색으로 강조, 0 인 카드는 좁고 조용하게`

---

### Task 6: 할 일 띠(G3)

**Files:**

- Create: `src/renderer/src/attention.ts`, `src/renderer/src/attention.test.ts`
- Create: `src/renderer/src/components/AttentionStrip.vue`, `src/renderer/src/components/AttentionStrip.test.ts`
- Modify: `src/renderer/src/App.vue:878-930`(추천 계산), `:1054-1121`(정리 추천·무거운 작업 겹침 `NoticeCard` 두 개 → `AttentionStrip`)
- Modify: `src/shared/text.ts`(`ui.attention: { label: '할 일', idleFor: (d) => \`${d} 동안 아무도 안 써요\`, more: (n) => \`외 ${n}개\`, less: '접기' }`)
- Test(고침): `App.test.ts` 의 `.recommend-box`·`.heavy-box` 를 쓰는 테스트

**Interfaces:**

- Produces(`attention.ts`):

```ts
export type AttentionKind = 'waiting' | 'recommend' | 'candidate' | 'overlap'
export interface AttentionItem {
  /** 같은 대상이면 갱신해도 같다: `waiting:<에이전트 키>` · 'recommend' · `candidate:<서버 키>` · 'overlap'. */
  id: string
  /** 닫은 뒤 이 값이 바뀌면 다시 보인다. */
  state: string
  kind: AttentionKind
  tone: Tone // 줄 왼쪽 점·메시지 색. recommend 는 메모리 단계(warn → 'warn', danger → 'stopped')
  /** 굵은 이름과 흐린 위치("Codex" · "shop-web", "next :3000" · "admin-console"). */
  name: string
  where: string | null
  message: string
  detail: string | null
  /** 단추가 쓰는 선택 키(waiting: 에이전트 키, candidate: 서버 키). */
  key: string | null
  /** recommend 만: 끌 키 전부. */
  keys?: string[]
}
export function attentionItems(s: DashboardSnapshot, now: number): AttentionItem[]
export function visibleAttention(
  items: AttentionItem[],
  dismissed: ReadonlyMap<string, string>
): AttentionItem[]
```

- 규칙(설계 §5 G3): 순서는 종류(waiting → recommend → candidate → overlap), 같은 종류 안에서 waiting 은 `stateSince` 이른 순(null 맨 뒤), candidate 는 `idleSince` 이른 순, 같으면 `id` 순.
  - waiting: 응답 대기 에이전트마다. `name` = 도구 이름, `where` = `folderOf(a.worktree)`, `message`·`detail` = `agentLine(a, s)` 의 `status`·`activity` 칸 글자(activity 가 `—`(muted) 면 null), `state` = `` `${stateSince}` ``.
  - recommend: 메모리 단계가 normal 이 아니고 `cleanupRecommendation(s).items` 가 있을 때 하나. `message` = `text.ui.home.recommendSummary(n, formatFreed(…))`, `keys` = 항목 키, `state` = 지금 App 의 `recommendState` 와 같은 문자열(`level|정렬한 키`).
  - candidate: `judgement === 'candidate'` 서버마다, recommend 의 `keys` 에 든 서버는 뺀다(닫았든 아니든). `name` = `` `${serverName(p, s.platform)} :${p.ports[0]}` ``(Task 3), `where` = 작업 공간 이름(없으면 폴더), `message` = `text.ui.attention.idleFor(formatDuration(now − idleSince))`, `detail` = 메모리 크기, `state` = `` `${idleSince}` ``.
  - overlap: `s.heavyOverlap` 일 때 하나. `message` = `text.ui.home.heavyOverlap(pressureText(s.memory), s.heavyJobs.length)`, `state` = 무거운 작업 키를 정렬해 이은 것.
  - `visibleAttention`: `dismissed.get(id) === state` 인 줄을 뺀다.
- Produces(`AttentionStrip.vue`): props `{ items: AttentionItem[]; busy?: boolean; chips?: RecommendChip[] }` — `RecommendChip` 은 지금 App 의 `recommendChips` 가 만드는 항목 모양(`key`·`icon`·`title`·`where`·`memoryBytes`·`commitBytes`)을 타입으로 내보낸 것이고, 칩 그리기(크기 글자 `text.ui.home.chipSize` 포함)는 지금 App 템플릿의 칩 마크업을 띠로 옮긴다. emits `focus(key)`·`kill(key)`·`killMany(keys)`·`showHeavy()`·`select(key)`·`dismiss(id, state)`. `section[aria-label="할 일"]`, 줄마다 `div[data-attention-item][data-kind]`, 단추 글자: waiting `text.ui.quick.focus`, recommend `text.ui.home.killAll`(지금처럼 `data-action="kill-many"`), candidate `text.ui.actions.kill`, overlap `text.ui.cards.showList`. 닫기 단추 `aria-label=text.ui.bar.dismiss`. 처음 3줄, 넘치면 `외 n개`/`접기`. 줄이 없으면 아무것도 그리지 않는다.
- App: `dismissed = ref(new Map<string,string>())`(앱을 다시 켜면 비어 있다), `attention = visibleAttention(attentionItems(snapshot, now), dismissed)`. 단추: focus → 지금 `focusAgent(key)`, kill → `act('kill', key)`, killMany → 지금 `killMany(keys)`, showHeavy → `tab = 'heavy'; query = ''`, select → `select(key)`. 자리: "자리 비운 사이" 카드 아래, ToolBar 위. 지금 `recommendDismissed`·`showRecommend` 는 없앤다.

- [ ] **Step 1: 실패하는 테스트(`attention.test.ts`)**

```ts
test('응답 대기 에이전트마다 한 줄, 오래 기다린 순, 시작 시각을 모르면 맨 뒤', ...)
test('스냅샷의 에이전트 순서가 바뀌어도 줄 순서는 같다', ...)
test('메모리 경고 + 후보가 있으면 정리 추천 한 줄, 그 안의 서버는 정리 후보 줄로 또 나오지 않는다', ...)
test('메모리가 정상이면 추천 줄은 없고 정리 후보 서버가 한 줄씩(이름 "Vite :5173", 메시지 "42분 동안 아무도 안 써요")', ...)
test('무거운 작업 겹침은 한 줄', ...)
test('닫은 줄은 state 가 같은 동안 빠지고, state 가 바뀌면 다시 보인다', ...)
```

`AttentionStrip.test.ts`:

```ts
test('줄이 없으면 아무것도 그리지 않는다', ...)
test('네 줄이면 세 줄 + "외 1개", 누르면 모두', ...)
test('응답 대기 줄의 창으로 가기는 focus(키), 닫기는 dismiss(id, state)', ...)
```

`App.test.ts`(고치거나 더함): 정리 추천의 `모두 끄기`(`data-action="kill-many"`)가 `killMany` 를 부른다, 응답 대기 줄의 창으로 가기가 `focusAgent` 를 부른다, 닫은 추천 줄은 후보가 바뀌면 다시 보인다.

- [ ] **Step 2: 실패 확인** — `npx vitest run src/renderer/src/attention.test.ts src/renderer/src/components/AttentionStrip.test.ts`
- [ ] **Step 3: `attention.ts` 구현**
- [ ] **Step 4: `AttentionStrip.vue` 구현, App 에 붙이고 두 알림 상자 없애기**
- [ ] **Step 5: 통과 확인** — `npx vitest run`
- [ ] **Step 6: 커밋** — `feat(ui): 할 일 띠 — 응답 대기·정리 추천·정리 후보·무거운 작업 겹침을 한 줄씩 바로 처리`

---

### Task 7: 픽셀 추이(G6)

**Files:**

- Create: `src/renderer/src/pixelTrend.ts`, `src/renderer/src/pixelTrend.test.ts`
- Create: `src/renderer/src/components/PixelTrend.vue`
- Modify: `src/renderer/src/components/StatsBar.vue:580-589`(메모리 카드 자세히의 `ResourceTrend` → `PixelTrend`), StatsBar props 에 `warnPercent`·`dangerPercent`
- Modify: `src/renderer/src/App.vue`(StatsBar 에 `settings.ramWarnPercent`·`ramDangerPercent` 넘기기)
- Modify: `src/renderer/src/components/TitleBar.vue:68`(실시간 점 → 작은 정사각형, `rounded-[1px]`)
- Test: `src/renderer/src/components/StatsBar.test.ts`

**Interfaces:**

- Produces: `pixelBuckets(points: Point[], end: number, windowMs: number, count: number, gapMs?: number | null): (number | null)[]` — `[end − windowMs, end)` 를 `count` 칸으로 나눠 칸마다 그 칸에 든 점 값의 최댓값, 점이 없으면 `null`. 마지막 점(t = end)은 마지막 칸에 넣는다. `gapMs` 는 쓰지 않아도 결과가 같다(빈 칸이 곧 끊김) — 인자는 받지 않아도 된다.
- Produces: `PixelTrend.vue` props `{ points: Point[]; windowMs: number; label: string; format: (v: number) => string; range: string; warn: number; danger: number }` — 칸 24 개(`BAR_COUNT = 24`), 높이 48px(ResourceTrend 와 같다), 칸 사이 1px, 모서리 없음, 칸 색 = 값 ≥ danger → `--status-stopped`, ≥ warn → `--status-waiting`, 그 밖 `--status-running`. 아래 설명 줄·`role="img"`+`aria-label`·마우스를 올리면 그 칸의 시각·값 풍선말은 ResourceTrend 와 같은 문구·모양(`data-slot="chart-tooltip"`). 루트에 `data-pixel-trend`.

- [ ] **Step 1: 실패하는 테스트**

```ts
// pixelTrend.test.ts
test('24 칸으로 나눠 칸마다 최댓값, 점이 없는 칸은 null', ...)
// end=240_000, windowMs=240_000, count=24 → 칸 너비 10_000. 점 (5_000,40) (8_000,55) → 0번 칸 55, 1번 칸 null
test('끝 시각의 점은 마지막 칸에 든다', ...)
test('창 밖(오래된) 점은 버린다', ...)
// StatsBar.test.ts
test('메모리 카드(자세히)의 추이는 24칸 픽셀 막대이고, 경고 기준을 넘은 칸은 노랑', ...)
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/renderer/src/pixelTrend.test.ts src/renderer/src/components/StatsBar.test.ts`
- [ ] **Step 3: 구현** — `pixelBuckets`, `PixelTrend.vue`, StatsBar·App 연결, TitleBar 점
- [ ] **Step 4: 통과 확인** — `npx vitest run`
- [ ] **Step 5: 커밋** — `feat(ui): 메모리 카드 추이를 아이콘처럼 픽셀 막대로`

---

### Task 8: 마무리 — 문서·스크린샷·전체 검토

**Files:**

- Modify: `README.md`(이미지 세 장 그대로 경로), `docs/images/overview.png`·`agents.png`·`disk.png`(다시 찍기)
- Modify: `docs/details.md`(탭 "더 보기"·할 일 띠와 맞지 않는 설명이 있으면)
- Modify: `docs/superpowers/specs/2026-11-12-corral-7-identity-design.md`(상태: 구현됨, 구현하며 바뀐 것이 있으면 §8 로 적는다)

- [ ] **Step 1: 스크린샷** — Task 1 의 "예시 화면"으로 첫 화면(1280×904, 자세히)·에이전트 탭(카드 접기, 1280×350)·디스크 정리 탭(카드 접기, 1280×392)을 어두운 테마로 다시 찍어 `docs/images/` 에 덮어쓴다. 예시 화면 파일은 지운다.
- [ ] **Step 2: 문서 고치기**(위 Files)
- [ ] **Step 3: 전체 확인** — `npm run typecheck`, `npm run lint`, `npx prettier --check src`, `npx vitest run` 모두 통과
- [ ] **Step 4: 커밋** — `docs: 7단계 화면으로 스크린샷·문서를 고친다`
