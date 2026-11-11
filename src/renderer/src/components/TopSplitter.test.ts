// @vitest-environment happy-dom
import { mount, type VueWrapper } from '@vue/test-utils'
import TopSplitter from './TopSplitter.vue'
import type { TopMode } from '../layoutState'

const HEIGHTS: Record<TopMode, number> = { full: 260, compact: 92, collapsed: 0 }

/** v-model:mode 처럼 바뀐 단계를 다시 props 로 넣는다. */
function splitter(mode: TopMode, editing = false): VueWrapper {
  const w: VueWrapper = mount(TopSplitter, {
    props: {
      mode,
      heights: HEIGHTS,
      editing,
      'onUpdate:mode': (next: TopMode) => void w.setProps({ mode: next })
    }
  })
  return w
}

const modes = (w: VueWrapper): (TopMode | undefined)[] =>
  (w.emitted('update:mode') ?? []).map((e) => e[0] as TopMode)
const pressed = (w: VueWrapper): string[] =>
  w
    .findAll('[data-mode]')
    .filter((b) => b.attributes('aria-pressed') === 'true')
    .map((b) => b.attributes('data-mode')!)
const handle = (w: VueWrapper): ReturnType<VueWrapper['find']> => w.find('[role="separator"]')

test('단계 버튼으로 바꾸고 더블클릭은 자세히 ↔ 접기', async () => {
  const w = splitter('full')
  expect(w.findAll('[data-mode]').map((b) => b.text())).toEqual(['자세히', '간단히', '접기'])
  expect(pressed(w)).toEqual(['full'])
  await w.find('[data-mode="compact"]').trigger('click')
  expect(pressed(w)).toEqual(['compact'])
  await w.find('[data-mode="collapsed"]').trigger('click')
  expect(pressed(w)).toEqual(['collapsed'])
  // 접혀 있으면 더블클릭으로 자세히, 다시 더블클릭하면 접기.
  await handle(w).trigger('dblclick')
  expect(pressed(w)).toEqual(['full'])
  await handle(w).trigger('dblclick')
  expect(pressed(w)).toEqual(['collapsed'])
  expect(modes(w)).toEqual(['compact', 'collapsed', 'full', 'collapsed'])
  // 손잡이는 이름(끄는 법)과 지금 단계를 알린다.
  expect(handle(w).attributes('aria-label')).toBe(
    '끌어서 위아래 크기 조절 · 더블클릭: 자세히 ↔ 접기'
  )
  expect(handle(w).attributes('aria-orientation')).toBe('horizontal')
  expect(handle(w).attributes('aria-valuetext')).toBe('접기')
  expect(handle(w).attributes('tabindex')).toBe('0')
})

test('끌어서 놓으면 가까운 단계에 붙는다', async () => {
  const w = splitter('full')
  const drags = (): (number | null)[] => (w.emitted('drag') ?? []).map((e) => e[0] as number)
  // 자세히(260px)에서 120px 위로 끈다 → 140px, 놓으면 간단히(92px)가 더 가깝다.
  await handle(w).trigger('pointerdown', { clientY: 400, button: 0, pointerId: 1 })
  // 조금 흔들린 것은 끌기가 아니다.
  await handle(w).trigger('pointermove', { clientY: 401, pointerId: 1 })
  expect(drags()).toEqual([])
  await handle(w).trigger('pointermove', { clientY: 330, pointerId: 1 })
  await handle(w).trigger('pointermove', { clientY: 280, pointerId: 1 })
  // 끄는 동안 높이를 알린다(단계는 아직 그대로).
  expect(drags()).toEqual([190, 140])
  expect(modes(w)).toEqual([])
  expect(handle(w).attributes('aria-valuenow')).toBe('140')
  await handle(w).trigger('pointerup', { clientY: 280, pointerId: 1 })
  expect(drags()).toEqual([190, 140, null])
  expect(modes(w)).toEqual(['compact'])

  // 간단히에서 아래로 멀리 끌어도 가장 큰 단계 높이까지만, 놓으면 자세히.
  await handle(w).trigger('pointerdown', { clientY: 200, button: 0, pointerId: 2 })
  await handle(w).trigger('pointermove', { clientY: 900, pointerId: 2 })
  expect(drags().at(-1)).toBe(260)
  await handle(w).trigger('pointerup', { clientY: 900, pointerId: 2 })
  expect(modes(w)).toEqual(['compact', 'full'])

  // 위로 끝까지 끌면 접기.
  await handle(w).trigger('pointerdown', { clientY: 500, button: 0, pointerId: 3 })
  await handle(w).trigger('pointermove', { clientY: 100, pointerId: 3 })
  expect(drags().at(-1)).toBe(0)
  await handle(w).trigger('pointerup', { clientY: 100, pointerId: 3 })
  expect(modes(w)).toEqual(['compact', 'full', 'collapsed'])

  // 끄다가 취소되면 단계는 그대로, 높이 알림만 끝낸다.
  await handle(w).trigger('pointerdown', { clientY: 100, button: 0, pointerId: 4 })
  await handle(w).trigger('pointermove', { clientY: 300, pointerId: 4 })
  await handle(w).trigger('pointercancel', { pointerId: 4 })
  expect(drags().at(-1)).toBeNull()
  expect(modes(w)).toEqual(['compact', 'full', 'collapsed'])

  // 누르기만 하고 놓으면(움직임 없음) 아무 일도 없다. 오른쪽 버튼은 끌기가 아니다.
  const before = drags().length
  await handle(w).trigger('pointerdown', { clientY: 100, button: 0, pointerId: 5 })
  await handle(w).trigger('pointerup', { clientY: 100, pointerId: 5 })
  await handle(w).trigger('pointerdown', { clientY: 100, button: 2, pointerId: 6 })
  await handle(w).trigger('pointermove', { clientY: 300, pointerId: 6 })
  await handle(w).trigger('pointerup', { clientY: 300, pointerId: 6 })
  expect(drags()).toHaveLength(before)
  expect(modes(w)).toEqual(['compact', 'full', 'collapsed'])
})

