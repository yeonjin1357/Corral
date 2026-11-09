import { trendChartData, trendChartOptions } from './chart'

const MB = 1024 * 1024
const GB = 1024 * MB

test('Uptime Kuma 핑 그래프와 같은 선 스타일(초록 선·옅은 채우기·곡률 0.2·점 없음)', () => {
  const d = trendChartData([{ t: Date.UTC(2026, 10, 6, 1, 2, 3), value: 50 }], 'RAM')
  expect(d.datasets[0]).toMatchObject({
    label: 'RAM',
    data: [50],
    borderColor: '#4ABF74',
    backgroundColor: '#4ABF7438',
    fill: 'origin',
    tension: 0.2,
    pointRadius: 0
  })
  expect(d.labels).toHaveLength(1)
})

test('격자색은 테마에 맞춘다', () => {
  expect(trendChartOptions(false, 'percent').scales.y.grid.color).toBe('rgba(0,0,0,0.1)')
  expect(trendChartOptions(true, 'percent').scales.y.grid.color).toBe('rgba(255,255,255,0.1)')
})

test('단위: 퍼센트는 0~100 고정, 바이트는 MB/GB 로 눈금 표시', () => {
  const pct = trendChartOptions(false, 'percent')
  expect(pct.scales.y.min).toBe(0)
  expect(pct.scales.y.max).toBe(100)
  expect(pct.scales.y.ticks.callback(80)).toBe('80%')
  const bytes = trendChartOptions(false, 'bytes')
  expect(bytes.scales.y.min).toBe(0)
  expect(bytes.scales.y.max).toBeUndefined()
})

test('바이트는 가장 큰 값에 맞춰 MB 또는 GB 단위로 그려 눈금이 둥근 수가 되게 한다', () => {
  const small = [
    { t: 0, value: 818 * MB },
    { t: 1, value: 700 * MB }
  ]
  expect(trendChartData(small, 'mem', 'bytes').datasets[0].data).toEqual([818, 700])
  const smallOpts = trendChartOptions(false, 'bytes', small)
  expect(smallOpts.scales.y.ticks.callback(800)).toBe('800 MB')
  expect(smallOpts.plugins.tooltip.callbacks.label({ parsed: { y: 818 } })).toBe('818 MB')

  const big = [{ t: 0, value: 4.6 * GB }]
  expect(trendChartData(big, 'mem', 'bytes').datasets[0].data).toEqual([4.6])
  const bigOpts = trendChartOptions(false, 'bytes', big)
  expect(bigOpts.scales.y.ticks.callback(2.5)).toBe('2.5 GB')
  expect(bigOpts.scales.y.ticks.callback(3)).toBe('3 GB')
  expect(bigOpts.plugins.tooltip.callbacks.label({ parsed: { y: 4.6 } })).toBe('4.6 GB')

  // 퍼센트는 그대로.
  expect(trendChartData([{ t: 0, value: 85.3 }], 'RAM', 'percent').datasets[0].data).toEqual([85.3])
})
