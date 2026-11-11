/**
 * 트리맵 배치(G6 메모리 지도): 정사각형에 가까운 칸으로 직사각형을 나눈다(squarified treemap,
 * Bruls·Huizing·van Wijk 2000). 큰 값부터 짧은 변을 따라 한 줄씩 놓고, 칸을 더해 가장 길쭉한 칸이
 * 더 길쭉해지면 그 줄을 닫는다.
 */

export interface TreemapRect {
  x: number
  y: number
  w: number
  h: number
}

/** 한 줄(넓이 목록)을 길이 side 의 변에 놓았을 때 가장 길쭉한 칸의 가로세로 비(1 이상). */
function worst(areas: number[], side: number): number {
  const sum = areas.reduce((a, b) => a + b, 0)
  const max = Math.max(...areas)
  const min = Math.min(...areas)
  const side2 = side * side
  return Math.max((side2 * max) / (sum * sum), (sum * sum) / (side2 * min))
}

/**
 * 항목을 값에 비례하는 넓이의 칸으로 rect 를 빈틈없이 채운다. 0 이하(·수가 아닌) 값은 빼고, 큰 값부터 놓는다
 * (같은 값은 들어온 순서). rect 에 넓이가 없으면 빈 목록.
 */
export function squarify<T extends { value: number }>(
  items: T[],
  rect: TreemapRect
): (TreemapRect & { item: T })[] {
  const list = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value)
  if (list.length === 0 || !(rect.w > 0) || !(rect.h > 0)) return []
  const total = list.reduce((sum, i) => sum + i.value, 0)
  const unit = (rect.w * rect.h) / total
  const out: (TreemapRect & { item: T })[] = []
  let { x, y, w, h } = rect
  let i = 0
  while (i < list.length) {
    const side = Math.min(w, h)
    const row = [list[i]]
    const areas = [list[i].value * unit]
    let ratio = worst(areas, side)
    for (let j = i + 1; j < list.length; j++) {
      const next = worst([...areas, list[j].value * unit], side)
      if (next > ratio) break
      row.push(list[j])
      areas.push(list[j].value * unit)
      ratio = next
    }
    i += row.length
    const last = i >= list.length
    const sum = areas.reduce((a, b) => a + b, 0)
    if (w >= h) {
      // 넓은 쪽은 왼쪽에 세로 줄. 마지막 줄은 남은 너비를 그대로 쓴다(셈의 오차로 빈틈이 생기지 않게).
      const width = last ? w : sum / h
      let top = y
      row.forEach((item, k) => {
        const height = k === row.length - 1 ? y + h - top : areas[k] / width
        out.push({ x, y: top, w: width, h: height, item })
        top += height
      })
      x += width
      w -= width
    } else {
      // 높은 쪽은 위에 가로 줄.
      const height = last ? h : sum / w
      let left = x
      row.forEach((item, k) => {
        const width = k === row.length - 1 ? x + w - left : areas[k] / height
        out.push({ x: left, y, w: width, h: height, item })
        left += width
      })
      y += height
      h -= height
    }
  }
  return out
}
