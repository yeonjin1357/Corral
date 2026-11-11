// @vitest-environment happy-dom
import { mount, type VueWrapper } from '@vue/test-utils'
import ConfirmDialog from './ConfirmDialog.vue'
import type { ConfirmRequest } from '../../../shared/types'

const MANY: ConfirmRequest = {
  id: 7,
  title: '메모리 정리',
  message: '2개를 끌까요? 약 1.9 GB 를 확보해요.',
  detail: [
    '• Gradle 데몬 (api · main) — 1.1 GB',
    '• :3000 (shop-web · develop) — 800 MB',
    '외 3개',
    '',
    '끄기 직전에 하나씩 최신 상태를 다시 확인하고, 그 사이 바뀐 것은 건너뛰어요.'
  ].join('\n'),
  buttons: ['모두 끄기', '취소'],
  defaultId: 1,
  cancelId: 1,
  tone: 'danger'
}

const HOOK: ConfirmRequest = {
  id: 8,
  title: 'Claude 연동 켜기',
  message: 'Claude Code 설정 파일에 Corral 훅을 더할까요?',
  detail: '설정 파일에 훅을 더해요.\n이미 실행 중인 세션은 다시 시작해야 반영될 수 있어요.',
  buttons: ['켜기', '취소'],
  defaultId: 1,
  cancelId: 1
}

let wrapper: VueWrapper | null = null

function open(request: ConfirmRequest): {
  w: VueWrapper
  dialog: HTMLElement
  button: (index: number) => HTMLButtonElement
} {
  const w = mount(ConfirmDialog, { props: { request }, attachTo: document.body })
  wrapper = w
  const dialog = document.querySelector<HTMLElement>('[role="alertdialog"]')!
  const button = (index: number): HTMLButtonElement =>
    document.querySelector<HTMLButtonElement>(`[data-confirm-button="${index}"]`)!
  return { w, dialog, button }
}

function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  ;(document.activeElement ?? document.body).dispatchEvent(event)
  return event
}

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

test('제목·질문·문단·목록을 그린다(• 줄은 목록, 빈 줄은 문단 나눔)', () => {
  const { dialog } = open(MANY)
  expect(dialog.getAttribute('aria-modal')).toBe('true')
  expect(dialog.querySelector('[data-confirm-title]')!.textContent).toBe(MANY.title)
  const question = document.getElementById(dialog.getAttribute('aria-labelledby')!)!
  expect(question.textContent).toBe(MANY.message)
  const body = document.getElementById(dialog.getAttribute('aria-describedby')!)!
  const paragraphs = body.querySelectorAll('[data-confirm-paragraph]')
  expect(paragraphs).toHaveLength(2)
  // 목록: 글머리표 글자는 떼고 항목마다 한 줄.
  expect([...paragraphs[0].querySelectorAll('li')].map((li) => li.textContent?.trim())).toEqual([
    'Gradle 데몬 (api · main) — 1.1 GB',
    ':3000 (shop-web · develop) — 800 MB'
  ])
  expect(paragraphs[0].querySelector('p')!.textContent).toBe('외 3개')
  expect(paragraphs[1].textContent).toBe(
    '끄기 직전에 하나씩 최신 상태를 다시 확인하고, 그 사이 바뀐 것은 건너뛰어요.'
  )
  expect(body.textContent).not.toContain('•')
})

test('한 문단 안의 여러 줄은 줄마다 나눠 그린다', () => {
  const { dialog } = open(HOOK)
  const body = document.getElementById(dialog.getAttribute('aria-describedby')!)!
  expect(body.querySelectorAll('[data-confirm-paragraph]')).toHaveLength(1)
  expect([...body.querySelectorAll('p')].map((p) => p.textContent)).toEqual(HOOK.detail.split('\n'))
})

test('처음 초점은 defaultId 버튼이고, 그린 뒤 shown 을 알린다', () => {
  const { w, button } = open(MANY)
  expect(document.activeElement).toBe(button(1))
  expect(w.emitted('shown')).toHaveLength(1)
  expect(w.emitted('answer')).toBeUndefined()
})

test('Esc 는 cancelId 로 답하고, 아래 화면(상세 패널 등)에는 키가 가지 않는다', () => {
  const below = vi.fn()
  window.addEventListener('keydown', below)
  try {
    const { w } = open({ ...MANY, cancelId: 1, defaultId: 0 })
    const event = press('Escape')
    expect(w.emitted('answer')).toEqual([[1]])
    expect(event.defaultPrevented).toBe(true)
    expect(below).not.toHaveBeenCalled()
  } finally {
    window.removeEventListener('keydown', below)
  }
})

