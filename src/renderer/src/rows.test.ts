import { filterRows, sortRows, tableFor, TABS } from './rows'
import {
  GB,
  MB,
  agentRow,
  diskRow,
  heavyJob,
  leftoverRow,
  serverRow,
  snapshot
} from './testing/fixtures'

const MIN = 60_000

describe('개발 서버 표', () => {
  test('포트·프로젝트·브랜치·연결·메모리를 스냅샷 값 그대로 보인다', () => {
    const t = tableFor('ports', snapshot({ takenAt: 10 * MIN, servers: [serverRow()] }))
    const row = t.rows[0]
    expect(row.key).toBe('server:4100:200')
    expect(row.cells.name.text).toBe('shop-web')
    expect(row.cells.port).toMatchObject({ text: ':3000', sort: 3000 })
    expect(row.cells.branch.text).toBe('develop')
    expect(row.cells.clients.text).toBe('1')
    expect(row.cells.memory).toMatchObject({ text: '1.2 GB', sort: 1200 * MB })
    expect(row.cells.process.text).toBe('node.exe')
  })

  test('상태: 정리 후보·확인해볼 것은 연결 없는 시간을 붙이고, 사용 중·에이전트·판별 불가를 구분한다', () => {
    const now = 60 * MIN
    const s = snapshot({
      takenAt: now,
      servers: [
        serverRow({
          ports: [1],
          judgement: 'candidate',
          clientCount: 0,
          idleSince: now - 35 * MIN
        }),
        serverRow({ ports: [2], judgement: 'check', clientCount: 1, idleSince: now - 25 * MIN }),
        serverRow({ ports: [3], clientCount: 2 }),
        serverRow({ ports: [4], clientCount: 0, agentInWorktree: true }),
        serverRow({ ports: [5], clientCount: 0, idleSince: now - 3 * MIN }),
        serverRow({ ports: [6], unresolvable: true, worktree: null, clientCount: 0 })
      ]
    })
    const status = Object.fromEntries(
      tableFor('ports', s).rows.map((r) => [r.cells.port.text, r.cells.status])
    )
    expect(status[':1']).toEqual({ text: '정리 후보 · 35분', dot: 'stopped' })
    expect(status[':2']).toEqual({ text: '확인해볼 것 · 25분', dot: 'warn' })
    expect(status[':3']).toEqual({ text: '사용 중', dot: 'running' })
    expect(status[':4']).toEqual({ text: '에이전트 작업 중', dot: 'idle' })
    expect(status[':5']).toEqual({ text: '연결 없음 · 3분', dot: 'idle' })
    expect(status[':6']).toEqual({ text: '판별 불가', dot: 'idle' })
  })

  test('한 서버의 여러 포트를 한 칸에', () => {
    const s = snapshot({ servers: [serverRow({ ports: [6176, 8081, 9091] })] })
    const row = tableFor('ports', s).rows[0]
    expect(row.cells.port).toMatchObject({ text: ':6176 · :8081 · :9091', sort: 6176 })
    expect(filterRows([row], '9091')).toHaveLength(1)
    expect(filterRows([row], ':8081')).toHaveLength(1)
  })

  test('판별 불가 서버는 내리기 버튼이 없다(누구의 서버인지 모르므로)', () => {
    const s = snapshot({
      servers: [serverRow(), serverRow({ ports: [8080], unresolvable: true, worktree: null })]
    })
    const kinds = tableFor('ports', s).rows.map((r) => r.actions.map((a) => a.kind))
    expect(kinds[0]).toEqual(['open', 'details', 'kill'])
    expect(kinds[1]).toEqual(['open', 'details'])
  })
})

