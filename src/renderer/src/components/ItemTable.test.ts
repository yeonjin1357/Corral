// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import ItemTable from './ItemTable.vue'
import { groupServers, groupWorkspaces, tableFor } from '../rows'
import { MB, heavyJob, serverRow, snapshot, workspaceRow } from '../testing/fixtures'
import type { DashboardSnapshot } from '../../../shared/types'
import { selectionKey } from '../../../shared/keys'

function ports(memories: number[]): DashboardSnapshot {
  return snapshot({
    servers: memories.map((mb, i) =>
      serverRow({ ports: [3000 + i], pid: 100 + i, memoryBytes: mb * MB })
    )
  })
}

type TableProps = InstanceType<typeof ItemTable>['$props']

function props(s: DashboardSnapshot, sort: { id: string; dir: 'asc' | 'desc' }): TableProps {
  const table = tableFor('ports', s)
  return {
    table,
    rows: table.rows,
    selectedKey: null,
    searching: false,
    emptyText: '',
    busyKey: null,
    sort
  }
}

const order = (w: ReturnType<typeof mount>): string[] =>
  w.findAll('tbody tr[data-key]').map((tr) => tr.attributes('data-key')!)

test('사용자가 고른 정렬은 데이터가 새로 와도(새 표 객체) 그대로다', async () => {
  const w = mount(ItemTable, {
    props: props(ports([300, 100, 200]), { id: 'memory', dir: 'desc' })
  })
  expect(order(w)).toEqual(['server:100:200', 'server:102:200', 'server:101:200'])
  // 다음 스냅샷: 표·행 객체가 모두 새로 만들어지고 기본 정렬(포트 순)도 다시 실린다.
  await w.setProps(props(ports([300, 100, 250]), { id: 'memory', dir: 'desc' }))
  expect(order(w)).toEqual(['server:100:200', 'server:102:200', 'server:101:200'])
})

test('머리를 누르면 바뀐 정렬을 알린다(같은 칸이면 방향만 뒤집는다)', async () => {
  const w = mount(ItemTable, { props: props(ports([300, 100]), { id: 'memory', dir: 'desc' }) })
  const memoryHead = w.findAll('th').find((th) => th.text().includes('메모리'))!
  await memoryHead.find('button').trigger('click')
  expect(w.emitted('update:sort')?.[0]).toEqual([{ id: 'memory', dir: 'asc' }])
  const portHead = w.findAll('th').find((th) => th.text().includes('포트'))!
  await portHead.find('button').trigger('click')
  expect(w.emitted('update:sort')?.[1]).toEqual([{ id: 'port', dir: 'asc' }])
})

