// @vitest-environment happy-dom
import { mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import StatsBar from './StatsBar.vue'
import type { DashboardSnapshot, DiskRow, ProcessGroup } from '../../../shared/types'
import { GB, MB, agentRow, diskRow, heavyJob, serverRow, snapshot } from '../testing/fixtures'

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

test('에이전트 카드의 상태 줄: 훅이 켜져 있으면 Claude 훅, 아니고 세션 파일로 아는 에이전트가 있으면 세션 파일, 아니면 CPU 추정', () => {
  const stateLine = (s: DashboardSnapshot): string =>
    bar(s)
      .findAll('[data-slot=card]')
      .find((c) => c.find('[data-slot=card-title]').text().trim() === '에이전트')!
      .find('p[title="상태 판단"]')
      .text()
      .replace(/\s+/g, ' ')
  const hookOn = {
    state: 'on' as const,
    problem: null,
    allHooksDisabled: false,
    settingsPath: 'C:\\Users\\dev\\.claude\\settings.json'
  }
  const fromFile = agentRow({ stateSource: 'file' })
  const fromCpu = agentRow({ pid: 5001, stateSource: 'cpu' })
  expect(stateLine(snapshot({ agents: [fromFile, fromCpu], hook: hookOn }))).toBe(
    '상태 · Claude 훅'
  )
  expect(stateLine(snapshot({ agents: [fromFile, fromCpu] }))).toBe('상태 · 세션 파일')
  expect(stateLine(snapshot({ agents: [fromCpu] }))).toBe('상태 · CPU 추정')
})

test('에이전트 카드: 오래 쉬는 세션이 있으면 셋째 칸 쪽에 "오래 쉼 n", 없으면 없다', () => {
  const agentCard = (s: DashboardSnapshot): DOMWrapper<Element> =>
    bar(s)
      .findAll('[data-slot=card]')
      .find((c) => c.find('[data-slot=card-title]').text().trim() === '에이전트')!
  const parked = (pid: number): ReturnType<typeof agentRow> =>
    agentRow({ pid, state: 'idle', lastActiveAt: 0, parked: true })
  const card = agentCard(
    snapshot({
      agents: [agentRow({ pid: 1 }), parked(2), parked(3), agentRow({ pid: 4, state: 'idle' })]
    })
  )
  expect(card.find('[data-parked]').text()).toBe('오래 쉼 2')
  // 셋째 칸(쉬는 중)은 오래 쉬는 세션을 포함한 수 그대로.
  const third = card.findAll('dl > div').at(-1)!
  expect([third.find('dt').text(), third.find('dd').text()]).toEqual(['쉬는 중', '3'])
  const none = agentCard(
    snapshot({ agents: [agentRow({ pid: 1 }), agentRow({ pid: 4, state: 'idle' })] })
  )
  expect(none.find('[data-parked]').exists()).toBe(false)
  expect(none.text()).not.toContain('오래 쉼')
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

test('디스크 정리 카드: 큰 숫자는 사용 중이 아닌 행의 합, 아래 줄은 끝난 곳과 오래 안 쓴 곳', () => {
  const diskCard = (rows: DiskRow[]): DOMWrapper<Element> =>
    bar(snapshot({ disk: { rows, scannedAt: 1, scanning: false, error: null } }))
      .findAll('[data-slot=card]')
      .find((c) => c.find('[data-slot=card-title]').text().trim() === '디스크 정리')!
  const card = diskCard([
    diskRow({ totalBytes: 1 * GB }),
    diskRow({ worktreeRoot: 'C:\\work\\b', totalBytes: 1 * GB, inUse: true }),
    diskRow({ worktreeRoot: 'C:\\work\\c', evidence: 'stale', staleDays: 21, totalBytes: 2 * GB }),
    diskRow({ worktreeRoot: 'C:\\work\\d', evidence: 'stale', staleDays: 40, totalBytes: 1 * GB })
  ])
  expect(card.find('.text-2xl').text()).toBe('4.0 GB')
  expect(card.text()).toContain('끝난 워크트리 1곳 · 오래 안 쓴 2곳')
  // 오래 안 쓴 곳이 없으면 지금 문구 그대로.
  expect(diskCard([diskRow()]).text()).toContain('끝난 워크트리 1곳에서 확보 가능')
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

describe('메모리 카드: 전체 RAM 을 묶음별로 쌓은 막대(G4)', () => {
  /** 전체 100 GB 중 60 GB 사용. 묶음은 GROUP_ORDER 순서(개발 서버·에이전트·무거운 작업·다른 앱·시스템)의 GB. */
  const withGroups = (heavyGb: number, totalBytes = 100 * GB): DashboardSnapshot => {
    const base = snapshot()
    const gb: [ProcessGroup, number][] = [
      ['devServer', 12],
      ['agent', 0.4],
      ['heavy', heavyGb],
      ['otherApps', 29.6 - heavyGb],
      ['system', 18]
    ]
    return snapshot({
      memory: {
        ...base.memory,
        totalBytes,
        usedBytes: totalBytes ? 60 * GB : 0,
        availableBytes: totalBytes ? 40 * GB : 0
      },
      groups: gb.map(([group, n]) => ({
        group,
        memoryBytes: Math.round(n * GB),
        commitBytes: null,
        processCount: 1
      }))
    })
  }
  const memoryCard = (w: VueWrapper): DOMWrapper<Element> => w.findAll('[data-slot=card]')[0]
  const parts = (w: VueWrapper): DOMWrapper<Element>[] =>
    memoryCard(w).findAll('[data-memory-part]')
  /** 범례 항목마다 [이름, %]. */
  const legend = (w: VueWrapper): string[][] =>
    memoryCard(w)
      .findAll('[data-memory-legend]')
      .map((li) =>
        li
          .findAll('span')
          .map((s) => s.text())
          .filter(Boolean)
      )

  test('메모리 카드: 전체 RAM 을 묶음별로 쌓은 막대와 묶음별 %', () => {
    const w = bar(withGroups(0))
    // 0 인 묶음(무거운 작업)은 조각이 없다. 나머지(남은 메모리)는 막대 바탕 그대로.
    expect(parts(w).map((p) => p.attributes('data-memory-part'))).toEqual([
      'devServer',
      'agent',
      'otherApps',
      'system'
    ])
    const widths = parts(w).map((p) => parseFloat((p.element as HTMLElement).style.width))
    ;[12, 0.4, 29.6, 18].forEach((share, i) => expect(widths[i]).toBeCloseTo(share))
    expect(parts(w).map((p) => (p.element as HTMLElement).style.backgroundColor)).toEqual([
      'var(--chart-1)',
      'var(--chart-2)',
      'var(--chart-4)',
      'var(--status-idle)'
    ])
    expect(parts(w).map((p) => p.attributes('title'))).toEqual([
      '개발 서버 12.0 GB · 전체 RAM 의 12%',
      '에이전트 410 MB · 전체 RAM 의 0.4%',
      '다른 앱 29.6 GB · 전체 RAM 의 30%',
      '시스템·공유 메모리 18.0 GB · 전체 RAM 의 18%'
    ])
    expect(memoryCard(w).find('[data-memory-bar]').attributes('title')).toBe(
      '남은 메모리 40.0 GB · 전체 RAM 의 40%'
    )
    // 범례: 2×2, 반올림한 %, 0 보다 크고 1 보다 작으면 <1%.
    expect(legend(w)).toEqual([
      ['개발 서버', '12%'],
      ['에이전트', '<1%'],
      ['다른 앱', '30%'],
      ['시스템·공유', '18%']
    ])
    expect(memoryCard(w).find('[data-memory-legend=devServer]').attributes('title')).toBe(
      '개발 서버 12.0 GB · 전체 RAM 의 12%'
    )
  })

  test('무거운 작업은 0 보다 클 때만 범례에', () => {
    expect(legend(bar(withGroups(0))).map(([name]) => name)).not.toContain('무거운 작업')
    const w = bar(withGroups(2))
    // 막대는 묶음 순서 그대로, 범례는 2×2 자리를 지키고 다섯째로 더한다.
    expect(parts(w).map((p) => p.attributes('data-memory-part'))).toEqual([
      'devServer',
      'agent',
      'heavy',
      'otherApps',
      'system'
    ])
    expect(legend(w)).toEqual([
      ['개발 서버', '12%'],
      ['에이전트', '<1%'],
      ['다른 앱', '28%'],
      ['시스템·공유', '18%'],
      ['무거운 작업', '2%']
    ])
  })

  test('메모리를 아직 모르면 쌓은 막대가 없다', () => {
    const w = bar(withGroups(0, 0))
    expect(memoryCard(w).find('[data-memory-bar]').exists()).toBe(false)
    expect(parts(w)).toHaveLength(0)
    expect(legend(w)).toHaveLength(0)
  })
})

describe('Codex 한도(G6): 에이전트 카드의 설명 줄', () => {
  const NOW = 10 * 60 * 60_000
  type Win = { usedPercent: number; windowMinutes: number; resetsAt: number | null }
  const win = (usedPercent: number, windowMinutes: number, resetsAt: number | null): Win => ({
    usedPercent,
    windowMinutes,
    resetsAt
  })
  const limits = (
    primary: Win | null,
    secondary: Win | null,
    at = NOW - 3 * 60_000
  ): DashboardSnapshot['codexLimits'] => ({ primary, secondary, planType: 'plus', at })
  const caption = (l: DashboardSnapshot['codexLimits']): DOMWrapper<Element> => {
    const w = bar(snapshot({ takenAt: NOW, agents: [agentRow({ tool: 'codex' })], codexLimits: l }))
    return w.find('[data-codex-limits]')
  }

  test('가장 높은 창 하나를 설명 줄에, 풍선말에는 모든 창과 기준 시각', () => {
    const el = caption(limits(win(14.2, 300, NOW + 3_600_000), win(30.6, 10080, NOW + 86_400_000)))
    expect(el.text()).toBe('Codex 한도 주간 31%')
    expect(el.classes()).toContain('truncate')
    const tip = el.attributes('title')!
    expect(tip).toContain('5시간: 14% · ')
    expect(tip).toContain('주간: 31% · ')
    expect(tip).toContain('초기화')
    expect(tip.endsWith('3분 전 기준')).toBe(true)
  })

  test('비슷하면 긴 창, 5시간이 더 높으면 5시간', () => {
    expect(caption(limits(win(50, 300, null), win(50, 10080, null))).text()).toBe(
      'Codex 한도 주간 50%'
    )
    expect(caption(limits(win(100, 300, null), win(31, 10080, null))).text()).toBe(
      'Codex 한도 5시간 100%'
    )
  })

  test('한도가 없거나 모든 창이 초기화됐으면 "실행 중" 그대로', () => {
    const none = bar(snapshot({ agents: [agentRow({ tool: 'codex' })] }))
    expect(none.find('[data-codex-limits]').exists()).toBe(false)
    expect(none.text()).toContain('실행 중')
    const reset = bar(
      snapshot({
        takenAt: NOW,
        agents: [agentRow({ tool: 'codex' })],
        codexLimits: limits(win(14, 300, NOW - 1), win(31, 10080, NOW))
      })
    )
    expect(reset.find('[data-codex-limits]').exists()).toBe(false)
    expect(reset.text()).toContain('실행 중')
    expect(reset.text()).not.toContain('Codex 한도')
  })

  test('사용률이 숫자가 아닌 창은 뺀다', () => {
    expect(caption(limits(win(NaN, 300, null), win(31, 10080, null))).text()).toBe(
      'Codex 한도 주간 31%'
    )
  })

  test('읽은 때가 스냅샷보다 뒤여도 "0초 전 기준"', () => {
    const el = caption(limits(win(10, 300, null), null, NOW + 60_000))
    expect(el.attributes('title')!.endsWith('0초 전 기준')).toBe(true)
  })
})
