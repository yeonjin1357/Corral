// @vitest-environment happy-dom
import { mount, type VueWrapper } from '@vue/test-utils'
import StatsBar from './StatsBar.vue'
import type { DashboardSnapshot } from '../../../shared/types'
import { GB, MB, agentRow, heavyJob, serverRow, snapshot } from '../testing/fixtures'

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
    // 같은 서버(pid 4100)가 8081·8082 를 연다. 메모리는 그 서버 한 번.
    const s = snapshot({
      servers: [serverRow({ ports: [8081, 8082], pid: 4100, memoryBytes: 1600 * MB })],
      groups: [
        { group: 'devServer', memoryBytes: 1600 * MB, commitBytes: null, processCount: 2 },
        { group: 'agent', memoryBytes: 500 * MB, commitBytes: null, processCount: 4 },
        { group: 'heavy', memoryBytes: 0, commitBytes: null, processCount: 0 },
        { group: 'otherApps', memoryBytes: 18 * GB, commitBytes: null, processCount: 300 },
        { group: 'system', memoryBytes: 2 * GB, commitBytes: null, processCount: 0 }
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
        { group: 'devServer', memoryBytes: 2200 * MB, commitBytes: null, processCount: 5 },
        { group: 'agent', memoryBytes: 600 * MB, commitBytes: null, processCount: 4 },
        { group: 'heavy', memoryBytes: 2000 * MB, commitBytes: null, processCount: 3 },
        { group: 'otherApps', memoryBytes: 18 * GB, commitBytes: null, processCount: 300 },
        { group: 'system', memoryBytes: 2 * GB, commitBytes: null, processCount: 0 }
      ]
    })
    const w = bar(s)
    expect(cardMemory(w, '에이전트')).toBe('600 MB')
    expect(cardMemory(w, '무거운 작업')).toBe('2.0 GB')
  })
})

test('개발 서버 카드: 큰 숫자는 서버 수, 아래 줄은 포트 수', () => {
  const s = snapshot({
    servers: [
      serverRow({
        ports: [6176, 8081, 9091],
        pid: 6100,
        workspace: { root: 'C:/work/ws', name: 'ws', branch: null, outer: true }
      }),
      serverRow({ ports: [3000], pid: 4100 })
    ]
  })
  const card = bar(s)
    .findAll('[data-slot=card]')
    .find((c) => c.find('[data-slot=card-title]').text().trim() === '개발 서버')!
  expect(card.find('.text-3xl').text()).toBe('2개')
  expect(card.text()).toContain('포트 4개 · 작업 공간 1곳')
})

describe('메모리 카드: 남은 메모리와 커밋', () => {
  const memoryCard = (w: VueWrapper): string =>
    w.findAll('[data-slot=card]')[0].text().replace(/\s+/g, ' ')

  /** 메모리 카드 머리의 배지(경고·위험·커밋). */
  const badges = (w: VueWrapper): string[] =>
    w
      .findAll('[data-slot=card]')[0]
      .findAll('[data-slot=badge]')
      .map((b) => b.text())
      .filter(Boolean)

  test('메모리 카드에 남은 메모리와 커밋 사용률', () => {
    const w = bar(
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
    const card = memoryCard(w)
    expect(card).toContain('63.7 GB 중 56.8 GB 사용 · 남은 6.5 GB')
    expect(card).toContain('커밋 104.8 / 127.7 GB (82%)')
    expect(card).toContain('경고')
    // 원인이 RAM 이라 "커밋" 배지는 없다.
    expect(badges(w)).toEqual(['경고'])
  })

  test('경고 원인이 커밋이면 배지 옆에 "커밋"', () => {
    const w = bar(
      snapshot({
        memory: {
          ...snapshot().memory,
          usedPercent: 50,
          level: 'danger',
          ramLevel: 'normal',
          commit: { usedBytes: 120 * GB, limitBytes: 127.7 * GB, percent: 94, level: 'danger' }
        }
      })
    )
    expect(badges(w)).toEqual(['위험', '커밋'])
  })

  test('커밋을 모르면 커밋 줄이 없다', () => {
    const w = bar(snapshot())
    expect(memoryCard(w)).not.toContain('커밋')
  })

  test('무거운 작업이 겹친 이유는 더 높은 쪽(RAM 또는 커밋) 퍼센트로 말한다', () => {
    const base = snapshot({
      heavyJobs: [heavyJob({ pid: 1 }), heavyJob({ pid: 2 })],
      heavyOverlap: true
    })
    expect(bar(base).text()).toContain('RAM 82% 에서 겹쳐 도는 중')
    const commit = snapshot({
      heavyJobs: [heavyJob({ pid: 1 }), heavyJob({ pid: 2 })],
      heavyOverlap: true,
      memory: {
        ...base.memory,
        ramLevel: 'normal',
        level: 'danger',
        commit: { usedBytes: 120 * GB, limitBytes: 127.7 * GB, percent: 94.3, level: 'danger' }
      }
    })
    expect(bar(commit).text()).toContain('커밋 94% 에서 겹쳐 도는 중')
  })
})
