// @vitest-environment happy-dom
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach } from 'vitest'
import ItemSheet, { type Selected } from './ItemSheet.vue'
import { MB, agentRow, diskRow, heavyJob, serverRow } from '../testing/fixtures'
import type { ClaudeHookStatus } from '../../../shared/types'

let wrapper: VueWrapper | null = null
afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

function sheet(item: Selected, hook: ClaudeHookStatus | null = null): VueWrapper {
  wrapper = mount(ItemSheet, {
    attachTo: document.body,
    props: {
      item,
      now: 10_000_000,
      memoryHistory: [],
      windowMs: 600_000,
      busy: false,
      hook,
      platform: 'win32',
      cpuCount: 8,
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

  test('하는 일을 모르면(설정에서 끔 등) 줄도 설명도 없다', () => {
    sheet({ kind: 'agent', row: agentRow({ activity: null }) }, HOOK_ON)
    expect(Object.keys(facts())).not.toContain('제목')
    expect(bodyText()).not.toContain(NOTE)
  })
})

describe('상세 패널: 세션 파일로 안 에이전트', () => {
  const FILE_NOTE =
    'Claude Code 가 남기는 세션 파일로 작업 중·쉬는 중을 알아요. 권한 대기는 Claude 연동을 켜야 알 수 있어요.'
  const fileAgent = (): Selected => ({
    kind: 'agent',
    row: agentRow({ state: 'idle', stateSource: 'file' })
  })
  const bodyText = (): string => document.body.textContent!.replace(/\s+/g, ' ')

  test('상태 출처는 Claude 세션 파일', () => {
    sheet(fileAgent())
    const source = [...document.body.querySelectorAll('p')].find(
      (p) => p.textContent?.trim() === '상태 출처'
    )?.nextElementSibling
    expect(source?.textContent?.trim()).toBe('Claude 세션 파일')
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