describe('작업 공간 묶음 보기', () => {
  const WS = { root: 'C:\\work\\ws', name: 'ws', branch: 'main', outer: true }
  const grouped = snapshot({
    servers: [
      serverRow({ pid: 1, ports: [5173], workspace: WS, memoryBytes: 100 * MB }),
      serverRow({ pid: 2, ports: [8081], workspace: WS, memoryBytes: 200 * MB }),
      serverRow({ pid: 3, ports: [3000], memoryBytes: 50 * MB })
    ]
  })
  function groupProps(collapsed: string[] = []): TableProps {
    return {
      ...props(grouped, { id: 'port', dir: 'asc' }),
      group: (rows) => groupServers(rows, grouped.servers, []),
      collapsed
    }
  }

  test('작업 공간 머리 아래 서버 줄이 들여쓰기로 오고, 혼자인 서버는 머리 없이', () => {
    const w = mount(ItemTable, { props: groupProps() })
    const heads = w.findAll('tbody tr[data-group]')
    expect(heads.map((h) => h.attributes('data-group'))).toEqual(['group:c:\\work\\ws'])
    expect(heads[0].text()).toContain('ws')
    expect(heads[0].text()).toContain('300 MB')
    expect(order(w)).toEqual(['server:3:200', 'server:1:200', 'server:2:200'])
    expect(w.find('tr[data-key="server:1:200"]').attributes('data-depth')).toBe('1')
    expect(w.find('tr[data-key="server:3:200"]').attributes('data-depth')).toBeUndefined()
  })

  test('묶음 머리를 접으면 서버 줄이 숨는다', async () => {
    const w = mount(ItemTable, { props: groupProps() })
    await w.find('tr[data-group] button[aria-expanded="true"]').trigger('click')
    expect(w.emitted('update:collapsed')?.[0]).toEqual([['group:c:\\work\\ws']])
    await w.setProps({ collapsed: ['group:c:\\work\\ws'] })
    expect(order(w)).toEqual(['server:3:200'])
    expect(w.find('tr[data-group] button[aria-expanded="false"]').exists()).toBe(true)
  })

  test('그 작업 공간을 정리하는 동안 정리 버튼을 누를 수 없다', () => {
    const w = mount(ItemTable, { props: { ...groupProps(), busyKey: 'group:C:\\work\\ws' } })
    expect(w.find('tr[data-group] [data-action="cleanup"]').attributes('disabled')).toBeDefined()
    const idle = mount(ItemTable, { props: groupProps() })
    expect(
      idle.find('tr[data-group] [data-action="cleanup"]').attributes('disabled')
    ).toBeUndefined()
  })

  test('묶음 머리의 정리 버튼은 작업 공간 정리를 부른다', async () => {
    const w = mount(ItemTable, { props: groupProps() })
    await w.find('tr[data-group] [data-action="cleanup"]').trigger('click')
    expect(w.emitted('groupAction')?.[0]).toEqual(['cleanup', 'C:\\work\\ws'])
  })

  test('이름 바꾸기: Enter 로 저장, Esc 로 취소', async () => {
    const w = mount(ItemTable, { props: groupProps(), attachTo: document.body })
    await w.find('tr[data-group] [data-action="rename"]').trigger('click')
    const input = w.find('tr[data-group] input')
    await input.setValue('  쇼핑  ')
    await input.trigger('keydown', { key: 'Enter' })
    expect(w.emitted('rename')?.[0]).toEqual(['C:\\work\\ws', '쇼핑'])
    expect(w.find('tr[data-group] input').exists()).toBe(false)
    await w.find('tr[data-group] [data-action="rename"]').trigger('click')
    await w.find('tr[data-group] input').trigger('keydown', { key: 'Escape' })
    expect(w.emitted('rename')).toHaveLength(1)
    w.unmount()
  })

  test('칸에 배지가 있으면 글자 옆에 보인다', () => {
    const s = snapshot({
      servers: [serverRow({ memoryGrowth: { fromBytes: 1, toBytes: 3 * 1024 * MB, minutes: 30 } })]
    })
    const w = mount(ItemTable, { props: props(s, { id: 'port', dir: 'asc' }) })
    expect(w.find('[data-slot="badge"]').text()).toBe('메모리 증가')
  })
})

