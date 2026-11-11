import {
  DEFAULT_CARDS,
  EXTRA_CARDS,
  TOP_HEIGHTS,
  addCard,
  cardColumns,
  moveCard,
  normalizeCardLayout,
  readCardLayout,
  readTopMode,
  removeCard,
  setCardHidden,
  snapTopMode,
  visibleCards,
  withScrollbar,
  writeCardLayout,
  writeTopMode,
  type CardLayout
} from './layoutState'

function memoryStorage(
  initial: Record<string, string> = {}
): Storage & { data: Record<string, string> } {
  const data = { ...initial }
  return {
    data,
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => {
      data[k] = v
    }
  } as Storage & { data: Record<string, string> }
}

test('단계는 저장한 값, 모르거나 읽지 못하면 자세히', () => {
  const storage = memoryStorage()
  // 처음은 자세히.
  expect(readTopMode(storage)).toBe('full')
  writeTopMode(storage, 'collapsed')
  expect(storage.data['pitwall.topMode']).toBe('collapsed')
  expect(readTopMode(storage)).toBe('collapsed')
  writeTopMode(storage, 'compact')
  expect(readTopMode(storage)).toBe('compact')
  // 모르는 값·저장소 없음·막힌 저장소는 자세히, 쓰기가 막혀도 오류를 내지 않는다.
  expect(readTopMode(memoryStorage({ 'pitwall.topMode': 'tiny' }))).toBe('full')
  expect(readTopMode(null)).toBe('full')
  const blocked = {
    getItem: () => {
      throw new Error('denied')
    },
    setItem: () => {
      throw new Error('denied')
    }
  }
  expect(readTopMode(blocked)).toBe('full')
  expect(() => writeTopMode(blocked, 'compact')).not.toThrow()
  expect(() => writeTopMode(null, 'compact')).not.toThrow()
})

test('놓은 높이에 가장 가까운 단계', () => {
  const heights = { full: 260, compact: 92, collapsed: 0 }
  expect(snapTopMode(300, heights)).toBe('full')
  expect(snapTopMode(200, heights)).toBe('full')
  expect(snapTopMode(150, heights)).toBe('compact')
  expect(snapTopMode(92, heights)).toBe('compact')
  expect(snapTopMode(50, heights)).toBe('compact')
  expect(snapTopMode(40, heights)).toBe('collapsed')
  expect(snapTopMode(-20, heights)).toBe('collapsed')
  // 두 단계의 가운데면 큰 쪽.
  expect(snapTopMode(176, heights)).toBe('full')
  expect(snapTopMode(46, heights)).toBe('compact')
  // 숫자가 아니면 가장 큰 단계.
  expect(snapTopMode(NaN, heights)).toBe('full')
  // 화면이 쓰는 높이는 큰 단계일수록 높다(접기는 0).
  expect(TOP_HEIGHTS.full).toBeGreaterThan(TOP_HEIGHTS.compact)
  expect(TOP_HEIGHTS.compact).toBeGreaterThan(TOP_HEIGHTS.collapsed)
  expect(TOP_HEIGHTS.collapsed).toBe(0)
})

test('카드 줄에 가로 스크롤바가 있으면 자세히·간단히 높이에 그만큼 더한다(접기는 그대로)', () => {
  const heights = { full: 260, compact: 92, collapsed: 0 }
  expect(withScrollbar(heights, 6)).toEqual({ full: 266, compact: 98, collapsed: 0 })
  // 스크롤바가 없으면 같은 값. 숫자가 아니거나 음수면 없는 것으로.
  expect(withScrollbar(heights, 0)).toEqual(heights)
  expect(withScrollbar(heights, -3)).toEqual(heights)
  expect(withScrollbar(heights, NaN)).toEqual(heights)
  // 받은 값은 바꾸지 않는다.
  expect(heights).toEqual({ full: 260, compact: 92, collapsed: 0 })
})

