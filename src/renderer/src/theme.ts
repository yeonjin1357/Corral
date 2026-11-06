/** OS 의 다크 모드 설정을 따라 body 에 Uptime Kuma 다크 테마 클래스(.dark)를 켜고 끈다. 반환 함수로 해제한다. */
export function watchColorScheme(matchMedia: (query: string) => MediaQueryList, body: HTMLElement): () => void {
  const mql = matchMedia('(prefers-color-scheme: dark)')
  const apply = (dark: boolean): void => {
    body.classList.toggle('dark', dark)
  }
  const listener = (event: MediaQueryListEvent): void => apply(event.matches)
  apply(mql.matches)
  mql.addEventListener('change', listener)
  return () => mql.removeEventListener('change', listener)
}
