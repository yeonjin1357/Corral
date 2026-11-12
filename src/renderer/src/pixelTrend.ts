import type { Point } from './history'

/**
 * 픽셀 추이(G6)의 칸 값. `[end − windowMs, end)` 를 count 칸으로 나눠 칸마다 그 칸에 든 점 값의 최댓값을 준다.
 * 점이 없는 칸은 null(빈 칸이 곧 끊김). 끝 시각(t = end)의 점은 마지막 칸에 넣고, 창 밖 점은 버린다.
 */
export function pixelBuckets(
  points: Point[],
  end: number,
  windowMs: number,
  count: number
): (number | null)[] {
  const out: (number | null)[] = Array.from({ length: count }, () => null)
  const start = end - windowMs
  for (const p of points) {
    if (p.t < start || p.t > end) continue
    const i = Math.min(count - 1, Math.floor(((p.t - start) / windowMs) * count))
    out[i] = out[i] == null ? p.value : Math.max(out[i]!, p.value)
  }
  return out
}