// ── 카드 고르기(G3) ──
test('카드 열 너비: 카드마다 비중과 최소 너비, 순서는 배치대로', () => {
  // 기본 여섯 장: 지금까지의 비율(메모리 1.5, 남은 프로세스 1.05, 디스크 정리 1.2), 메모리는 240px·나머지는 150px 아래로 줄지 않는다.
  expect(cardColumns(DEFAULT_CARDS)).toBe(
    [
      'minmax(240px, 1.5fr)',
      'minmax(150px, 1fr)',
      'minmax(150px, 1fr)',
      'minmax(150px, 1fr)',
      'minmax(150px, 1.05fr)',
      'minmax(150px, 1.2fr)'
    ].join(' ')
  )
  // 새 카드는 1 몫, 순서는 받은 대로.
  expect(cardColumns(['events', 'disk', 'waiting', 'memory', 'tokens'])).toBe(
    [
      'minmax(150px, 1fr)',
      'minmax(150px, 1.2fr)',
      'minmax(150px, 1fr)',
      'minmax(240px, 1.5fr)',
      'minmax(150px, 1fr)'
    ].join(' ')
  )
  expect(cardColumns([])).toBe('')
})

test('1280px 창에서 일곱 장(기본 여섯 + 새 카드 하나)이 스크롤 없이 한 줄에 들어간다', () => {
  // 카드 줄 너비 = 1280 − 좌우 여백 16×2 − 카드 사이 틈 12×6 = 1176px(app.css `.resource-grid`).
  const row = 1280 - 2 * 16 - 6 * 12
  expect(row).toBe(1176)
  for (const extra of EXTRA_CARDS) {
    const columns = cardColumns([...DEFAULT_CARDS, extra])
    const mins = [...columns.matchAll(/minmax\((\d+)px/g)].map((m) => Number(m[1]))
    expect(mins).toHaveLength(7)
    expect(mins.reduce((n, px) => n + px, 0)).toBeLessThanOrEqual(row)
  }
})

const DEFAULT_LAYOUT: CardLayout = { order: DEFAULT_CARDS, hidden: [] }

test('모르는 이름·중복은 버리고 빠진 기본 카드는 끝에 붙인다', () => {
  expect(DEFAULT_CARDS).toEqual(['memory', 'servers', 'agents', 'heavy', 'leftovers', 'disk'])
  expect(EXTRA_CARDS).toEqual(['waiting', 'tokens', 'events'])
  expect(
    normalizeCardLayout({
      order: ['events', 'disk', 'nope', 'disk', 'memory', 3, 'events'],
      hidden: ['memory', 'nope', 'waiting', 'memory']
    })
  ).toEqual({
    // 기본 카드는 앞으로 늘어도 사라지지 않게 끝에 붙는다.
    order: ['events', 'disk', 'memory', 'servers', 'agents', 'heavy', 'leftovers'],
    // 숨긴 것은 줄에 있는 것만(줄에 없는 새 카드 waiting 은 버린다).
    hidden: ['memory']
  })
  // order 가 배열이 아니면 기본 카드 순서, 숨긴 기본 카드는 그대로.
  expect(normalizeCardLayout({ order: 'memory', hidden: ['disk'] })).toEqual({
    order: DEFAULT_CARDS,
    hidden: ['disk']
  })
  expect(normalizeCardLayout({ order: ['tokens'] })).toEqual({
    order: ['tokens', ...DEFAULT_CARDS],
    hidden: []
  })
  // 보이는 카드: 숨긴 것을 뺀 순서.
  expect(
    visibleCards({ order: ['tokens', ...DEFAULT_CARDS], hidden: ['memory', 'tokens'] })
  ).toEqual(['servers', 'agents', 'heavy', 'leftovers', 'disk'])
})

test('보이는 카드가 없거나 JSON 이 아니면 기본 배치', () => {
  expect(normalizeCardLayout(null)).toEqual(DEFAULT_LAYOUT)
  expect(normalizeCardLayout('cards')).toEqual(DEFAULT_LAYOUT)
  expect(normalizeCardLayout([])).toEqual(DEFAULT_LAYOUT)
  expect(
    normalizeCardLayout({ order: ['waiting'], hidden: [...DEFAULT_CARDS, 'waiting'] })
  ).toEqual(DEFAULT_LAYOUT)
  // 기본 배치를 고쳐도 기본 카드 목록은 그대로(새 배열을 돌려준다).
  normalizeCardLayout(null).order.push('waiting')
  expect(DEFAULT_CARDS).toHaveLength(6)

  // 저장소: 쓴 것을 그대로 읽고, 처음·JSON 이 아님·저장소 없음·막힘은 기본 배치.
  const storage = memoryStorage()
  expect(readCardLayout(storage)).toEqual(DEFAULT_LAYOUT)
  const layout: CardLayout = { order: ['waiting', ...DEFAULT_CARDS], hidden: ['heavy'] }
  writeCardLayout(storage, layout)
  expect(JSON.parse(storage.data['pitwall.cards'])).toEqual(layout)
  expect(readCardLayout(storage)).toEqual(layout)
  expect(readCardLayout(memoryStorage({ 'pitwall.cards': '{oops' }))).toEqual(DEFAULT_LAYOUT)
  expect(readCardLayout(memoryStorage({ 'pitwall.cards': '{"order":["nope"]}' }))).toEqual(
    DEFAULT_LAYOUT
  )
  expect(readCardLayout(null)).toEqual(DEFAULT_LAYOUT)
  const blocked = {
    getItem: () => {
      throw new Error('denied')
    },
    setItem: () => {
      throw new Error('denied')
    }
  }
  expect(readCardLayout(blocked)).toEqual(DEFAULT_LAYOUT)
  expect(() => writeCardLayout(blocked, layout)).not.toThrow()
  expect(() => writeCardLayout(null, layout)).not.toThrow()
})

test('마지막 보이는 카드는 숨길 수 없다', () => {
  const l: CardLayout = { order: ['memory', 'waiting', 'disk'], hidden: ['disk'] }
  expect(setCardHidden(l, 'memory', true)).toEqual({
    order: ['memory', 'waiting', 'disk'],
    hidden: ['disk', 'memory']
  })
  expect(setCardHidden(l, 'disk', false)).toEqual({
    order: ['memory', 'waiting', 'disk'],
    hidden: []
  })
  // 이미 그 상태거나 줄에 없는 카드는 그대로.
  expect(setCardHidden(l, 'disk', true)).toBe(l)
  expect(setCardHidden(l, 'memory', false)).toBe(l)
  expect(setCardHidden(l, 'tokens', true)).toBe(l)
  // 하나 남은 보이는 카드는 숨기지 않는다.
  const last: CardLayout = { order: ['memory', 'waiting', 'disk'], hidden: ['disk', 'memory'] }
  expect(setCardHidden(last, 'waiting', true)).toBe(last)
  expect(visibleCards(last)).toEqual(['waiting'])
})

test('새 카드는 더하고 뺄 수 있고 기본 카드는 뺄 수 없다', () => {
  const added = addCard(DEFAULT_LAYOUT, 'tokens')
  expect(added).toEqual({ order: [...DEFAULT_CARDS, 'tokens'], hidden: [] })
  // 이미 있는 카드·기본 카드는 더하지 않는다.
  expect(addCard(added, 'tokens')).toBe(added)
  expect(addCard(added, 'memory')).toBe(added)
  // 빼면 숨김에서도 지운다. 기본 카드·줄에 없는 카드는 그대로.
  const hidden: CardLayout = { order: [...DEFAULT_CARDS, 'tokens'], hidden: ['tokens', 'disk'] }
  expect(removeCard(hidden, 'tokens')).toEqual({ order: DEFAULT_CARDS, hidden: ['disk'] })
  expect(removeCard(hidden, 'disk')).toBe(hidden)
  expect(removeCard(hidden, 'events')).toBe(hidden)
  // 하나 남은 보이는 카드면 빼지 않는다(보이는 카드가 없어지므로).
  const only: CardLayout = { order: [...DEFAULT_CARDS, 'events'], hidden: DEFAULT_CARDS }
  expect(removeCard(only, 'events')).toBe(only)
})

test('순서 옮기기는 범위 밖이면 양 끝', () => {
  const l: CardLayout = { order: ['memory', 'servers', 'agents', 'disk'], hidden: ['agents'] }
  expect(moveCard(l, 'memory', 2).order).toEqual(['servers', 'agents', 'memory', 'disk'])
  expect(moveCard(l, 'disk', 1).order).toEqual(['memory', 'disk', 'servers', 'agents'])
  // 숨김은 그대로.
  expect(moveCard(l, 'disk', 1).hidden).toEqual(['agents'])
  // 범위 밖은 양 끝.
  expect(moveCard(l, 'servers', -3).order).toEqual(['servers', 'memory', 'agents', 'disk'])
  expect(moveCard(l, 'servers', 99).order).toEqual(['memory', 'agents', 'disk', 'servers'])
  // 제자리·줄에 없는 카드는 그대로.
  expect(moveCard(l, 'agents', 2)).toBe(l)
  expect(moveCard(l, 'waiting', 0)).toBe(l)
})
