# Corral

> 예전 이름은 pitwall 입니다. 이름만 바뀌었고 설정 폴더·자동 실행(로그인할 때 실행)·에이전트 연동은 그대로 이어집니다.

AI 코딩 에이전트(Claude Code, Codex)를 여러 git 워크트리에서 동시에 돌릴 때, 내 PC 에서 돌아가는 개발 작업 전체를 한눈에 보고 그 자리에서 정리하는 트레이 앱입니다.

- 지원 OS: Windows 10/11, macOS(Intel·Apple Silicon — **아직 실제 Mac 에서 확인하지 않은 미검증 빌드**)
- 라이선스: MIT. 화면 디자인은 [NeoHtop](https://github.com/Abdenasser/neohtop)(MIT)을 가져와 한국어 앱에 맞게 바꿨습니다. → [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)

## 무엇을 보여 주나요

| 기능                       | 설명                                                                                                                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 작업 공간                  | 첫 탭. 여러 저장소를 묶는 바깥 저장소(작업 공간)마다 그 작업의 에이전트·개발 서버·무거운 작업·남은 프로세스를 한 묶음으로 보여 줍니다. 묶음 머리에는 작업 공간 전체의 메모리·커밋 합(프로세스마다 한 번), 커밋 안 한 변경 수(`git status`, 5분에 한 번), 마지막 활동. 머리에서 이름 바꾸기·폴더 열기, 그 작업 공간의 서버·남은 프로세스를 **확인 창 한 번으로 정리**합니다. |
| 에이전트 현황              | 실행 중인 Claude Code·Codex 세션, 어느 워크트리에서 도는지, 상태(작업 중·쉬는 중·**응답 대기**·오류)와 그 상태가 이어진 시간("작업 중 · 12분"). 상태는 연동 훅, Claude Code 가 프로세스마다 남기는 세션 파일, Codex 세션 기록으로 알고, 셋 다 없으면 CPU 로 짐작합니다. 연동 없이도 Claude 는 세션 파일로 응답 대기와 그 이유(권한 확인·질문 등)를 알고, 연동을 켜면 어떤 도구가 권한을 기다리는지와 **하는 일**(세션 제목·마지막 요청의 첫 줄·실행 중인 도구)까지 보입니다. 쉰 지 기준 시간(설정, 기본 180분)이 넘으면 `오래 쉼 · 3시간`, 연동으로 작업 중인데 15분 넘게 이벤트도 CPU 사용도 없으면 `조용함 · 18분`. |
| 토큰·사용 한도             | 에이전트 표의 컨텍스트 칸과 상세 패널의 토큰 카드(컨텍스트·출력 합·모델). Codex 는 사용 한도(창마다 사용률·초기화 시각)도 보여 줍니다 — 에이전트 카드 설명 줄에 가장 높은 것 하나, Codex 에이전트의 상세 패널에 전부. 세션 기록 파일에서 숫자만 읽습니다. |
| 바로 가기                  | 상세 패널에서 경로 복사·폴더 열기·터미널 열기(Windows Terminal 이 있으면 그것, 없으면 cmd), 에이전트는 **창으로 가기**(그 에이전트가 떠 있는 터미널·에디터 창을 앞으로). 작업 공간 머리에서 폴더 열기. |
| 화면 배치                  | 위쪽 카드와 아래 표 사이의 손잡이 줄로 카드 영역을 **자세히**(지금 카드)·**간단히**(카드마다 제목·큰 값·한 줄)·**접기**(카드 없음) 가운데 하나에 둡니다. 손잡이를 끌면 놓을 때 가장 가까운 단계에 붙고, 더블클릭은 자세히 ↔ 접기, 손잡이에 초점이 있으면 ↑·↓ 로 한 단계씩. **카드 편집**을 누르면 카드마다 아래 가장자리에 앞으로·뒤로(‹ ›)·숨기기/보이기(새 카드는 빼기도) 단추가 나오고(끌어서 순서를 바꿔도 됩니다), 손잡이 줄에 "더할 수 있는 카드"·기본값으로·완료가 나옵니다. 더할 수 있는 카드는 **응답 대기**(기다리는 에이전트와 이유·기다린 시간, 누르면 그 에이전트의 상세 패널), **토큰·한도**(컨텍스트가 가장 큰 에이전트와 Codex 한도), **최근 기록**(기록 세 줄). 카드는 한 줄에 놓이고(메모리 카드는 다른 카드의 1.5배), 창에 다 들어가지 않으면 카드 줄만 가로로 스크롤됩니다. 고른 단계와 카드 배치는 다시 켜도 그대로입니다. |
| 메모리 현황                | 전체 사용률·남은 메모리와 최근 2시간 추이, 묶음별 사용량(개발 서버·에이전트·무거운 작업·다른 앱·시스템 — 항목 수와 프로세스 수를 함께), 메모리를 많이 쓰는 다른 앱. Windows 에서는 **커밋**(페이지 파일로 밀려난 것까지 포함해 프로세스가 차지한 메모리)을 프로세스·묶음·앱마다, 시스템 커밋 사용량/한도와 시스템·공유 메모리 안의 커널 몫도 보여 줍니다 — 메모리가 모자라면 RAM 값은 줄어도 커밋은 그대로이기 때문입니다. 경고 색은 RAM 과 커밋 사용률 가운데 더 나쁜 쪽을 따릅니다. 다른 앱 탭에는 모든 앱이 이름별로, node·java 같은 런타임은 띄운 앱별로(`node (Cursor)`) 보입니다. |
| 메모리 구성                | 메모리 카드에 전체 RAM 을 묶음(개발 서버·에이전트·무거운 작업·다른 앱·시스템·공유)별로 나눈 **쌓은 막대**와 묶음마다 전체 RAM 대비 %(막대의 빈 칸은 남은 메모리). 표의 메모리 칸 뒤에는 그 줄이 그 표의 메모리 합에서 차지하는 몫을 옅은 **막대**로 깝니다(검색해도 길이는 그대로. 작업 공간 탭은 줄끼리 더하면 같은 프로세스를 두 번 셀 수 있어 사용 중인 RAM 대비, 다른 포트 보기는 막대 없음). 칸에 마우스를 올리면 `4.2 GB · 이 표 합의 52% · 전체 RAM 의 7%`. 메모리 카드의 ↗(메모리 상세)에는 **메모리 지도**(사각형 넓이 = 메모리. 묶음 안에 서버·에이전트·무거운 작업·앱이 들어가고, 서버·에이전트·무거운 작업 칸을 누르면 그 상세 패널)와, RAM 추이 아래 묶음별로 쌓은 **묶음별 추이**(최근 2시간)가 있습니다. |
| 개발 서버                  | 서버(포트를 연 프로세스 트리) 한 줄에 그 서버가 연 포트를 모두(`:6176 · :8081 · :9091`), 워크트리·브랜치, 메모리·커밋, CPU, 연결 수. 메모리가 30분 넘게 계속 늘면 **메모리 증가** 표시. 상세 패널에서 포트마다 열고, 그 서버를 이루는 프로세스(이름·무엇인지·메모리)를 봅니다. 확인 창을 거쳐 바로 내립니다. 목록/작업 공간 묶음으로 바꿔 보고, 서버를 숨길 수 있습니다. 개발 서버가 아닌 열린 포트(1024 이상)는 표 아래 "다른 포트"에서 봅니다(보기만). |
| 안 쓰는 서버 판단          | 에이전트가 없는 워크트리의 서버가 20분(설정) 동안 연결이 없으면 **정리 후보**, 브라우저 탭만 붙어 있으면 **확인해볼 것**. 샘플 사이에 잠깐 요청을 받은 흔적(최근 닫힌 연결·새 연결)이 있으면 다시 셉니다. 그 워크트리·작업 공간의 에이전트가 모두 오래 쉬는 세션이면 판단하되 `확인해볼 것 · 에이전트 쉼` 까지만 올립니다(정리 후보·정리 추천에는 넣지 않음). |
| 남은 프로세스              | 실행한 쪽(에이전트·터미널)이 끝났는데 남은 Playwright 브라우저·테스트 러너·Gradle 데몬 등.                                                                                                        |
| 무거운 작업 겹침           | 설정한 무거운 명령(타입 검사·빌드 등)이 둘 이상 겹치고 메모리가 경고 기준을 넘을 때만 알립니다. 설정에서 **겹치면 에이전트가 기다리게 하기**(Claude Code, 기본 끔)를 켜면, 무거운 작업이 이미 돌고 메모리가 경고 기준을 넘었을 때 Claude 가 새 무거운 명령을 실행하려 하면 "1분쯤 뒤에 다시 실행하라"고 답합니다(같은 세션·같은 명령 종류는 10분에 두 번까지, 그다음은 참고 문구만 붙이고 실행). 무거운 작업을 Corral 이 끄지는 않습니다. |
| 메모리 부족 경고·정리 추천 | 메모리(RAM 또는 커밋)가 기준을 넘으면 "이것들을 끄면 RAM 약 1.2 GB · 커밋 약 4.2 GB 확보"처럼 정리 후보를 묶어 보여 주고(커밋을 모르면 RAM 만), 확인 창 하나로 한꺼번에 끕니다.                     |
| 디스크 정리                | 끝난 워크트리(원격 브랜치가 지워졌거나 기본 브랜치에 머지됨, 실행 중인 것이 없음)의 `node_modules`·`dist`·`.next` 같은 의존성·빌드 결과 폴더 가운데 **git 이 무시하는 폴더만** 크기를 보여 주고 지웁니다. 끝난 근거는 없어도 14일(설정) 넘게 커밋도 변경도 없던 워크트리는 "오래 안 씀"으로 함께 보입니다. 워크트리 자체와 메인 체크아웃은 건드리지 않습니다. **모두 정리**는 검색과 상관없이 사용 중이 아닌 줄 전부를 확인 창 하나로 지우고, 지우기 직전에 줄마다 다시 확인해 그 사이 쓰기 시작한 곳은 건너뜁니다. |
| 기록                       | 서버 시작·꺼짐, 에이전트 시작·작업 끝남·응답 대기·오류·조용함·꺼짐, 무거운 작업 시작·끝, 메모리 단계 변화, 정리·디스크 정리, 에이전트를 기다리게 함을 최근 24시간·300개까지 기록 탭에 남깁니다(종류·시각·폴더 이름·브랜치·숫자만). 창을 10분 넘게 안 보다가 다시 보면 **자리 비운 사이** 카드가 그 사이 일을 한 줄로 요약합니다. |

트레이(메뉴바) 아이콘은 앱 아이콘과 같은 작은 모니터이고 그래프 선 색이 메모리 상태(초록·노랑·분홍)이며, 응답을 기다리거나 조용한 에이전트가 있으면 점이 붙습니다. **왼쪽 클릭은 요약 창**(RAM·개발 서버·에이전트, 정리 추천, 작업 공간별 서버, 에이전트 상태), **오른쪽 클릭은 메뉴**입니다. 메모리 부족·에이전트 응답 대기(계속 기다리면 10분마다 다시)·작업 끝남(2분 넘게 일한 뒤)·조용함·작업 중이거나 응답을 기다리던 에이전트가 꺼짐·무거운 작업 겹침은 OS 알림으로도 알려 줍니다(설정에서 항목별로 끔). OS 알림 센터가 알림을 남기므로 알림에는 명령·프롬프트를 넣지 않고 도구 이름까지만 넣습니다. 에이전트 알림을 누르면 그 에이전트가 떠 있는 창으로 가 보고, 창을 찾지 못하면 Corral 을 엽니다.

다시 켜도 RAM 추이·묶음별 추이·서버 메모리 기록·기록 탭의 일과, 꺼져 있던 시간이 10분 이하면 정리 판단 시간도 이어 씁니다(앱 데이터 폴더의 `history.json`. 앱 데이터 폴더는 Windows `%APPDATA%\pitwall`, macOS `~/Library/Application Support/pitwall` — 이름이 Corral 로 바뀌어도 폴더 이름은 그대로입니다).

## 설치

[Releases](https://github.com/yeonjin1357/Corral/releases) 에서 내려받습니다. 코드 서명 인증서가 없어 처음 실행할 때 OS 경고가 나옵니다.

### Windows

1. `corral-<버전>-setup.exe` 를 실행합니다(관리자 권한 없이 사용자 폴더에 설치).
2. "Windows의 PC 보호" 창이 뜨면 **추가 정보 → 실행** 을 누릅니다.
3. 새 버전은 자동으로 내려받고, 앱을 다시 시작할 때 설치됩니다.

회사 보안 프로그램이 서명 없는 실행 파일이나 PowerShell 사용을 막을 수 있습니다. 그 경우 수집 방식이 "제한 모드"로 바뀌며, 일부 정보(작업 폴더 등)가 빠질 수 있습니다.

### macOS (미검증)

1. Apple Silicon 은 `corral-<버전>-arm64.dmg`, Intel 은 `corral-<버전>-x64.dmg` 를 엽니다.
2. Corral 을 응용 프로그램 폴더로 옮깁니다. 예전 이름(pitwall)으로 설치한 적이 있으면 응용 프로그램 폴더의 `pitwall.app` 은 지웁니다(이름이 달라 새 앱이 덮어쓰지 않습니다. 설정·기록은 그대로 이어집니다).
3. 처음 열 때 "확인되지 않은 개발자" 경고가 나오면 **시스템 설정 → 개인정보 보호 및 보안** 아래쪽의 **그래도 열기**를 누릅니다(macOS 14 이하는 Finder 에서 앱을 오른쪽 클릭 → 열기). "손상되었기 때문에 열 수 없습니다"가 나오면 터미널에서 아래를 실행한 뒤 다시 엽니다.
   ```bash
   xattr -dr com.apple.quarantine /Applications/Corral.app
   ```
4. 서명이 없어 자동 업데이트가 되지 않습니다. 새 버전이 나오면 앱(설정 > 정보, 트레이 메뉴)이 알려 주고, 직접 다시 설치합니다.

디스크 정리는 `git` 을 씁니다. Xcode 명령줄 도구가 없는 Mac 에서는 처음 쓸 때 설치 창이 뜰 수 있습니다.

## 무엇을 읽고, 무엇을 바꾸나요

모두 내 PC 안에서만 읽고, 읽은 것을 어디로도 보내지 않습니다. 아래에서 `<Claude 설정 폴더>` 는 `~/.claude`(`CLAUDE_CONFIG_DIR` 이 있으면 그 폴더), `<Codex 폴더>` 는 `~/.codex`(`CODEX_HOME` 이 있으면 그 폴더), 앱 데이터 폴더는 Windows `%APPDATA%\pitwall`, macOS `~/Library/Application Support/pitwall`(예전 이름 그대로)입니다.

- **늘 읽는 것:**
  - 프로세스 목록과 명령줄·작업 폴더·메모리(Windows 는 커밋 포함)·CPU 시간, 시스템 메모리(Windows 는 커밋 한도·커널 메모리 포함), 열린 TCP 포트와 연결, git 저장소 정보(브랜치·워크트리 목록·원격 추적 상태).
    - Windows 에서는 다른 프로세스의 작업 폴더와 메모리를 알기 위해 작은 C# 보조 코드를 PowerShell 로 컴파일해 앱 데이터 폴더에 둡니다.
  - 에이전트·서버·무거운 작업·남은 프로세스가 도는 워크트리마다 커밋 안 한 변경 수: `git status --porcelain` 을 워크트리마다 5분에 한 번 돌려 줄 수만 셉니다. 잠금 파일을 만들지 않고(`GIT_OPTIONAL_LOCKS=0`), 저장소 설정의 fsmonitor 도 띄우지 않습니다.
  - Claude Code 가 실행 중인 프로세스마다 남기는 세션 파일(`<Claude 설정 폴더>/sessions/<pid>.json`)의 세션 id·상태·상태가 바뀐 시각·응답 대기 이유·세션 이름. 지금 도는 Claude 프로세스의 파일만 열고, 같은 폴더의 다른 파일(`.key` 등)은 열지 않습니다. 세션 이름은 "에이전트가 하는 일 보기"를 끄면 버립니다.
  - Codex 세션 기록(`<Codex 폴더>/sessions/`)의 이벤트 종류·시각·작업 폴더. 대화 내용은 읽어 두지 않으며, `auth.json` 은 열지 않습니다.
  - 연동 상태를 보이려고 Claude 설정 파일(`settings.json`)과 Codex 훅 설정 파일(`hooks.json`)을 읽습니다(읽기만).
- **설정이 켜져 있을 때만 읽는 것:**
  - **토큰 사용량 보기**(설정 > 에이전트 연동, 기본 켬): Claude 세션 기록(`<Claude 설정 폴더>/projects/<폴더>/<세션 id>.jsonl`)과 Codex 세션 기록에서 토큰 숫자·모델 이름·Codex 사용 한도만 꺼냅니다. 대화 내용은 남기지 않고, 수집을 늦추지 않게 뒤에서 덧붙은 만큼만 읽습니다. 끄면 Claude 세션 기록은 열지 않고, Codex 세션 기록에서는 위의 상태 이벤트만 읽습니다.
  - **Claude 연동·Codex 연동**(아래): 훅이 보내는 이벤트로 상태를 알고, **에이전트가 하는 일 보기**(설정 > 에이전트 연동, 기본 켬)가 켜져 있으면 세션 제목·마지막 요청의 첫 줄(200자)·도구 이름과 요약(셸 명령은 첫 줄 160자, 파일 도구는 파일 이름)을 메모리에만 들고 화면에 보입니다. 디스크(기록·`history.json`)에는 쓰지 않고, 끄면 받는 순간 버립니다.
  - **겹치면 에이전트가 기다리게 하기**(설정 > 무거운 작업, 기본 끔): Claude 가 실행하려는 셸 명령을 그 자리에서 보고, 무거운 작업이 이미 돌고 메모리가 경고 기준을 넘었을 때만 그 명령이 부르는 패키지 스크립트(`npm run build` 등)를 그 폴더 `package.json` 의 scripts 에서 한 단계 찾아봅니다. 명령은 판단에만 쓰고 남기지 않습니다.
- **인터넷 접속:** 새 버전 확인(GitHub) 하나뿐이며 설정 > 일반에서 끌 수 있습니다. 사용자 정보는 보내지 않습니다.
- **바꾸는 것:**
  - 포트 내리기·프로세스 끄기·의존성 폴더 지우기는 **항상 확인 창**을 거치고, 누르기 직전에 최신 상태를 다시 확인합니다. 자동으로 끄거나 지우는 일은 없습니다. 에이전트 자체와, 아래에서 에이전트가 돌고 있는 프로세스는 끄지 않습니다.
  - Claude 설정 파일(`<Claude 설정 폴더>/settings.json`)은 **"Claude 연동 켜기"를 눌렀을 때만** 알림 훅을 더하고, **"겹치면 에이전트가 기다리게 하기"를 켰을 때만** 질문 훅을 하나 더 넣습니다. 둘 다 확인 창을 거치고 바꾸기 전에 백업을 남깁니다(아래).
  - Codex 훅 설정 파일(`<Codex 폴더>/hooks.json`)도 **"Codex 연동 켜기"를 눌렀을 때만** 바꿉니다.
  - **에이전트의 동작:** 기본으로는 바꾸지 않습니다. "겹치면 에이전트가 기다리게 하기"를 켰을 때만, 조건이 맞으면 Claude Code 에 무거운 명령을 1분쯤 뒤에 다시 실행하라고 답합니다(같은 세션·같은 명령 종류는 10분에 두 번까지). Corral 이 꺼져 있거나 답하지 못하면 명령은 그대로 실행됩니다.
  - 앱 데이터 폴더에 설정(`config.json`)·기억한 저장소(`state.json`)·RAM 추이와 기록(`history.json`)을 씁니다. `history.json` 에는 30초마다 묶음별 메모리(바이트, 개발 서버·에이전트·무거운 작업·다른 앱·시스템)도 2시간까지 남깁니다. 기록에는 종류·시각·폴더 이름·브랜치·숫자만 들어가고 프롬프트·명령은 들어가지 않습니다.
  - 화면 배치(카드 영역 단계·카드 순서와 숨긴 카드)와 표 정렬·개발 서버 보기는 설정 파일이 아니라 이 PC 의 앱 저장소(`localStorage`, 앱 데이터 폴더 안)에 남깁니다.
  - 상세 패널의 바로 가기(경로 복사·폴더 열기·터미널 열기·창으로 가기)는 누를 때만, 지금 목록에 있는 항목의 폴더·창에만 씁니다.
  - 로그인할 때 실행(설정 > 일반, 기본 켬)을 위해 OS 로그인 항목에 등록합니다.

## Claude 연동

연동을 켜지 않아도 Claude Code 가 남기는 세션 파일로 작업 중·쉬는 중·응답 대기를 압니다. "Claude 연동 켜기"를 누르면 Claude Code 설정 파일에 훅을 더해, 세션 시작·프롬프트·도구 사용(실행 전·후)·권한 요청·알림·응답 끝·오류·세션 끝 이벤트를 Corral 의 로컬 포트(127.0.0.1, 무작위 토큰)로 보냅니다. 그러면 어떤 도구가 권한을 기다리는지, 하는 일, 오류, 조용함까지 압니다. 이 훅은 비동기라 Claude 를 기다리게 하지 않습니다.

- 바꾸기 전에 원래 파일을 `settings.json.pitwall-backup-<시각>` 으로 남깁니다.
- 다른 도구가 넣은 훅·주석·다른 설정은 그대로 둡니다. 끄면 Corral 이 넣은 훅만 정확히 뺍니다. `statusLine` 은 건드리지 않습니다.
- Corral 이 꺼져 있어도 훅은 조용히 끝나(종료 코드 0) Claude 작업을 방해하지 않습니다.
- 이미 실행 중인 Claude 세션은 다시 시작해야 반영될 수 있습니다.
- 이전 버전에서 연동을 켰다면 받는 이벤트(도구 실행 전)가 늘어 상태가 "예전 설정이 남아 있어요. 다시 켜 주세요."로 보입니다. 설정 > 에이전트 연동에서 **Claude 연동 다시 켜기**를 한 번 눌러 주세요(자동으로 고치지 않습니다).

**겹치면 에이전트가 기다리게 하기**(설정 > 무거운 작업, 기본 끔)를 켜면 같은 확인 창·백업을 거쳐 질문 훅이 하나 더 들어갑니다. Claude 가 Bash·PowerShell 명령을 실행하기 전에 동기로 Corral 에 묻는 훅입니다(연결 제한 0.3초, 훅 제한 3초).

- Corral 이 답하지 않거나 어떤 오류가 나도 명령은 그대로 실행됩니다. 명령마다 더해지는 시간은 Windows 에서 Corral 이 켜져 있을 때 수십 ms, 꺼져 있을 때 약 0.3초입니다([docs/measurements.md](docs/measurements.md)).
- 끄면 바로 판단을 멈춥니다. 설정 파일에서 질문 훅도 뺄지는 따로 묻습니다(남겨 두면 명령마다 묻기만 하고 아무것도 미루지 않습니다).
- Claude 연동이 꺼져 있으면 켤 때 함께 들어갑니다.
- 이 훅은 `127.0.0.1:<포트>` 에서 답하는 쪽을 그대로 믿습니다. Corral 이 꺼져 있는 동안 다른 로컬 프로그램이 그 포트를 열면 이벤트를 받고 이 훅에 답할 수도 있습니다(알림 훅이 이미 가진 "이벤트를 받는" 노출이 "답하는" 쪽까지 넓어집니다).

## Codex 연동

설정 > 에이전트 연동의 "Codex 연동 켜기"는 Claude 연동과 같은 방식(확인 창·백업·다른 훅 보존·끄면 Corral 항목만 뺌)으로 Codex 훅 설정 파일에 훅을 더해, 응답 대기까지 알 수 있게 합니다. 켠 뒤 **Codex 에서 `/hooks` 를 열어 Corral 훅(주소에 `pitwall-hook` 이 들어 있는 훅)을 한 번 승인**해야 이벤트가 옵니다. 연동을 켜지 않아도 Codex 세션 기록으로 작업 중·쉬는 중·오류를 압니다(같은 폴더에서 Codex 를 둘 이상 돌리거나 기록을 찾지 못하면 CPU 로 짐작).

## 설정

오른쪽 위 **설정**(또는 트레이 메뉴 > 설정)에서 바꿉니다.

- 일반: 갱신 주기(빠르게 2·10초 / 보통 5·30초 / 절약 15·120초 — 창이 열려 있을 때·닫혀 있을 때), 화면 테마, 로그인 시 실행, 새 버전 확인
- 기준값: RAM 경고·위험 기준(기본 80·90% — RAM 과 커밋 사용률에 같이 씀), 안 쓰는 포트 기준 시간(기본 20분), 오래 쉬는 세션 기준(기본 180분), 숨긴 서버(`:포트`, 프로세스 이름, 또는 `워크트리 경로:포트`. 서버 상세 패널의 "숨기기"는 그 워크트리의 첫 포트로 더함)
- 무거운 작업: 명령 패턴(예: `vue-tsc`, `vite build`), 겹치면 에이전트가 기다리게 하기(Claude Code, 기본 끔)
- 알림: 메모리 부족·에이전트 응답 대기·에이전트 작업 끝남·조용한 에이전트·에이전트 꺼짐·무거운 작업 겹침, 알림을 누르면 그 에이전트의 창으로(기본 켬), 응답 대기 다시 알림 간격(기본 10분, 0 이면 끔)
- 디스크 정리: 지울 폴더 이름(기본 `node_modules`·`.next`·`.nuxt`·`.turbo`·`.vite`·`dist`·`build`·`out`·`target`·`.gradle`, git 이 무시하는 것만 지움), 오래 안 쓴 워크트리 기준(기본 14일, 0 이면 끔), 더 살펴볼 저장소
- 에이전트 연동: Claude 연동·Codex 연동 켜기/끄기, 에이전트가 하는 일 보기(기본 켬), 토큰 사용량 보기(기본 켬)

## 알려진 한계

- macOS 빌드는 아직 실제 Mac 에서 확인하지 않았습니다. macOS 에서는 커밋 값을 모릅니다(커밋 칸·줄이 빠집니다). Windows 에서도 보안 정책으로 보조 코드가 막힌 PC 는 커밋을 모릅니다.
- WSL2·Docker·devcontainer 안에서 도는 서버는 어느 워크트리 것인지 알 수 없어 "판별 불가"로만 보이고 정리 후보가 되지 않습니다.
- Codex 의 응답 대기는 Codex 연동을 켜고 `/hooks` 에서 승인해야 알 수 있습니다.
- Claude Code 의 세션 파일과 세션 기록은 문서화되지 않은 내부 형식입니다. 형식이 바뀌면 연동 없이 아는 상태·토큰 숫자가 안 보일 수 있습니다(그때는 비워 두고 CPU 로 짐작합니다). 출력 합에는 하위 에이전트가 쓴 토큰이 들어 있지 않고, 64 MB 가 넘는 기록은 끝 16 MB 만 읽어 출력 합이 비어 보입니다.
- Claude 의 사용 한도는 보여 주지 않습니다. 알 수 있는 길이 Claude 의 상태 줄(`statusLine`) 설정뿐인데 Corral 은 그것을 건드리지 않습니다.
- 창으로 가기는 그 에이전트가 떠 있는 터미널·에디터 창까지만 가고 탭은 고르지 못합니다. Windows 는 다른 앱이 창을 앞으로 가져오는 것을 막을 때가 있어 창이 앞으로 오지 않을 수 있습니다.
- 조용함은 오래 걸리는 명령(CI 기다리기 등)을 기다릴 때도 뜹니다. 그래서 "멈춤"이 아니라 "조용함"이라고 부릅니다.
- 작업 공간 합계는 작업 공간마다 따로 셉니다. 두 작업 공간에 걸친 프로세스(한 작업 공간의 에이전트가 다른 작업 공간에서 돌리는 빌드 등)는 양쪽 합계에 모두 들어가므로 묶음끼리 더하지 마세요.
- "끝난 워크트리"는 이 PC 의 git 정보(마지막 fetch)로만 판단합니다. Corral 은 fetch 하지 않습니다.
- macOS 에서 Dock·Finder 로 켜면 셸 설정 파일에서만 정한 `CLAUDE_CONFIG_DIR` 을 모를 수 있습니다. 설정 > 에이전트 연동에 Corral 이 쓰는 설정 파일 경로가 나오니 확인해 주세요.
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
- 설계 문서: [docs/superpowers/specs/2026-11-06-pitwall-design.md](docs/superpowers/specs/2026-11-06-pitwall-design.md), 4단계(작업 공간 묶음·편의 기능) [docs/superpowers/specs/2026-11-09-pitwall-4-features-design.md](docs/superpowers/specs/2026-11-09-pitwall-4-features-design.md), 5단계(메모리 압박·에이전트 주의·작업 공간 보기) [docs/superpowers/specs/2026-11-10-pitwall-5-attention-memory-design.md](docs/superpowers/specs/2026-11-10-pitwall-5-attention-memory-design.md), 6단계(이름 Corral·화면 배치·메모리 구성) [docs/superpowers/specs/2026-11-11-corral-6-layout-memory-design.md](docs/superpowers/specs/2026-11-11-corral-6-layout-memory-design.md)
- 부하 측정 기록: [docs/measurements.md](docs/measurements.md)

---

## English

Corral (formerly pitwall) is a tray (menu bar) app for developers who run several AI coding agents (Claude Code, Codex) across git worktrees at once. Its first tab groups each workspace's agents, dev servers, heavy jobs and leftover processes together, with the workspace's total memory and uncommitted-change count. It shows each agent's state (working, idle, waiting for you — with the reason — or error) and how long it has been in it, long-idle and quiet agents, token/context numbers and Codex usage limits; dev servers (one row per server process tree, with all its ports) and which worktree they belong to; memory by group including Windows commit charge (memory pushed out to the page file) — as a stacked bar of total RAM on the memory card, a pale bar behind each memory cell showing the row's share of that table, and a memory map (treemap) plus a per-group trend in the memory details — leftover processes, heavy jobs (type checks, builds) that overlap while memory is low, dependency folders of finished or long-unused worktrees, and a 24-hour history with a "while you were away" summary. It lets you clean things up after a native confirmation dialog and jump to an agent's terminal window. Everything is read locally; the only network access is the GitHub update check, which can be turned off. Without any integration, Claude Code state comes from the small per-process session file Claude Code writes (`sessions/<pid>.json`) and Codex state from its local session files; token numbers are read from session transcripts (numbers and model name only; can be turned off). The Claude Code and Codex integrations only touch `~/.claude/settings.json` / `~/.codex/hooks.json` when you click enable ("Claude 연동 켜기" / "Codex 연동 켜기"), keep a backup and preserve other tools' hooks; Codex needs a one-time approval in its `/hooks` screen. With the integration on, the session title, the first line of the last prompt and the running tool are kept in memory only, never written to disk or put into OS notifications (can be turned off). An opt-in setting (off by default) adds one more synchronous Claude Code hook so that, when a heavy job is already running and memory is above the warning level, Claude is told to retry a new heavy command in about a minute (at most twice per session and command kind in 10 minutes) — the only way Corral ever changes what an agent does; if Corral is not running, the command just runs. The card area above the tables snaps to three sizes (full, compact, collapsed) with a drag handle, and its cards can be hidden, reordered or extended with waiting-agent, token/limit and recent-history cards; this layout is kept in the app's local storage. Left-clicking the tray icon opens a summary popover; right-click opens the menu. The UI is in Korean. Windows is tested; the macOS build is not yet verified on a real Mac.
