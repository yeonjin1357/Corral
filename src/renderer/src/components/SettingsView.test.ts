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

test('갱신 주기: 옵션마다 창을 열었을 때·닫았을 때 간격을 적고, 설명에 알림이 늦을 수 있는 만큼을 적는다', async () => {
  const w = view('general')
  const select = w.find('select#refresh')
  expect(select.findAll('option').map((o) => o.text())).toEqual([
    '빠르게 · 2초 / 10초',
    '보통 · 5초 / 30초',
    '절약 · 15초 / 2분'
  ])
  const help = (): string => w.find('label[for="refresh"]').element.parentElement!.textContent!
  expect(help()).toContain('창을 열어 두면 5초, 닫아 두면 30초마다 확인해요.')
  expect(help()).toContain('알림이 최대 30초 늦을 수 있고')
  await select.setValue('saver')
  expect(help()).toContain('창을 열어 두면 15초, 닫아 두면 2분마다 확인해요.')
  expect(help()).toContain('알림이 최대 2분 늦을 수 있고')
})

test('드롭다운 목록은 테마의 팝오버 색으로 그린다(반투명 바탕이 흰색 위에 깔려 글자가 안 보이지 않게)', () => {
  const select = view('general').find('select#refresh')
  expect(select.classes()).toContain('[&_option]:bg-popover')
  expect(select.classes()).toContain('[&_option]:text-popover-foreground')
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

  describe('macOS 설치본', () => {
    const PAGE = 'https://github.com/yeonjin1357/Corral/releases/latest'
    const COMMAND =
      'curl -fsSL https://raw.githubusercontent.com/yeonjin1357/Corral/main/scripts/install-mac.sh | bash'
    const available = (next: Partial<UpdateStatus>): UpdateStatus =>
      status({ state: 'available', version: '0.4.0', url: PAGE, installCommand: COMMAND, ...next })

    test('앱 안에서 바꿔 넣을 수 있으면 업데이트 버튼(누르면 설치를 요청한다), 설치 한 줄은 보이지 않는다', async () => {
      const w = about({ update: available({ selfInstall: true }) })
      expect(w.find('.update-state').text()).toBe('새 버전 0.4.0 이 있어요.')
      const button = w.find('[data-action="update-self-install"]')
      expect(button.text()).toBe('업데이트')
      expect(w.text()).toContain('누르면 새 버전을 내려받아 앱을 바꿔 넣고 다시 켜요.')
      expect(w.find('[data-update-command]').exists()).toBe(false)
      await button.trigger('click')
      expect(w.emitted('updateInstall')).toHaveLength(1)
    })

    test('내려받는 중에는 업데이트 버튼이 없다', () => {
      const w = about({
        update: status({ state: 'downloading', version: '0.4.0', selfInstall: true })
      })
      expect(w.find('[data-action="update-self-install"]').exists()).toBe(false)
      expect(w.find('.update-state').text()).toBe('새 버전 0.4.0 을 내려받는 중이에요.')
    })

    test('바꿔 넣지 못했으면 까닭과 설치 한 줄을 보이고, 복사할 수 있다', async () => {
      const w = about({
        update: available({ selfInstall: false, error: '응용 프로그램 폴더에 쓸 수 없어요.' })
      })
      expect(w.find('[data-action="update-self-install"]').exists()).toBe(false)
      expect(w.find('.update-problem').text()).toBe('응용 프로그램 폴더에 쓸 수 없어요.')
      expect(w.text()).toContain('터미널에 아래 한 줄을 붙여 넣으면 새 버전으로 바뀌어요.')
      expect(w.find('[data-update-command]').text()).toBe(COMMAND)
      await w.find('[data-action="update-copy-command"]').trigger('click')
      expect(w.emitted('updateCopyCommand')).toHaveLength(1)
      // 내려받기 페이지도 남겨 둔다.
      expect(w.find(`a[href="${PAGE}"]`).exists()).toBe(true)
    })

    test('Windows(설치 한 줄이 없음)의 새 버전 알림은 지금처럼 내려받기 페이지뿐', () => {
      const w = about({ update: status({ state: 'available', version: '0.4.0', url: PAGE }) })
      expect(w.find('[data-action="update-self-install"]').exists()).toBe(false)
      expect(w.find('[data-update-command]').exists()).toBe(false)
      expect(w.find(`a[href="${PAGE}"]`).exists()).toBe(true)
    })
  })
})
