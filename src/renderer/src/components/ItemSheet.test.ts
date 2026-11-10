// @vitest-environment happy-dom
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach } from 'vitest'
import ItemSheet, { type Selected } from './ItemSheet.vue'
import { MB, agentRow, diskRow, heavyJob, leftoverRow, serverRow } from '../testing/fixtures'
import type {
  AgentRow,
  ClaudeHookStatus,
  CodexLimits,
  CollectMode,
  Platform
} from '../../../shared/types'

let wrapper: VueWrapper | null = null
afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

function sheet(
  item: Selected,
  hook: ClaudeHookStatus | null = null,
  platform: Platform = 'win32',
  collectMode: CollectMode | null = 'helper-dll',
  codexLimits: CodexLimits | null = null
): VueWrapper {
  wrapper = mount(ItemSheet, {
    attachTo: document.body,
    props: {
      item,
      now: 10_000_000,
      memoryHistory: [],
      windowMs: 600_000,
      busy: false,
      hook,
      platform,
      collectMode,
      cpuCount: 8,
      codexLimits,
      open: true
    }
  })
  return wrapper
}

const processRows = (): string[][] =>
  [...document.body.querySelectorAll('[data-process-row]')].map((tr) =>
    [...tr.querySelectorAll('td')].map((td) => td.textContent!.replace(/\s+/g, ' ').trim())
  )
const processTitle = (): string | undefined =>
  document.body.querySelector('[data-processes] [data-slot=card-title]')?.textContent?.trim()

describe('상세 패널: 포트별 열기', () => {
  test('포트가 여럿이면 포트마다 열기 버튼, 누른 포트를 연다', async () => {
    const w = sheet({ kind: 'server', row: serverRow({ ports: [6176, 8081] }) })
    const buttons = [...document.body.querySelectorAll<HTMLElement>('[data-action="open"]')]
    expect(buttons.map((b) => b.textContent!.trim())).toEqual([':6176', ':8081'])
    buttons[1].click()
    expect(w.emitted('open')).toEqual([[8081]])
  })

  test('포트가 하나면 "브라우저로 열기" 하나', () => {
    const w = sheet({ kind: 'server', row: serverRow({ ports: [3000] }) })
    const buttons = [...document.body.querySelectorAll<HTMLElement>('[data-action="open"]')]
    expect(buttons.map((b) => b.textContent!.trim())).toEqual(['브라우저로 열기'])
    buttons[0].click()
    expect(w.emitted('open')).toEqual([[3000]])
  })
})

describe('상세 패널: 바로 가기(G3f)', () => {
  const quickButtons = (): HTMLElement[] => [
    ...document.body.querySelectorAll<HTMLElement>('[data-quick]')
  ]

  test('워크트리를 아는 항목은 경로 복사·폴더 열기·터미널 열기, 누르면 그 폴더로', () => {
    const w = sheet({ kind: 'server', row: serverRow() })
    expect(quickButtons().map((b) => b.textContent!.trim())).toEqual([
      '경로 복사',
      '폴더 열기',
      '터미널 열기'
    ])
    for (const b of quickButtons()) b.click()
    expect(w.emitted('quick')).toEqual([
      ['copy', 'C:\\work\\shop-web'],
      ['folder', 'C:\\work\\shop-web'],
      ['terminal', 'C:\\work\\shop-web']
    ])
  })

  test('에이전트·무거운 작업·남은 프로세스·디스크 정리도 그 폴더로', () => {
    const cases: [Selected, string][] = [
      [{ kind: 'agent', row: agentRow() }, 'C:\\work\\wt-a'],
      [
        {
          kind: 'heavy',
          row: heavyJob({
            worktree: { root: 'C:\\work\\heavy', branch: 'main', isLinkedWorktree: false }
          })
        },
        'C:\\work\\heavy'
      ],
      [
        {
          kind: 'leftover',
          row: leftoverRow({
            worktree: { root: 'C:\\work\\left', branch: 'main', isLinkedWorktree: false }
          })
        },
        'C:\\work\\left'
      ],
      [{ kind: 'disk', row: diskRow() }, 'C:\\work\\old-feature']
    ]
    for (const [item, path] of cases) {
      wrapper?.unmount()
      const w = sheet(item)
      quickButtons()
        .find((b) => b.dataset.quick === 'folder')!
        .click()
      expect(w.emitted('quick')).toEqual([['folder', path]])
    }
  })

  test('폴더를 모르면(판별 불가 서버·주인 폴더를 모르는 남은 프로세스) 바로 가기가 없다', () => {
    sheet({
      kind: 'server',
      row: serverRow({ worktree: null, unresolvable: true, processName: 'wslrelay.exe' })
    })
    expect(quickButtons()).toEqual([])
    wrapper?.unmount()
    sheet({ kind: 'leftover', row: leftoverRow({ worktree: null }) })
    expect(quickButtons()).toEqual([])
  })
})

