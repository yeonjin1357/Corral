// @vitest-environment happy-dom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import SettingsView from './SettingsView.vue'
import { DEFAULT_SETTINGS, type Settings } from '../../../shared/settings'
import type { ClaudeHookStatus } from '../../../shared/types'

const HOOK: ClaudeHookStatus = {
  state: 'off',
  problem: null,
  allHooksDisabled: false,
  settingsPath: 'C:\\Users\\김개발\\.claude\\settings.json'
}

function setup(
  over: Partial<{
    settings: Settings
    hook: ClaudeHookStatus | null
    save: (s: Settings) => Promise<Settings>
    pickFolder: () => Promise<string | null>
  }> = {}
): { w: VueWrapper; save: ReturnType<typeof vi.fn>; pickFolder: ReturnType<typeof vi.fn> } {
  const save = vi.fn(over.save ?? (async (s: Settings) => s))
  const pickFolder = vi.fn(over.pickFolder ?? (async () => null))
  const w = mount(SettingsView, {
    props: {
      settings: over.settings ?? DEFAULT_SETTINGS,
      hook: over.hook === undefined ? HOOK : over.hook,
      hookBusy: false,
      version: '0.2.0',
      save,
      pickFolder
    }
  })
  return { w, save, pickFolder }
}

async function open(w: VueWrapper, label: string): Promise<void> {
  await w
    .findAll('.settings-menu a')
    .find((a) => a.text() === label)!
    .trigger('click')
}

test('Uptime Kuma 설정처럼 왼쪽 메뉴 7개, 고른 메뉴의 제목, 처음은 일반', async () => {
  const { w } = setup()
  expect(w.findAll('.settings-menu a').map((a) => a.text())).toEqual([
    '일반',
    '기준값',
    '무거운 작업',
    '알림',
    '디스크 정리',
    'Claude 연동',
    '정보'
  ])
  expect(w.get('.settings-content-header').text()).toBe('일반')
  expect(w.get('.settings-menu a.active').text()).toBe('일반')
  await open(w, '정보')
  expect(w.get('.settings-content-header').text()).toBe('정보')
  expect(w.text()).toContain('pitwall 0.2.0')
  expect(w.find('.btn-save').exists()).toBe(false)
})

test('일반: 갱신 주기에 따라 확인 주기 안내가 바뀌고, 저장하면 바꾼 값을 넘긴다', async () => {
  const { w, save } = setup()
  expect(w.text()).toContain('창이 열려 있으면 5초, 닫혀 있으면 30초마다 확인해요.')
  await w.get('#refresh-fast').setValue(true)
  expect(w.text()).toContain('창이 열려 있으면 2초, 닫혀 있으면 10초마다 확인해요.')
  await w.get('#theme-dark').setValue(true)
  await w.get('#launch-at-login').setValue(false)
  await w.get('form').trigger('submit')
  await flushPromises()
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({ refresh: 'fast', theme: 'dark', launchAtLogin: false })
  )
  expect(w.get('.save-notice').text()).toBe('저장했어요.')
})

test('기준값: 숫자 칸 값을 넘기고, 메인이 고친 값(범위 안)으로 폼이 바뀐다', async () => {
  const { w, save } = setup()
  await open(w, '기준값')
  await w.get('#ram-warn').setValue('10')
  await w.get('#idle-port').setValue('45')
  await w.get('form').trigger('submit')
  await flushPromises()
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({ ramWarnPercent: 10, idlePortMinutes: 45 })
  )
  await w.setProps({ settings: { ...DEFAULT_SETTINGS, ramWarnPercent: 50, idlePortMinutes: 45 } })
  expect((w.get('#ram-warn').element as HTMLInputElement).value).toBe('50')
})

test('무거운 작업: 한 줄에 하나(빈 줄·앞뒤 공백 제외), 기본값으로 되돌리기', async () => {
  const { w, save } = setup()
  await open(w, '무거운 작업')
  await w.get('#heavy-patterns').setValue('  vue-tsc \n\n gradle build\n')
  await w.get('form').trigger('submit')
  await flushPromises()
  expect(save.mock.calls[0][0].heavyPatterns).toEqual(['vue-tsc', 'gradle build'])
  await w.get('.btn-outline-primary').trigger('click')
  expect((w.get('#heavy-patterns').element as HTMLTextAreaElement).value).toBe(
    DEFAULT_SETTINGS.heavyPatterns.join('\n')
  )
})

test('알림: 항목별로 끄고 켠다', async () => {
  const { w, save } = setup()
  await open(w, '알림')
  await w.get('#notify-claude').setValue(false)
  await w.get('form').trigger('submit')
  await flushPromises()
  expect(save.mock.calls[0][0].notify).toEqual({
    ramLow: true,
    claudeWaiting: false,
    heavyOverlap: true
  })
})

test('디스크 정리: 폴더 이름 줄, 저장소를 폴더 고르기로 더하고 뺀다', async () => {
  const { w, save, pickFolder } = setup({ pickFolder: async () => 'C:\\work\\shop-web' })
  await open(w, '디스크 정리')
  expect(w.text()).toContain('더한 저장소가 없어요.')
  await w.get('.btn-add-repo').trigger('click')
  await flushPromises()
  expect(pickFolder).toHaveBeenCalled()
  expect(w.findAll('.repo').map((r) => r.find('span').text())).toEqual(['C:\\work\\shop-web'])
  await w.get('#dependency-dirs').setValue('node_modules\n.venv')
  await w.get('form').trigger('submit')
  await flushPromises()
  expect(save.mock.calls[0][0]).toMatchObject({
    dependencyDirs: ['node_modules', '.venv'],
    extraRepos: ['C:\\work\\shop-web']
  })
  await w.get('.btn-remove-repo').trigger('click')
  expect(w.findAll('.repo')).toHaveLength(0)
})

test('Claude 연동: 상태와 설정 파일 경로, 켜기 버튼. 예전 설정이 남았으면 다시 켜기와 끄기 둘 다', async () => {
  const { w } = setup()
  await open(w, 'Claude 연동')
  expect(w.text()).toContain('꺼짐')
  expect(w.text()).toContain('설정 파일: C:\\Users\\김개발\\.claude\\settings.json')
  await w.get('.btn-hook').trigger('click')
  expect(w.emitted('hook')).toEqual([['enable']])

  const partial = setup({ hook: { ...HOOK, state: 'partial' } })
  await open(partial.w, 'Claude 연동')
  expect(partial.w.get('.btn-hook').text()).toBe('Claude 연동 다시 켜기')
  await partial.w.get('.btn-hook-off').trigger('click')
  expect(partial.w.emitted('hook')).toEqual([['disable']])
})

test('저장이 실패하면 이유를 빨간 글씨로 보인다', async () => {
  const { w } = setup({
    save: async () => {
      throw new Error('디스크가 가득 찼어요')
    }
  })
  await w.get('form').trigger('submit')
  await flushPromises()
  expect(w.get('.save-notice').text()).toBe('저장하지 못했어요: 디스크가 가득 찼어요')
  expect(w.get('.save-notice').classes()).toContain('text-danger')
})
