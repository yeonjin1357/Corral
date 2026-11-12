import type { PitEventKind } from './events'
import type { MemoryLevel, WaitReason } from './types'

/**
 * 맨 위 카드 줄의 카드 이름(카드 이름 키는 layoutState 의 CardId). 카드 제목(ui.cards.*)과 카드 편집의 이름
 * (ui.cardsEdit.title — 편집 막대의 칩·새 카드 제목)이 같은 글을 쓰도록 한 번만 적는다.
 */
const cardTitles = {
  memory: '메모리',
  servers: '개발 서버',
  agents: '에이전트',
  heavy: '무거운 작업',
  leftovers: '남은 프로세스',
  disk: '디스크 정리',
  waiting: '응답 대기',
  tokens: '토큰·한도',
  events: '최근 기록'
} as const

/** 화면·트레이·확인 창에 나오는 문구는 모두 여기 모은다(나중에 다국어로 넓힐 때 이 파일만 바꾸면 되도록). */
export const text = {
  appName: 'Corral',
  unresolvable: '판별 불가',
  detached: '(detached)',
  kill: {
    title: '개발 서버 내리기',
    message: (ports: string, label: string): string => `${ports} (${label}) 을(를) 내릴까요?`,
    detail: (processName: string, pid: number, descendantCount: number): string =>
      descendantCount > 0
        ? `${processName} (PID ${pid}) 와 하위 프로세스 ${descendantCount}개가 종료돼요.`
        : `${processName} (PID ${pid}) 가 종료돼요.`,
    agentInWorktree:
      '이 워크트리에서 에이전트가 실행 중이에요. 에이전트가 이 서버를 쓰고 있을 수 있어요.',
    confirm: '내리기',
    cancel: '취소'
  },
  /** 확인 창(메인이 묻고 화면이 그린다). ok: 실패를 알리기만 하는 창의 버튼 하나. */
  confirm: {
    ok: '확인'
  },
  /** 끄면 확보할 메모리(formatFreed). 커밋을 알면 RAM·커밋 둘 다, 모르면 RAM 만. */
  freed: {
    withCommit: (ram: string, commit: string): string => `RAM 약 ${ram} · 커밋 약 ${commit}`,
    ramOnly: (ram: string): string => `약 ${ram}`
  },
  /** 메모리 압박의 원인(pressureText): 커밋 단계가 더 높으면 커밋 사용률, 아니면 RAM 사용률. */
  pressure: {
    ram: (percent: number): string => `RAM ${percent}%`,
    commit: (percent: number): string => `커밋 ${percent}%`
  },
  /**
   * 무거운 작업이 겹치고 메모리가 부족할 때 Claude 에게 돌려주는 말(G7, 에이전트가 읽는다).
   * running: 도는 무거운 작업의 패턴 이름(guard.running), percent: 메모리 압박 원인의 사용률(pressureSource).
   * 명령·경로·프로세스 이름은 넣지 않는다.
   */
  guard: {
    defer: (running: string, percent: number): string =>
      `Corral: 지금 다른 무거운 작업(${running})이 돌고 있고 메모리 사용률이 ${percent}% 예요. 이 명령은 지금 실행하지 말고 1분쯤 뒤에 같은 명령을 다시 실행해 주세요. 그동안 다른 일을 먼저 해도 돼요. 검사를 건너뛰지는 마세요.`,
    note: (running: string, percent: number): string =>
      `Corral 참고: 다른 무거운 작업(${running})과 겹쳐 실행됐고 메모리 사용률이 ${percent}% 예요.`,
    /** 패턴 이름 몇 개와 나머지 개수: "vite build, tsc, webpack 외 2개". */
    running: (labels: string[], rest: number): string =>
      rest > 0 ? `${labels.join(', ')} 외 ${rest}개` : labels.join(', ')
  },
  cleanupWorkspace: {
    title: '작업 공간 정리',
    /** freed: formatFreed 결과("약 1.2 GB" 또는 "RAM 약 1.2 GB · 커밋 약 4.2 GB"). */
    message: (name: string, n: number, freed: string): string =>
      `${name} 의 ${n}개를 끌까요? ${freed} 를 확보해요.`,
    agent: (tool: string, state: string): string =>
      `${tool} 가 이 작업 공간에서 실행 중(${state})이에요. 서버를 꺼도 에이전트는 그대로예요.`
  },
  killMany: {
    title: '메모리 정리',
    /** freed: formatFreed 결과. */
    message: (n: number, freed: string): string => `${n}개를 끌까요? ${freed} 를 확보해요.`,
    item: (title: string, where: string, size: string): string => `• ${title} (${where}) — ${size}`,
    more: (n: number): string => `외 ${n}개`,
    note: '끄기 직전에 하나씩 최신 상태를 다시 확인하고, 그 사이 바뀐 것은 건너뛰어요.',
    confirm: '모두 끄기',
    killed: (n: number, freed: string): string => `${n}개를 껐어요. ${freed} 를 확보했어요.`,
    skipped: (n: number): string => `${n}개는 그 사이 바뀌거나 끝나서 건너뛰었어요.`,
    busy: (n: number): string => `${n}개는 이미 처리 중이라 건너뛰었어요.`,
    failed: (n: number): string => `${n}개는 끄지 못했어요(권한이 없거나 이미 끝남).`
  },
  disk: {
    confirmTitle: '의존성 폴더 지우기',
    confirmMessage: (folder: string, names: string, size: string): string =>
      `${folder} 의 ${names} 를 지울까요? 약 ${size}`,
    confirmDetail: (paths: string[], allCwds = true): string =>
      [
        ...paths,
        '',
        '워크트리와 소스 코드는 그대로 두고 의존성 폴더만 지워요. 이 워크트리를 다시 쓰려면 npm install 등으로 다시 설치해야 해요.',
        ...(allCwds ? [] : ['', text.disk.cwdsUnknown])
      ].join('\n'),
    /** 수집 방식이 모든 프로세스의 작업 폴더를 읽지 못할 때 확인 창에 덧붙인다. */
    cwdsUnknown:
      '이 PC 에서는 프로세스의 작업 폴더를 모두 확인할 수 없어, 이 폴더 안에서 열어 둔 터미널·도구가 있는지 다 알아보지 못했어요. 쓰는 것이 없는지 확인한 뒤 지워 주세요.',
    confirm: '지우기',
    /** 디스크 정리의 모두 정리: 사용 중이 아닌 워크트리를 확인 창 하나로 지운다. */
    removeAll: {
      title: '모두 정리',
      message: (n: number, size: string): string =>
        `워크트리 ${n}곳의 의존성 폴더를 지울까요? 약 ${size}`,
      item: (name: string, folders: string, size: string): string =>
        `• ${name} (${folders}) — ${size}`,
      more: (n: number): string => `외 ${n}곳`,
      stale: (n: number): string => `이 중 ${n}곳은 끝났다는 근거 없이 오래 안 쓴 워크트리예요.`,
      note: '워크트리와 소스 코드는 그대로 두고 의존성 폴더만 지워요. 지우기 직전에 하나씩 다시 확인하고, 그 사이 쓰기 시작한 곳은 건너뛰어요.',
      confirm: '모두 지우기',
      removed: (n: number, size: string): string =>
        `${n}곳을 정리했어요. 약 ${size} 를 확보했어요.`,
      skipped: (n: number): string => `${n}곳은 그 사이 쓰기 시작했거나 바뀌어 건너뛰었어요.`,
      busy: (n: number): string => `${n}곳은 이미 정리하는 중이라 건너뛰었어요.`,
      failed: (n: number): string =>
        `${n}곳은 일부 폴더를 지우지 못했어요(파일을 쓰는 프로그램이 있을 수 있어요).`
    },
    removed: (names: string, size: string): string =>
      `${names} 를 지웠어요. 약 ${size} 를 확보했어요.`,
    inUse: '이 워크트리에서 개발 서버·에이전트 등이 실행 중이라 지우지 않았어요.',
    inUseBy: (name: string, pid: number): string =>
      `이 워크트리를 쓰는 프로세스가 있어 지우지 않았어요: ${name} (PID ${pid})`,
    notFinished: '이 워크트리의 브랜치가 더는 끝난 상태가 아니라 지우지 않았어요.',
    notStale: '이 워크트리를 다시 쓰기 시작해 지우지 않았어요.',
    locked: '이 워크트리가 잠겨 있어(다른 도구가 쓰는 중) 지우지 않았어요.',
    partial: (names: string): string =>
      `지우지 못한 폴더가 있어요(파일을 쓰는 프로그램이 있을 수 있어요): ${names}. 일부만 지워졌을 수 있으니 이 워크트리를 다시 쓰려면 의존성을 다시 설치해 주세요.`,
    unknownAgent:
      '작업 폴더를 모르는 에이전트가 있어 지우지 않았어요. 그 에이전트가 이 워크트리를 쓰고 있을 수 있어요.',
    gitMissing: 'git 을 찾지 못해 디스크 정리를 할 수 없어요. git 을 설치한 뒤 다시 시도해 주세요.',
    scanFailed: (detail: string): string => `끝난 워크트리를 찾지 못했어요: ${detail}`
  },
  notify: {
    ramTitle: (percent: number): string => `RAM 이 부족해요 (${percent}%)`,
    /** RAM 은 위험이 아닌데 커밋이 위험 기준을 넘었을 때. */
    commitTitle: (percent: number): string => `메모리 한도에 가까워요 (커밋 ${percent}%)`,
    /** freed: formatFreed 결과. */
    ramBody: (n: number, freed: string): string =>
      `정리 후보 ${n}개를 끄면 ${freed} 를 확보할 수 있어요.`,
    ramNoCandidates: '정리할 후보가 없어요. 메모리를 많이 쓰는 앱을 확인해 보세요.',
    waitingTitle: (tool: string): string => `${tool} 가 권한을 기다려요`,
    /** 세션 파일로 안 응답 대기의 이유가 질문·입력 요청·목표 제안·모름일 때의 제목(하나만 알릴 때). */
    waitingInputTitle: (tool: string): string => `${tool} 가 답을 기다려요`,
    /**
     * where: "폴더 · 브랜치", waitingTool: 권한을 기다리는 도구 이름(모르면 null). 명령·프롬프트는 넣지 않는다
     * (OS 알림 센터가 디스크에 남긴다).
     */
    waitingBody: (where: string, waitingTool: string | null): string =>
      waitingTool ? `${where} — ${waitingTool}` : where,
    waitingManyTitle: (n: number, tool: string | null): string =>
      `${tool ?? '에이전트'} ${n}개가 응답을 기다려요`,
    /** 계속 응답 대기일 때 다시 알림. duration: 기다린 시간(formatDuration). */
    waitingStillTitle: (tool: string, duration: string): string =>
      `${tool} 가 ${duration}째 응답을 기다려요`,
    quietTitle: (folder: string, tool: string): string => `${folder} 의 ${tool} 가 조용해요`,
    quietBody: (duration: string): string =>
      `${duration}째 이벤트가 없어요. 멈췄는지 확인해 보세요.`,
    quietManyTitle: (n: number): string => `에이전트 ${n}개가 조용해요`,
    goneTitle: (folder: string, tool: string): string => `${folder} 의 ${tool} 가 꺼졌어요`,
    /** 꺼지기 전 상태(작업 중·응답 대기)별 본문. */
    goneBody: { working: '작업 중이었어요.', waiting: '응답을 기다리던 중이었어요.' },
    goneManyTitle: (n: number): string => `에이전트 ${n}개가 꺼졌어요`,
    /** pressure: pressureText 결과("RAM 85%" 또는 "커밋 86%"). */
    heavyTitle: (pressure: string): string => `무거운 작업이 겹쳤어요 (${pressure})`,
    heavyBody: (labels: string): string => `${labels} 이(가) 동시에 돌고 있어요.`,
    doneTitle: (folder: string, tool: string): string => `${folder} 의 ${tool} 가 작업을 끝냈어요`,
    doneBody: (duration: string): string => `${duration} 동안 일했어요.`,
    doneManyTitle: (n: number): string => `에이전트 ${n}개가 작업을 끝냈어요`
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
    enableMessage: 'Claude Code 설정 파일에 Corral 훅을 더할까요?',
    enableDetail: (path: string): string =>
      `${path} 에 세션 시작·프롬프트·권한 요청·알림·도구 사용·응답 끝·오류·세션 끝 이벤트를 ` +
      'Corral 로 보내는 훅을 더해요. 다른 설정과 훅은 그대로 두고, 바꾸기 전에 백업을 남겨요. ' +
      '이미 실행 중인 Claude 세션은 다시 시작해야 반영될 수 있어요.',
    /** 무거운 작업 기다리게 하기(G7)가 켜져 있을 때 enableDetail 뒤에 붙인다. */
    enableGuardNote:
      ' "겹치면 에이전트가 기다리게 하기"가 켜져 있어, Bash·PowerShell 명령 전에 Corral 에 묻는 훅도 하나 더해요.',
    enableConfirm: '켜기',
    /** 설정에서 무거운 작업 기다리게 하기(G7)를 켤 때: 질문 훅을 더한다. */
    guardOnTitle: '에이전트 기다리게 하기 켜기',
    guardOnMessage: 'Claude Code 설정 파일에 질문 훅을 더할까요?',
    guardOnDetail: (path: string): string =>
      `${path} 의 Corral 훅을 다시 써서, Claude 가 Bash·PowerShell 명령을 실행하기 전에 Corral 에 묻는 훅을 하나 더해요. 무거운 작업이 겹치고 메모리가 부족할 때만 그 명령을 잠깐 미루게 해요. 다른 설정과 훅은 그대로 두고, 바꾸기 전에 백업을 남겨요. 이미 실행 중인 Claude 세션은 다시 시작해야 반영될 수 있어요.`,
    guardOnConfirm: '켜기',
    /** 설정에서 끈 뒤(기능은 이미 꺼짐): 질문 훅도 뺄지. */
    guardOffTitle: '에이전트 기다리게 하기 끄기',
    guardOffMessage: 'Claude Code 설정 파일에서 질문 훅을 뺄까요?',
    guardOffDetail: (path: string): string =>
      `기능은 이미 껐어요. ${path} 에서 Bash·PowerShell 명령 전에 Corral 에 묻는 훅도 빼요. 남겨 두면 명령마다 Corral 에 한 번 묻기만 하고 아무것도 미루지 않아요. 다른 설정과 훅은 그대로 두고, 바꾸기 전에 백업을 남겨요.`,
    guardOffConfirm: '빼기',
    disableTitle: 'Claude 연동 끄기',
    disableMessage: 'Claude Code 설정 파일에서 Corral 훅을 뺄까요?',
    disableDetail: (path: string): string =>
      `${path} 에서 Corral 이 넣은 훅만 빼요. 다른 설정과 훅은 그대로 두고, 바꾸기 전에 백업을 남겨요.`,
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
  codexHook: {
    enableTitle: 'Codex 연동 켜기',
    enableMessage: 'Codex 훅 설정 파일에 Corral 훅을 더할까요?',
    enableDetail: (path: string): string =>
      `${path} 에 세션 시작·프롬프트·도구 사용·권한 요청·응답 끝·멈춤·세션 끝 이벤트를 Corral 로 보내는 훅을 ` +
      '더해요. 다른 훅은 그대로 두고, 바꾸기 전에 백업을 남겨요. 켠 뒤 Codex 에서 /hooks 를 열어 한 번 승인해야 ' +
      '상태가 와요. 이미 실행 중인 Codex 는 다시 시작해야 반영될 수 있어요.',
    enableConfirm: '켜기',
    disableTitle: 'Codex 연동 끄기',
    disableMessage: 'Codex 훅 설정 파일에서 Corral 훅을 뺄까요?',
    disableDetail: (path: string): string =>
      `${path} 에서 Corral 이 넣은 훅만 빼요. 다른 훅은 그대로 두고, 바꾸기 전에 백업을 남겨요.`,
    disableConfirm: '끄기',
    enabled: (backupPath: string | null): string =>
      (backupPath
        ? `Codex 연동을 켰어요. 원래 설정은 ${backupPath} 에 백업했어요. `
        : 'Codex 연동을 켰어요. ') +
      'Codex 에서 /hooks 를 열어 Corral 훅(주소에 pitwall-hook 이 들어 있는 훅)을 한 번 승인해 주세요.',
    alreadyOn:
      'Codex 연동이 이미 켜져 있어요. 상태가 안 오면 Codex 의 /hooks 에서 승인했는지 확인해 주세요.',
    disabled: (backupPath: string | null): string =>
      backupPath
        ? `Codex 연동을 껐어요. 바꾸기 전 설정은 ${backupPath} 에 백업했어요.`
        : 'Codex 연동을 껐어요.',
    alreadyOff: 'Codex 연동이 이미 꺼져 있어요.',
    errors: {
      parse: 'hooks.json 을 읽을 수 없어 바꾸지 않았어요. 주석·쉼표 같은 형식을 확인해 주세요.',
      shape: 'hooks.json 의 hooks 형식이 예상과 달라 바꾸지 않았어요.',
      busy: 'hooks.json 이 계속 바뀌고 있어 바꾸지 않았어요. 잠시 뒤 다시 해 주세요.',
      encoding:
        'hooks.json 에 UTF-8 이 아닌 글자가 있어 바꾸지 않았어요. UTF-8 로 다시 저장한 뒤 해 주세요.',
      other: (message: string): string => `Codex 연동을 바꾸지 못했어요: ${message}`
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
    servers: (n: number): string => `개발 서버 ${n}개`,
    agents: (n: number, waiting: number): string =>
      waiting > 0 ? `에이전트 ${n}개 (응답 대기 ${waiting})` : `에이전트 ${n}개`,
    candidates: (n: number): string => `정리 후보 ${n}개`,
    leftovers: (n: number): string => `남은 프로세스 ${n}개`,
    heavy: (n: number, overlap: boolean): string =>
      overlap ? `무거운 작업 ${n}개 · 겹침(메모리 부족)` : `무거운 작업 ${n}개`,
    disk: (size: string): string => `디스크 정리 가능 ${size}`,
    updateReady: (v: string): string => `새 버전 ${v} — 다시 시작해 설치`,
    updateAvailable: (v: string): string => `새 버전 ${v} 내려받기`,
    open: '앱 열기',
    settings: '설정',
    quit: '종료',
    /** pressure: pressureText 결과("RAM 82%" 또는 "커밋 91%"), waiting: 응답을 기다리는 에이전트 수. */
    tooltip: (pressure: string, waiting: number): string =>
      waiting > 0 ? `Corral — ${pressure} · 응답 대기 ${waiting}` : `Corral — ${pressure}`,
    stillRunning:
      'Corral 은 트레이에서 계속 실행돼요. 끄려면 트레이 아이콘 메뉴에서 종료를 누르세요.'
  },
  ui: {
    loading: '불러오는 중…',
    stale: '업데이트 지연',
    settingsLater: '설정은 다음 단계에서 추가돼요',
    nextStage: '(다음 단계)',
    none: '—',
    nav: { dashboard: '대시보드', settings: '설정' },
    /** 맨 위 제목줄(NeoHtop TitleBar). */
    bar: {
      live: (sec: number): string => `실시간 · ${sec}초`,
      refresh: '지금 새로고침',
      theme: '화면 테마',
      themeTitle: '화면 테마 고르기',
      themes: {
        light: { label: '밝게', sub: '흰 바탕' },
        dark: { label: '어둡게', sub: '흑회색' },
        auto: { label: 'OS 따라', sub: '밝게·어둡게 자동' }
      },
      menu: 'Corral 메뉴',
      settings: '설정…',
      about: 'Corral 정보',
      checkUpdate: '새 버전 확인…',
      back: '대시보드로',
      dismiss: '닫기'
    },
    trend: {
      window: (ms: number): string => {
        if (ms < 60_000) return `${Math.round(ms / 1000)}초`
        const minutes = Math.round(ms / 60_000)
        if (minutes < 60) return `${minutes}분`
        const rest = minutes % 60
        return rest ? `${Math.floor(minutes / 60)}시간 ${rest}분` : `${minutes / 60}시간`
      },
      collecting: '기록을 모으는 중…'
    },
    /** 맨 위 카드 줄(NeoHtop StatsBar). */
    cards: {
      memory: cardTitles.memory,
      memoryOf: (used: string, total: string, free: string): string =>
        `${total} 중 ${used} 사용 · 남은 ${free}`,
      /** 커밋 사용량(단위가 같으면 앞 값의 단위는 뺀다: "104.8 / 127.7 GB"). */
      commitLine: (used: string, limit: string, percent: number): string =>
        `커밋 ${used} / ${limit} (${percent}%)`,
      /** 경고·위험의 원인이 RAM 이 아니라 커밋일 때 배지 옆에 붙는다. */
      commitCause: '커밋',
      levels: { warn: '경고', danger: '위험' },
      /** 쌓은 막대 조각·범례의 풍선말(G4): "개발 서버 8.7 GB · 전체 RAM 의 14%". */
      memoryPart: (name: string, bytes: string, percent: number): string =>
        `${name} ${bytes} · 전체 RAM 의 ${percent}%`,
      /** 쌓은 막대의 빈 칸(남은 메모리) 풍선말 이름. */
      memoryFree: '남은 메모리',
      memoryDetails: '메모리 자세히 보기',
      showList: '목록에서 보기',
      count: '개',
      memorySum: '메모리',
      ports: cardTitles.servers,
      portsSub: (ports: number, workspaces: number): string =>
        workspaces > 0 ? `포트 ${ports}개 · 작업 공간 ${workspaces}곳` : `포트 ${ports}개`,
      portJudge: '정리 판단',
      candidate: '정리 후보',
      check: '확인해볼 것',
      inUse: '사용 중',
      agents: cardTitles.agents,
      agentsSub: '실행 중',
      stateSource: '상태 판단',
      sourceHook: 'Claude 훅',
      sourceFile: '세션 파일',
      sourceCpu: 'CPU 추정',
      agentStates: '상태',
      agentOthers: '그 외',
      /** 셋째 칸(쉬는 중·그 외) 가운데 오래 쉬는 세션 수. */
      agentParked: (n: number): string => `오래 쉼 ${n}`,
      /** 에이전트 카드 설명 줄(G6): 가장 높은 창 하나, "Codex 한도 주간 31%". */
      codexLimitCaption: (label: string, percent: number): string =>
        `Codex 한도 ${label} ${percent}%`,
      codexLimitWindow: (label: string, percent: number): string => `${label} ${percent}%`,
      /** 풍선말의 창 하나: "5시간: 14% · 11월 10일 오후 3:00 초기화"(초기화 시각을 모르면 앞부분만). */
      codexLimitTip: (label: string, percent: number, resetAt: string | null): string =>
        resetAt ? `${label}: ${percent}% · ${resetAt} 초기화` : `${label}: ${percent}%`,
      /** 상세 패널 사용 한도 카드의 초기화 시각: "5시간 오후 9:21 초기화". */
      codexLimitReset: (label: string, at: string): string => `${label} · ${at} 초기화`,
      /** 풍선말 끝: 숫자를 읽은 때(ago: "3분"). */
      codexLimitsAt: (ago: string): string => `${ago} 전 기준`,
      /** 창 길이 이름: 주간·N일·N시간·N분. */
      windowWeek: '주간',
      windowDays: (n: number): string => `${n}일`,
      windowHours: (n: number): string => `${n}시간`,
      windowMinutes: (n: number): string => `${n}분`,
      heavy: cardTitles.heavy,
      heavyRunning: '실행 중',
      overlap: '겹침',
      /** pressure: pressureText 결과("RAM 85%" 또는 "커밋 86%"). */
      overlapNote: (pressure: string): string => `${pressure} 에서 겹쳐 도는 중`,
      heavyHelp:
        '설정한 무거운 명령(타입 검사·빌드 등)이에요. 둘 이상 겹치고 RAM 이 경고 기준을 넘으면 알려요.',
      leftovers: cardTitles.leftovers,
      leftoversSub: '남은 개발 도구',
      leftoversAgent: (n: number): string => `에이전트 워크트리 ${n}개는 뺐어요.`,
      leftoversHelp: '실행한 에이전트·터미널이 끝났는데 10분 넘게 남아 있는 개발 도구예요.',
      disk: cardTitles.disk,
      /** finished·stale: 사용 중이 아닌 끝난·오래 안 쓴 워크트리 수. 오래 안 쓴 곳이 없으면 예전 문구. */
      diskSub: (finished: number, stale = 0): string =>
        stale > 0
          ? `끝난 워크트리 ${finished}곳 · 오래 안 쓴 ${stale}곳`
          : `끝난 워크트리 ${finished}곳에서 확보 가능`,
      diskInUse: '사용 중이라 제외',
      diskNotYet: '아직 찾지 않았어요',
      diskAuto: '곧 저절로 찾아요',
      diskScanned: (time: string): string => `${time} 에 찾음`,
      rescan: '다시 찾기'
    },
    /** 카드 영역과 표 사이의 손잡이 줄(G2). */
    layout: {
      modes: { full: '자세히', compact: '간단히', collapsed: '접기' },
      handle: '끌어서 위아래 크기 조절 · 더블클릭: 자세히 ↔ 접기',
      editCards: '카드 편집'
    },
    /** 카드 고르기(G3): 카드 이름(편집 막대의 칩·새 카드 제목), 편집 단추, 새 카드의 빈 상태. */
    cardsEdit: {
      title: cardTitles,
      hide: '숨기기',
      show: '보이기',
      remove: '빼기',
      left: '앞으로',
      right: '뒤로',
      addable: '더할 수 있는 카드',
      reset: '기본값으로',
      done: '완료',
      waitingNone: '기다리는 에이전트가 없어요',
      tokensNone: '아직 읽은 토큰이 없어요',
      eventsNone: '아직 기록이 없어요'
    },
    /** 표 위 탭(NeoHtop ToolBar). */
    tabs: {
      label: '보기',
      workspaces: '작업 공간',
      ports: '개발 서버',
      agents: '에이전트',
      leftovers: '남은 프로세스',
      heavy: '무거운 작업',
      disk: '디스크 정리',
      apps: '다른 앱',
      events: '기록'
    },
    /** 기록 탭(G3g): 종류 이름과 내용 문구. 내용(프롬프트·명령)은 기록에 없으니 숫자·이름만 쓴다. */
    events: {
      kinds: {
        'agent-start': '시작',
        'memory-level': '메모리',
        'agent-end': '꺼짐',
        'agent-done': '작업 끝남',
        'agent-waiting': '응답 대기',
        'agent-error': '오류',
        'agent-quiet': '조용함',
        'server-start': '서버 시작',
        'server-end': '서버 꺼짐',
        'heavy-start': '무거운 작업 시작',
        'heavy-end': '무거운 작업 끝',
        cleanup: '정리',
        'disk-remove': '디스크 정리',
        'heavy-defer': '에이전트를 기다리게 함'
      } satisfies Record<PitEventKind, string>,
      memoryLevel: (level: string): string => `메모리 ${level}`,
      levels: { normal: '정상', warn: '경고', danger: '위험' } satisfies Record<
        MemoryLevel,
        string
      >,
      worked: (duration: string): string => `${duration} 동안 일했어요`,
      wasWorking: '작업 중이었어요',
      quiet: '한동안 이벤트가 없었어요',
      peak: (bytes: string): string => `최대 ${bytes}`,
      ram: (percent: number): string => `RAM ${percent}%`,
      cleanupCount: (count: number): string => `${count}개를 껐어요`
    },
    /** 창을 오래 안 보다가 다시 볼 때 카드(G3g). */
    away: {
      title: '자리 비운 사이',
      summary: (minutes: number, parts: string[]): string =>
        `${minutes}분 동안: ${parts.join(' · ')}`,
      done: (n: number): string => `작업 끝남 ${n}`,
      waiting: (n: number): string => `응답 대기 ${n}`,
      gone: (n: number): string => `꺼진 에이전트 ${n}`,
      quiet: (n: number): string => `조용함 ${n}`,
      maxRam: (percent: number): string => `RAM 최고 ${percent}%`,
      show: '기록 보기'
    },
    search: {
      placeholder: '이름·포트·브랜치로 찾기…',
      clear: '검색어 지우기',
      matches: (shown: number, total: number): string => `${total}개 중 ${shown}개`,
      chip: (q: string): string => `검색: ${q}`,
      clearAll: '모두 지우기',
      none: '찾는 항목이 없어요',
      noneHint: '다른 이름·포트·브랜치로 찾아 보세요.'
    },
    columns: {
      project: '프로젝트',
      port: '포트',
      branch: '브랜치',
      process: '프로세스',
      status: '상태',
      clients: '연결',
      memory: '메모리',
      commit: '커밋',
      cpu: 'CPU',
      runtime: '실행 시간',
      activity: '하는 일',
      context: '컨텍스트',
      tool: '도구',
      name: '이름',
      command: '명령',
      worktree: '워크트리',
      time: '시각',
      kind: '종류',
      target: '대상',
      detail: '내용',
      evidence: '끝난 근거',
      folders: '의존성 폴더',
      size: '크기',
      app: '앱',
      pid: 'PID',
      processes: '프로세스 수',
      actions: '동작'
    },
    /** 표의 메모리 막대(G5): 메모리 칸 풍선말과 메모리 머리글 풍선말(막대의 기준). */
    table: {
      /** ofRam: 전체 RAM 대비 %. 전체 RAM 을 아직 모르면 null(그 부분을 뺀다). */
      memoryShareRows: (bytes: string, ofTable: number, ofRam: number | null): string =>
        ofRam == null
          ? `${bytes} · 이 표 합의 ${ofTable}%`
          : `${bytes} · 이 표 합의 ${ofTable}% · 전체 RAM 의 ${ofRam}%`,
      memoryShareUsed: (bytes: string, ofUsed: number): string =>
        `${bytes} · 사용 중 RAM 의 ${ofUsed}%`,
      memoryHintRows: '막대: 이 표의 메모리 합 대비',
      memoryHintUsed: '막대: 사용 중인 RAM 대비'
    },
    rowStatus: {
      inUse: '사용 중',
      idle: '연결 없음',
      candidate: '정리 후보',
      check: '확인해볼 것',
      agent: '에이전트 작업 중',
      /** 덮는 에이전트가 모두 오래 쉬는 세션인데 아직 판단 전(G2). */
      agentParked: '에이전트 오래 쉼',
      /** 덮는 에이전트가 모두 오래 쉬는 세션이라 확인해볼 것까지만 올린 서버(표의 160px 칸용 짧은 문구). */
      checkParked: '확인해볼 것 · 에이전트 쉼',
      /** checkParked 의 긴 문구(표의 title·상세 패널 배지). duration: 가장 늦은 마지막 활동부터. */
      checkParkedFor: (duration: string): string => `확인해볼 것 · 에이전트가 ${duration}째 쉼`,
      /** 에이전트 상태 칸의 오래 쉬는 세션("오래 쉼 · 3시간"). */
      parked: '오래 쉼',
      /** 오래 쉬는 에이전트 상태 칸의 title. */
      lastActive: (duration: string): string => `마지막 활동 ${duration} 전`,
      /** 에이전트 상태 칸·상세 패널 배지의 조용한 에이전트(G3c, "조용함 · 18분"). */
      quiet: '조용함',
      /** 조용한 에이전트 상태 칸의 title. tool: 실행 중인 도구 이름(모르면 null). */
      quietFor: (minutes: number, tool: string | null): string =>
        `${tool ? `${tool} 실행 중 · ` : ''}${minutes}분째 이벤트가 없고 CPU 를 거의 쓰지 않아요`,
      unresolvable: '판별 불가',
      leftoverAgent: '에이전트 워크트리',
      leftoverFree: '끌 수 있음',
      diskInUse: '사용 중',
      diskFree: '지울 수 있음',
      hidden: '숨김',
      memoryGrowth: '메모리 증가',
      memoryGrowthTitle: (minutes: number, from: string, to: string): string =>
        `${minutes}분 동안 ${from} → ${to}`,
      withTime: (state: string, duration: string): string => `${state} · ${duration}`,
      groupCount: (label: string, n: number): string => `${label} ${n}`
    },
    trayView: {
      live: '실시간 요약',
      stale: '업데이트가 늦어지고 있어요',
      reading: '확인하는 중…',
      open: 'Corral 열기',
      settings: '설정',
      quit: 'Corral 종료',
      ram: 'RAM',
      ramDetail: (used: string, total: string): string => `${used} / ${total}`,
      servers: '개발 서버',
      ports: (n: number): string => `포트 ${n}개`,
      agents: '에이전트',
      agentStates: (working: number, waiting: number): string =>
        waiting > 0 ? `작업 중 ${working} · 응답 대기 ${waiting}` : `작업 중 ${working}`,
      /** freed: formatFreed 결과. */
      recommend: (n: number, freed: string): string => `정리 추천 ${n}개 · ${freed} 확보`,
      workspaces: '작업 공간',
      workspaceColumns: '서버 · 메모리',
      noServers: '열려 있는 개발 서버가 없어요.'
    },
    group: {
      expand: (name: string): string => `${name} 펼치기`,
      collapse: (name: string): string => `${name} 접기`,
      servers: (n: number): string => `서버 ${n}개`,
      renameLabel: '작업 공간 이름',
      renameHint: 'Enter 로 저장, Esc 로 취소. 비우면 폴더 이름으로 돌아가요.',
      memoryHint: '묶음 안 서버 메모리 합(서버마다 한 번)',
      commitHint: '묶음 안 서버 커밋 합(서버마다 한 번)',
      workspaceRepo: '작업 공간 저장소',
      viewLabel: '개발 서버 보기',
      list: '목록',
      grouped: '묶음',
      hiddenToggle: (n: number): string => `숨김 ${n}개`,
      hiddenBack: '숨긴 서버 닫기',
      /** 개발 서버가 아닌 LISTEN 포트(G5c) 보기: 표 바닥 전환과 바닥 줄의 이름. */
      otherPorts: '다른 포트',
      otherToggle: (n: number): string => `다른 포트 ${n}개`,
      otherBack: '다른 포트 닫기',
      /** 찾는 포트가 개발 서버에 없고 다른 포트에 있을 때 빈 화면의 버튼. */
      findOther: '다른 포트에서 찾기',
      hideHint:
        '이 워크트리의 첫 포트로 숨겨요(다른 프로젝트가 같은 포트를 열면 그대로 보여요). 숨긴 서버는 개수·정리 추천·알림·트레이에서 빠져요.',
      hiddenDone: (entry: string): string =>
        `${entry} 서버를 숨겼어요. 표 아래 "숨김"에서 다시 볼 수 있어요.`
    },
    /** 작업 공간 탭(G4): 한 작업의 에이전트·서버·무거운 작업·남은 프로세스를 한 묶음에. */
    workspaces: {
      /** 종류 칸과 머리 요약("서버 3 · 무거운 작업 1"). */
      kinds: {
        server: '서버',
        agent: '에이전트',
        heavy: '무거운 작업',
        leftover: '남은 프로세스'
      },
      /** 머리 요약의 커밋 안 한 변경 수("변경 12"). */
      changed: '변경',
      members: (n: number): string => `항목 ${n}개`,
      memoryHint: '작업 공간 전체 메모리 합(프로세스마다 한 번)',
      commitHint: '작업 공간 전체 커밋 합(프로세스마다 한 번)'
    },
    actions: {
      hide: '숨기기',
      unhide: '숨김 풀기',
      cleanup: '작업 공간 정리',
      rename: '이름 바꾸기',
      details: '자세히',
      open: '브라우저로 열기',
      kill: '내리기',
      killLeftover: '끄기',
      remove: '의존성 폴더 지우기'
    },
    /** 상세 패널의 바로 가기(G3f). */
    quick: {
      copy: '경로 복사',
      folder: '폴더 열기',
      terminal: '터미널 열기',
      copied: '경로를 복사했어요.',
      failed: '열지 못했어요. 폴더가 없어졌을 수 있어요.',
      /** 에이전트가 떠 있는 터미널·에디터 창을 앞으로 가져온다. */
      focus: '창으로 가기',
      focusFailed: '그 에이전트의 창을 찾지 못했어요.'
    },
    footer: {
      count: (label: string, n: number): string => `${label} ${n}개`,
      takenAt: (time: string): string => `${time} 기준`
    },
    /** 오른쪽에서 나오는 상세 패널(NeoHtop ProcessDetailsModal·ResourceDetails). */
    sheet: {
      info: '정보',
      workspace: '작업 공간',
      commandLine: '명령줄',
      path: '경로',
      pid: 'PID',
      children: '하위 프로세스',
      processes: (n: number): string => `프로세스 ${n}개`,
      processRest: (n: number): string => `그 밖 ${n}개(메모리가 작은 것은 줄였어요)`,
      startedAt: '시작 시각',
      runtime: '실행 시간',
      branchKind: '체크아웃',
      linked: '연결된 워크트리',
      main: '메인 체크아웃',
      clients: '연결',
      clientsNow: (n: number): string =>
        n > 0 ? '브라우저 등이 연결돼 있어요' : '지금 연결이 없어요',
      memoryTitle: '메모리',
      memoryDesc: 'Corral 이 묶어서 본 메모리 사용',
      reading: (time: string): string => `${time} 측정`,
      facts: {
        total: '전체 메모리',
        used: '사용 중',
        free: '남은 메모리',
        commit: '커밋',
        commitLimit: '커밋 한도'
      },
      /** 커널 몫(시스템·공유 메모리 줄 아래). */
      kernelIncluded: (size: string): string => `커널 ${size} 포함`,
      commitNote:
        '커밋은 프로세스가 차지하기로 한 메모리 전체(RAM 에 올라온 것 + 페이지 파일로 밀려난 것)예요. 메모리가 부족하면 RAM 값은 줄어도 커밋은 그대로예요.',
      groupsTitle: '어디에 쓰고 있나',
      groupsDesc: '사용 중인 메모리를 묶음별로 나눴어요.',
      topApps: '메모리를 많이 쓰는 다른 앱',
      trendTitle: '사용 추이',
      done: '닫기'
    },
    /** 메모리 상세의 메모리 지도·묶음별 추이(G6). */
    memorySheet: {
      mapTitle: '메모리 지도',
      mapHint: '사각형 크기 = 쓰는 메모리. 누르면 그 줄의 상세',
      /** 큰 순 12개 밖의 다른 앱을 모은 칸. */
      mapOthers: (n: number): string => `기타 ${n}개`,
      /** 묶음 안 줄들의 합이 묶음보다 작을 때 남는 몫. */
      mapRest: '그 밖',
      /** 폴더·도구까지 같은 에이전트 칸을 PID 로 구분한다. */
      mapWithPid: (label: string, pid: number): string => `${label} · PID ${pid}`,
      /** 에이전트 칸의 크기: 표의 메모리(띄운 무거운 작업까지)와 달리 무거운 작업을 뺀 자기 몫일 때. */
      agentOwn: (bytes: string): string => `${bytes} (무거운 작업 제외)`,
      trendGroupsTitle: '묶음별 추이',
      /** 지도 위 한 줄(남은 메모리는 지도에 넣지 않는다). */
      freeLine: (free: string): string => `남은 메모리 ${free}`
    },
    recommend: {
      more: (n: number): string => `외 ${n}개`,
      overlapTitle: '무거운 작업이 겹쳐 돌고 있어요'
    },
    settings: {
      title: '설정',
      menu: {
        general: '일반',
        thresholds: '기준값',
        heavy: '무거운 작업',
        notifications: '알림',
        disk: '디스크 정리',
        claude: '에이전트 연동',
        about: '정보'
      },
      save: '저장',
      saved: '저장했어요.',
      saving: '저장하는 중…',
      dirty: '저장하지 않은 변경 사항이 있어요.',
      clean: '바꾼 뒤 저장을 누르면 바로 적용돼요.',
      pageDesc: {
        general: 'Corral 이 얼마나 자주 확인하고 어떻게 보일지 정해요.',
        thresholds: '경고 색과 정리 후보를 정하는 기준이에요.',
        heavy: '겹쳐 돌면 알려 줄 무거운 명령이에요.',
        notifications: '어떤 때 OS 알림을 보낼지 골라요.',
        disk: '끝난 워크트리에서 지울 폴더와 더 살펴볼 저장소예요.',
        claude: 'Claude Code·Codex 훅으로 작업 중·응답 대기와 기다리는 도구를 정확히 알아요.'
      },
      /** 정보 쪽의 제목 아래 줄(다른 쪽의 pageDesc 자리). */
      currentVersion: (v: string): string => `현재 버전: ${v}`,
      groups: {
        check: '확인 주기',
        look: '화면',
        startup: '시작과 업데이트',
        ram: 'RAM',
        ports: '개발 서버',
        heavy: '무거운 명령',
        notify: 'OS 알림',
        dirs: '지울 폴더',
        stale: '오래 안 쓴 워크트리',
        repos: '더 살펴볼 저장소',
        hook: '연동 상태'
      },
      saveFailed: (detail: string): string => `저장하지 못했어요: ${detail}`,
      refresh: '갱신 주기',
      refreshChoices: { fast: '빠르게', normal: '보통', saver: '절약' },
      /** 옵션 줄: "빠르게 · 2초 / 10초"(창을 열어 두었을 때 / 닫아 두었을 때). */
      refreshChoice: (label: string, open: string, closed: string): string =>
        `${label} · ${open} / ${closed}`,
      refreshHelp: (open: string, closed: string): string =>
        `창을 열어 두면 ${open}, 닫아 두면 ${closed}마다 확인해요. 창을 닫아 둔 동안에는 알림이 최대 ${closed} 늦을 수 있고, 빠를수록 Corral 이 CPU 를 조금 더 써요.`,
      theme: '화면 테마',
      themeChoices: { light: '밝게', dark: '어둡게', auto: '자동(OS 따라)' },
      launchAtLogin: '로그인할 때 트레이로 시작',
      launchAtLoginHelp: '설치한 앱에서만 적용돼요(개발 실행에서는 등록하지 않아요).',
      updateCheck: '새 버전 확인',
      updateCheckHelp:
        '새 버전이 나왔는지 인터넷으로 확인해요. Corral 이 하는 유일한 인터넷 접속이에요.',
      ramWarn: 'RAM 경고 기준',
      ramWarnHelp:
        'RAM 사용률이나 커밋 사용률이 이 이상이면 주황색이 되고, 무거운 작업이 겹칠 때 알려요.',
      ramDanger: 'RAM 위험 기준',
      ramDangerHelp:
        'RAM 사용률이나 커밋 사용률이 이 이상이면 빨간색이 되고 메모리 부족 알림을 보내요. 경고 기준보다 커야 해요.',
      idlePort: '안 쓰는 포트 기준',
      idlePortHelp:
        '에이전트가 없는 워크트리의 포트가 이 시간 동안 연결이 없으면 정리 후보, 브라우저 탭만 연결돼 있으면 확인해볼 것으로 표시해요.',
      agentParked: '오래 쉬는 세션 기준',
      agentParkedHelp:
        '에이전트가 이 시간 넘게 입력·도구 사용이 없으면 오래 쉬는 세션으로 봐요. 그 에이전트만 있는 워크트리의 서버는 정리 후보가 아니라 확인해볼 것까지만 올려요.',
      minutes: '분',
      heavyPatterns: '무거운 명령',
      heavyHelp:
        '한 줄에 하나씩. 명령 이름(예: vue-tsc)이나 이름과 인자(예: vite build). 둘 이상 겹치고 RAM 이 경고 기준 이상이면 알려요. 알리기만 해요 — 에이전트를 기다리게 하려면 아래 항목을 켜세요.',
      resetDefaults: '기본값으로',
      heavyGuard: '겹치면 에이전트가 기다리게 하기(Claude Code)',
      heavyGuardHelp:
        '켜면 Claude 가 Bash·PowerShell 명령을 실행하기 전에 Corral 에 물어봐요. 무거운 작업이 이미 돌고 있고 메모리가 경고 기준을 넘었을 때만, 같은 명령을 두 번까지 1분 뒤로 미루게 해요. Claude 설정 파일에 훅을 하나 더 넣어요(확인 창·백업). Corral 이 꺼져 있으면 아무 일도 없어요.',
      /** 켜려고 저장했는데 메인이 켜지 않았을 때(질문 훅 설치를 취소·실패) "저장했어요" 대신. */
      heavyGuardNotChanged:
        '에이전트 기다리게 하기는 켜지 않았어요(훅 설치를 취소했거나 실패했어요).',
      /** 켜져 있는데 Claude 연동이 켜져 있지 않을 때 체크 아래에. */
      heavyGuardNeedsHook:
        'Claude 연동이 꺼져 있어 지금은 동작하지 않아요. Claude 연동을 켜면 질문 훅도 함께 설치돼요.',
      notifyRamLow: '메모리 부족',
      notifyRamLowHelp: 'RAM 이나 커밋이 위험 기준을 넘으면, 끄면 확보할 수 있는 양과 함께 알려요.',
      notifyAgentDone: '에이전트 작업 끝남',
      notifyAgentDoneHelp:
        '정확한 상태를 아는 에이전트(Claude·Codex 연동, Codex 세션 기록)가 2분 넘게 일한 뒤 끝나면 알려요. 짧은 답에는 알리지 않아요.',
      hiddenServers: '숨긴 서버',
      hiddenServersHelp:
        '목록·개수·정리 추천·알림·트레이에서 빼는 서버예요. :포트, 프로세스 이름, 또는 워크트리의 포트로 맞춰요. 서버 상세 패널의 "숨기기"로 더해요(그 워크트리의 첫 포트).',
      noHiddenServers: '숨긴 서버가 없어요.',
      unhide: '빼기',
      showAgentActivity: '에이전트가 하는 일 보기',
      showAgentActivityHelp:
        '훅이 알려 주는 세션 제목·요청 첫 줄·도구 이름을 화면에 보여요. 메모리에만 두고 파일로 남기지 않아요.',
      readUsage: '토큰 사용량 보기',
      readUsageHelp:
        '세션 기록 파일에서 토큰 숫자만 읽어요. 대화 내용은 남기지 않아요. Claude 의 사용 한도는 보여 주지 않아요(상태 줄 설정을 건드려야 해서요).',
      notifyClaudeWaiting: '에이전트 응답 대기',
      notifyClaudeWaitingHelp: '에이전트가 권한 확인이나 답을 기다리기 시작하면 알려요.',
      notifyAgentQuiet: '조용한 에이전트',
      notifyAgentQuietHelp:
        '훅으로 작업 중인 에이전트가 15분 넘게 이벤트도 CPU 사용도 없으면 알려요. 오래 걸리는 명령을 기다리는 중일 수도 있어요.',
      notifyAgentGone: '에이전트 꺼짐',
      notifyAgentGoneHelp: '작업 중이거나 응답을 기다리던 에이전트가 꺼지면 알려요.',
      notifyClickFocus: '알림을 누르면 그 에이전트의 창으로',
      notifyClickFocusHelp:
        '에이전트 알림을 누르면 그 에이전트가 떠 있는 터미널·에디터 창을 앞으로 가져와요. 창을 찾지 못하면 Corral 을 열어요. 탭까지 고르지는 못해요.',
      waitingReminder: '응답 대기 다시 알림',
      waitingReminderHelp:
        '응답 대기가 이 시간 넘게 이어지면 다시 알려요. 0 이면 다시 알리지 않아요.',
      notifyHeavy: '무거운 작업 겹침',
      notifyHeavyHelp: '무거운 작업이 둘 이상 겹치고 RAM 이 경고 기준 이상이 되면 알려요.',
      dependencyDirs: '지울 의존성 폴더 이름',
      dependencyDirsHelp:
        '한 줄에 하나씩. 끝난 워크트리 바로 아래의 이 이름 폴더 가운데 git 이 무시하는(.gitignore 등) 폴더만 지워요. 저장소에 올라간 폴더는 이름이 같아도 건너뛰어요. 경로나 .git 은 쓸 수 없어요.',
      staleWorktreeDays: '오래 안 쓴 워크트리 기준',
      staleWorktreeDaysHelp:
        '끝난 근거가 없어도 이 날수 동안 커밋도 변경도 없던 워크트리를 "확인해볼 것"으로 보여 줘요. 0 이면 찾지 않아요.',
      days: '일',
      extraRepos: '더 살펴볼 저장소',
      extraReposHelp:
        '에이전트·개발 서버를 본 저장소는 저절로 기억해요. 그 밖에 끝난 워크트리를 찾아볼 저장소를 여기 더해요.',
      addRepo: '폴더 추가',
      removeRepo: '빼기',
      noRepos: '더한 저장소가 없어요.',
      settingsFile: (path: string): string => `설정 파일: ${path}`,
      updates: {
        /** 시각은 main/index.ts 의 UPDATE_FIRST_CHECK_MS·UPDATE_CHECK_EVERY_MS 와 맞춘다. */
        auto: '업데이트는 Corral 을 시작할 때 자동으로 확인하고, 켜 두는 동안에는 6시간마다 다시 확인해요.',
        disabledOff: '새 버전 확인이 꺼져 있어요(설정 > 일반).',
        disabledDev: '개발 실행에서는 새 버전을 확인하지 않아요.',
        checking: '확인하는 중…',
        none: '최신 버전이에요.',
        available: (v: string): string => `새 버전 ${v} 이 있어요.`,
        downloading: (v: string): string => `새 버전 ${v} 을 내려받는 중이에요.`,
        ready: (v: string): string => `새 버전 ${v} 을 받았어요. 다시 시작하면 설치돼요.`,
        error: (e: string): string => `새 버전을 확인하지 못했어요: ${e}`,
        check: '업데이트 확인',
        install: '다시 시작해 설치',
        download: '내려받기 페이지'
      }
    },
    refresh: '지금 새로고침',
    list: {
      search: '검색…',
      clearSearch: '검색어 지우기',
      empty: '열려 있는 개발 서버 포트가 없어요.',
      emptyAgents: '실행 중인 에이전트가 없어요.',
      emptyLeftovers: '남은 프로세스가 없어요.',
      emptyHeavy: '돌고 있는 무거운 작업이 없어요.',
      emptyApps: '메모리를 많이 쓰는 다른 앱이 없어요.',
      emptyEvents: '아직 기록이 없어요.',
      emptyWorkspaces: '실행 중인 작업이 없어요.',
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
        waiting: '응답 대기',
        idle: '쉬는 중',
        error: '오류',
        unknown: '확인 중'
      },
      sources: {
        hook: 'Claude 훅',
        cpu: 'CPU 추정',
        rollout: 'Codex 세션 기록',
        file: 'Claude 세션 파일'
      },
      runtime: '실행 시간',
      /** 상세 패널 토큰 카드(G6). */
      usage: '토큰',
      limitsCard: '사용 한도',
      usageOutput: (tokens: string): string => `출력 합 ${tokens}`,
      usageTotal: (tokens: string): string => `전체 ${tokens}`,
      usageContextOf: (used: string, window: string): string => `${used} / ${window}`,
      usageHelp:
        '세션 기록 파일에서 읽은 숫자예요. 출력 합에는 하위 에이전트가 쓴 것이 들어 있지 않아요.',
      cpu: 'CPU',
      cpuSub: '코어 1개 = 100% 기준',
      cpuSubWindows: '작업 관리자처럼 전체 CPU 대비',
      stateSource: '상태 출처',
      codexNote:
        'Codex 세션 기록을 찾지 못해 CPU 사용량으로 짐작해요. Codex 연동을 켜면 응답 대기까지 알 수 있어요.',
      codexRolloutNote:
        'Codex 세션 기록으로 상태를 알아요. 응답 대기는 Codex 연동을 켜야 알 수 있어요.',
      noHookNote: 'Claude 연동을 켜면 응답 대기와 기다리는 도구까지 정확히 알 수 있어요.',
      fileNote:
        'Claude Code 가 남기는 세션 파일로 작업 중·쉬는 중·응답 대기를 알아요. 어떤 도구가 권한을 기다리는지는 Claude 연동을 켜야 알 수 있어요.',
      /** 세션 파일로 안 응답 대기의 이유(하는 일 칸·상세 패널의 상태 출처). */
      waitReason: {
        permission: '권한 확인 대기',
        input: '질문에 답 대기',
        sandbox: '샌드박스 허용 대기',
        worker: '하위 작업 요청 대기',
        goal: '목표 제안에 답 대기',
        other: '응답 대기'
      } satisfies Record<WaitReason, string>,
      /** 조용한 에이전트(G3c)의 상세 패널 설명(상태 출처 설명보다 먼저). */
      quietNote:
        '작업 중인데 한동안 이벤트가 없고 CPU 도 거의 쓰지 않아요. 오래 걸리는 명령을 기다리는 중일 수도, 멈춘 것일 수도 있어요.',
      /** 하는 일(G3b)의 도구 한 줄: "Bash · npm run build"(요약을 모르면 이름만). */
      activityTool: (name: string | null, summary: string | null): string =>
        [name, summary].filter(Boolean).join(' · '),
      /** 하는 일 칸의 권한 대기: "권한: Bash · npm run build". */
      activityWaiting: (tool: string): string => `권한: ${tool}`,
      /** 상세 패널 정보의 하는 일 줄 이름. */
      activityFacts: {
        title: '제목',
        prompt: '마지막 요청',
        tool: '실행 중인 도구',
        waiting: '권한을 기다리는 도구'
      },
      activityNote:
        '에이전트 연동이 알려 준 내용이에요. Corral 은 이것을 메모리에만 두고 파일로 남기지 않아요. 설정 > 에이전트 연동에서 끌 수 있어요.'
    },
    disk: {
      empty: '정리할 끝난 워크트리가 없어요.',
      notYet: '아직 찾지 않았어요. 앱을 켜고 1분 뒤에 찾아요.',
      gone: '이미 정리됐거나 더는 끝난 워크트리가 아니에요.',
      scanning: '찾는 중…',
      rescan: '다시 찾기',
      remove: '의존성 폴더 지우기',
      /** 사용 중이 아닌 줄 전부를 지우는 버튼. 크기를 아직 모르면 이름만. */
      removeAll: (size: string | null): string => (size ? `모두 정리 · ${size}` : '모두 정리'),
      evidence: { upstreamGone: '원격 삭제됨', merged: '머지됨', stale: '오래 안 씀' },
      /** 오래 안 쓴 워크트리의 근거 칸(G5d). */
      staleFor: (days: number): string => `오래 안 씀(${days}일)`,
      evidenceNote: {
        upstreamGone:
          '원격 브랜치가 지워졌어요(보통 머지한 뒤 지워요). 워크트리와 소스는 그대로 두고 의존성 폴더만 지워요.',
        merged:
          '원격 브랜치가 기본 브랜치에 머지됐어요. 워크트리와 소스는 그대로 두고 의존성 폴더만 지워요.',
        stale: (days: number): string =>
          `끝났다는 근거는 없지만 ${days}일 동안 커밋도 변경도 없었어요. 의존성 폴더만 지우고 워크트리와 소스는 그대로 둬요.`
      },
      inUse: '사용 중',
      inUseNote: '이 워크트리에서 개발 서버·에이전트 등이 실행 중이라 지울 수 없어요.',
      measuring: '재는 중…',
      link: '링크라 건너뜀',
      unreadable: '읽을 수 없어 건너뜀',
      tracked: 'git 이 관리해 건너뜀',
      folders: '의존성 폴더',
      size: '크기',
      sizeSub: '(지울 수 있는 합계)',
      branch: '브랜치',
      evidenceTitle: '끝났다고 본 근거',
      /** 오래 안 쓴 워크트리의 근거 카드 제목(끝났다는 근거가 없으므로). */
      staleEvidenceTitle: '목록에 올린 근거',
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
        on: '켜짐 — Claude 훅으로 작업 중·응답 대기와 기다리는 도구·하는 일을 알아요.',
        off: '꺼짐 — 지금은 Claude Code 의 세션 파일(없으면 CPU 사용량)로 상태를 알아요. 켜면 어떤 도구가 권한을 기다리는지와 하는 일까지 알 수 있어요.',
        partial: '예전 설정이 남아 있어요. 다시 켜 주세요.',
        server: '훅을 받을 포트를 열지 못했어요. 다시 켜면 새 포트로 바꿔요.',
        settings: 'Claude 설정 파일(settings.json)을 읽을 수 없어요.'
      },
      allHooksDisabled:
        'Claude 설정에서 모든 훅이 꺼져 있어요(disableAllHooks). 켜도 이벤트가 오지 않아요.'
    },
    codexHook: {
      title: 'Codex 연동',
      enable: 'Codex 연동 켜기',
      reenable: 'Codex 연동 다시 켜기',
      disable: 'Codex 연동 끄기',
      states: {
        on: '켜짐 — Codex 훅으로 작업 중·응답 대기를 알아요. 상태가 안 오면 Codex 에서 /hooks 를 열어 Corral 훅(주소에 pitwall-hook 이 들어 있는 훅)을 승인해 주세요.',
        off: '꺼짐 — 지금은 Codex 세션 기록(없으면 CPU 사용량)으로 짐작해요. 켜면 응답 대기까지 알 수 있어요.',
        partial: '예전 설정이 남아 있어요. 다시 켜 주세요.',
        server: '훅을 받을 포트를 열지 못했어요. 다시 켜면 새 포트로 바꿔요.',
        settings: 'Codex 훅 설정 파일(hooks.json)을 읽을 수 없어요.'
      },
      file: (path: string): string => `설정 파일: ${path}`
    },
    /** 에이전트 탭 도구줄의 연동 상태·설정으로 가기(켜고 끄기는 설정 > 에이전트 연동에서). */
    integration: {
      settings: '연동 설정',
      help: '에이전트 연동 설명',
      helpTitle: '에이전트 연동',
      helpBody: [
        '연동을 켜지 않아도 Claude Code 의 세션 파일과 Codex 세션 기록으로 작업 중·쉬는 중·응답 대기를 알아요.',
        '연동을 켜면 각 도구의 설정 파일에 Corral 훅을 더해, 어떤 도구가 권한을 기다리는지와 하는 일까지 정확히 알아요. 켜고 끄는 것은 설정 > 에이전트 연동에서 해요(확인 창·백업).'
      ],
      states: {
        on: '켜짐',
        off: '꺼짐',
        partial: '다시 켜야 해요',
        error: '문제가 있어요',
        allHooksDisabled: '훅이 모두 꺼져 있어요',
        unknown: '확인 중'
      },
      /** 풍선말 한 줄: "Claude Code 연동: 켜짐". */
      stateLine: (tool: string, state: string): string => `${tool} 연동: ${state}`
    },
    home: {
      title: '한눈에 보기',
      ram: 'RAM',
      ramUsage: (used: string, total: string): string => `${used} / ${total}`,
      ports: '개발 서버',
      agents: '에이전트',
      leftovers: '남은 프로세스',
      candidates: '정리 후보',
      waiting: (n: number): string => `응답 대기 ${n}`,
      checks: (n: number): string => `확인해볼 것 ${n}`,
      agentLeftovers: (n: number): string => `에이전트 워크트리 ${n}`,
      current: '(현재)',
      ramTrend: 'RAM 사용 추이',
      groups: '메모리 묶음',
      recommendTitle: '메모리 정리 추천',
      /** freed: formatFreed 결과. */
      recommendSummary: (n: number, freed: string): string =>
        `${n}개를 끄면 ${freed} 를 확보할 수 있어요.`,
      /** 추천 칩의 크기: RAM 크기와 커밋 크기("1.2 GB · 커밋 4.2 GB"). */
      chipSize: (memory: string, commit: string): string => `${memory} · 커밋 ${commit}`,
      recommendNone:
        "정리 후보가 없어요. '다른 앱'에서 메모리를 많이 쓰는 앱 중 끌 만한 것을 확인해 보세요.",
      showApps: '다른 앱 보기',
      killAll: '모두 끄기',
      heavyTitle: '무거운 작업',
      /** pressure: pressureText 결과("RAM 85%" 또는 "커밋 86%"). */
      heavyOverlap: (pressure: string, n: number): string =>
        `${pressure} 인데 무거운 작업 ${n}개가 겹쳐 돌고 있어요. 하나가 끝날 때까지 새 작업을 미루면 좋아요.`,
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
      /** 좁은 자리(메모리 카드 범례)의 시스템·공유 메모리 이름. */
      systemShort: '시스템·공유',
      systemNote:
        '시스템·공유 메모리: 커널·드라이버, 여러 앱이 같이 쓰는 메모리, Corral 이 읽을 수 없는 프로세스(보안 프로그램·관리자 권한 등)를 합친 값이에요.',
      processes: (n: number): string => `${n}개`,
      /** 런타임을 띄운 앱까지 적은 다른 앱 이름(G5b, "node (Cursor)")과 그 title("node.exe — Cursor.exe"). */
      withOwner: (name: string, owner: string): string => `${name} (${owner})`,
      withOwnerTitle: (name: string, owner: string): string => `${name} — ${owner}`,
      /** 묶음의 행 수(탭 숫자와 같은 단위). 숨긴 서버가 있으면 함께 적는다. */
      count: (n: number, hidden = 0): string =>
        hidden ? `${n}개(숨김 ${hidden}개 포함)` : `${n}개`,
      processCount: (n: number): string => `프로세스 ${n}개`,
      goTo: (label: string): string => `${label} 탭에서 보기`
    },
    detail: {
      url: (port: number): string => `http://localhost:${port}`,
      /** 상세 패널 메모리 카드의 보조 줄. */
      commitSub: (size: string): string => `커밋 ${size}`,
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