describe('상세 패널: 창으로 가기(G3f)', () => {
  /** 동작 줄의 버튼 글자(순서대로). */
  const actionRow = (): string[] => [
    ...[...document.body.querySelectorAll('[data-quick], [data-action="focus"]')].map((b) =>
      b.textContent!.trim()
    )
  ]
  const focusButton = (): HTMLElement | null =>
    document.body.querySelector<HTMLElement>('[data-action="focus"]')
  const host = { pids: [4000, 3000], app: null }

  test('에이전트는 동작 줄 맨 앞에 창으로 가기, 누르면 그 에이전트의 선택 키로', () => {
    const w = sheet({ kind: 'agent', row: agentRow({ pid: 5000, startedAt: 100, host }) })
    expect(actionRow()).toEqual(['창으로 가기', '경로 복사', '폴더 열기', '터미널 열기'])
    focusButton()!.click()
    expect(w.emitted('focus')).toEqual([['agent:5000:100']])
  })

  test('폴더를 몰라도 창으로 가기는 있다', () => {
    sheet({ kind: 'agent', row: agentRow({ worktree: null, host }) })
    expect(actionRow()).toEqual(['창으로 가기'])
  })

  test('찾아볼 조상(Windows)이나 .app(macOS)이 없으면 버튼이 없다, 에이전트가 아니면 없다', () => {
    sheet({ kind: 'agent', row: agentRow({ host: { pids: [], app: null } }) })
    expect(focusButton()).toBeNull()
    wrapper?.unmount()
    // macOS 는 조상 pid 가 있어도 .app 번들을 모르면 갈 곳이 없다.
    sheet({ kind: 'agent', row: agentRow({ host }) }, null, 'darwin')
    expect(focusButton()).toBeNull()
    wrapper?.unmount()
    const iterm = { pids: [300], app: '/Applications/iTerm.app' }
    sheet({ kind: 'agent', row: agentRow({ host: iterm }) }, null, 'darwin')
    expect(focusButton()).not.toBeNull()
    wrapper?.unmount()
    sheet({ kind: 'server', row: serverRow() })
    expect(focusButton()).toBeNull()
  })

  test('보조 코드를 못 쓰는 수집 방식에서는 창으로 가기 단추가 없다', () => {
    const agent: Selected = { kind: 'agent', row: agentRow({ host }) }
    for (const collectMode of ['basic', 'safe'] as const) {
      sheet(agent, null, 'win32', collectMode)
      expect(focusButton()).toBeNull()
      // 바로 가기는 그대로 있다.
      expect(actionRow()).toEqual(['경로 복사', '폴더 열기', '터미널 열기'])
      wrapper?.unmount()
    }
    for (const collectMode of ['helper-dll', 'helper-memory', null] as const) {
      sheet(agent, null, 'win32', collectMode)
      expect(focusButton()).not.toBeNull()
      wrapper?.unmount()
    }
  })
})

