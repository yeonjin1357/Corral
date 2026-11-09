/**
 * OS 앱 아이콘을 메인에 한 번만 묻고 기억한다(같은 앱이 여러 행에 나와도 한 번).
 * 메인은 지금 스냅샷에 나온 실행 파일에만 답하므로, 실패·없음은 null 로 기억했다가 잠시 뒤 다시 묻는다.
 */
const cache = new Map<string, { at: number; icon: Promise<string | null> }>()
const RETRY_MS = 60_000

export function nativeIcon(path: string): Promise<string | null> {
  const hit = cache.get(path)
  if (hit) return hit.icon
  const icon = window.pitwall
    .fileIcon(path)
    .then((value) => {
      if (!value) setTimeout(() => cache.delete(path), RETRY_MS)
      return value
    })
    .catch(() => {
      setTimeout(() => cache.delete(path), RETRY_MS)
      return null
    })
  cache.set(path, { at: Date.now(), icon })
  return icon
}
