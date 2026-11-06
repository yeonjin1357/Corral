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
    agentInside: '이 프로세스 아래에서 에이전트(Claude·Codex)가 돌고 있어 내리지 않았어요. 에이전트를 먼저 끝내 주세요.',
    invalid: '잘못된 요청이에요.'
  },
  unsupportedPlatform: '지원하지 않는 OS 예요. Windows 와 macOS 만 지원해요.',
  tray: {
    checking: 'RAM 확인 중…',
    failed: 'RAM 정보를 가져오지 못했어요',
    ram: (percent: number, used: string, total: string): string => `RAM ${percent}% (${used} / ${total})`,
    staleSuffix: ' · 업데이트 지연',
    ports: (n: number): string => `개발 서버 포트 ${n}개`,
    open: '앱 열기',
    quit: '종료',
    tooltip: (percent: number): string => `pitwall — RAM ${percent}%`,
    stillRunning: 'pitwall 은 트레이에서 계속 실행돼요. 끄려면 트레이 아이콘 메뉴에서 종료를 누르세요.'
  },
  ui: {
    loading: '불러오는 중…',
    stale: '업데이트 지연',
    settingsLater: '설정은 다음 단계에서 추가돼요',
    pending: '다음 단계에서 추가돼요',
    ram: 'RAM',
    ramUsage: (used: string, total: string, percent: number): string => `${used} / ${total} (${percent}%)`,
    count: (n: number): string => `${n}개`,
    none: '—',
    cards: {
      ports: '개발 서버 포트',
      memory: '개발 작업 메모리',
      agents: '에이전트',
      leftovers: '남겨진 프로세스',
      heavy: '무거운 작업',
      disk: '디스크'
    },
    ports: {
      port: '포트',
      worktree: '작업(워크트리 · 브랜치)',
      clients: '연결',
      memory: '메모리',
      clientCount: (n: number): string => `연결 ${n}`,
      noClients: '연결 없음',
      kill: '내리기',
      empty: '열려 있는 개발 서버 포트가 없어요.'
    },
    groups: {
      devServer: '개발 서버',
      agent: '에이전트',
      other: '그 외',
      processes: (n: number): string => `프로세스 ${n}개`
    }
  }
} as const
