import type { Point } from './history'

/**
 * 픽셀 추이(G6)의 칸 값. 칸 폭은 windowMs / count, 칸 경계는 절대 시각(t / 칸 폭)에 붙여 마지막 칸이 end 를
 * 품게 한다(end 가 칸 안에서 조금씩 흘러도 경계가 옆으로 밀리지 않는다). 칸마다 그 칸에 든 점 값의 최댓값을 준다.
 * 끝 시각(t = end, 끝 포함)의 점은 마지막 칸에 들고, 창 밖 점은 버린다.
 * 점이 없는 칸 중 앞뒤에 실제 점이 있고 그 두 점의 시각 차가 gapMs 이하면 앞 칸의 값으로 잇는다
 * (수집 간격이 칸보다 길어도 가짜 빈 칸이 생기지 않게). gapMs 가 null/undefined 면 앞뒤에 점이 있는 빈 칸은 모두 잇는다.
 * 첫 점 앞의 빈 칸과 gapMs 보다 길게 끊긴 구간은 null 로 둔다(빈 칸이 곧 끊김).
 */
export function pixelBuckets(
  points: Point[],
  end: number,
  windowMs: number,
  count: number,
  gapMs?: number | null
): (number | null)[] {
  const out: (number | null)[] = Array.from({ length: Math.max(0, count) }, () => null)
  if (windowMs <= 0 || count <= 0) return out
  const bucketMs = windowMs / count
  const lastIdx = Math.floor(end / bucketMs)
  const firstIdx = lastIdx - (count - 1)
  // 칸마다 든 점의 가장 이른·늦은 시각(빈 칸을 이을지 가를 때 쓴다).
  const minT: number[] = Array.from({ length: count }, () => Infinity)
  const maxT: number[] = Array.from({ length: count }, () => -Infinity)
  for (const p of points) {
    if (p.t > end) continue
    const i = Math.floor(p.t / bucketMs) - firstIdx
    if (i < 0 || i >= count) continue
    out[i] = out[i] == null ? p.value : Math.max(out[i]!, p.value)
    minT[i] = Math.min(minT[i], p.t)
    maxT[i] = Math.max(maxT[i], p.t)
  }
  // 앞쪽에서부터 훑으며 빈 칸 구간 [a, b) 를 앞 칸 값으로 잇는다.
  let prev = -1
  for (let i = 0; i < count; i++) {
    if (out[i] == null) continue
    if (prev >= 0 && i - prev > 1 && (gapMs == null || minT[i] - maxT[prev] <= gapMs)) {
      for (let k = prev + 1; k < i; k++) out[k] = out[prev]
    }
    prev = i
  }
  return out
}
