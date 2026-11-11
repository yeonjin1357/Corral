// @vitest-environment happy-dom
import { mount, type VueWrapper } from '@vue/test-utils'
import SettingsView from './SettingsView.vue'
import { DEFAULT_SETTINGS, type Settings } from '../../../shared/settings'
import type { UpdateStatus } from '../../../shared/types'

const status = (next: Partial<UpdateStatus>): UpdateStatus => ({
  state: 'idle',
  version: null,
  url: null,
  error: null,
  checkedAt: null,
  ...next
})

function view(
  page: 'general' | 'about',
  opts: { update?: UpdateStatus | null; settings?: Partial<Settings> } = {}
): VueWrapper {
  return mount(SettingsView, {
    props: {
      settings: { ...DEFAULT_SETTINGS, ...opts.settings },
      hook: null,
      hookBusy: false,
      version: '0.3.0',
      save: async (s: Settings) => s,
      pickFolder: async () => null,
      update: opts.update ?? null,
      page
    }
  })
}
const about = (opts?: Parameters<typeof view>[1]): VueWrapper => view('about', opts)

test('일반 쪽의 새 버전 확인 설명에 GitHub 이 나오지 않는다', () => {
  const w = view('general')
  expect(w.text()).toContain('새 버전 확인')
  expect(w.text()).not.toContain('GitHub')
})

describe('설정 > 정보', () => {
  test('현재 버전과 업데이트 확인 버튼만 있고, 저장소·라이선스 링크는 없다', async () => {
    const w = about()
    expect(w.find('h1').text()).toBe('정보')
    expect(w.text()).toContain('현재 버전: 0.3.0')
    expect(w.findAll('a')).toHaveLength(0)
    expect(w.text()).not.toContain('GitHub')
    expect(w.text()).not.toContain('라이선스')
    const check = w.find('[data-action="update-check"]')
    expect(check.text()).toBe('업데이트 확인')
    await check.trigger('click')
    expect(w.emitted('updateCheck')).toHaveLength(1)
  })

  test('확인 전에는 결과 줄 없이 자동 확인 안내만 보인다', () => {
    const w = about({ update: status({ state: 'idle' }) })
    expect(w.find('.update-state').exists()).toBe(false)
    expect(w.find('.update-auto').text()).toContain('시작할 때')
  })

  test('확인한 결과는 안내 위에 보인다', () => {
    const w = about({ update: status({ state: 'none', checkedAt: 1 }) })
    expect(w.find('.update-state').text()).toBe('최신 버전이에요.')
    expect(w.find('.update-auto').exists()).toBe(true)
  })

  test('확인하는 중에는 버튼을 잠근다', () => {
    const w = about({ update: status({ state: 'checking' }) })
    expect(w.find('[data-action="update-check"]').attributes('disabled')).toBeDefined()
  })

  test('개발 실행이면 그렇다고 알리고 자동 확인 안내는 뺀다', () => {
    const w = about({ update: status({ state: 'disabled' }) })
    expect(w.find('.update-state').text()).toContain('개발 실행')
    expect(w.find('.update-auto').exists()).toBe(false)
  })

  test('새 버전 확인을 껐으면 그렇다고 알리고 자동 확인 안내는 뺀다', () => {
    const w = about({
      update: status({ state: 'disabled' }),
      settings: { updateCheck: false }
    })
    expect(w.find('.update-state').text()).toContain('꺼져 있어요')
    expect(w.find('.update-auto').exists()).toBe(false)
  })

  test('받아 둔 새 버전이 있으면 다시 시작해 설치할 수 있다', async () => {
    const w = about({ update: status({ state: 'ready', version: '0.4.0' }) })
    expect(w.find('.update-state').text()).toContain('0.4.0')
    await w.find('[data-action="update-install"]').trigger('click')
    expect(w.emitted('updateInstall')).toHaveLength(1)
  })
})
