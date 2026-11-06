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

function formatValue(value: number, unit: TrendUnit): string {
  return unit === 'percent' ? `${Math.round(value * 10) / 10}%` : formatBytes(value)
}

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
export function trendChartData(points: Point[], label: string): TrendData {
  return {
    labels: points.map((p) => timeLabel(p.t)),
    datasets: [
      {
        label,
        data: points.map((p) => p.value),
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
export function trendChartOptions(dark: boolean, unit: TrendUnit): TrendOptions {
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
          label: (ctx: { parsed: { y: number } }): string => formatValue(ctx.parsed.y, unit)
        }
      }
    },
    scales: {
      x: { grid, ticks: { maxTicksLimit: 8, maxRotation: 0 } },
      y: {
        grid,
        min: 0,
        max: unit === 'percent' ? 100 : undefined,
        ticks: { callback: (value: number | string): string => formatValue(Number(value), unit) }
      }
    }
  }
}
