import type { DashboardSnapshot } from '../shared/types'

/**
 * 화면에서는 포트 번호만 받고 주소는 여기서 만든다. 지금 목록에 있는 개발 서버 포트일 때만 연다
 * (화면이 임의의 주소·프로토콜을 열게 하지 않으려고).
 */
export function localUrlFor(port: unknown, latest: DashboardSnapshot | null): string | null {
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) return null
  if (!latest?.servers.some((row) => row.ports.includes(port))) return null
  return `http://localhost:${port}`
}
