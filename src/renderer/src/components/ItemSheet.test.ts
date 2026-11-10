// @vitest-environment happy-dom
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach } from 'vitest'
import ItemSheet, { type Selected } from './ItemSheet.vue'
import { MB, agentRow, diskRow, heavyJob, serverRow } from '../testing/fixtures'

let wrapper: VueWrapper | null = null
afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

function sheet(item: Selected): VueWrapper {
  wrapper = mount(ItemSheet, {
    attachTo: document.body,
    props: {
      item,
      now: 10_000_000,
      memoryHistory: [],
      windowMs: 600_000,
      busy: false,
      hook: null,
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

test('상세 패널: 세션 파일로 안 에이전트는 상태 출처와 그 설명을 보인다', () => {
  sheet({ kind: 'agent', row: agentRow({ state: 'idle', stateSource: 'file' }) })
  const source = [...document.body.querySelectorAll('p')].find(
    (p) => p.textContent?.trim() === '상태 출처'
  )?.nextElementSibling
  expect(source?.textContent?.trim()).toBe('Claude 세션 파일')
  expect(document.body.textContent!.replace(/\s+/g, ' ')).toContain(
    'Claude Code 가 남기는 세션 파일로 작업 중·쉬는 중을 알아요. 권한 대기는 Claude 연동을 켜야 알 수 있어요.'
  )
})
