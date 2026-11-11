// @vitest-environment happy-dom
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach } from 'vitest'
import MemorySheet from './MemorySheet.vue'
import MemoryMap from './MemoryMap.vue'
import StackedTrend from './StackedTrend.vue'
import type { DashboardSnapshot, GroupPoint } from '../../../shared/types'
import { GB, MB, agentRow, heavyJob, serverRow, snapshot } from '../testing/fixtures'

let wrapper: VueWrapper | null = null
afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

function sheet(s: DashboardSnapshot, groupHistory: GroupPoint[] = []): VueWrapper {
  wrapper = mount(MemorySheet, {
    attachTo: document.body,
    props: {
      snapshot: s,
      ramHistory: [],
      groupHistory,
      windowMs: 600_000,
      refreshing: false,
      open: true
    }
  })
  return wrapper
}

const s = snapshot({
  servers: [serverRow({ pid: 1, ports: [3000] }), serverRow({ pid: 2, ports: [3001] })],
  hiddenServers: [serverRow({ pid: 3, ports: [2375] })],
  agents: [agentRow({ pid: 10 }), agentRow({ pid: 11 })],
  heavyJobs: [heavyJob({ pid: 20 })],
  apps: [
    {
      name: 'chrome.exe',
      owner: null,
      memoryBytes: 2 * GB,
      commitBytes: null,
      processCount: 40,
      exePath: null
    },
    {
      name: 'svchost.exe',
      owner: null,
      memoryBytes: 1 * GB,
      commitBytes: null,
      processCount: 90,
      exePath: null
    },
    {
      name: 'a.exe',
      owner: null,
      memoryBytes: 300 * MB,
      commitBytes: null,
      processCount: 1,
      exePath: null
    },
    {
      name: 'b.exe',
      owner: null,
      memoryBytes: 200 * MB,
      commitBytes: null,
      processCount: 1,
      exePath: null
    },
    {
      name: 'c.exe',
      owner: null,
      memoryBytes: 100 * MB,
      commitBytes: null,
      processCount: 1,
      exePath: null
    },
    {
      name: 'd.exe',
      owner: null,
      memoryBytes: 50 * MB,
      commitBytes: null,
      processCount: 1,
      exePath: null
    }
  ],
  groups: [
    { group: 'devServer', memoryBytes: 2 * GB, commitBytes: null, processCount: 5 },
    { group: 'agent', memoryBytes: 1 * GB, commitBytes: null, processCount: 37 },
    { group: 'heavy', memoryBytes: 3 * GB, commitBytes: null, processCount: 4 },
    { group: 'otherApps', memoryBytes: 4 * GB, commitBytes: null, processCount: 134 },
    { group: 'system', memoryBytes: 2 * GB, commitBytes: null, processCount: 0 }
  ]
})

const groupRows = (): Element[] => [...document.body.querySelectorAll('[data-memory-group]')]
const groupText = (key: string): string =>
  groupRows()
    .find((e) => e.getAttribute('data-memory-group') === key)!
    .textContent!.replace(/\s+/g, ' ')
    .trim()

