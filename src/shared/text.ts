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
  killMany: {
    title: '메모리 정리',
    message: (n: number, size: string): string => `${n}개를 끌까요? 약 ${size} 를 확보해요.`,
    item: (title: string, where: string, size: string): string => `• ${title} (${where}) — ${size}`,
    more: (n: number): string => `외 ${n}개`,
    note: '끄기 직전에 하나씩 최신 상태를 다시 확인하고, 그 사이 바뀐 것은 건너뛰어요.',
    confirm: '모두 끄기',
    killed: (n: number, size: string): string => `${n}개를 껐어요. 약 ${size} 를 확보했어요.`,
    skipped: (n: number): string => `${n}개는 그 사이 바뀌거나 끝나서 건너뛰었어요.`,
    busy: (n: number): string => `${n}개는 이미 처리 중이라 건너뛰었어요.`,
    failed: (n: number): string => `${n}개는 끄지 못했어요(권한이 없거나 이미 끝남).`
  },
  disk: {
    confirmTitle: '의존성 폴더 지우기',
    confirmMessage: (folder: string, names: string, size: string): string =>
      `${folder} 의 ${names} 를 지울까요? 약 ${size}`,
    confirmDetail: (paths: string[]): string =>
      [
        ...paths,
        '',
        '워크트리와 소스 코드는 그대로 두고 의존성 폴더만 지워요. 이 워크트리를 다시 쓰려면 npm install 등으로 다시 설치해야 해요.'
      ].join('\n'),
    confirm: '지우기',
    removed: (names: string, size: string): string =>
      `${names} 를 지웠어요. 약 ${size} 를 확보했어요.`,
    inUse: '이 워크트리에서 개발 서버·에이전트 등이 실행 중이라 지우지 않았어요.',
    inUseBy: (name: string, pid: number): string =>
      `이 워크트리를 쓰는 프로세스가 있어 지우지 않았어요: ${name} (PID ${pid})`,
    notFinished: '이 워크트리의 브랜치가 더는 끝난 상태가 아니라 지우지 않았어요.',
    partial: (names: string): string =>
      `지우지 못한 폴더가 있어요(파일을 쓰는 프로그램이 있을 수 있어요): ${names}`,
    gitMissing: 'git 을 찾지 못해 디스크 정리를 할 수 없어요. git 을 설치한 뒤 다시 시도해 주세요.',
    scanFailed: (detail: string): string => `끝난 워크트리를 찾지 못했어요: ${detail}`
  },
  notify: {
    ramTitle: (percent: number): string => `RAM 이 부족해요 (${percent}%)`,
    ramBody: (n: number, size: string): string =>
      `정리 후보 ${n}개를 끄면 약 ${size} 를 확보할 수 있어요.`,
    ramNoCandidates: '정리할 후보가 없어요. 메모리를 많이 쓰는 앱을 확인해 보세요.',
    waitingTitle: 'Claude 가 권한을 기다려요',
    waitingManyTitle: (n: number): string => `Claude ${n}개가 권한을 기다려요`,
    heavyTitle: (percent: number): string => `무거운 작업이 겹쳤어요 (RAM ${percent}%)`,
    heavyBody: (labels: string): string => `${labels} 이(가) 동시에 돌고 있어요.`
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
      encoding:
        'settings.json 에 UTF-8 이 아닌 글자가 있어 바꾸지 않았어요. UTF-8 로 다시 저장한 뒤 해 주세요.',
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
    heavy: (n: number, overlap: boolean): string =>
      overlap ? `무거운 작업 ${n}개 · 겹침(RAM 부족)` : `무거운 작업 ${n}개`,
    disk: (size: string): string => `디스크 정리 가능 ${size}`,
    open: '앱 열기',
    settings: '설정',
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
    settings: {
      title: '설정',
      menu: {
        general: '일반',
        thresholds: '기준값',
        heavy: '무거운 작업',
        notifications: '알림',
        disk: '디스크 정리',
        claude: 'Claude 연동',
        about: '정보'
      },
      save: '저장',
      saved: '저장했어요.',
      saveFailed: (detail: string): string => `저장하지 못했어요: ${detail}`,
      refresh: '갱신 주기',
      refreshChoices: { fast: '빠르게', normal: '보통', saver: '절약' },
      refreshHelp: (openSec: number, closedSec: number): string =>
        `창이 열려 있으면 ${openSec}초, 닫혀 있으면 ${closedSec}초마다 확인해요. 빠를수록 pitwall 이 CPU 를 조금 더 써요.`,
      theme: '화면 테마',
      themeChoices: { light: '밝게', dark: '어둡게', auto: '자동(OS 따라)' },
      launchAtLogin: '로그인할 때 트레이로 시작',
      launchAtLoginHelp: '설치한 앱에서만 적용돼요(개발 실행에서는 등록하지 않아요).',
      updateCheck: '새 버전 확인',
      updateCheckHelp:
        'GitHub 에서 새 버전이 있는지 확인해요. pitwall 이 하는 유일한 인터넷 접속이에요.',
      ramWarn: 'RAM 경고 기준',
      ramWarnHelp: '이 이상이면 RAM 이 주황색이 되고, 무거운 작업이 겹칠 때 알려요.',
      ramDanger: 'RAM 위험 기준',
      ramDangerHelp: '이 이상이면 빨간색이 되고 RAM 부족 알림을 보내요. 경고 기준보다 커야 해요.',
      idlePort: '안 쓰는 포트 기준',
      idlePortHelp:
        '에이전트가 없는 워크트리의 포트가 이 시간 동안 연결이 없으면 정리 후보, 브라우저 탭만 연결돼 있으면 확인해볼 것으로 표시해요.',
      minutes: '분',
      heavyPatterns: '무거운 명령',
      heavyHelp:
        '한 줄에 하나씩. 명령 이름(예: vue-tsc)이나 이름과 인자(예: vite build). 둘 이상 겹치고 RAM 이 경고 기준 이상이면 알려요. 막거나 기다리게 하지는 않아요.',
      resetDefaults: '기본값으로',
      notifyRamLow: 'RAM 부족',
      notifyRamLowHelp: 'RAM 이 위험 기준을 넘으면, 끄면 확보할 수 있는 양과 함께 알려요.',
      notifyClaudeWaiting: 'Claude 권한 대기',
      notifyClaudeWaitingHelp:
        'Claude 연동을 켜 두었을 때, 세션이 권한을 기다리기 시작하면 알려요.',
      notifyHeavy: '무거운 작업 겹침',
      notifyHeavyHelp: '무거운 작업이 둘 이상 겹치고 RAM 이 경고 기준 이상이 되면 알려요.',
      dependencyDirs: '지울 의존성 폴더 이름',
      dependencyDirsHelp:
        '한 줄에 하나씩. 끝난 워크트리 바로 아래의 이 이름 폴더만 지워요(예: node_modules). 경로나 .git 은 쓸 수 없어요.',
      extraRepos: '더 살펴볼 저장소',
      extraReposHelp:
        '에이전트·개발 서버를 본 저장소는 저절로 기억해요. 그 밖에 끝난 워크트리를 찾아볼 저장소를 여기 더해요.',
      addRepo: '폴더 추가',
      removeRepo: '빼기',
      noRepos: '더한 저장소가 없어요.',
      settingsFile: (path: string): string => `설정 파일: ${path}`,
      version: (v: string): string => `pitwall ${v}`,
      repo: 'GitHub 저장소',
      license: '라이선스: MIT',
      notices: '가져온 오픈소스와 라이선스',
      description:
        '로컬 AI 코딩 에이전트·개발 서버 포트·RAM·디스크를 한눈에 보고 정리하는 트레이 앱이에요.'
    },
    refresh: '지금 새로고침',
    list: {
      search: '검색…',
      clearSearch: '검색어 지우기',
      empty: '열려 있는 개발 서버 포트가 없어요.',
      emptyAgents: '실행 중인 에이전트가 없어요.',
      emptyLeftovers: '남은 프로세스가 없어요.',
      noMatch: '찾는 항목이 없어요.',
      groups: {
        ports: '개발 서버 포트',
        agents: '에이전트',
        leftovers: '남은 프로세스',
        disk: '디스크 정리'
      },
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
      cpuSubWindows: '(전체 CPU 대비)',
      stateSource: '상태 출처',
      codexNote: 'Codex 는 CPU 사용량으로만 작업 중인지 짐작해요.',
      noHookNote: 'Claude 연동을 켜면 권한 대기까지 정확히 알 수 있어요.'
    },
    disk: {
      empty: '정리할 끝난 워크트리가 없어요.',
      notYet: '아직 찾지 않았어요. 앱을 켜고 1분 뒤에 찾아요.',
      gone: '이미 정리됐거나 더는 끝난 워크트리가 아니에요.',
      scanning: '찾는 중…',
      rescan: '다시 찾기',
      remove: '의존성 폴더 지우기',
      evidence: { upstreamGone: '원격 삭제됨', merged: '머지됨' },
      evidenceNote: {
        upstreamGone:
          '원격 브랜치가 지워졌어요(보통 머지한 뒤 지워요). 워크트리와 소스는 그대로 두고 의존성 폴더만 지워요.',
        merged:
          '원격 브랜치가 기본 브랜치에 머지됐어요. 워크트리와 소스는 그대로 두고 의존성 폴더만 지워요.'
      },
      inUse: '사용 중',
      inUseNote: '이 워크트리에서 개발 서버·에이전트 등이 실행 중이라 지울 수 없어요.',
      measuring: '재는 중…',
      link: '링크라 건너뜀',
      folders: '의존성 폴더',
      size: '크기',
      sizeSub: '(지울 수 있는 합계)',
      branch: '브랜치',
      evidenceTitle: '끝났다고 본 근거',
      evidenceSub: '(이 PC 의 git 정보)'
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
      recommendTitle: '메모리 정리 추천',
      recommendSummary: (n: number, size: string): string =>
        `${n}개를 끄면 약 ${size} 를 확보할 수 있어요.`,
      recommendNone:
        "정리 후보가 없어요. 아래 '메모리를 많이 쓰는 다른 앱'에서 끌 만한 것을 확인해 보세요.",
      killAll: '모두 끄기',
      heavyTitle: '무거운 작업',
      heavyOverlap: (percent: number, n: number): string =>
        `RAM 이 ${percent}% 인데 무거운 작업 ${n}개가 겹쳐 돌고 있어요. 하나가 끝날 때까지 새 작업을 미루면 좋아요.`,
      topAppsTitle: '메모리를 많이 쓰는 다른 앱',
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
      heavy: '무거운 작업',
      otherApps: '다른 앱',
      system: '시스템·공유 메모리',
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
