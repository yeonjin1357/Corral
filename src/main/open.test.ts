import { localUrlFor } from './open'
import type { DashboardSnapshot, ServerRow } from '../shared/types'

const row = { ports: [3000] } as ServerRow
const latest = { servers: [row] } as DashboardSnapshot

test('목록에 있는 포트만 http://localhost:<포트> 로 연다', () => {
  expect(localUrlFor(3000, latest)).toBe('http://localhost:3000')
})

test('목록에 없는 포트, 스냅샷 없음, 숫자가 아니거나 범위 밖이면 열지 않는다', () => {
  expect(localUrlFor(3001, latest)).toBeNull()
  expect(localUrlFor(3000, null)).toBeNull()
  expect(localUrlFor('3000/../evil', latest)).toBeNull()
  expect(localUrlFor('javascript:alert(1)', latest)).toBeNull()
  expect(localUrlFor(0, { servers: [{ ports: [0] } as ServerRow] } as DashboardSnapshot)).toBeNull()
  expect(
    localUrlFor(70000, { servers: [{ ports: [70000] } as ServerRow] } as DashboardSnapshot)
  ).toBeNull()
  expect(localUrlFor(3000.5, latest)).toBeNull()
})
