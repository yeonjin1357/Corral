// @vitest-environment happy-dom
import { mount, type VueWrapper } from '@vue/test-utils'
import StatsBar from './StatsBar.vue'
import type { DashboardSnapshot } from '../../../shared/types'
import { GB, MB, agentRow, heavyJob, portRow, snapshot } from '../testing/fixtures'

function bar(s: DashboardSnapshot): VueWrapper {
  return mount(StatsBar, { props: { snapshot: s, ramHistory: [], windowMs: 600_000 } })
}

/** 제목이 title 인 카드의 "메모리" 줄 값. */
function cardMemory(w: VueWrapper, title: string): string {
  const card = w
    .findAll('[data-slot=card]')
    .find((c) => c.find('[data-slot=card-title]').text().trim() === title)!
  const row = card
    .findAll('div')
    .find(
      (d) =>
        d.element.children[0]?.textContent?.trim() === '메모리' && d.findAll('span').length === 2
    )!
  return row.findAll('span')[1].text()
}

describe('카드의 메모리 합은 메모리 카드 묶음과 같은 값(같은 프로세스를 두 번 세지 않는다)', () => {
  test('한 프로세스가 포트 둘을 열어도 개발 서버 메모리는 한 번만 센다', () => {
    // 같은 서버(pid 4100)가 8081·8082 를 연다. 표에는 두 줄이지만 메모리는 같은 프로세스 것이다.
    const s = snapshot({
      ports: [
        portRow({ port: 8081, pid: 4100, memoryBytes: 1600 * MB }),
        portRow({ port: 8082, pid: 4100, memoryBytes: 1600 * MB })
      ],
      groups: [
        { group: 'devServer', memoryBytes: 1600 * MB, processCount: 2 },
        { group: 'agent', memoryBytes: 500 * MB, processCount: 4 },
        { group: 'heavy', memoryBytes: 0, processCount: 0 },
        { group: 'otherApps', memoryBytes: 18 * GB, processCount: 300 },
        { group: 'system', memoryBytes: 2 * GB, processCount: 0 }
      ]
    })
    expect(cardMemory(bar(s), '개발 서버')).toBe('1.6 GB')
  })

  test('에이전트 카드는 무거운 작업을 뺀 에이전트 묶음 값(메모리 카드의 "에이전트"와 같다)', () => {
    // 에이전트 행 메모리(2.6 GB)에는 그 아래에서 도는 타입 검사(2 GB)가 들어 있지만, 묶음에서는 무거운 작업 몫이다.
    const s = snapshot({
      agents: [agentRow({ memoryBytes: 2600 * MB })],
      heavyJobs: [heavyJob({ memoryBytes: 2000 * MB })],
      groups: [
        { group: 'devServer', memoryBytes: 2200 * MB, processCount: 5 },
        { group: 'agent', memoryBytes: 600 * MB, processCount: 4 },
        { group: 'heavy', memoryBytes: 2000 * MB, processCount: 3 },
        { group: 'otherApps', memoryBytes: 18 * GB, processCount: 300 },
        { group: 'system', memoryBytes: 2 * GB, processCount: 0 }
      ]
    })
    const w = bar(s)
    expect(cardMemory(w, '에이전트')).toBe('600 MB')
    expect(cardMemory(w, '무거운 작업')).toBe('2.0 GB')
  })
})