describe('상세 패널: 프로세스 목록', () => {
  test('에이전트가 띄운 프로세스를 이름·무엇인지·개수·메모리로 보인다(자기 포함 개수)', () => {
    sheet({
      kind: 'agent',
      row: agentRow({
        descendantCount: 4,
        processes: [
          {
            name: 'node.exe',
            hint: '@playwright/mcp',
            count: 2,
            memoryBytes: 310 * MB,
            commitBytes: null
          },
          { name: 'claude.exe', hint: null, count: 1, memoryBytes: 300 * MB, commitBytes: null },
          { name: 'cmd.exe', hint: null, count: 2, memoryBytes: 10 * MB, commitBytes: null }
        ]
      })
    })
    expect(processTitle()).toBe('프로세스 5개')
    expect(processRows()).toEqual([
      ['node.exe @playwright/mcp', '×2', '310 MB'],
      ['claude.exe', '×1', '300 MB'],
      ['cmd.exe', '×2', '10 MB']
    ])
  })

  test('목록이 한도로 잘렸으면 나머지 개수를 한 줄로 알린다', () => {
    sheet({
      kind: 'server',
      row: serverRow({
        descendantPids: [2, 3, 4, 5],
        processes: [
          { name: 'java.exe', hint: null, count: 2, memoryBytes: 900 * MB, commitBytes: null }
        ]
      })
    })
    expect(processTitle()).toBe('프로세스 5개')
    expect(document.body.querySelector('[data-process-rest]')!.textContent).toContain('그 밖 3개')
  })

  test('무거운 작업도 프로세스 목록을 보인다', () => {
    sheet({
      kind: 'heavy',
      row: heavyJob({
        descendantPids: [2],
        processes: [
          { name: 'node.exe', hint: 'vue-tsc', count: 1, memoryBytes: 800 * MB, commitBytes: null },
          { name: 'cmd.exe', hint: null, count: 1, memoryBytes: 5 * MB, commitBytes: null }
        ]
      })
    })
    expect(processRows().map((r) => r[0])).toEqual(['node.exe vue-tsc', 'cmd.exe'])
  })

  test('디스크 정리 항목에는 프로세스 목록이 없다', () => {
    sheet({ kind: 'disk', row: diskRow() })
    expect(document.body.querySelector('[data-processes]')).toBeNull()
  })
})

describe('상세 패널: 커밋', () => {
  const cardText = (): string => document.body.textContent!.replace(/\s+/g, ' ')

  test('서버 메모리 카드에 커밋', () => {
    sheet({ kind: 'server', row: serverRow({ commitBytes: 4.2 * 1024 * MB }) })
    expect(cardText()).toContain('커밋 4.2 GB')
  })

  test('남은 프로세스·무거운 작업·에이전트에도, 모르면 없다', () => {
    sheet({ kind: 'agent', row: agentRow({ commitBytes: 800 * MB }) })
    expect(cardText()).toContain('커밋 800 MB')
    wrapper?.unmount()
    sheet({ kind: 'heavy', row: heavyJob() })
    expect(cardText()).not.toContain('커밋')
  })
})

describe('상세 패널: 서버 판단과 에이전트(G2)', () => {
  const NOW = 10_000_000
  const HOUR = 60 * 60_000
  const badge = (): string | undefined =>
    document.body.querySelector('[data-slot=badge]')?.textContent?.trim()
  const bodyText = (): string => document.body.textContent!.replace(/\s+/g, ' ')
  const parked = { agentInWorktree: true, parkedAgent: true, parkedSince: NOW - 2 * HOUR }

  test('오래 쉬는 에이전트만 있어 확인해볼 것이면 배지에 에이전트가 쉰 기간', () => {
    sheet({
      kind: 'server',
      row: serverRow({ judgement: 'check', clientCount: 0, idleSince: NOW - HOUR, ...parked })
    })
    expect(badge()).toBe('확인해볼 것 · 에이전트가 2시간째 쉼')
  })

  test('판단 전이면 "에이전트 오래 쉼"', () => {
    sheet({
      kind: 'server',
      row: serverRow({ clientCount: 0, idleSince: NOW - 60_000, ...parked })
    })
    expect(badge()).toBe('에이전트 오래 쉼')
  })

  test('활동 중인 에이전트가 있어도 연결 카드에 연결이 없던 시간을 보인다', () => {
    sheet({
      kind: 'server',
      row: serverRow({ clientCount: 0, idleSince: NOW - 2 * HOUR, agentInWorktree: true })
    })
    expect(badge()).toBe('에이전트 작업 중')
    expect(bodyText()).toContain('지금 연결이 없어요 · 2시간')
  })
})