describe('메모리 상세: 어디에 쓰고 있나', () => {
  test('묶음마다 행 수(탭 숫자와 같은 단위)와 프로세스 수를 함께 적는다', () => {
    sheet(s)
    expect(groupText('devServer')).toContain('개발 서버 3개(숨김 1개 포함) · 프로세스 5개')
    expect(groupText('agent')).toContain('에이전트 2개 · 프로세스 37개')
    expect(groupText('heavy')).toContain('무거운 작업 1개 · 프로세스 4개')
    expect(groupText('otherApps')).toContain('다른 앱 6개 · 프로세스 134개')
    expect(groupText('system')).not.toContain('프로세스')
  })

  test('숨긴 서버가 없으면 숨김 표시를 붙이지 않는다', () => {
    sheet({ ...s, hiddenServers: [] })
    expect(groupText('devServer')).toContain('개발 서버 2개 · 프로세스 5개')
  })

  test('묶음을 누르면 그 탭으로 간다(시스템·공유 메모리는 누를 수 없다)', async () => {
    const w = sheet(s)
    const button = (key: string): HTMLElement | null =>
      document.body.querySelector(`[data-memory-group="${key}"] button`)
    button('agent')!.click()
    button('otherApps')!.click()
    button('devServer')!.click()
    button('heavy')!.click()
    expect(button('system')).toBeNull()
    expect(w.emitted('go')).toEqual([['agents'], ['apps'], ['ports'], ['heavy']])
  })

  test('많이 쓰는 다른 앱은 상위 5개만 보인다(전부는 다른 앱 탭)', () => {
    sheet(s)
    const names = [...document.body.querySelectorAll('[data-top-app]')].map((e) =>
      e.getAttribute('data-top-app')
    )
    expect(names).toEqual(['chrome.exe', 'svchost.exe', 'a.exe', 'b.exe', 'c.exe'])
  })

  test('많이 쓰는 다른 앱은 다른 앱 탭과 같은 이름(띄운 앱까지)으로 보인다', () => {
    const app = { memoryBytes: GB, commitBytes: null, processCount: 3, exePath: null }
    sheet({
      ...s,
      apps: [
        { ...app, name: 'node.exe', owner: 'Cursor.exe' },
        { ...app, name: 'node.exe', owner: null }
      ]
    })
    const rows = [...document.body.querySelectorAll('[data-top-app]')]
    expect(rows.map((e) => e.querySelector('td')!.textContent!.trim())).toEqual([
      'node (Cursor)',
      'node'
    ])
    expect(rows[0].querySelector('td')!.getAttribute('title')).toBe('node.exe — Cursor.exe')
  })
})

test('맨 위에 남은 메모리 한 줄과 메모리 지도, RAM 추이 아래에 묶음별 추이', () => {
  const points: GroupPoint[] = [
    { t: 1, devServer: GB, agent: GB, heavy: 0, otherApps: 4 * GB, system: 2 * GB }
  ]
  const w = sheet(s, points)
  const body = document.body.textContent!.replace(/\s+/g, ' ')
  // 남은 메모리 = 전체 − 사용(fixtures: 32 GB − 26.3 GB).
  expect(body).toContain('메모리 지도')
  expect(body).toContain('남은 메모리 5.7 GB')
  const order = [...document.body.querySelectorAll('h3')].map((h) => h.textContent!.trim())
  expect(order.slice(0, 3)).toEqual(['메모리 지도', '사용 추이', '묶음별 추이'])
  expect(w.findComponent(StackedTrend).props()).toMatchObject({
    points,
    windowMs: 600_000,
    totalBytes: 32 * GB
  })
  // 지도에서 고른 줄은 그대로 올린다(App 이 메모리 상세를 닫고 그 줄의 상세를 연다).
  w.findComponent(MemoryMap).vm.$emit('select', 'server:1:200')
  expect(w.emitted('select')).toEqual([['server:1:200']])
})

test('커밋·한도·남은 메모리·커널 몫을 보인다, 모르면 숨긴다', () => {
  sheet(
    snapshot({
      memory: {
        totalBytes: 63.7 * GB,
        usedBytes: 56.8 * GB,
        usedPercent: 89.2,
        availableBytes: 6.5 * GB,
        level: 'warn',
        ramLevel: 'warn',
        commit: { usedBytes: 104.8 * GB, limitBytes: 127.7 * GB, percent: 82.1, level: 'warn' },
        kernelBytes: 2 * GB
      }
    })
  )
  const body = document.body.textContent!.replace(/\s+/g, ' ')
  expect(body).toContain('남은 메모리6.5 GB')
  expect(body).toContain('커밋104.8 GB')
  expect(body).toContain('커밋 한도127.7 GB')
  expect(body).toContain('커널 2.0 GB 포함')
  expect(body).toContain('페이지 파일로 밀려난 것')
  wrapper?.unmount()
  document.body.innerHTML = ''

  sheet(snapshot())
  const plain = document.body.textContent!
  expect(plain).not.toContain('커밋')
  expect(document.body.querySelector('[data-kernel]')).toBeNull()
  expect(plain).not.toContain('포함')
})
