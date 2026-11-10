// @vitest-environment happy-dom
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach } from 'vitest'
import MemorySheet from './MemorySheet.vue'
import type { DashboardSnapshot } from '../../../shared/types'
import { GB, MB, agentRow, heavyJob, serverRow, snapshot } from '../testing/fixtures'

let wrapper: VueWrapper | null = null
afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

function sheet(s: DashboardSnapshot): VueWrapper {
  wrapper = mount(MemorySheet, {
    attachTo: document.body,
    props: { snapshot: s, ramHistory: [], windowMs: 600_000, refreshing: false, open: true }
  })
  return wrapper
}

const s = snapshot({
  servers: [serverRow({ pid: 1, ports: [3000] }), serverRow({ pid: 2, ports: [3001] })],
  hiddenServers: [serverRow({ pid: 3, ports: [2375] })],
  agents: [agentRow({ pid: 10 }), agentRow({ pid: 11 })],
  heavyJobs: [heavyJob({ pid: 20 })],
  apps: [
    { name: 'chrome.exe', memoryBytes: 2 * GB, commitBytes: null, processCount: 40, exePath: null },
    {
      name: 'svchost.exe',
      memoryBytes: 1 * GB,
      commitBytes: null,
      processCount: 90,
      exePath: null
    },
    { name: 'a.exe', memoryBytes: 300 * MB, commitBytes: null, processCount: 1, exePath: null },
    { name: 'b.exe', memoryBytes: 200 * MB, commitBytes: null, processCount: 1, exePath: null },
    { name: 'c.exe', memoryBytes: 100 * MB, commitBytes: null, processCount: 1, exePath: null },
    { name: 'd.exe', memoryBytes: 50 * MB, commitBytes: null, processCount: 1, exePath: null }
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
})