describe('에이전트 표', () => {
  test('CPU 는 Windows 에서 작업 관리자처럼 전체 CPU 대비(÷ 코어 수)로 보인다', () => {
    const s = snapshot({
      platform: 'win32',
      cpuCount: 8,
      agents: [agentRow({ cpuPercent: 40 })]
    })
    expect(tableFor('agents', s).rows[0].cells.cpu).toMatchObject({ text: '5.0%', sort: 5 })
  })

  test('macOS 는 코어 1개 = 100% 그대로, 모르면 —', () => {
    const s = snapshot({
      platform: 'darwin',
      cpuCount: 8,
      agents: [agentRow({ cpuPercent: 40 }), agentRow({ pid: 2, cpuPercent: null })]
    })
    const cpu = tableFor('agents', s).rows.map((r) => r.cells.cpu.text)
    expect(cpu).toEqual(['40.0%', '—'])
  })

  test('상태 점 색과 실행 시간(스냅샷 시각 기준)', () => {
    const s = snapshot({
      takenAt: 3 * 60 * MIN + 100,
      agents: [
        agentRow({ state: 'waiting', startedAt: 100 }),
        agentRow({ pid: 2, state: 'error', startedAt: null })
      ]
    })
    const rows = tableFor('agents', s).rows
    expect(rows[0].cells.status).toEqual({ text: '권한 대기', dot: 'warn' })
    expect(rows[0].cells.runtime.text).toBe('3시간')
    expect(rows[1].cells.status).toEqual({ text: '오류', dot: 'stopped' })
    expect(rows[1].cells.runtime.text).toBe('—')
  })

  test('작업 폴더를 모르면 그렇게 보이고, 동작은 자세히만(에이전트는 끄지 않는다)', () => {
    const s = snapshot({ agents: [agentRow({ worktree: null })] })
    const row = tableFor('agents', s).rows[0]
    expect(row.cells.name.text).toBe('작업 폴더 모름')
    expect(row.actions.map((a) => a.kind)).toEqual(['details'])
  })
})

describe('남은 프로세스·무거운 작업·디스크·다른 앱 표', () => {
  test('남은 프로세스: 에이전트 워크트리 것은 회색, 나머지는 끌 수 있음', () => {
    const s = snapshot({
      leftovers: [leftoverRow(), leftoverRow({ pid: 7100, agentInWorktree: true })]
    })
    const rows = tableFor('leftovers', s).rows
    expect(rows[0].cells.status).toEqual({ text: '끌 수 있음', dot: 'warn' })
    expect(rows[1].cells.status).toEqual({ text: '에이전트 워크트리', dot: 'idle' })
    expect(rows[0].actions.map((a) => a.kind)).toEqual(['details', 'kill'])
  })

  test('무거운 작업: 끄는 버튼이 없다(경고만 한다)', () => {
    const s = snapshot({ heavyJobs: [heavyJob()] })
    const row = tableFor('heavy', s).rows[0]
    expect(row.cells.name.text).toBe('vue-tsc')
    expect(row.cells.memory.text).toBe('6.0 GB')
    expect(row.actions.map((a) => a.kind)).toEqual(['details'])
  })

  test('디스크: 사용 중이면 지우기 버튼을 막고, 재는 중이면 크기를 그렇게 보인다', () => {
    const s = snapshot({
      disk: {
        rows: [diskRow(), diskRow({ worktreeRoot: 'C:\\work\\b', inUse: true, totalBytes: null })],
        scannedAt: 1,
        scanning: false,
        error: null
      }
    })
    const rows = tableFor('disk', s).rows
    expect(rows[0].cells.name.text).toBe('old-feature')
    expect(rows[0].cells.size.text).toBe('1.5 GB')
    expect(rows[0].cells.evidence.text).toBe('원격 삭제됨')
    expect(rows[0].actions.find((a) => a.kind === 'remove')?.disabled).toBe(false)
    expect(rows[1].cells.size.text).toBe('재는 중…')
    expect(rows[1].cells.status).toEqual({ text: '사용 중', dot: 'warn' })
    expect(rows[1].actions.find((a) => a.kind === 'remove')?.disabled).toBe(true)
  })

  test('다른 앱: 고를 수 없는 행이고 프로세스 수를 센다', () => {
    const row = tableFor('apps', snapshot()).rows[0]
    expect(row.key).toBeNull()
    expect(row.cells.name).toMatchObject({ text: 'chrome', title: 'chrome.exe' })
    expect(row.cells.memory.text).toBe('5.0 GB')
    expect(row.cells.processes.text).toBe('40개')
  })

  test('모든 탭이 빈 스냅샷에서도 표를 만든다', () => {
    const empty = snapshot({ servers: [], topApps: [], disk: null })
    for (const tab of TABS) expect(tableFor(tab, empty).rows).toEqual([])
  })
})