describe('상세 패널: 하는 일(G3b)', () => {
  const NOTE =
    '에이전트 연동이 알려 준 내용이에요. pitwall 은 이것을 메모리에만 두고 파일로 남기지 않아요. 설정 > 에이전트 연동에서 끌 수 있어요.'
  const HOOK_ON: ClaudeHookStatus = {
    state: 'on',
    problem: null,
    allHooksDisabled: false,
    settingsPath: 'C:\\Users\\dev\\.claude\\settings.json'
  }
  const bodyText = (): string => document.body.textContent!.replace(/\s+/g, ' ')
  /** 정보 카드의 칸 이름 → 값. */
  const facts = (): Record<string, string> =>
    Object.fromEntries(
      [...document.body.querySelectorAll('[data-slot=card-content] > div')].map((div) => {
        const [label, value] = [...div.querySelectorAll('p')].map((p) => p.textContent!.trim())
        return [label, value]
      })
    )

  test('제목·마지막 요청·실행 중인 도구를 정보에 보이고, 메모리에만 둔다고 알린다', () => {
    sheet(
      {
        kind: 'agent',
        row: agentRow({
          activity: {
            title: '로그인 버그',
            prompt: '로그인할 때 500 이 나요',
            tool: { name: 'Bash', summary: 'npm test', since: 10_000_000 - 3 * 60_000 },
            waiting: null
          }
        })
      },
      HOOK_ON
    )
    expect(facts()).toMatchObject({
      제목: '로그인 버그',
      '마지막 요청': '로그인할 때 500 이 나요',
      '실행 중인 도구': 'Bash · npm test · 3분'
    })
    expect(bodyText()).toContain(NOTE)
  })

  test('권한을 기다리는 도구도 보이고, 모르는 값의 줄은 숨긴다', () => {
    sheet(
      {
        kind: 'agent',
        row: agentRow({
          state: 'waiting',
          activity: {
            title: null,
            prompt: null,
            tool: null,
            waiting: { tool: 'Bash', summary: 'rm -rf dist' }
          }
        })
      },
      HOOK_ON
    )
    expect(facts()['권한을 기다리는 도구']).toBe('Bash · rm -rf dist')
    expect(Object.keys(facts())).not.toContain('제목')
    expect(Object.keys(facts())).not.toContain('마지막 요청')
    expect(Object.keys(facts())).not.toContain('실행 중인 도구')
  })

  test('권한 대기 중에는 기다리는 도구를 실행 중인 도구로 보이지 않는다', () => {
    const bash = { tool: 'Bash', summary: 'rm -rf dist' }
    sheet(
      {
        kind: 'agent',
        row: agentRow({
          state: 'waiting',
          activity: {
            title: null,
            prompt: null,
            tool: { name: 'Bash', summary: 'rm -rf dist', since: 10_000_000 - 2 * 60_000 },
            waiting: bash
          }
        })
      },
      HOOK_ON
    )
    expect(facts()['권한을 기다리는 도구']).toBe('Bash · rm -rf dist')
    expect(Object.keys(facts())).not.toContain('실행 중인 도구')
    wrapper?.unmount()
    // 병렬로 도는 다른 도구는 그대로 보인다.
    sheet(
      {
        kind: 'agent',
        row: agentRow({
          state: 'waiting',
          activity: {
            title: null,
            prompt: null,
            tool: { name: 'Grep', summary: 'TODO', since: 10_000_000 - 60_000 },
            waiting: bash
          }
        })
      },
      HOOK_ON
    )
    expect(facts()['실행 중인 도구']).toBe('Grep · TODO · 1분')
  })

  test('하는 일을 모르면(설정에서 끔 등) 줄도 설명도 없다', () => {
    sheet({ kind: 'agent', row: agentRow({ activity: null }) }, HOOK_ON)
    expect(Object.keys(facts())).not.toContain('제목')
    expect(bodyText()).not.toContain(NOTE)
  })
})

describe('상세 패널: 조용한 에이전트(G3c)', () => {
  const QUIET_NOTE =
    '작업 중인데 한동안 이벤트가 없고 CPU 도 거의 쓰지 않아요. 오래 걸리는 명령을 기다리는 중일 수도, 멈춘 것일 수도 있어요.'
  const NOW = 10_000_000
  const badge = (): string | undefined =>
    document.body.querySelector('[data-slot=badge]')?.textContent?.trim()
  const bodyText = (): string => document.body.textContent!.replace(/\s+/g, ' ')

  test('배지는 조용함 · 기간이고, 설명으로 조용함을 알린다', () => {
    sheet({
      kind: 'agent',
      row: agentRow({ stateSince: NOW - 49 * 60_000, quietSince: NOW - 18 * 60_000 })
    })
    expect(badge()).toBe('조용함 · 18분')
    expect(bodyText()).toContain(QUIET_NOTE)
  })

  test('조용하지 않으면 지금처럼 작업 중 · 기간, 설명 없음', () => {
    sheet({ kind: 'agent', row: agentRow({ stateSince: NOW - 49 * 60_000 }) })
    expect(badge()).toBe('작업 중 · 49분')
    expect(bodyText()).not.toContain(QUIET_NOTE)
  })
})