test('버튼을 누르면 그 번호로 답한다(한 번만)', async () => {
  const { w, button } = open(MANY)
  button(0).click()
  button(0).click()
  press('Escape')
  expect(w.emitted('answer')).toEqual([[0]])
})

test('Enter 는 초점이 있는 버튼으로 답한다', () => {
  const { w, button } = open(MANY)
  button(0).focus()
  const event = press('Enter')
  expect(w.emitted('answer')).toEqual([[0]])
  expect(event.defaultPrevented).toBe(true)
})

test('위험한 일(danger)이면 확인 버튼이 destructive, 보통이면 기본(파란) 버튼, 취소는 outline', () => {
  const danger = open(MANY)
  expect(danger.button(0).dataset.variant).toBe('destructive')
  expect(danger.button(0).className).toContain('text-destructive')
  expect(danger.button(1).dataset.variant).toBe('outline')
  expect(
    danger.dialog.querySelector('[data-confirm-icon]')!.getAttribute('data-confirm-icon')
  ).toBe('danger')
  danger.w.unmount()
  wrapper = null

  const normal = open(HOOK)
  expect(normal.button(0).dataset.variant).toBe('default')
  expect(normal.button(0).className).toContain('bg-primary')
  expect(normal.button(1).dataset.variant).toBe('outline')
  expect(
    normal.dialog.querySelector('[data-confirm-icon]')!.getAttribute('data-confirm-icon')
  ).toBe('normal')
})

test('확인 버튼(첫 버튼)이 오른쪽 끝, 나머지는 그 왼쪽에 차례로', () => {
  open({ ...HOOK, buttons: ['켜기', '건너뛰기', '취소'], defaultId: 2, cancelId: 2 })
  const order = [...document.querySelectorAll<HTMLElement>('[data-confirm-button]')].map((b) => [
    b.dataset.confirmButton,
    b.textContent?.trim()
  ])
  expect(order).toEqual([
    ['2', '취소'],
    ['1', '건너뛰기'],
    ['0', '켜기']
  ])
})

test('오류(error)는 버튼 하나와 빨간 아이콘, 본문이 없으면 describedby 도 없다', () => {
  const { w, dialog, button } = open({
    id: 9,
    kind: 'error',
    title: '에이전트 기다리게 하기 켜기',
    message: 'settings.json 을 읽을 수 없어 바꾸지 않았어요.',
    detail: '',
    buttons: ['확인'],
    defaultId: 0,
    cancelId: 0
  })
  expect(document.querySelectorAll('[data-confirm-button]')).toHaveLength(1)
  expect(dialog.querySelector('[data-confirm-icon]')!.getAttribute('data-confirm-icon')).toBe(
    'error'
  )
  expect(dialog.hasAttribute('aria-describedby')).toBe(false)
  expect(document.activeElement).toBe(button(0))
  press('Escape')
  expect(w.emitted('answer')).toEqual([[0]])
})

test('배경을 눌러도 닫히지 않는다', () => {
  const { w, button } = open(MANY)
  const overlay = document.querySelector<HTMLElement>('[data-confirm-overlay]')!
  const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
  overlay.dispatchEvent(down)
  overlay.click()
  // 배경을 눌러도 초점이 카드 밖으로 나가지 않는다.
  expect(down.defaultPrevented).toBe(true)
  expect(document.activeElement).toBe(button(1))
  expect(w.emitted('answer')).toBeUndefined()
  expect(document.querySelector('[role="alertdialog"]')).not.toBeNull()
})

test('Tab 은 카드 안에서 돈다(Shift+Tab 은 거꾸로)', () => {
  const { button } = open({
    ...HOOK,
    buttons: ['켜기', '건너뛰기', '취소'],
    defaultId: 2,
    cancelId: 2
  })
  expect(document.activeElement).toBe(button(2))
  const tab = press('Tab')
  expect(tab.defaultPrevented).toBe(true)
  expect(document.activeElement).toBe(button(1))
  press('Tab')
  expect(document.activeElement).toBe(button(0))
  press('Tab')
  expect(document.activeElement).toBe(button(2))
  press('Tab', { shiftKey: true })
  expect(document.activeElement).toBe(button(0))
  // 초점이 카드 밖에 있어도 카드 안으로 돌아온다.
  ;(document.activeElement as HTMLElement).blur()
  press('Tab')
  expect(document.activeElement).toBe(button(2))
})

test('닫히면 원래 초점으로 돌아간다', () => {
  const before = document.createElement('button')
  document.body.appendChild(before)
  before.focus()
  const { w, button } = open(MANY)
  expect(document.activeElement).toBe(button(1))
  w.unmount()
  wrapper = null
  expect(document.activeElement).toBe(before)
})
