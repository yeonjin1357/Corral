// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import AttentionStrip from './AttentionStrip.vue'
import type { AttentionItem } from '../attention'

const item = (n: number, over: Partial<AttentionItem> = {}): AttentionItem => ({
  id: `waiting:a${n}`,
  state: `${n}`,
  kind: 'waiting',
  tone: 'warn',
  name: 'Codex',
  where: `proj${n}`,
  message: '응답 대기 · 3분',
  detail: null,
  key: `agent:${n}`,
  ...over
})

test('줄이 없으면 아무것도 그리지 않는다', () => {
  const w = mount(AttentionStrip, { props: { items: [] } })
  expect(w.find('section').exists()).toBe(false)
  expect(w.html()).not.toContain('할 일')
})

test('네 줄이면 세 줄 + "외 1개", 누르면 모두', async () => {
  const w = mount(AttentionStrip, { props: { items: [1, 2, 3, 4].map((n) => item(n)) } })
  expect(w.find('section[aria-label="할 일"]').exists()).toBe(true)
  expect(w.findAll('[data-attention-item]')).toHaveLength(3)
  const more = w.find('[data-action="toggle-more"]')
  expect(more.text()).toBe('외 1개')
  await more.trigger('click')
  expect(w.findAll('[data-attention-item]')).toHaveLength(4)
  expect(w.find('[data-action="toggle-more"]').text()).toBe('접기')
})

test('응답 대기 줄의 창으로 가기는 focus(키), 닫기는 dismiss(id, state)', async () => {
  const w = mount(AttentionStrip, { props: { items: [item(1)] } })
  const row = w.find('[data-attention-item][data-kind="waiting"]')
  await row.find('[data-action="act"]').trigger('click')
  expect(w.emitted('focus')?.[0]).toEqual(['agent:1'])
  expect(row.find('[data-action="act"]').text()).toBe('창으로 가기')
  await row.find('[aria-label="Codex 닫기"]').trigger('click')
  expect(w.emitted('dismiss')?.[0]).toEqual(['waiting:a1', '1'])
})

test('정리 추천은 모두 끄기(killMany)와 칩, 후보는 내리기(kill), 겹침은 목록에서 보기(showHeavy)', async () => {
  const w = mount(AttentionStrip, {
    props: {
      items: [
        item(1, { id: 'recommend', kind: 'recommend', key: null, keys: ['server:1', 'server:2'] }),
        item(2, { id: 'candidate:s', kind: 'candidate', key: 'server:3' }),
        item(3, { id: 'overlap', kind: 'overlap', key: null })
      ],
      chips: [
        {
          key: 'server:1',
          icon: null,
          title: ':3000',
          where: 'shop',
          memoryBytes: 1 << 30,
          commitBytes: null
        }
      ]
    }
  })
  await w.find('[data-action="kill-many"]').trigger('click')
  expect(w.emitted('killMany')?.[0]).toEqual([['server:1', 'server:2']])
  await w.find('.recommend-item').trigger('click')
  expect(w.emitted('select')?.[0]).toEqual(['server:1'])
  const cand = w.find('[data-kind="candidate"] [data-action="act"]')
  expect(cand.text()).toBe('내리기')
  await cand.trigger('click')
  expect(w.emitted('kill')?.[0]).toEqual(['server:3'])
  const heavy = w.find('[data-kind="overlap"] [data-action="act"]')
  expect(heavy.text()).toBe('목록에서 보기')
  await heavy.trigger('click')
  expect(w.emitted('showHeavy')).toHaveLength(1)
})

test('추천 항목이 칩보다 많으면 칩 줄에 "외 n개"를 보인다', () => {
  const keys = ['a', 'b', 'c', 'd', 'e', 'f']
  const chips = keys.slice(0, 4).map((key) => ({
    key,
    icon: null,
    title: key,
    where: 'shop',
    memoryBytes: 1 << 20,
    commitBytes: null
  }))
  const w = mount(AttentionStrip, {
    props: { items: [item(1, { id: 'recommend', kind: 'recommend', key: null, keys })], chips }
  })
  expect(w.findAll('.recommend-item')).toHaveLength(4)
  expect(w.text()).toContain('외 2개')
})

test('후보 줄의 내리기는 그 서버를 처리하는 동안 잠긴다', () => {
  const items = [
    item(1, { id: 'candidate:s', kind: 'candidate', key: 'server:3' }),
    item(2, { id: 'candidate:t', kind: 'candidate', key: 'server:4' })
  ]
  const w = mount(AttentionStrip, { props: { items, busyKey: 'server:3' } })
  const buttons = w.findAll('[data-action="act"]')
  expect(buttons[0].attributes('disabled')).toBeDefined()
  expect(buttons[1].attributes('disabled')).toBeUndefined()
})

test('닫기 단추는 줄 이름을 넣어 서로 구별된다', () => {
  const w = mount(AttentionStrip, {
    props: { items: [item(1, { name: 'Codex' }), item(2, { name: 'Claude Code' })] }
  })
  const labels = w.findAll('[data-action="dismiss"]').map((b) => b.attributes('aria-label'))
  expect(labels).toEqual(['Codex 닫기', 'Claude Code 닫기'])
})
