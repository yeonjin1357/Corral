# pitwall

AI 코딩 에이전트(Claude Code, Codex)를 여러 git 워크트리에서 동시에 돌릴 때, 내 PC 에서 돌아가는 개발 작업 전체를 한눈에 보고 그 자리에서 정리하는 트레이 앱입니다. 이름은 F1 피트월(여러 차의 상태를 지켜보다가 필요하면 불러들이는 곳)에서 따왔습니다.

- 지원 OS: Windows 10/11, macOS(Intel·Apple Silicon — **아직 실제 Mac 에서 확인하지 않은 미검증 빌드**)
- 라이선스: MIT. 화면 디자인은 [NeoHtop](https://github.com/Abdenasser/neohtop)(MIT)을 가져와 한국어 앱에 맞게 바꿨습니다. → [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)

## 무엇을 보여 주나요

| 기능                       | 설명                                                                                                                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 에이전트 현황              | 실행 중인 Claude Code·Codex 세션, 어느 워크트리에서 도는지, 작업 중·쉬는 중(CPU 로 짐작). Claude 는 연동을 켜면 **권한 대기**까지 정확히 압니다.                                                  |
| RAM 현황                   | 전체 사용률과 묶음별 사용량(개발 서버·에이전트·무거운 작업·다른 앱·시스템), 메모리를 많이 쓰는 다른 앱 상위 5개.                                                                                  |
| 개발 서버 포트             | 열려 있는 개발용 포트, 그 포트를 연 프로세스, 워크트리·브랜치, 메모리, 연결 수. 확인 창을 거쳐 바로 내립니다.                                                                                     |
| 안 쓰는 포트 판단          | 에이전트가 없는 워크트리의 포트가 20분(설정) 동안 연결이 없으면 **정리 후보**, 브라우저 탭만 붙어 있으면 **확인해볼 것**.                                                                         |
| 남은 프로세스              | 실행한 쪽(에이전트·터미널)이 끝났는데 남은 Playwright 브라우저·테스트 러너·Gradle 데몬 등.                                                                                                        |
| 무거운 작업 겹침 경고      | 설정한 무거운 명령(타입 검사·빌드 등)이 둘 이상 겹치고 RAM 이 경고 기준을 넘을 때만 알립니다. 막거나 기다리게 하지 않습니다.                                                                      |
| 메모리 부족 경고·정리 추천 | RAM 이 기준을 넘으면 "이것들을 끄면 약 X GB 확보"처럼 정리 후보를 묶어 보여 주고, 확인 창 하나로 한꺼번에 끕니다.                                                                                 |
| 디스크 정리                | 끝난 워크트리(원격 브랜치가 지워졌거나 기본 브랜치에 머지됨, 실행 중인 것이 없음)의 `node_modules` 같은 의존성 폴더 크기를 보여 주고 지웁니다. 워크트리 자체와 메인 체크아웃은 건드리지 않습니다. |

트레이(메뉴바) 아이콘은 앱 아이콘과 같은 작은 모니터이고 그래프 선 색이 RAM 상태(초록·노랑·분홍)이며, 메뉴에서 RAM·에이전트(권한 대기 수)·정리 후보·새 버전을 바로 볼 수 있습니다. RAM 부족·Claude 권한 대기·무거운 작업 겹침은 OS 알림으로도 알려 줍니다(설정에서 항목별로 끔).

## 설치

[Releases](https://github.com/yeonjin1357/pitwall/releases) 에서 내려받습니다. 코드 서명 인증서가 없어 처음 실행할 때 OS 경고가 나옵니다.

### Windows

1. `pitwall-<버전>-setup.exe` 를 실행합니다(관리자 권한 없이 사용자 폴더에 설치).
2. "Windows의 PC 보호" 창이 뜨면 **추가 정보 → 실행** 을 누릅니다.
3. 새 버전은 자동으로 내려받고, 앱을 다시 시작할 때 설치됩니다.

회사 보안 프로그램이 서명 없는 실행 파일이나 PowerShell 사용을 막을 수 있습니다. 그 경우 수집 방식이 "제한 모드"로 바뀌며, 일부 정보(작업 폴더 등)가 빠질 수 있습니다.

### macOS (미검증)

1. Apple Silicon 은 `pitwall-<버전>-arm64.dmg`, Intel 은 `pitwall-<버전>-x64.dmg` 를 엽니다.
2. pitwall 을 응용 프로그램 폴더로 옮깁니다.
3. 처음 열 때 "확인되지 않은 개발자" 경고가 나오면 **시스템 설정 → 개인정보 보호 및 보안** 아래쪽의 **그래도 열기**를 누릅니다(macOS 14 이하는 Finder 에서 앱을 오른쪽 클릭 → 열기). "손상되었기 때문에 열 수 없습니다"가 나오면 터미널에서 아래를 실행한 뒤 다시 엽니다.
   ```bash
   xattr -dr com.apple.quarantine /Applications/pitwall.app
   ```
4. 서명이 없어 자동 업데이트가 되지 않습니다. 새 버전이 나오면 앱(설정 > 정보, 트레이 메뉴)이 알려 주고, 직접 다시 설치합니다.

디스크 정리는 `git` 을 씁니다. Xcode 명령줄 도구가 없는 Mac 에서는 처음 쓸 때 설치 창이 뜰 수 있습니다.

## 무엇을 읽고, 무엇을 바꾸나요

- **읽는 것(내 PC 안에서만):** 프로세스 목록과 명령줄·작업 폴더·메모리·CPU 시간, 열린 TCP 포트와 연결, git 저장소 정보(브랜치·워크트리 목록·원격 추적 상태). 어디로도 보내지 않습니다.
  - Windows 에서는 다른 프로세스의 작업 폴더를 알기 위해 작은 C# 보조 코드를 PowerShell 로 컴파일해 앱 데이터 폴더에 둡니다.
- **인터넷 접속:** 새 버전 확인(GitHub) 하나뿐이며 설정 > 일반에서 끌 수 있습니다. 사용자 정보는 보내지 않습니다.
- **바꾸는 것:**
  - 포트 내리기·프로세스 끄기·의존성 폴더 지우기는 **항상 확인 창**을 거치고, 누르기 직전에 최신 상태를 다시 확인합니다. 자동으로 끄거나 지우는 일은 없습니다. 에이전트 자체와, 아래에서 에이전트가 돌고 있는 프로세스는 끄지 않습니다.
  - Claude 설정 파일(`~/.claude/settings.json`, `CLAUDE_CONFIG_DIR` 이 있으면 그 폴더)은 **"Claude 연동 켜기"를 눌렀을 때만** 바꿉니다(아래).
  - 로그인할 때 실행(설정 > 일반, 기본 켬)을 위해 OS 로그인 항목에 등록합니다.

## Claude 연동

"Claude 연동 켜기"를 누르면 Claude Code 설정 파일에 훅을 더해, 세션 시작·프롬프트·권한 요청·알림·도구 사용·응답 끝·오류·세션 끝 이벤트를 pitwall 의 로컬 포트(127.0.0.1, 무작위 토큰)로 보냅니다.

- 바꾸기 전에 원래 파일을 `settings.json.pitwall-backup-<시각>` 으로 남깁니다.
- 다른 도구가 넣은 훅·주석·다른 설정은 그대로 둡니다. 끄면 pitwall 이 넣은 훅만 정확히 뺍니다.
- pitwall 이 꺼져 있어도 훅은 조용히 끝나(종료 코드 0) Claude 작업을 방해하지 않습니다.
- 이미 실행 중인 Claude 세션은 다시 시작해야 반영될 수 있습니다.

Codex 는 프로세스·CPU 사용량으로만 작업 중인지 짐작합니다.

## 설정

오른쪽 위 **설정**(또는 트레이 메뉴 > 설정)에서 바꿉니다.

- 일반: 갱신 주기(빠르게 2·10초 / 보통 5·30초 / 절약 15·120초 — 창이 열려 있을 때·닫혀 있을 때), 화면 테마, 로그인 시 실행, 새 버전 확인
- 기준값: RAM 경고·위험 기준(기본 80·90%), 안 쓰는 포트 기준 시간(기본 20분)
- 무거운 작업: 명령 패턴(예: `vue-tsc`, `vite build`)
- 알림: RAM 부족·Claude 권한 대기·무거운 작업 겹침
- 디스크 정리: 지울 의존성 폴더 이름(기본 `node_modules`), 더 살펴볼 저장소

## 알려진 한계

- macOS 빌드는 아직 실제 Mac 에서 확인하지 않았습니다.
- WSL2·Docker·devcontainer 안에서 도는 서버는 어느 워크트리 것인지 알 수 없어 "판별 불가"로만 보이고 정리 후보가 되지 않습니다.
- Codex 의 권한 대기 같은 세부 상태는 알 수 없습니다.
- "끝난 워크트리"는 이 PC 의 git 정보(마지막 fetch)로만 판단합니다. pitwall 은 fetch 하지 않습니다.
- macOS 에서 Dock·Finder 로 켜면 셸 설정 파일에서만 정한 `CLAUDE_CONFIG_DIR` 을 모를 수 있습니다. 설정 > Claude 연동에 pitwall 이 쓰는 설정 파일 경로가 나오니 확인해 주세요.
- 에이전트가 백그라운드로 띄운 작업은 실행한 셸이 먼저 끝나면 남은 프로세스처럼 보일 수 있어, 10분 넘게 산 것만 보이고 에이전트가 있는 워크트리의 것은 따로 셉니다.

## 개발

```bash
npm install
npm run dev        # 개발 실행
npm test           # 테스트
npm run typecheck  # 타입 검사
npm run lint       # 린트
npm run build      # 타입 검사 + 빌드
npm run build:win  # Windows 설치 파일(dist/)
npm run build:mac  # macOS 설치 파일(macOS 에서만)
```

- 앱 아이콘은 `npm run icon` 으로 다시 만듭니다(그림은 `src/main/pixelArt.ts`, 결과는 `build/icon.png`·`build/icon.ico`·`resources/icon.png`·`resources/icon-small.png`).
- 릴리스: `package.json` 의 `version` 을 올리고 같은 버전의 태그(`v0.2.0`)를 올리면 GitHub Actions 가 Windows·macOS 설치 파일을 초안 릴리스에 올립니다. 초안을 확인한 뒤 GitHub 에서 게시합니다.
- 설계 문서: [docs/superpowers/specs/2026-11-06-pitwall-design.md](docs/superpowers/specs/2026-11-06-pitwall-design.md)

---

## English

pitwall is a tray (menu bar) app for developers who run several AI coding agents (Claude Code, Codex) across git worktrees at once. It shows running agents and their state, dev-server ports and which worktree they belong to, RAM by group, leftover processes, heavy jobs (type checks, builds) that overlap while RAM is low, and dependency folders of finished worktrees — and lets you clean them up after a native confirmation dialog. Everything is read locally; the only network access is the GitHub update check, which can be turned off. The Claude Code integration only touches `~/.claude/settings.json` when you click "Claude 연동 켜기" (enable), keeps a backup and preserves other tools' hooks. The UI is in Korean. Windows is tested; the macOS build is not yet verified on a real Mac.
