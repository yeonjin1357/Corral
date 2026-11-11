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
  expect(edit.attributes('aria-pressed')).toBe('false')
  await edit.trigger('click')
  expect(w.emitted('edit')).toHaveLength(1)
  // 단계는 그대로.
  expect(modes(w)).toEqual([])
  // 편집 중이면 눌린 모양.
  expect(splitter('full', true).find('[data-action="cards-edit"]').attributes('aria-pressed')).toBe(
    'true'
  )
})
