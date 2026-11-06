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
    invalid: '잘못된 요청이에요.'
  },
  unsupportedPlatform: '지원하지 않는 OS 예요. Windows 와 macOS 만 지원해요.'
} as const