test('끄는 중에 다른 포인터를 눌러도 끌기는 처음 포인터 그대로', async () => {
  const w = splitter('full')
  const drags = (): (number | null)[] => (w.emitted('drag') ?? []).map((e) => e[0] as number)
  await handle(w).trigger('pointerdown', { clientY: 400, button: 0, pointerId: 1 })
  await handle(w).trigger('pointermove', { clientY: 330, pointerId: 1 })
  // 둘째 손가락·펜이 눌려도 끌기의 시작점을 바꾸지 않는다.
  await handle(w).trigger('pointerdown', { clientY: 100, button: 0, pointerId: 2 })
  await handle(w).trigger('pointermove', { clientY: 280, pointerId: 1 })
  expect(drags()).toEqual([190, 140])
  await handle(w).trigger('pointerup', { clientY: 280, pointerId: 1 })
  expect(modes(w)).toEqual(['compact'])
})

test('끄는 중에는 다른 포인터의 움직임·놓기·취소·잡기 잃음을 무시한다', async () => {
  const w = splitter('full')
  const drags = (): (number | null)[] => (w.emitted('drag') ?? []).map((e) => e[0] as number)
  await handle(w).trigger('pointerdown', { clientY: 400, button: 0, pointerId: 1 })
  await handle(w).trigger('pointermove', { clientY: 330, pointerId: 1 })
  // 둘째 포인터(펜·다른 손가락)는 높이를 바꾸지도, 끌기를 끝내지도 않는다.
  await handle(w).trigger('pointermove', { clientY: 100, pointerId: 2 })
  await handle(w).trigger('pointerup', { clientY: 100, pointerId: 2 })
  await handle(w).trigger('pointercancel', { pointerId: 2 })
  await handle(w).trigger('lostpointercapture', { pointerId: 2 })
  expect(drags()).toEqual([190])
  expect(modes(w)).toEqual([])
  // 처음 포인터로 이어 끌고 놓으면 그대로 붙는다.
  await handle(w).trigger('pointermove', { clientY: 280, pointerId: 1 })
  await handle(w).trigger('pointerup', { clientY: 280, pointerId: 1 })
  expect(drags()).toEqual([190, 140, null])
  expect(modes(w)).toEqual(['compact'])
})

test('끄는 중에 손잡이가 사라지면(다른 화면으로 감) 높이 알림을 끝낸다(단계는 그대로)', async () => {
  // unmount 는 기록된 emitted 를 지우므로 부모처럼 듣는 함수로 받는다.
  const listen = (): { w: VueWrapper; drags: (number | null)[]; modes: TopMode[] } => {
    const drags: (number | null)[] = []
    const modes: TopMode[] = []
    const w = mount(TopSplitter, {
      props: {
        mode: 'full',
        heights: HEIGHTS,
        onDrag: (h: number | null) => drags.push(h),
        'onUpdate:mode': (m: TopMode) => modes.push(m)
      }
    })
    return { w, drags, modes }
  }
  const dragging = listen()
  await handle(dragging.w).trigger('pointerdown', { clientY: 400, button: 0, pointerId: 1 })
  await handle(dragging.w).trigger('pointermove', { clientY: 300, pointerId: 1 })
  expect(dragging.drags).toEqual([160])
  dragging.w.unmount()
  expect(dragging.drags).toEqual([160, null])
  expect(dragging.modes).toEqual([])
  // 끌지 않았으면(누르기만 했음) 사라져도 알리지 않는다.
  const pressed = listen()
  await handle(pressed.w).trigger('pointerdown', { clientY: 400, button: 0, pointerId: 1 })
  pressed.w.unmount()
  expect(pressed.drags).toEqual([])
})

