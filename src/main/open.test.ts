import { localUrlFor } from './open'
import type { DashboardSnapshot, PortRow } from '../shared/types'

const row = { port: 3000 } as PortRow
const latest = { ports: [row] } as DashboardSnapshot

test('목록에 있는 포트만 http://localhost:<포트> 로 연다', () => {
  expect(localUrlFor(3000, latest)).toBe('http://localhost:3000')
})

test('목록에 없는 포트, 스냅샷 없음, 숫자가 아니거나 범위 밖이면 열지 않는다', () => {
  expect(localUrlFor(3001, latest)).toBeNull()
  expect(localUrlFor(3000, null)).toBeNull()
  expect(localUrlFor('3000/../evil', latest)).toBeNull()
  expect(localUrlFor('javascript:alert(1)', latest)).toBeNull()
  expect(localUrlFor(0, { ports: [{ port: 0 } as PortRow] } as DashboardSnapshot)).toBeNull()
  expect(
    localUrlFor(70000, { ports: [{ port: 70000 } as PortRow] } as DashboardSnapshot)
  ).toBeNull()
  expect(localUrlFor(3000.5, latest)).toBeNull()
})
