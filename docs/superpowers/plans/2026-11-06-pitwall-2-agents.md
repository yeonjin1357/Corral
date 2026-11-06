# pitwall 2단계(에이전트·정리 후보·남은 프로세스) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 지금 돌아가는 Claude Code·Codex 에이전트를 워크트리별로 보여 주고(Claude 는 훅 연동으로 "권한 대기"까지), 안 쓰는 포트를 두 단계로 판단해 정리 후보로 표시하며, 주인 없이 남은 개발 도구 프로세스를 찾아 확인 후 정리할 수 있게 한다.

**Architecture:** 수집 결과에 프로세스 CPU 시간을 더해, 에이전트 하위 트리의 CPU 변화로 "작업 중/쉬는 중"을 판단한다(훅 없이도 동작). Claude 훅을 켜면 로컬 HTTP 서버(127.0.0.1, 토큰)가 훅 이벤트를 받아 세션 상태(작업 중·권한 대기·쉬는 중)를 덮어쓴다. 메인 프로세스의 수집기(collector)가 이전 샘플의 CPU 와 포트별 "안 쓰인 시각"을 기억해 판단한다. 화면은 Uptime Kuma 목록의 그룹(개발 서버 포트·에이전트·남은 프로세스)과 상세 화면 구성을 따른다.

**Tech Stack:** 1단계와 같음(Electron 45, Vue 3.5, TypeScript 5.9, Vitest 5). Node `http` 로 훅 서버.

**Spec:** `docs/superpowers/specs/2026-11-06-pitwall-design.md` (§3 의 1·4·5, §5, §8 Claude 연동)

## Global Constraints

- 1단계 Global Constraints 를 그대로 따른다(공개 레포에 회사 정보 없음, 끄는 동작은 항상 네이티브 확인 창, 문구는 `src/shared/text.ts`, Windows·macOS 둘 다).
- **실제 `~/.claude/settings.json` 은 사용자가 앱에서 "Claude 연동 켜기"를 누를 때만 바꾼다.** 개발·테스트는 임시 폴더(`CLAUDE_CONFIG_DIR`)로 한다.
- 훅 명령은 pitwall 이 꺼져 있어도 Claude 에 오류 알림이 뜨지 않게 항상 종료 코드 0 으로 끝나고(`async: true`, `timeout: 5`), 다른 도구(Orca 등)의 훅·설정 키·순서를 보존한다. 끌 때는 pitwall 이 넣은 항목만 지운다. 바꾸기 전에 백업을 남긴다.
- 훅 서버는 127.0.0.1 에만 열고, 무작위 토큰이 맞을 때만 받는다(다른 웹페이지가 보내는 요청 차단).
- 에이전트 자체는 끄지 않는다(스펙 §4 비목표). 하위에 에이전트가 있는 프로세스도 끄지 않는다(1단계 최종 검토 수정 유지).
- 안 쓰는 포트 기준 시간 기본 20분(`DEFAULT_IDLE_PORT_MS`).
- Codex 훅 연동은 이번 단계에서 하지 않는다(Windows 에서 훅 명령 실행 방식이 확인되지 않음). Codex 는 프로세스·CPU 로만 판단한다.

## Review Focus

1. **설정 파일 보존** — 다른 도구 훅이 있는 settings.json, 주석·후행 쉼표가 있는 settings.json, 없는 파일, 깨진 JSON. 깨진 파일은 고치지 않고 거절해야 한다. → Task 4
2. **훅 명령이 실제로 조용히 끝나는지** — pitwall 서버가 꺼져 있을 때 종료 코드 0, 켜져 있을 때 이벤트 도착, 사용자 이름에 공백이 있어도 동작. → Task 4 실제 Windows 테스트(cmd.exe 를 args 로 직접 실행)
3. **세션 ↔ 프로세스 연결** — 같은 워크트리에 Claude 세션이 여럿이면 가장 급한 상태(권한 대기 > 작업 중 > 쉬는 중)를 보인다. 끝난 세션은 남지 않는다. → Task 3
4. **CPU 판단의 첫 샘플·pid 재사용** — 이전 샘플이 없으면 "알 수 없음", 같은 pid 라도 시작 시각이 다르면 새 프로세스. → Task 2
5. **남은 프로세스 오판** — 부모가 살아 있는 프로세스, 에이전트·포트 서버·pitwall 자신, 시스템 프로세스를 남은 프로세스로 올리면 안 된다. → Task 6

---

### Task 1: CPU 시간·에이전트 작업 폴더 수집

**Files:** Modify `src/shared/types.ts`, `src/main/collect/windows.ts`(+test), `src/main/collect/darwin.ts`(+test)

- `ProcessInfo.cpuMs: number | null` — 누적 CPU 시간(ms).
  - Windows: `(KernelModeTime + UserModeTime) / 10000`(Win32_Process, 100ns 단위). 기본·대체 스크립트 둘 다.
  - macOS: `ps -o time=`(`[[dd-]hh:]mm:ss[.cc]`) 를 ms 로. 열 순서 `pid=,ppid=,rss=,time=,lstart=,comm=`.
