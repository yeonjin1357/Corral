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
    confirm: '내리기',
    cancel: '취소'
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
  tray: {
    checking: 'RAM 확인 중…',
    failed: 'RAM 정보를 가져오지 못했어요',
    ram: (percent: number, used: string, total: string): string =>
      `RAM ${percent}% (${used} / ${total})`,
    staleSuffix: ' · 업데이트 지연',
    ports: (n: number): string => `개발 서버 포트 ${n}개`,
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
      noMatch: '찾는 포트가 없어요.'
    },
    tags: { unresolvable: '판별 불가' },
    home: {
      title: '한눈에 보기',
      ram: 'RAM',
      ramUsage: (used: string, total: string): string => `${used} / ${total}`,
      ports: '개발 서버',
      agents: '에이전트',
      leftovers: '남은 프로세스',
      disk: '디스크',
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