describe('상세 패널: 세션 파일로 안 에이전트', () => {
  const FILE_NOTE =
    'Claude Code 가 남기는 세션 파일로 작업 중·쉬는 중·응답 대기를 알아요. 어떤 도구가 권한을 기다리는지는 Claude 연동을 켜야 알 수 있어요.'
  const fileAgent = (): Selected => ({
    kind: 'agent',
    row: agentRow({ state: 'idle', stateSource: 'file' })
  })
  const bodyText = (): string => document.body.textContent!.replace(/\s+/g, ' ')
  const sourceText = (): string | undefined =>
    [...document.body.querySelectorAll('p')]
      .find((p) => p.textContent?.trim() === '상태 출처')
      ?.nextElementSibling?.textContent?.trim()

  test('상태 출처는 Claude 세션 파일', () => {
    sheet(fileAgent())
    expect(sourceText()).toBe('Claude 세션 파일')
  })

  test('세션 파일로 안 응답 대기는 상태 출처에 대기 이유를 덧붙인다', () => {
    sheet({
      kind: 'agent',
      row: agentRow({ state: 'waiting', stateSource: 'file', waitReason: 'input' })
    })
    expect(sourceText()).toBe('Claude 세션 파일 · 질문에 답 대기')
  })

  test('세션 파일 출처 설명은 Claude 연동이 꺼져 있을 때만', () => {
    sheet(fileAgent(), { state: 'off', problem: null, allHooksDisabled: false, settingsPath: '' })
    expect(bodyText()).toContain(FILE_NOTE)
    wrapper?.unmount()
    // 연동이 켜져 있는데 파일을 따르는 것은 그 세션의 훅 소식이 끊겼을 때다(연동을 켜라는 말은 맞지 않다).
    sheet(fileAgent(), {
      state: 'on',
      problem: null,
      allHooksDisabled: false,
      settingsPath: 'C:\\Users\\dev\\.claude\\settings.json'
    })
    expect(bodyText()).not.toContain(FILE_NOTE)
    expect(bodyText()).not.toContain('Claude 연동을 켜면')
  })
})

describe('상세 패널: 디스크 정리', () => {
  const bodyText = (): string => document.body.textContent!.replace(/\s+/g, ' ')

  test('오래 안 쓴 워크트리는 근거에 날수, 설명은 끝난 근거가 없다는 것', () => {
    sheet({ kind: 'disk', row: diskRow({ evidence: 'stale', staleDays: 21 }) })
    expect(bodyText()).toContain('오래 안 씀(21일)')
    expect(bodyText()).toContain(
      '끝났다는 근거는 없지만 21일 동안 커밋도 변경도 없었어요. 의존성 폴더만 지우고 워크트리와 소스는 그대로 둬요.'
    )
  })

  test('오래 안 쓴 워크트리의 근거 카드 제목은 목록에 올린 근거', () => {
    sheet({ kind: 'disk', row: diskRow({ evidence: 'stale', staleDays: 21 }) })
    expect(bodyText()).toContain('목록에 올린 근거')
    expect(bodyText()).not.toContain('끝났다고 본 근거')
    wrapper?.unmount()
    // 끝난 행은 그대로.
    sheet({ kind: 'disk', row: diskRow() })
    expect(bodyText()).toContain('끝났다고 본 근거')
    expect(bodyText()).not.toContain('목록에 올린 근거')
  })
})