- 작업 폴더 조회 대상에 에이전트 후보를 더한다: Windows 스크립트는 이름이 `^(claude|codex)` 이거나 명령줄에 `@anthropic-ai[\\/]claude-code|@openai[\\/]codex` 가 있는 pid, macOS 는 `classifyAgent` 인 pid.
- 테스트: 두 OS 파서의 CPU 값, 시간 형식 4가지(`0:01.50`, `12:03.00`, `1:02:03`, `2-01:00:00`), 스크립트에 에이전트 후보 cwd 조회가 있는지, 실제 Windows 샘플에서 자기 프로세스 cpuMs > 0.

### Task 2: 에이전트 행과 CPU 활동 판단

**Files:** Create `src/main/agents.ts`(+test); Modify `src/shared/types.ts`

```ts
export type AgentTool = 'claude' | 'codex'
export type AgentState = 'working' | 'waiting' | 'idle' | 'error' | 'unknown'
export interface AgentRow { pid; tool; worktree: WorktreeInfo | null; startedAt; memoryBytes; descendantCount; state: AgentState; stateSource: 'hook' | 'cpu'; cpuPercent: number | null }
export function buildAgents(input: { sample; worktrees; devServerPids: Set<number>; previousCpu: Map<string, { cpuMs: number; at: number }>; now; hookStates?: (worktreeRoot: string) => AgentState | null }): { agents: AgentRow[]; cpu: Map<string, { cpuMs: number; at: number }> }
```
- 최상위 에이전트만 행(에이전트 조상이 있으면 그 세션의 일부). 하위 트리 CPU 합의 변화율이 코어 1개 기준 2% 이상이면 working, 아니면 idle, 이전 값이 없으면 unknown. 키는 `pid:startedAt`(pid 재사용 구분).
- 메모리 = 자기 + 자손 중 개발 서버가 아닌 것. 훅 상태가 있으면 그것이 우선(stateSource 'hook').
- 테스트: 첫 샘플 unknown, 2% 경계, pid 재사용, 하위 에이전트는 행이 아님, 훅 상태 우선, Codex 행.

### Task 3: 훅 서버와 세션 상태

**Files:** Create `src/main/hookServer.ts`, `src/main/sessions.ts`(+tests)

- `createHookServer({ port, token, onEvent })`: `POST /pitwall-hook/claude?t=<token>` 만 받는다. 토큰 불일치 403, 그 밖 404, 본문 1MB 제한, JSON 오류 400. 응답 204. 127.0.0.1 에만 연다.
- `applyHookEvent(sessions, ev, now)`: SessionStart→idle, UserPromptSubmit·PostToolUse→working, PermissionRequest·Notification(permission_prompt)→waiting, Notification(idle_prompt)·Stop→idle, StopFailure→error, SessionEnd→삭제. 6시간 동안 소식이 없으면 버린다.
- `stateForWorktree(sessions, root, resolve)`: 같은 워크트리 세션 중 waiting > working > error > idle 순으로 하나.
- 테스트: 실제 http 서버(포트 0)로 토큰·경로·크기·JSON 검사, 상태 전이 표, 우선순위, 만료.

### Task 4: Claude 훅 설치·해제

**Files:** Create `src/main/claudeHooks.ts`(+test), `src/main/config.ts`(+test)

- `claudeConfigDir(env, home)`: `CLAUDE_CONFIG_DIR` 가 있으면 그것, 아니면 `~/.claude`.
- `hookCommand(platform, port, token)`: Windows `{ command: 'C:\\Windows\\System32\\cmd.exe', args: ['/d', '/c', '<curl.exe ...> >nul 2>&1 & exit /b 0'] }`, macOS `{ command: '/bin/sh', args: ['-c', '/usr/bin/curl ... >/dev/null 2>&1; exit 0'] }`. curl 은 `-s -m 2 --data-binary @- http://127.0.0.1:<port>/pitwall-hook/claude?t=<token>`.
- `withPitwallHooks(settings, hook)`, `withoutPitwallHooks(settings)`, `hasPitwallHooks(settings)`: 이벤트 SessionStart·UserPromptSubmit·PermissionRequest·Notification·PostToolUse·Stop·StopFailure·SessionEnd 에 `{ type: 'command', command, args, async: true, timeout: 5 }` 그룹을 더한다. 표시는 명령에 `pitwall-hook` 이 들어 있는지로 한다. 다른 키·훅·순서 보존, 두 번 켜도 한 번만.
- `installClaudeHooks/uninstallClaudeHooks({ dir, hook, now })`: 파일이 없으면 만들고, 있으면 `settings.json.pitwall-backup-<시각>` 으로 백업 후 임시 파일에 쓰고 바꾼다. 주석·후행 쉼표는 JSONC 로 읽되, 해석이 안 되면 바꾸지 않고 오류로 돌려준다.
- `loadConfig/saveConfig(userData)`: `{ hook: { port, token } }` — 처음 켤 때 빈 포트(40000~60000)와 32바이트 토큰을 만든다.
- 테스트: 순수 함수 표, 파일 입출력(임시 폴더), **실제 Windows: 위 hookCommand 를 args 그대로 spawn 해 stdin JSON 을 보내면 테스트 서버에 도착하고, 서버가 없어도 종료 코드 0. 공백이 있는 경로에서도.**

