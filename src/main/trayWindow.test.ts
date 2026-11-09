import { shouldReopen, trayWindowBounds, TRAY_WINDOW_SIZE } from './trayWindow'

const size = { width: 360, height: 520 }
/** 1920×1080 화면, 작업 표시줄 높이 48. */
const screen = { x: 0, y: 0, width: 1920, height: 1080 }

describe('트레이 요약 창 위치', () => {
  test('Windows 아래 작업 표시줄이면 트레이 위에(아이콘 가운데 맞춤, 작업 영역 안)', () => {
    const display = { bounds: screen, workArea: { x: 0, y: 0, width: 1920, height: 1032 } }
    const tray = { x: 1700, y: 1040, width: 24, height: 32 }
    expect(trayWindowBounds(tray, display, size, 'win32')).toEqual({
      x: 1700 + 12 - 180,
      y: 1032 - 520 - 8,
      width: 360,
      height: 520
    })
  })

  test('위 작업 표시줄이면 아래에', () => {
    const display = { bounds: screen, workArea: { x: 0, y: 48, width: 1920, height: 1032 } }
    const tray = { x: 1700, y: 8, width: 24, height: 32 }
    expect(trayWindowBounds(tray, display, size, 'win32')).toMatchObject({ y: 48 + 8 })
  })

  test('오른쪽·왼쪽 작업 표시줄이면 그 옆에', () => {
    const right = { bounds: screen, workArea: { x: 0, y: 0, width: 1860, height: 1080 } }
    const r = trayWindowBounds({ x: 1880, y: 900, width: 32, height: 24 }, right, size, 'win32')
    expect(r.x).toBe(1860 - 360 - 8)
    expect(r.y).toBe(1080 - 520) // 아이콘 가운데에 맞추면 화면 밖이라 안으로 민다.
    const left = { bounds: screen, workArea: { x: 60, y: 0, width: 1860, height: 1080 } }
    expect(trayWindowBounds({ x: 10, y: 300, width: 32, height: 24 }, left, size, 'win32').x).toBe(
      60 + 8
    )
  })

  test('macOS 는 메뉴바 아이콘 아래', () => {
    const display = {
      bounds: { x: 0, y: 0, width: 1512, height: 982 },
      workArea: { x: 0, y: 25, width: 1512, height: 957 }
    }
    const tray = { x: 1200, y: 0, width: 22, height: 24 }
    expect(trayWindowBounds(tray, display, size, 'darwin')).toEqual({
      x: 1200 + 11 - 180,
      y: 24 + 4,
      width: 360,
      height: 520
    })
  })

  test('화면 밖으로 나가지 않는다(모서리 아이콘·음수 좌표 화면)', () => {
    const display = {
      bounds: { x: -1280, y: 0, width: 1280, height: 1024 },
      workArea: { x: -1280, y: 0, width: 1280, height: 984 }
    }
    const corner = trayWindowBounds(
      { x: -20, y: 990, width: 24, height: 32 },
      display,
      size,
      'win32'
    )
    expect(corner.x).toBe(-360 - 8)
    expect(corner.x + corner.width).toBeLessThanOrEqual(0)
    const far = trayWindowBounds(
      { x: -1290, y: 990, width: 24, height: 32 },
      display,
      size,
      'win32'
    )
    expect(far.x).toBe(-1280 + 8)
  })

  test('트레이 위치를 모르면(0 크기) 작업 영역 오른쪽 아래', () => {
    const display = { bounds: screen, workArea: { x: 0, y: 0, width: 1920, height: 1032 } }
    expect(trayWindowBounds({ x: 0, y: 0, width: 0, height: 0 }, display, size, 'win32')).toEqual({
      x: 1920 - 360 - 8,
      y: 1032 - 520 - 8,
      width: 360,
      height: 520
    })
  })

  test('기본 크기는 NeoHtop 요약 창과 비슷한 세로형', () => {
    expect(TRAY_WINDOW_SIZE.height).toBeGreaterThan(TRAY_WINDOW_SIZE.width)
  })
})

test('창이 포커스를 잃어 막 숨은 직후의 트레이 클릭은 다시 열지 않는다(누르면 닫히는 동작)', () => {
  expect(shouldReopen(null, 1000)).toBe(true)
  expect(shouldReopen(1000, 1100)).toBe(false)
  expect(shouldReopen(1000, 1400)).toBe(true)
})
