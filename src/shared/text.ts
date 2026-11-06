/** 화면·트레이·확인 창에 나오는 문구는 모두 여기 모은다(나중에 다국어로 넓힐 때 이 파일만 바꾸면 되도록). */
export const text = {
  appName: 'pitwall',
  unresolvable: '판별 불가',
  detached: '(detached)',
  kill: {
    title: '포트 내리기',
    message: (port: number, label: string): string => `:${port} (${label}) 을(를) 내릴까요?`,
    detail: (processName: string, pid: number, descendantCount: number): string =>
      descendantCount > 0
        ? `${processName} (PID ${pid}) 와 하위 프로세스 ${descendantCount}개가 종료돼요.`
        : `${processName} (PID ${pid}) 가 종료돼요.`,
    agentInWorktree:
      '이 워크트리에서 에이전트가 실행 중이에요. 에이전트가 이 서버를 쓰고 있을 수 있어요.',
    confirm: '내리기',
    cancel: '취소'
  },
  leftoverKill: {
    title: '남은 프로세스 끄기',
    message: (label: string, where: string): string => `${label} (${where}) 을(를) 끌까요?`,
    noWorktree: '작업 폴더 모름',
    agentInWorktree:
      '이 워크트리에서 에이전트가 실행 중이에요. 에이전트가 이 프로세스를 쓰고 있을 수 있어요.',
    confirm: '끄기'
  },
  claudeHook: {
    enableTitle: 'Claude 연동 켜기',
    enableMessage: 'Claude Code 설정 파일에 pitwall 훅을 더할까요?',
    enableDetail: (path: string): string =>
      `${path} 에 세션 시작·프롬프트·권한 요청·알림·도구 사용·응답 끝·오류·세션 끝 이벤트를 ` +
      'pitwall 로 보내는 훅을 더해요. 다른 설정과 훅은 그대로 두고, 바꾸기 전에 백업을 남겨요. ' +
      '이미 실행 중인 Claude 세션은 다시 시작해야 반영될 수 있어요.',
    enableConfirm: '켜기',
    disableTitle: 'Claude 연동 끄기',
    disableMessage: 'Claude Code 설정 파일에서 pitwall 훅을 뺄까요?',
    disableDetail: (path: string): string =>
      `${path} 에서 pitwall 이 넣은 훅만 빼요. 다른 설정과 훅은 그대로 두고, 바꾸기 전에 백업을 남겨요.`,
    disableConfirm: '끄기',
    enabled: (backupPath: string | null): string =>
      backupPath
        ? `Claude 연동을 켰어요. 원래 설정은 ${backupPath} 에 백업했어요.`
        : 'Claude 연동을 켰어요.',
    alreadyOn: 'Claude 연동이 이미 켜져 있어요.',
    disabled: (backupPath: string | null): string =>
      backupPath
        ? `Claude 연동을 껐어요. 바꾸기 전 설정은 ${backupPath} 에 백업했어요.`
        : 'Claude 연동을 껐어요.',
    alreadyOff: 'Claude 연동이 이미 꺼져 있어요.',
    errors: {
      parse: 'settings.json 을 읽을 수 없어 바꾸지 않았어요. 주석·쉼표 같은 형식을 확인해 주세요.',
      shape: 'settings.json 의 hooks 형식이 예상과 달라 바꾸지 않았어요.',
      busy: 'settings.json 이 계속 바뀌고 있어 바꾸지 않았어요. 잠시 뒤 다시 해 주세요.',
      other: (message: string): string => `Claude 연동을 바꾸지 못했어요: ${message}`
    }
  },
  leftoverLabels: {
    kotlinDaemon: 'Kotlin 데몬',
    gradleDaemon: 'Gradle 데몬',
    playwrightMcp: 'Playwright MCP',
    playwrightBrowser: 'Playwright 브라우저',
    playwright: 'Playwright',
    headlessBrowser: '헤드리스 브라우저',
    jestWorker: 'Jest 워커',
    tsserver: 'TypeScript 서버'
  },
  killResult: {
    gone: '이미 종료된 프로세스예요.',
    changed: '그 사이 다른 프로세스로 바뀌어서 내리지 않았어요.',
    cancelled: '취소했어요.',
    failed: '내리지 못했어요.',
    unresolvable: '어느 작업의 포트인지 알 수 없어 내릴 수 없어요.',
    permission: '권한이 없어 내리지 못했어요. 관리자 권한으로 실행된 프로세스일 수 있어요.',
    busy: '이미 처리 중이에요.',
    agentInside:
      '이 프로세스 아래에서 에이전트(Claude·Codex)가 돌고 있어 내리지 않았어요. 에이전트를 먼저 끝내 주세요.',
    invalid: '잘못된 요청이에요.'
  },
  unsupportedPlatform: '지원하지 않는 OS 예요. Windows 와 macOS 만 지원해요.',
  collectSlow: '수집이 너무 오래 걸리고 있어요.',
  collectErrors: {
    timeout: '수집 명령이 시간 안에 끝나지 않았어요.',
    unreadable: '수집 결과를 읽지 못했어요.',
    darwinCommand: (command: string, code: number): string =>
      `macOS 프로세스 정보를 가져오지 못했어요 (${command} 종료 코드 ${code}).`,
    cannotRun: (detail: string): string => `수집 명령을 실행하지 못했어요: ${detail}`,
    other: (detail: string): string => `수집 중 문제가 생겼어요: ${detail}`
  },
  actionError: (detail: string): string => `요청을 처리하지 못했어요: ${detail}`,
  openFailed: '브라우저로 열지 못했어요. 포트가 이미 닫혔을 수 있어요.',
  tray: {
    checking: 'RAM 확인 중…',
    failed: 'RAM 정보를 가져오지 못했어요',
    ram: (percent: number, used: string, total: string): string =>
      `RAM ${percent}% (${used} / ${total})`,
    staleSuffix: ' · 업데이트 지연',
    ports: (n: number): string => `개발 서버 포트 ${n}개`,
    agents: (n: number, waiting: number): string =>
      waiting > 0 ? `에이전트 ${n}개 (권한 대기 ${waiting})` : `에이전트 ${n}개`,
    candidates: (n: number): string => `정리 후보 ${n}개`,
    leftovers: (n: number): string => `남은 프로세스 ${n}개`,
    open: '앱 열기',
    quit: '종료',
    tooltip: (percent: number): string => `pitwall — RAM ${percent}%`,
    stillRunning:
      'pitwall 은 트레이에서 계속 실행돼요. 끄려면 트레이 아이콘 메뉴에서 종료를 누르세요.'
  },
  ui: {
    loading: '불러오는 중…',
    stale: '업데이트 지연',
    settingsLater: '설정은 다음 단계에서 추가돼요',
    nextStage: '(다음 단계)',
    none: '—',
    nav: { dashboard: '대시보드', settings: '설정' },
    refresh: '지금 새로고침',
    list: {
      search: '검색…',
      clearSearch: '검색어 지우기',
      empty: '열려 있는 개발 서버 포트가 없어요.',
      emptyAgents: '실행 중인 에이전트가 없어요.',
      emptyLeftovers: '남은 프로세스가 없어요.',
      noMatch: '찾는 항목이 없어요.',
      groups: { ports: '개발 서버 포트', agents: '에이전트', leftovers: '남은 프로세스' },
      collapse: '접기·펼치기'
    },
    tags: {
      unresolvable: '판별 불가',
      candidate: '정리 후보',
      check: '확인해볼 것',
      agentRunning: '에이전트 실행 중',
      noWorktree: '작업 폴더 모름'
    },
    agent: {
      tools: { claude: 'Claude', codex: 'Codex' },
      toolNames: { claude: 'Claude Code', codex: 'Codex' },
      states: {
        working: '작업 중',
        waiting: '권한 대기',
        idle: '쉬는 중',
        error: '오류',
        unknown: '확인 중'
      },
      sources: { hook: 'Claude 훅', cpu: 'CPU 추정' },
      runtime: '실행 시간',
      cpu: 'CPU',
      cpuSub: '(코어 1개 = 100%)',
      stateSource: '상태 출처',
      codexNote: 'Codex 는 CPU 사용량으로만 작업 중인지 짐작해요.',
      noHookNote: 'Claude 연동을 켜면 권한 대기까지 정확히 알 수 있어요.'
    },
    leftover: {
      kill: '끄기',
      commandLine: '명령줄',
      startedAt: '시작 시각',
      runtime: '실행 시간',
      why: '실행한 프로세스(에이전트·터미널 등)가 끝났는데 남아 있는 개발 도구예요.'
    },
    hook: {
      title: 'Claude 연동',
      enable: 'Claude 연동 켜기',
      reenable: 'Claude 연동 다시 켜기',
      disable: 'Claude 연동 끄기',
      states: {
        on: '켜짐 — Claude 훅으로 작업 중·권한 대기를 알아요.',
        off: '꺼짐 — 지금은 CPU 사용량으로 짐작해요. 켜면 권한 대기까지 알 수 있어요.',
        partial: '예전 설정이 남아 있어요. 다시 켜 주세요.',
        server: '훅을 받을 포트를 열지 못했어요. 다시 켜면 새 포트로 바꿔요.',
        settings: 'Claude 설정 파일(settings.json)을 읽을 수 없어요.'
      },
      allHooksDisabled:
        'Claude 설정에서 모든 훅이 꺼져 있어요(disableAllHooks). 켜도 이벤트가 오지 않아요.'
    },
    home: {
      title: '한눈에 보기',
      ram: 'RAM',
      ramUsage: (used: string, total: string): string => `${used} / ${total}`,
      ports: '개발 서버',
      agents: '에이전트',
      leftovers: '남은 프로세스',
      candidates: '정리 후보',
      waiting: (n: number): string => `권한 대기 ${n}`,
      checks: (n: number): string => `확인해볼 것 ${n}`,
      current: '(현재)',
      ramTrend: 'RAM 사용 추이',
      groups: '메모리 묶음',
      groupHeaders: { name: '구분', memory: '메모리', processes: '프로세스' },
      collectMode: (label: string): string => `수집 방식: ${label}`,
      collectModes: {
        'helper-dll': '보조 코드(DLL)',
        'helper-memory': '보조 코드(메모리에서 컴파일)',
        basic: '기본 명령(보조 코드 막힘 — 작업 폴더·전용 메모리 없음)',
        safe: '제한 모드 대체 스크립트(보안 정책으로 기본 스크립트 막힘)',
        darwin: 'macOS ps·lsof'
      }
    },
    groups: {
      devServer: '개발 서버',
      agent: '에이전트',
      other: '그 외',
      processes: (n: number): string => `${n}개`
    },
    detail: {
      url: (port: number): string => `http://localhost:${port}`,
      open: '브라우저로 열기',
      kill: '내리기',
      inUse: '사용 중',
      idle: '연결 없음',
      every: (openSec: number, closedSec: number): string =>
        `창이 열려 있으면 ${openSec}초, 닫혀 있으면 ${closedSec}초마다 확인`,
      memory: '메모리',
      clients: '연결',
      pid: 'PID',
      children: '하위 프로세스',
      branch: '브랜치',
      current: '(현재)',
      mainCheckout: '(메인 체크아웃)',
      linkedWorktree: '(연결된 worktree)',
      memoryTrend: '메모리 추이'
    }
  }
} as const
