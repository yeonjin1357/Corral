import { DEFAULT_THRESHOLDS, DEFAULT_INTERVALS, COMMAND_TIMEOUT_MS } from './defaults'

test('기본 임계값과 주기', () => {
  expect(DEFAULT_THRESHOLDS).toEqual({ ramWarnPercent: 80, ramDangerPercent: 90 })
  expect(DEFAULT_INTERVALS).toEqual({ openMs: 5000, closedMs: 30000 })
  expect(COMMAND_TIMEOUT_MS).toBe(15000)
})