test('포인터 잡기를 잃으면(lostpointercapture) 끌기를 끝내고 가까운 단계에 붙는다', async () => {
  const w = splitter('full')
  const drags = (): (number | null)[] => (w.emitted('drag') ?? []).map((e) => e[0] as number)
  await handle(w).trigger('pointerdown', { clientY: 400, button: 0, pointerId: 1 })
  await handle(w).trigger('pointermove', { clientY: 200, pointerId: 1 })
  await handle(w).trigger('lostpointercapture', { pointerId: 1 })
  expect(drags()).toEqual([60, null])
  expect(modes(w)).toEqual(['compact'])
  // 끝난 뒤의 움직임은 끌기가 아니다.
  await handle(w).trigger('pointermove', { clientY: 500, pointerId: 1 })
  expect(drags()).toEqual([60, null])
})

test('↑·↓ 로 한 단계씩', async () => {
  const w = splitter('full')
  const key = (k: string): Promise<void> => handle(w).trigger('keydown', { key: k })
  // ↑ = 한 단계 작게, 가장 작은 단계에서는 그대로.
  await key('ArrowUp')
  await key('ArrowUp')
  await key('ArrowUp')
  expect(pressed(w)).toEqual(['collapsed'])
  // ↓ = 한 단계 크게, 가장 큰 단계에서는 그대로.
  await key('ArrowDown')
  expect(pressed(w)).toEqual(['compact'])
  await key('ArrowDown')
  await key('ArrowDown')
  expect(pressed(w)).toEqual(['full'])
  expect(modes(w)).toEqual(['compact', 'collapsed', 'compact', 'full'])
  // 다른 키는 그대로.
  await key('Enter')
  expect(modes(w)).toHaveLength(4)
})

test('카드 편집 버튼은 edit 를 보낸다', async () => {
  const w = splitter('compact')
  const edit = w.find('[data-action="cards-edit"]')
  expect(edit.text()).toBe('카드 편집')
  await edit.trigger('click')
  expect(w.emitted('edit')).toHaveLength(1)
  // 단계는 그대로.
  expect(modes(w)).toEqual([])
  // 편집 중에는 글자가 완료로 바뀌는 다른 단추라 켜고 끄는 단추(aria-pressed)가 아니다.
  expect(edit.attributes('aria-pressed')).toBeUndefined()
  const done = splitter('full', true).find('[data-action="cards-edit"]')
  expect(done.text()).toBe('완료')
  expect(done.attributes('aria-pressed')).toBeUndefined()
})

test('더할 수 있는 카드 칩·기본값으로·완료', async () => {
  const w = mount(TopSplitter, {
    props: { mode: 'full', heights: HEIGHTS, editing: true, addable: ['waiting', 'events'] }
  })
  // 편집 중에는 단계 버튼 자리에 편집 막대가 온다(카드 영역 높이는 그대로).
  expect(w.find('[data-mode]').exists()).toBe(false)
  const bar = w.find('[role="group"]')
  expect(bar.attributes('aria-label')).toBe('더할 수 있는 카드')
  expect(bar.text()).toContain('더할 수 있는 카드')
  const chips = w.findAll('[data-add-card]')
  expect(chips.map((c) => [c.attributes('data-add-card'), c.text()])).toEqual([
    ['waiting', '응답 대기'],
    ['events', '최근 기록']
  ])
  await chips[1].trigger('click')
  expect(w.emitted('add')).toEqual([['events']])
  const reset = w.find('[data-action="cards-reset"]')
  expect(reset.text()).toBe('기본값으로')
  await reset.trigger('click')
  expect(w.emitted('reset')).toHaveLength(1)
  // 카드 편집 버튼은 완료가 되고, 누르면 편집을 끝낸다(edit 를 보낸다).
  const done = w.find('[data-action="cards-edit"]')
  expect(done.text()).toBe('완료')
  await done.trigger('click')
  expect(w.emitted('edit')).toHaveLength(1)
  // 더할 카드가 없으면 칩과 이름 없이 기본값으로만.
  await w.setProps({ addable: [] })
  expect(w.find('[data-add-card]').exists()).toBe(false)
  expect(w.text()).not.toContain('더할 수 있는 카드')
  expect(w.find('[data-action="cards-reset"]').exists()).toBe(true)
  // 편집이 끝나면 단계 버튼이 돌아온다.
  await w.setProps({ editing: false })
  expect(w.findAll('[data-mode]')).toHaveLength(3)
  expect(w.find('[data-action="cards-reset"]').exists()).toBe(false)
  expect(w.find('[data-action="cards-edit"]').text()).toBe('카드 편집')
})
