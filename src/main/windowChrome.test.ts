import { TITLE_BAR_HEIGHT, backgroundFor, overlayFor, windowChrome } from './windowChrome'

test('Windows: OS 창 단추를 화면 제목줄에 겹쳐 그리고, 아래 테두리 1px 는 남긴다', () => {
  expect(windowChrome('win32', false)).toEqual({
    titleBarStyle: 'hidden',
    backgroundColor: '#ffffff',
    titleBarOverlay: { color: '#f6f8fa', symbolColor: '#24292f', height: TITLE_BAR_HEIGHT - 1 }
  })
})

test('macOS: 신호등을 제목줄 높이 가운데에 두고 겹침 영역은 쓰지 않는다', () => {
  const chrome = windowChrome('darwin', true)
  expect(chrome.titleBarOverlay).toBeUndefined()
  expect(chrome.trafficLightPosition).toEqual({ x: 16, y: 17 })
  expect(chrome.backgroundColor).toBe('#1e1e2e')
})

test('어두운 테마 색은 화면(Catppuccin) 제목줄·글자 색과 같다', () => {
  expect(overlayFor(true)).toMatchObject({ color: '#181825', symbolColor: '#cdd6f4' })
  expect(backgroundFor(true)).toBe('#1e1e2e')
})