describe('상세 패널: 토큰 카드(G6)', () => {
  const usage = (over: Partial<NonNullable<AgentRow['usage']>> = {}): AgentRow['usage'] => ({
    contextTokens: 132_000,
    contextWindow: null,
    outputTokens: 48_200,
    totalTokens: null,
    model: 'claude-opus-4',
    ...over
  })
  const card = (): HTMLElement | null =>
    [...document.body.querySelectorAll<HTMLElement>('[data-slot=card]')].find(
      (c) => c.textContent?.trim().startsWith('토큰') === true
    ) ?? null
  const flat = (el: HTMLElement | null): string =>
    el?.textContent?.replace(/\s+/g, ' ').trim() ?? ''

  test('큰 값은 컨텍스트, 보조 줄은 아는 것만 · 로 잇고, 도움말이 붙는다', () => {
    sheet({ kind: 'agent', row: agentRow({ usage: usage() }) })
    const c = card()
    expect(c).not.toBeNull()
    expect(flat(c)).toContain('132k')
    expect(flat(c)).toContain('출력 합 48.2k · claude-opus-4')
    expect(flat(c)).toContain(
      '세션 기록 파일에서 읽은 숫자예요. 출력 합에는 하위 에이전트가 쓴 것이 들어 있지 않아요.'
    )
  })

  test('한도를 알면 132k / 258k, Codex 는 전체 합이 보조 줄에', () => {
    sheet({
      kind: 'agent',
      row: agentRow({
        tool: 'codex',
        usage: usage({ contextWindow: 258_400, totalTokens: 668_000, model: null })
      })
    })
    expect(flat(card())).toContain('132k / 258k')
    expect(flat(card())).toContain('출력 합 48.2k · 전체 668k')
    expect(flat(card())).not.toContain('claude')
  })

  test('usage 가 null 이거나 모든 값이 null 이면 카드가 없다', () => {
    sheet({ kind: 'agent', row: agentRow({ usage: null }) })
    expect(card()).toBeNull()
    wrapper?.unmount()
    sheet({
      kind: 'agent',
      row: agentRow({
        usage: {
          contextTokens: null,
          contextWindow: null,
          outputTokens: null,
          totalTokens: null,
          model: null
        }
      })
    })
    expect(card()).toBeNull()
  })

  test('컨텍스트만 모르면 큰 값은 —, 보조 줄은 남은 것만', () => {
    sheet({ kind: 'agent', row: agentRow({ usage: usage({ contextTokens: null, model: null }) }) })
    expect(flat(card())).toContain('—')
    expect(flat(card())).toContain('출력 합 48.2k')
  })
})

describe('상세 패널: 사용 한도 카드(Codex, G6)', () => {
  const NOW = 10_000_000
  const limits: CodexLimits = {
    primary: { usedPercent: 14.2, windowMinutes: 300, resetsAt: NOW + 3_600_000 },
    secondary: { usedPercent: 30.6, windowMinutes: 10080, resetsAt: null },
    planType: null,
    at: NOW - 180_000
  }
  const card = (): HTMLElement | null =>
    [...document.body.querySelectorAll<HTMLElement>('[data-slot=card]')].find((c) =>
      c.textContent?.trim().startsWith('사용 한도')
    ) ?? null
  const flat = (el: HTMLElement | null): string => el?.textContent?.replace(/s+/g, ' ').trim() ?? ''

  test('Codex 행에 한도가 있으면 모든 창과 초기화 시각·기준 시각', () => {
    sheet({ kind: 'agent', row: agentRow({ tool: 'codex' }) }, null, 'win32', 'helper-dll', limits)
    expect(flat(card())).toContain('5시간 14% · 주간 31%')
    expect(flat(card())).toContain('5시간 ')
    expect(flat(card())).toContain('초기화')
    expect(flat(card())).toContain('3분 전 기준')
  })

  test('Claude 행·한도 없음·모든 창이 초기화됐으면 카드가 없다', () => {
    sheet({ kind: 'agent', row: agentRow({ tool: 'claude' }) }, null, 'win32', 'helper-dll', limits)
    expect(card()).toBeNull()
    wrapper?.unmount()
    sheet({ kind: 'agent', row: agentRow({ tool: 'codex' }) }, null, 'win32', 'helper-dll', null)
    expect(card()).toBeNull()
    wrapper?.unmount()
    const gone: CodexLimits = {
      ...limits,
      primary: { usedPercent: 5, windowMinutes: 300, resetsAt: NOW },
      secondary: null
    }
    sheet({ kind: 'agent', row: agentRow({ tool: 'codex' }) }, null, 'win32', 'helper-dll', gone)
    expect(card()).toBeNull()
  })
})

describe('상세 패널: 컨텍스트 한도가 0 이면', () => {
  test('132k / 0 이 아니라 132k', () => {
    sheet({
      kind: 'agent',
      row: agentRow({
        usage: {
          contextTokens: 132_000,
          contextWindow: 0,
          outputTokens: null,
          totalTokens: null,
          model: null
        }
      })
    })
    const t = document.body.textContent!
    expect(t).toContain('132k')
    expect(t).not.toContain('132k / 0')
  })
})