### Task 5: 안 쓰는 포트 두 단계 판단과 에이전트 워크트리 보호

**Files:** Create `src/main/judge.ts`(+test); Modify `src/shared/types.ts`, `src/main/kill.ts`(+test)

- `PortRow` 에 `judgement: 'candidate' | 'check' | null`, `idleSince: number | null`, `agentInWorktree: boolean`.
- `judgePorts(rows, agents, previous, now, thresholdMs)`: 같은 워크트리에 에이전트가 없고 연결 0 이 기준 시간 이상이면 candidate, 에이전트가 없고 연결만 있는(탭만 열린) 상태가 기준 시간 이상이면 check. 상태가 바뀌면 시각을 새로 센다. 판별 불가 포트는 판단하지 않는다.
- 확인 창: 같은 워크트리에 에이전트가 있으면 "이 워크트리에서 에이전트가 작업 중이에요." 줄을 더한다.

### Task 6: 남은 프로세스

**Files:** Create `src/main/leftovers.ts`(+test); Modify `src/main/kill.ts`(+test), IPC

- `LeftoverRow { pid; processName; label; commandLine; worktree; memoryBytes; descendantPids; startedAt }`.
- `findLeftovers(sample, worktrees, exclude: Set<number>)`: 부모가 없거나(시작 시각상 가짜 부모 포함, macOS 는 ppid 1) 명령줄이 개발 도구(`ms-playwright|playwright|--remote-debugging-pipe|vitest|jest-worker|esbuild|node_modules[\\/]\.bin|webpack|tsserver|--headless`)이고, 개발 서버·에이전트·pitwall 트리가 아닌 최상위 프로세스. 자손 포함.
- `processLabel(p)`: Gradle 데몬·Kotlin 데몬·Playwright 브라우저·vitest·esbuild 등 알아보기 쉬운 이름, 없으면 프로세스 이름.
- 내리기: `killLeftover(pid)` — 포트 내리기와 같은 확인(최신 샘플 재확인·확인 창·하위 에이전트 거절).

### Task 7: 수집기와 IPC 연결

**Files:** Create `src/main/collector.ts`(+test); Modify `src/main/index.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`

- `createCollector(deps)`: 샘플 → 메모리 → worktree → 스냅샷 → 에이전트 → 포트 판단 → 남은 프로세스. 이전 CPU·포트 시각을 기억. 스냅샷에 `agents`, `leftovers`, `hook: { claude: 'off' | 'on' | 'error' }`.
- IPC: `killLeftover(pid)`, `claudeHook.status/enable/disable`(켜기·끄기는 메인에서 설정 파일 경로·백업을 보여 주는 확인 창).

### Task 8: 화면

**Files:** Modify `PortList.vue` → 그룹 목록, `HomeView.vue`, `App.vue`; Create `AgentListItem.vue`, `LeftoverListItem.vue`, `AgentDetail.vue`, `LeftoverDetail.vue`, `ListGroup.vue`(+tests)

- 왼쪽 목록을 Uptime Kuma 그룹 모양(접기 화살표·이름·개수)으로 "개발 서버 포트 · 에이전트 · 남은 프로세스". 검색은 세 그룹 모두에 적용.
- 포트 항목에 판단 태그("정리 후보" 빨강, "확인해볼 것" 주황).
- 에이전트 항목: 알약 배지에 도구 이름(Claude·Codex), 색은 상태(작업 중 초록·권한 대기 주황·쉬는 중 회색·오류 빨강), 이름 = 워크트리 폴더, 태그 = 상태·브랜치, 하트비트 = 작업 중 여부 기록.
- 에이전트 상세: 상태 배지, 숫자 칸(메모리·하위 프로세스·실행 시간·CPU·상태 출처), 메모리 추이. 끄기 버튼 없음. "Claude 연동 켜기/끄기" 버튼은 에이전트 그룹 머리와 첫 화면에.
- 남은 프로세스 상세: 내리기 버튼, 숫자 칸(메모리·PID·하위 프로세스·시작 시각).
- 첫 화면 숫자 칸: 에이전트(권한 대기 n), 남은 프로세스 n, 정리 후보 n.

### Task 9: 실제 확인과 검토

- 실제 Windows 에서: 에이전트 5개가 워크트리별로 보이는지, CPU 판단이 바뀌는지, 임시 `CLAUDE_CONFIG_DIR` 로 켜기·끄기(설정 보존·백업) 후 훅 명령으로 보낸 이벤트가 상태를 바꾸는지, 남은 프로세스(부모를 끝낸 테스트 프로세스)가 잡히고 정리되는지.
- 최종 검토 에이전트 1개.