describe('작업 공간 탭 묶음', () => {
  const WS = { root: 'C:\\work\\shop', name: 'shop', branch: 'main', outer: false }
  const server = serverRow({ pid: 1, ports: [5173], workspace: WS, memoryBytes: 300 * MB })
  const build = heavyJob({ pid: 2, workspace: WS })
  const lone = serverRow({ pid: 3, ports: [3000], memoryBytes: 100 * MB })
  const s = snapshot({
    servers: [server, lone],
    heavyJobs: [build],
    workspaces: [
      workspaceRow({
        key: 'ws:c:\\work\\shop',
        root: 'C:\\work\\shop',
        name: 'shop',
        memoryBytes: 7 * 1024 * MB,
        serverKeys: [selectionKey.server(server)],
        heavyKeys: [selectionKey.heavy(build)],
        changedFiles: 4
      }),
      workspaceRow({
        key: 'ws:?',
        root: null,
        name: '작업 폴더 모름',
        memoryBytes: 100 * MB,
        serverKeys: [selectionKey.server(lone)]
      })
    ]
  })
  function wsProps(): TableProps {
    const table = tableFor('workspaces', s)
    return {
      table,
      rows: table.rows,
      selectedKey: null,
      searching: false,
      emptyText: '',
      busyKey: null,
      sort: table.sort,
      group: (rows) => groupWorkspaces(rows, s, s.takenAt)
    }
  }

  test('머리에 구성원 수·요약·작업 공간 합계, 요약은 상태 칸에서 빈 포트·CPU 칸까지 쓴다', () => {
    const w = mount(ItemTable, { props: wsProps() })
    const heads = w.findAll('tbody tr[data-group]')
    expect(heads.map((h) => h.attributes('data-group'))).toEqual(['ws:c:\\work\\shop', 'ws:?'])
    const shop = heads[0]
    expect(shop.find('[data-slot="badge"]').text()).toBe('2')
    expect(shop.find('[data-slot="badge"]').attributes('title')).toBe('항목 2개')
    expect(shop.text()).toContain('서버 1 · 무거운 작업 1 · 변경 4')
    expect(shop.text()).toContain('7.0 GB')
    // 상태(170) + 포트 + CPU 를 한 칸으로: 머리 줄의 칸 수는 표의 칸 수보다 둘 적다.
    const status = shop.find('td[colspan="3"]')
    expect(status.exists()).toBe(true)
    expect(status.find('[title]').attributes('title')).toBe(
      '사용 중 1 · 서버 1 · 무거운 작업 1 · 변경 4'
    )
    // 구성원은 머리 아래 들여쓰기로(메모리 큰 순).
    expect(order(w)).toEqual([
      selectionKey.heavy(build),
      selectionKey.server(server),
      selectionKey.server(lone)
    ])
  })

  test('머리 동작: 이름 바꾸기·폴더 열기·정리, 작업 폴더 모름은 동작이 없다', async () => {
    const w = mount(ItemTable, { props: wsProps() })
    const shop = w.find('tr[data-group="ws:c:\\\\work\\\\shop"]')
    expect(shop.findAll('[data-action]').map((b) => b.attributes('data-action'))).toEqual([
      'rename',
      'folder',
      'cleanup'
    ])
    await shop.find('[data-action="folder"]').trigger('click')
    await shop.find('[data-action="cleanup"]').trigger('click')
    expect(w.emitted('groupAction')).toEqual([
      ['folder', 'C:\\work\\shop'],
      ['cleanup', 'C:\\work\\shop']
    ])
    expect(w.find('tr[data-group="ws:?"]').findAll('[data-action]')).toHaveLength(0)
  })
})

test('오래 쉬는 에이전트 서버의 상태 칸은 짧은 문구, 쉰 기간은 title 에', () => {
  const now = 300 * 60_000
  const s = snapshot({
    takenAt: now,
    servers: [
      serverRow({
        judgement: 'check',
        clientCount: 0,
        idleSince: now - 25 * 60_000,
        agentInWorktree: true,
        parkedAgent: true,
        parkedSince: now - 192 * 60_000
      })
    ]
  })
  const w = mount(ItemTable, { props: props(s, { id: 'port', dir: 'asc' }) })
  const cell = w.find('span[title="확인해볼 것 · 에이전트가 3시간 12분째 쉼"]')
  expect(cell.find('.truncate').text()).toBe('확인해볼 것 · 에이전트 쉼')
})

test('첫 칸은 이름 칸이 아니어도 왼쪽 여백을 갖는다', () => {
  const w = mount(ItemTable, {
    props: {
      table: {
        columns: [
          { id: 'time', label: '시각', width: 150 },
          { id: 'kind', label: '종류', width: 150 }
        ],
        rows: [
          {
            key: null,
            id: 'event:1',
            cells: { time: { text: '오전 9:10' }, kind: { text: '시작' } },
            actions: [],
            search: ''
          }
        ],
        sort: { id: 'time', dir: 'desc' }
      },
      rows: [
        {
          key: null,
          id: 'event:1',
          cells: { time: { text: '오전 9:10' }, kind: { text: '시작' } },
          actions: [],
          search: ''
        }
      ],
      selectedKey: null,
      searching: false,
      emptyText: '',
      busyKey: null,
      sort: { id: 'time', dir: 'desc' }
    } as TableProps
  })
  const heads = w.findAll('thead th')
  expect(heads[0].classes()).toContain('pl-4')
  expect(heads[1].classes()).not.toContain('pl-4')
  const cells = w.findAll('tbody tr td')
  expect(cells[0].classes()).toContain('pl-4')
  expect(cells[1].classes()).not.toContain('pl-4')
})
