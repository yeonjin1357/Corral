import { trendChartData, trendChartOptions } from './chart'

const MB = 1024 * 1024

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
  expect(bytes.scales.y.ticks.callback(512 * MB)).toBe('512 MB')
})
