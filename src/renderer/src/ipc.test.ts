import { reactive, ref } from 'vue'
import { DEFAULT_SETTINGS, type Settings } from '../../shared/settings'
import { toIpc } from './ipc'

// 메인 프로세스로 보내는 값은 구조화 복제(structured clone)된다. Vue 반응형 객체(Proxy)는 복제할 수 없어
// 실제 앱에서 "An object could not be cloned" 로 설정 저장이 실패했다(테스트는 IPC 를 흉내 내 놓쳤다).

test('반응형 설정을 펼쳐도 안쪽(알림·목록)은 Proxy 라 그대로는 복제되지 않는다', () => {
  const settings = ref<Settings>(structuredClone(DEFAULT_SETTINGS))
  expect(() => structuredClone({ ...settings.value, theme: 'dark' })).toThrow()
})

test('toIpc 는 반응형 값을 복제 가능한 보통 값으로 바꾸고 내용은 그대로 둔다', () => {
  const draft = reactive(structuredClone(DEFAULT_SETTINGS))
  draft.notify.ramLow = false
  draft.extraRepos.push('C:\\work\\shop-web')
  const plain = toIpc({ ...draft, theme: 'dark' as const })
  expect(() => structuredClone(plain)).not.toThrow()
  expect(plain).toEqual({
    ...DEFAULT_SETTINGS,
    theme: 'dark',
    notify: { ...DEFAULT_SETTINGS.notify, ramLow: false },
    extraRepos: ['C:\\work\\shop-web']
  })
})
