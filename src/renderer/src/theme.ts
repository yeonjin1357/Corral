/**
 * OS(또는 pitwall 설정이 정한 nativeTheme)의 다크 모드를 따라 root 요소에 .dark 를 켜고 끈다.
 * .dark 아래에서 어두운 색이, 그 밖에서는 밝은 색이 쓰인다. 반환 함수로 해제한다.
 */
export function watchColorScheme(
  matchMedia: (query: string) => MediaQueryList,
  root: HTMLElement
): () => void {
  const mql = matchMedia('(prefers-color-scheme: dark)')
  const apply = (dark: boolean): void => {
    root.classList.toggle('dark', dark)
  }
  const listener = (event: MediaQueryListEvent): void => apply(event.matches)
  apply(mql.matches)
  mql.addEventListener('change', listener)
  return () => mql.removeEventListener('change', listener)
}