describe('검색·정렬', () => {
  const s = snapshot({
    servers: [
      serverRow({ ports: [3000] }),
      serverRow({
        ports: [5173],
        pid: 2,
        worktree: { root: 'C:\\work\\admin', branch: 'feat/login', isLinkedWorktree: true }
      })
    ]
  })
  const rows = tableFor('ports', s).rows

  test('프로젝트·브랜치·포트(:포함)로 찾고, 대소문자를 가리지 않는다', () => {
    expect(filterRows(rows, 'ADMIN').map((r) => r.cells.port.text)).toEqual([':5173'])
    expect(filterRows(rows, 'login').map((r) => r.cells.port.text)).toEqual([':5173'])
    expect(filterRows(rows, ':3000').map((r) => r.cells.port.text)).toEqual([':3000'])
    expect(filterRows(rows, '5173').map((r) => r.cells.port.text)).toEqual([':5173'])
    expect(filterRows(rows, '  ')).toHaveLength(2)
  })

  test('숫자 칸은 숫자로, 글자 칸은 한국어 순서로 정렬한다', () => {
    const big = tableFor(
      'ports',
      snapshot({
        servers: [
          serverRow({ ports: [1], memoryBytes: 9 * MB }),
          serverRow({ ports: [2], pid: 2, memoryBytes: 2 * GB }),
          serverRow({ ports: [3], pid: 3, memoryBytes: 100 * MB })
        ]
      })
    ).rows
    expect(sortRows(big, 'memory', 'desc').map((r) => r.cells.port.text)).toEqual([
      ':2',
      ':3',
      ':1'
    ])
    expect(sortRows(big, 'port', 'asc').map((r) => r.cells.port.text)).toEqual([':1', ':2', ':3'])
  })
})

describe('행 아이콘(NeoHtop 처럼 첫 칸에 무엇이 도는지)', () => {
  test('개발 서버: 명령줄로 고른 프레임워크 로고, 실행 파일이 절대 경로면 OS 아이콘 후보도 둔다', () => {
    const s = snapshot({
      platform: 'win32',
      servers: [
        serverRow({
          commandLine:
            '"C:\\Program Files\\nodejs\\node.exe" C:\\work\\shop-web\\node_modules\\vite\\bin\\vite.js'
        })
      ]
    })
    const icon = tableFor('ports', s).rows[0].cells.name.icon
    expect(icon?.brand?.title).toBe('Vite')
    expect(icon?.exePath).toBe('C:\\Program Files\\nodejs\\node.exe')
    expect(icon?.prefer).toBe('brand')
  })

  test('에이전트: 프로젝트 칸에 도구 로고(Claude Code·Codex)를 두고, 따로 있던 도구 칸은 없앤다', () => {
    const s = snapshot({ agents: [agentRow(), agentRow({ pid: 2, tool: 'codex' })] })
    const t = tableFor('agents', s)
    expect(t.columns.map((c) => c.id)).not.toContain('tool')
    const [claude, codex] = t.rows
    expect(claude.cells.name.icon?.image).toBeTruthy()
    expect(claude.cells.name.icon?.title).toBe('Claude Code')
    expect(codex.cells.name.icon?.title).toBe('Codex')
    expect(claude.cells.name.icon?.image).not.toBe(codex.cells.name.icon?.image)
  })

  test('다른 앱: OS 앱 아이콘을 먼저, 없으면 이름으로 고른 로고', () => {
    const icon = tableFor('apps', snapshot()).rows[0].cells.name.icon
    expect(icon).toMatchObject({
      prefer: 'native',
      exePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    })
    expect(icon?.brand?.title).toBe('Google Chrome')
  })

  test('남은 프로세스·무거운 작업·디스크도 첫 칸에 아이콘이 있다', () => {
    const s = snapshot({
      leftovers: [leftoverRow({ label: 'Gradle 데몬', commandLine: 'java GradleDaemon' })],
      heavyJobs: [heavyJob()],
      disk: { rows: [diskRow()], scannedAt: 1, scanning: false, error: null }
    })
    expect(tableFor('leftovers', s).rows[0].cells.name.icon?.brand?.title).toBe('Gradle')
    expect(tableFor('heavy', s).rows[0].cells.name.icon?.brand?.title).toBe('TypeScript')
    expect(tableFor('disk', s).rows[0].cells.name.icon?.fallback).toBe('folder')
  })
})
