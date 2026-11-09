import { formatBytes } from '../../shared/format'
import type { Point } from './history'

export type TrendUnit = 'percent' | 'bytes'

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function timeLabel(t: number): string {
  const d = new Date(t)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

const MiB = 1024 * 1024
const GiB = 1024 * MiB

/**
 * 바이트 그래프는 가장 큰 값에 맞춰 MB 또는 GB 단위의 수로 그린다.
 * 바이트 그대로 그리면 Chart.js 가 10진수로 눈금을 잡아 858 MB·763 MB 처럼 어색한 눈금이 나온다.
 */
function byteScale(points: Point[]): { factor: number; suffix: string } {
  const max = points.reduce((m, p) => Math.max(m, p.value), 0)
  return max >= GiB ? { factor: GiB, suffix: 'GB' } : { factor: MiB, suffix: 'MB' }
}

const trim = (n: number): string => String(Math.round(n * 10) / 10)

export interface TrendData {
  labels: string[]
  datasets: {
    label: string
    data: number[]
    borderColor: string
    backgroundColor: string
    fill: 'origin'
    tension: number
    pointRadius: number
    borderWidth: number
  }[]
}

interface Grid {
  color: string
}

export interface TrendOptions {
  responsive: boolean
  maintainAspectRatio: boolean
  animation: false
  interaction: { mode: 'index'; intersect: boolean }
  plugins: {
    legend: { display: boolean }
    tooltip: {
      backgroundColor: string
      bodyColor: string
      titleColor: string
      callbacks: { label: (ctx: { parsed: { y: number } }) => string }
    }
  }
  scales: {
    x: { grid: Grid; ticks: { maxTicksLimit: number; maxRotation: number } }
    y: {
      grid: Grid
      min: number
      max: number | undefined
      ticks: { callback: (value: number | string) => string }
    }
  }
}

/** Uptime Kuma PingChart 의 선 스타일(#4ABF74 선, 옅은 채우기, 곡률 0.2)을 그대로 쓴다. 점은 그리지 않는다. */
export function trendChartData(
  points: Point[],
  label: string,
  unit: TrendUnit = 'percent'
): TrendData {
  const factor = unit === 'bytes' ? byteScale(points).factor : 1
  return {
    labels: points.map((p) => timeLabel(p.t)),
    datasets: [
      {
        label,
        data: points.map((p) => Math.round((p.value / factor) * 100) / 100),
        borderColor: '#4ABF74',
        backgroundColor: '#4ABF7438',
        fill: 'origin' as const,
        tension: 0.2,
        pointRadius: 0,
        borderWidth: 2
      }
    ]
  }
}

/** Uptime Kuma PingChart 의 격자·툴팁 색을 테마별로 그대로 쓴다. */
export function trendChartOptions(
  dark: boolean,
  unit: TrendUnit,
  points: Point[] = []
): TrendOptions {
  const scale = byteScale(points)
  const formatValue = (value: number): string =>
    unit === 'percent' ? `${trim(value)}%` : formatBytes(value * scale.factor)
  const formatTick = (value: number): string =>
    unit === 'percent' ? `${trim(value)}%` : `${trim(value)} ${scale.suffix}`
  const grid = { color: dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }
  const textColor = dark ? 'rgba(220,220,220,1.0)' : 'rgba(12,12,18,1.0)'
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false as const,
    interaction: { mode: 'index' as const, intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: dark ? 'rgba(32,42,38,1.0)' : 'rgba(212,232,222,1.0)',
        bodyColor: textColor,
        titleColor: textColor,
        callbacks: {
          label: (ctx: { parsed: { y: number } }): string => formatValue(ctx.parsed.y)
        }
      }
    },
    scales: {
      x: { grid, ticks: { maxTicksLimit: 8, maxRotation: 0 } },
      y: {
        grid,
        min: 0,
        max: unit === 'percent' ? 100 : undefined,
        ticks: { callback: (value: number | string): string => formatTick(Number(value)) }
      }
    }
  }
}
