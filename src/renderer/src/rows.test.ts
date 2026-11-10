import {
  filterRows,
  groupServers,
  groupWorkspaces,
  hiddenServerTable,
  otherPortsTable,
  sortRows,
  tableFor,
  TABS,
  type SnapshotTab,
  workspaceSummary,
  workspaceTable
} from './rows'
import { selectionKey } from '../../shared/keys'
import {
  GB,
  MB,
  agentRow,
  diskRow,
  heavyJob,
  leftoverRow,
  otherPort,
  serverRow,
  snapshot,
  workspaceRow
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

  test('오래 쉬는 에이전트만 있는 서버: 확인해볼 것이면 짧은 문구(쉰 기간은 title), 판단 전이면 "에이전트 오래 쉼"', () => {
    const now = 300 * MIN
    const parked = { agentInWorktree: true, parkedAgent: true, parkedSince: now - 192 * MIN }
    const s = snapshot({
      takenAt: now,
      servers: [
        serverRow({
          ports: [1],
          judgement: 'check',
          clientCount: 0,
          idleSince: now - 25 * MIN,
          ...parked
        }),
        serverRow({ ports: [2], clientCount: 0, idleSince: now - 5 * MIN, ...parked }),
        // 탭이 열려 있으면 판단 전에는 지금처럼 사용 중.
        serverRow({ ports: [3], clientCount: 1, idleSince: now - 5 * MIN, ...parked })
      ]
    })
    const status = Object.fromEntries(
      tableFor('ports', s).rows.map((r) => [r.cells.port.text, r.cells.status])
    )
    // 160px 칸에서 기간이 잘리지 않게 칸에는 짧게, 쉰 기간은 title 에.
    expect(status[':1']).toEqual({
      text: '확인해볼 것 · 에이전트 쉼',
      title: '확인해볼 것 · 에이전트가 3시간 12분째 쉼',
      dot: 'warn'
    })
    expect(status[':2']).toEqual({ text: '에이전트 오래 쉼', dot: 'idle' })
    expect(status[':3']).toEqual({ text: '사용 중', dot: 'running' })
  })

  test('오래 쉬는 에이전트 서버의 메모리 증가 title 은 쉰 기간 문구에 이어 붙인다', () => {
    const now = 300 * MIN
    const s = snapshot({
      takenAt: now,
      servers: [
        serverRow({
          judgement: 'check',
          clientCount: 0,
          idleSince: now - 25 * MIN,
          agentInWorktree: true,
          parkedAgent: true,
          parkedSince: now - 120 * MIN,
          memoryGrowth: { fromBytes: 2 * GB, toBytes: 3.6 * GB, minutes: 30 }
        })
      ]
    })
    expect(tableFor('ports', s).rows[0].cells.status).toMatchObject({
      text: '확인해볼 것 · 에이전트 쉼',
      badge: '메모리 증가',
      title: '확인해볼 것 · 에이전트가 2시간째 쉼 · 30분 동안 2.0 GB → 3.6 GB'
    })
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

  test('오래 쉬는 에이전트의 상태 칸은 오래 쉼 · 기간', () => {
    const now = 5 * 60 * MIN
    const s = snapshot({
      takenAt: now,
      agents: [
        // 기간은 상태 시작이 아니라 마지막 활동부터. 130px 칸이라 배지 없이 글자로만.
        agentRow({
          state: 'idle',
          stateSince: now - 3 * 60 * MIN,
          lastActiveAt: now - 3 * 60 * MIN - 12 * MIN,
          parked: true
        }),
        agentRow({ pid: 2, state: 'unknown', lastActiveAt: now - 4 * 60 * MIN, parked: true }),
        // 오류는 오류 · 기간 그대로(배지 없음).
        agentRow({
          pid: 3,
          state: 'error',
          stateSince: now - 10 * MIN,
          lastActiveAt: now - 4 * 60 * MIN,
          parked: true
        }),
        agentRow({ pid: 4, state: 'idle', stateSince: now - 10 * MIN })
      ]
    })
    const rows = tableFor('agents', s).rows
    expect(rows[0].cells.status).toEqual({
      text: '오래 쉼 · 3시간 12분',
      title: '마지막 활동 3시간 12분 전',
      dot: 'idle'
    })
    expect(rows[1].cells.status).toEqual({
      text: '오래 쉼 · 4시간',
      title: '마지막 활동 4시간 전',
      dot: 'idle'
    })
    expect(rows[2].cells.status).toEqual({
      text: '오류 · 10분',
      title: '마지막 활동 4시간 전',
      dot: 'stopped'
    })
    expect(rows[3].cells.status).toEqual({ text: '쉬는 중 · 10분', dot: 'idle' })
    expect(rows.map((r) => r.cells.status.badge)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined
    ])
    // 에이전트는 끄지 않는다.
    expect(rows[0].actions.map((a) => a.kind)).toEqual(['details'])
  })

  test('조용한 에이전트의 상태 칸은 조용함 · 기간(주황 점)', () => {
    const now = 5 * 60 * MIN
    const working = { state: 'working' as const, stateSince: now - 49 * MIN, cpuPercent: 0.4 }
    const s = snapshot({
      takenAt: now,
      agents: [
        // 기간은 작업 시작이 아니라 조용해진 때부터. 130px 칸이라 배지 없이 글자로만.
        agentRow({
          ...working,
          lastActiveAt: now - 18 * MIN,
          quietSince: now - 18 * MIN,
          activity: {
            title: '로그인 버그',
            prompt: null,
            tool: { name: 'Bash', summary: 'npm run e2e', since: now - 18 * MIN },
            waiting: null
          }
        }),
        // 실행 중인 도구를 모르면 앞머리 없이.
        agentRow({ ...working, pid: 2, quietSince: now - 16 * MIN - 30_000 }),
        agentRow({ ...working, pid: 3 })
      ]
    })
    const rows = tableFor('agents', s).rows
    expect(rows[0].cells.status).toEqual({
      text: '조용함 · 18분',
      title: 'Bash 실행 중 · 18분째 이벤트가 없고 CPU 를 거의 쓰지 않아요',
      dot: 'warn'
    })
    expect(rows[1].cells.status).toEqual({
      text: '조용함 · 16분',
      title: '16분째 이벤트가 없고 CPU 를 거의 쓰지 않아요',
      dot: 'warn'
    })
    expect(rows[2].cells.status).toEqual({ text: '작업 중 · 49분', dot: 'running' })
  })

  test('칸: 이름·브랜치·상태·하는 일·CPU·메모리·커밋·실행 시간', () => {
    const t = tableFor('agents', snapshot({ agents: [agentRow({ commitBytes: GB })] }))
    expect(t.columns.map((col) => [col.id, col.label, col.width])).toEqual([
      ['name', '프로젝트', 200],
      ['branch', '브랜치', 150],
      ['status', '상태', 130],
      ['activity', '하는 일', 200],
      ['cpu', 'CPU', 64],
      ['memory', '메모리', 88],
      ['commit', '커밋', 88],
      ['runtime', '실행 시간', 90]
    ])
  })

  test('하는 일 칸: 권한 대기 > 실행 중인 도구 > 제목 > 프롬프트', () => {
    const tool = { name: 'Bash', summary: 'npm run build', since: 0 }
    const s = snapshot({
      agents: [
        agentRow({
          pid: 1,
          activity: {
            title: '로그인 버그',
            prompt: '고쳐 줘',
            tool,
            waiting: { tool: 'Bash', summary: 'rm -rf dist' }
          }
        }),
        agentRow({
          pid: 2,
          activity: { title: '로그인 버그', prompt: '고쳐 줘', tool, waiting: null }
        }),
        agentRow({
          pid: 3,
          activity: { title: '로그인 버그', prompt: '고쳐 줘', tool: null, waiting: null }
        }),
        agentRow({
          pid: 4,
          activity: { title: null, prompt: '고쳐 줘', tool: null, waiting: null }
        }),
        agentRow({ pid: 5, activity: null }),
        // 요약을 모르는 도구는 이름만.
        agentRow({
          pid: 6,
          activity: {
            title: null,
            prompt: null,
            tool: { name: 'TodoWrite', summary: null, since: 0 },
            waiting: null
          }
        }),
        agentRow({
          pid: 7,
          activity: {
            title: null,
            prompt: null,
            tool: null,
            waiting: { tool: 'WebFetch', summary: null }
          }
        })
      ]
    })
    const rows = tableFor('agents', s).rows
    expect(rows.map((r) => r.cells.activity.text)).toEqual([
      '권한: Bash · rm -rf dist',
      'Bash · npm run build',
      '로그인 버그',
      '고쳐 줘',
      '—',
      'TodoWrite',
      '권한: WebFetch'
    ])
    // 칸이 좁아 잘리므로 전체 글은 title 에. 모르면 흐리게.
    expect(rows[0].cells.activity.title).toBe('권한: Bash · rm -rf dist')
    expect(rows[4].cells.activity).toMatchObject({ text: '—', muted: true })
    // 검색은 제목으로도 찾는다(프롬프트·명령은 검색하지 않는다).
    expect(filterRows(rows, '로그인').map((r) => r.key)).toEqual(
      [rows[0], rows[1], rows[2]].map((r) => r.key)
    )
    expect(filterRows(rows, 'rm -rf')).toEqual([])
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

  test('디스크: 오래 안 쓴 워크트리는 근거에 날수, 상태는 확인해볼 것(사용 중이면 사용 중)', () => {
    const s = snapshot({
      disk: {
        rows: [
          diskRow(),
          diskRow({ worktreeRoot: 'C:\\work\\b', evidence: 'stale', staleDays: 21 }),
          diskRow({ worktreeRoot: 'C:\\work\\c', evidence: 'stale', staleDays: 30, inUse: true })
        ],
        scannedAt: 1,
        scanning: false,
        error: null
      }
    })
    const rows = tableFor('disk', s).rows
    expect(rows[0].cells.status).toEqual({ text: '지울 수 있음', dot: 'running' })
    expect(rows[1].cells.evidence.text).toBe('오래 안 씀(21일)')
    expect(rows[1].cells.status).toEqual({ text: '확인해볼 것', dot: 'warn' })
    expect(rows[1].actions.find((a) => a.kind === 'remove')?.disabled).toBe(false)
    expect(rows[2].cells.evidence.text).toBe('오래 안 씀(30일)')
    expect(rows[2].cells.status).toEqual({ text: '사용 중', dot: 'warn' })
  })

  test('다른 앱: 고를 수 없는 행이고 프로세스 수를 센다', () => {
    const row = tableFor('apps', snapshot()).rows[0]
    expect(row.key).toBeNull()
    expect(row.cells.name).toMatchObject({ text: 'chrome', title: 'chrome.exe' })
    expect(row.cells.memory.text).toBe('5.0 GB')
    expect(row.cells.processes.text).toBe('40개')
  })

  test('다른 앱 이름은 node (Cursor)', () => {
    const CURSOR = 'C:\\Users\\dev\\AppData\\Local\\Programs\\cursor\\Cursor.exe'
    const t = tableFor(
      'apps',
      snapshot({
        apps: [
          {
            name: 'node.exe',
            owner: 'Cursor.exe',
            memoryBytes: 2 * GB,
            commitBytes: null,
            processCount: 13,
            exePath: CURSOR
          },
          {
            name: 'node.exe',
            owner: null,
            memoryBytes: 1 * GB,
            commitBytes: null,
            processCount: 2,
            exePath: null
          }
        ]
      })
    )
    const [cursor, plain] = t.rows
    expect(cursor.cells.name).toMatchObject({
      text: 'node (Cursor)',
      title: 'node.exe — Cursor.exe'
    })
    expect(plain.cells.name).toMatchObject({ text: 'node', title: 'node.exe' })
    // 이름이 같아도 띄운 앱이 다르면 다른 행이다.
    expect(cursor.id).not.toBe(plain.id)
    // 아이콘은 띄운 앱의 것(메인이 띄운 앱의 실행 파일을 담는다).
    expect(cursor.cells.name.icon).toMatchObject({ exePath: CURSOR, prefer: 'native' })
    expect(filterRows(t.rows, 'cursor')).toEqual([cursor])
  })

  test('다른 앱: 상위 몇 개로 자르지 않고 전부 보인다', () => {
    const apps = Array.from({ length: 7 }, (_, i) => ({
      name: `app${i}.exe`,
      owner: null,
      memoryBytes: (7 - i) * MB,
      commitBytes: null,
      processCount: 1,
      exePath: null
    }))
    expect(tableFor('apps', snapshot({ apps })).rows).toHaveLength(7)
  })

  test('모든 탭이 빈 스냅샷에서도 표를 만든다', () => {
    const empty = snapshot({ servers: [], apps: [], disk: null })
    for (const tab of TABS.filter((t): t is SnapshotTab => t !== 'events'))
      expect(tableFor(tab, empty).rows).toEqual([])
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

describe('작업 공간 묶음(F1)', () => {
  const MINUTE = 60_000
  const WS = { root: 'C:\\work\\ws', name: 'ws', branch: 'main', outer: true }
  const SOLO = { root: 'C:\\work\\shop-web', name: 'shop-web', branch: 'develop', outer: false }
  const front = serverRow({
    pid: 1,
    ports: [5173],
    memoryBytes: 300 * MB,
    clientCount: 1,
    worktree: { root: 'C:\\work\\ws\\repos\\front', branch: 'main', isLinkedWorktree: false },
    workspace: WS
  })
  const api = serverRow({
    pid: 2,
    ports: [6176, 8081, 9091],
    memoryBytes: 2 * GB,
    clientCount: 0,
    judgement: 'candidate',
    idleSince: 0,
    worktree: { root: 'C:\\work\\ws\\repos\\api', branch: 'main', isLinkedWorktree: false },
    workspace: WS
  })
  const solo = serverRow({ pid: 3, ports: [3000], memoryBytes: 900 * MB, workspace: SOLO })
  const claude = agentRow({
    worktree: { root: 'C:\\work\\ws', branch: 'main', isLinkedWorktree: false },
    workspace: WS,
    state: 'working',
    stateSince: 0
  })
  const s = snapshot({ takenAt: 12 * MINUTE, servers: [solo, front, api], agents: [claude] })
  const rows = sortRows(tableFor('ports', s).rows, 'port', 'asc')

  test('작업 공간별로 묶고 머리에 서버 수·메모리 합·에이전트·상태 요약', () => {
    const groups = groupServers(rows, s.servers, s.agents)
    expect(groups.map((g) => [g.group?.name ?? null, g.rows.map((r) => r.key)])).toEqual([
      [null, ['server:3:200']],
      ['ws', ['server:1:200', 'server:2:200']]
    ])
    const ws = groups[1].group!
    expect(ws).toMatchObject({
      key: 'group:c:\\work\\ws',
      root: 'C:\\work\\ws',
      count: 2,
      memoryBytes: 300 * MB + 2 * GB,
      actions: ['rename', 'cleanup']
    })
    // 개발 서버 탭의 머리는 서버만 보인다(작업 공간 탭의 요약은 없다).
    expect(ws.summary).toBeUndefined()
    expect(ws.agentBadges.map((b) => b.key)).toEqual([selectionKey.agent(claude)])
    expect(ws.status).toEqual({ text: '정리 후보 1 · 사용 중 1', dot: 'stopped' })
  })

  test('검색으로 일부만 보여도 머리의 수치는 작업 공간 전체(정리 버튼이 끄는 범위)', () => {
    const filtered = rows.filter((r) => r.key === 'server:1:200')
    const groups = groupServers(filtered, s.servers, s.agents)
    const ws = groups.find((g) => g.group)?.group
    expect(ws).toMatchObject({ count: 2, memoryBytes: 300 * MB + 2 * GB })
    expect(ws!.status).toEqual({ text: '정리 후보 1 · 사용 중 1', dot: 'stopped' })
    expect(groups.find((g) => g.group)!.rows.map((r) => r.key)).toEqual(['server:1:200'])
  })

  test('혼자인 작업 공간은 머리 없이, 작업 공간을 모르는 서버(판별 불가)도 머리 없이', () => {
    const unknown = serverRow({
      pid: 4,
      ports: [8080],
      workspace: null,
      worktree: null,
      unresolvable: true
    })
    const t = snapshot({ servers: [solo, unknown] })
    const groups = groupServers(tableFor('ports', t).rows, t.servers, [])
    expect(groups.every((g) => g.group === null)).toBe(true)
    expect(groups.map((g) => g.rows.length)).toEqual([1, 1])
  })

  test('묶음 순서는 정렬된 줄에서 처음 나온 순서(정렬을 따른다)', () => {
    const byMemory = sortRows(tableFor('ports', s).rows, 'memory', 'desc')
    const groups = groupServers(byMemory, s.servers, s.agents)
    expect(groups.map((g) => g.group?.name ?? null)).toEqual(['ws', null])
    expect(groups[0].rows.map((r) => r.key)).toEqual(['server:2:200', 'server:1:200'])
  })
})

describe('작업 공간 탭(G4)', () => {
  const now = 10 * 60 * MIN
  const SHOP = { root: 'C:\\work\\shop', name: 'shop', branch: 'main', outer: true }
  const front = serverRow({
    pid: 1,
    ports: [5173],
    memoryBytes: 300 * MB,
    worktree: { root: 'C:\\work\\shop\\front', branch: 'main', isLinkedWorktree: false },
    workspace: SHOP
  })
  const api = serverRow({
    pid: 2,
    ports: [8081],
    memoryBytes: 900 * MB,
    cpuPercent: 40,
    worktree: { root: 'C:\\work\\shop\\api', branch: 'feat/api', isLinkedWorktree: false },
    workspace: SHOP
  })
  const claude = agentRow({
    pid: 10,
    worktree: { root: 'C:\\work\\shop', branch: 'main', isLinkedWorktree: false },
    workspace: SHOP,
    state: 'working',
    stateSince: now - 12 * MIN
  })
  const build = heavyJob({ pid: 20, memoryBytes: 2 * GB, workspace: SHOP })
  const gradle = leftoverRow({
    pid: 30,
    label: 'Gradle 데몬',
    memoryBytes: 500 * MB,
    workspace: SHOP
  })
  const lone = serverRow({ pid: 3, ports: [3000], memoryBytes: 100 * MB })
  const shop = workspaceRow({
    key: 'ws:c:\\work\\shop',
    root: 'C:\\work\\shop',
    name: 'shop',
    outer: true,
    // 행 값의 합이 아니라 메인이 pid 마다 한 번 센 값.
    memoryBytes: 3 * GB,
    commitBytes: 4 * GB,
    processCount: 9,
    agentKeys: [selectionKey.agent(claude)],
    serverKeys: [selectionKey.server(front), selectionKey.server(api)],
    heavyKeys: [selectionKey.heavy(build)],
    leftoverKeys: [selectionKey.leftover(gradle)],
    changedFiles: 12,
    lastActiveAt: now - 3 * 60 * MIN
  })
  const unknown = workspaceRow({
    key: 'ws:?',
    root: null,
    name: '작업 폴더 모름',
    memoryBytes: 100 * MB,
    processCount: 1,
    serverKeys: [selectionKey.server(lone)]
  })
  const s = snapshot({
    takenAt: now,
    servers: [front, api, lone],
    agents: [claude],
    heavyJobs: [build],
    leftovers: [gradle],
    workspaces: [shop, unknown]
  })

  test('작업 공간 표: 에이전트·서버·무거운 작업·남은 프로세스가 한 표에, 머리의 합은 스냅샷의 workspaces 값', () => {
    const t = workspaceTable(s)
    expect(tableFor('workspaces', s)).toEqual(t)
    // 커밋을 아는 행이 없으면 커밋 칸은 뺀다(다른 탭과 같은 규칙).
    expect(t.columns.map((col) => [col.id, col.label, col.width])).toEqual([
      ['name', '이름', 220],
      ['kind', '종류', 100],
      ['status', '상태', 170],
      ['port', '포트', 124],
      ['cpu', 'CPU', 64],
      ['memory', '메모리', 88]
    ])
    expect(t.sort).toEqual({ id: 'memory', dir: 'desc' })

    const row = (key: string): (typeof t.rows)[number] => t.rows.find((r) => r.key === key)!
    const own = (tab: SnapshotTab, key: string): (typeof t.rows)[number] =>
      tableFor(tab, s).rows.find((r) => r.key === key)!
    const cases: [SnapshotTab, string, string, string][] = [
      ['ports', selectionKey.server(api), 'api', '서버'],
      ['agents', selectionKey.agent(claude), 'shop', '에이전트'],
      ['heavy', selectionKey.heavy(build), 'vue-tsc', '무거운 작업'],
      ['leftovers', selectionKey.leftover(gradle), 'Gradle 데몬', '남은 프로세스']
    ]
    for (const [tab, key, name, kind] of cases) {
      const r = row(key)
      expect(r.cells.name.text, key).toBe(name)
      expect(r.cells.name.icon, key).toEqual(own(tab, key).cells.name.icon)
      expect(r.cells.kind.text, key).toBe(kind)
      // 상태 문구·동작은 각 탭과 같다(상태 칸이 없는 무거운 작업은 —).
      expect(r.cells.status, key).toEqual(
        own(tab, key).cells.status ?? { text: '—', sort: -1, muted: true }
      )
      expect(r.actions, key).toEqual(own(tab, key).actions)
    }
    expect(row(selectionKey.server(api)).cells.port).toMatchObject({ text: ':8081', sort: 8081 })
    expect(row(selectionKey.server(api)).cells.cpu).toMatchObject({ text: '5.0%', sort: 5 })
    expect(row(selectionKey.agent(claude)).cells.status.text).toBe('작업 중 · 12분')
    expect(row(selectionKey.heavy(build)).cells.port.text).toBe('—')
    expect(row(selectionKey.leftover(gradle)).cells.memory.text).toBe('500 MB')

    const groups = groupWorkspaces(sortRows(t.rows, 'memory', 'desc'), s, now)
    expect(groups.map((g) => [g.group?.key, g.rows.map((r) => r.key)])).toEqual([
      [
        'ws:c:\\work\\shop',
        [
          selectionKey.heavy(build),
          selectionKey.server(api),
          selectionKey.agent(claude),
          selectionKey.leftover(gradle),
          selectionKey.server(front)
        ]
      ],
      ['ws:?', [selectionKey.server(lone)]]
    ])
    expect(groups[0].group).toMatchObject({
      root: 'C:\\work\\shop',
      name: 'shop',
      outer: true,
      count: 5,
      memoryBytes: 3 * GB,
      commitBytes: 4 * GB,
      status: { text: '작업 중', dot: 'running' },
      summary: '서버 2 · 무거운 작업 1 · 남은 프로세스 1 · 변경 12',
      actions: ['rename', 'folder', 'cleanup']
    })
    expect(groups[0].group!.agentBadges.map((b) => [b.key, b.title])).toEqual([
      [selectionKey.agent(claude), 'Claude Code · 작업 중 · 12분']
    ])
    // 작업 공간을 모르는 줄은 이름을 바꾸거나 정리하거나 열 수 없다.
    expect(groups[1].group).toMatchObject({
      root: null,
      name: '작업 폴더 모름',
      count: 1,
      memoryBytes: 100 * MB,
      actions: []
    })
  })

  test('묶음 순서는 스냅샷 순서이고, 정렬은 묶음 안 줄만 바꾼다', () => {
    const groups = groupWorkspaces(sortRows(workspaceTable(s).rows, 'memory', 'asc'), s, now)
    expect(groups.map((g) => g.group?.key)).toEqual(['ws:c:\\work\\shop', 'ws:?'])
    expect(groups[0].rows.map((r) => r.key)[0]).toBe(selectionKey.server(front))
  })

  test('검색에 맞는 구성원이 없는 작업 공간은 보이지 않고, 머리의 수치는 작업 공간 전체', () => {
    const rows = workspaceTable(s).rows
    // 종류 이름·브랜치·포트로도 찾는다.
    expect(filterRows(rows, '남은 프로세스').map((r) => r.key)).toEqual([
      selectionKey.leftover(gradle)
    ])
    expect(filterRows(rows, 'feat/api').map((r) => r.key)).toEqual([selectionKey.server(api)])
    const groups = groupWorkspaces(filterRows(rows, ':3000'), s, now)
    expect(groups.map((g) => [g.group?.key, g.rows.length])).toEqual([['ws:?', 1]])
    const shopOnly = groupWorkspaces(filterRows(rows, 'gradle'), s, now)
    expect(shopOnly.map((g) => g.group?.key)).toEqual(['ws:c:\\work\\shop'])
    expect(shopOnly[0].group).toMatchObject({ count: 5, memoryBytes: 3 * GB })
  })

  test('스냅샷에 없는 구성원은 건너뛴다', () => {
    const stale = snapshot({
      takenAt: now,
      servers: [front],
      workspaces: [
        workspaceRow({
          key: 'ws:c:\\work\\shop',
          root: 'C:\\work\\shop',
          name: 'shop',
          serverKeys: [selectionKey.server(front), 'server:999:1']
        })
      ]
    })
    const groups = groupWorkspaces(workspaceTable(stale).rows, stale, now)
    expect(groups[0].rows.map((r) => r.key)).toEqual([selectionKey.server(front)])
    expect(groups[0].group).toMatchObject({ count: 1, summary: '서버 1' })
  })

  test('머리 요약에서 0 과 모르는 값은 뺀다', () => {
    const idle = agentRow({
      pid: 40,
      workspace: SHOP,
      state: 'idle',
      stateSince: now - 3 * 60 * MIN,
      lastActiveAt: now - 3 * 60 * MIN
    })
    const head = (
      agents: ReturnType<typeof agentRow>[],
      over: Parameters<typeof workspaceRow>[0]
    ): unknown => {
      const t = snapshot({
        takenAt: now,
        servers: [],
        agents,
        workspaces: [
          workspaceRow({
            key: 'ws:c:\\work\\shop',
            root: 'C:\\work\\shop',
            name: 'shop',
            serverKeys: [],
            agentKeys: agents.map((a) => selectionKey.agent(a)),
            ...over
          })
        ]
      })
      return groupWorkspaces(workspaceTable(t).rows, t, now)[0].group?.summary
    }
    // 서버·무거운 작업·남은 프로세스가 0 이고 변경 수가 0 이면 빼고, 쉬는 에이전트뿐이면 마지막 활동.
    expect(head([idle], { changedFiles: 0, lastActiveAt: now - 3 * 60 * MIN })).toBe(
      '마지막 활동 3시간 전'
    )
    // 변경 수·마지막 활동을 모르면 뺀다.
    expect(head([idle], { changedFiles: null, lastActiveAt: null })).toBe('')
    // 작업 중이거나 권한 대기인 에이전트가 있으면 마지막 활동은 보이지 않는다.
    const working = agentRow({ ...idle, pid: 41, state: 'working' })
    const waiting = agentRow({ ...idle, pid: 42, state: 'waiting' })
    expect(head([idle, working], { changedFiles: 3, lastActiveAt: now - MIN })).toBe('변경 3')
    expect(head([waiting], { changedFiles: null, lastActiveAt: now - MIN })).toBe('')
  })

  test('권한 대기 에이전트가 있으면 머리 상태가 권한 대기', () => {
    const status = (agents: ReturnType<typeof agentRow>[], servers = [front]): unknown => {
      const t = snapshot({
        takenAt: now,
        servers,
        agents,
        workspaces: [
          workspaceRow({
            key: 'ws:c:\\work\\shop',
            root: 'C:\\work\\shop',
            name: 'shop',
            serverKeys: servers.map((r) => selectionKey.server(r)),
            agentKeys: agents.map((a) => selectionKey.agent(a))
          })
        ]
      })
      return groupWorkspaces(workspaceTable(t).rows, t, now)[0].group?.status
    }
    const working = agentRow({ pid: 50, workspace: SHOP, state: 'working', stateSince: now })
    const quiet = agentRow({ ...working, pid: 51, quietSince: now - 16 * MIN })
    const waiting = agentRow({ pid: 52, workspace: SHOP, state: 'waiting', stateSince: now })
    const idle = agentRow({ pid: 53, workspace: SHOP, state: 'idle' })
    // 권한 대기 > 조용함 > 작업 중 > 서버 요약.
    expect(status([working, quiet, waiting])).toEqual({ text: '권한 대기', dot: 'warn' })
    expect(status([working, quiet])).toEqual({ text: '조용함', dot: 'warn' })
    expect(status([idle, working])).toEqual({ text: '작업 중', dot: 'running' })
    expect(status([idle])).toEqual({ text: '사용 중 1', dot: 'running' })
    const candidate = serverRow({ ...front, judgement: 'candidate', clientCount: 0 })
    expect(status([], [candidate])).toEqual({ text: '정리 후보 1', dot: 'stopped' })
    // 서버도 바쁜 에이전트도 없으면 상태는 비운다("연결 없음"은 서버의 말이라).
    expect(status([idle], [])).toEqual({ text: '' })
  })
})

describe('새 정보 표시(F3·F5·F6)', () => {
  test('에이전트 상태 칸에 경과 시간', () => {
    const now = 60 * 60_000
    const s = snapshot({
      takenAt: now,
      agents: [
        agentRow({ pid: 1, state: 'working', stateSince: now - 12 * 60_000 }),
        agentRow({ pid: 2, state: 'waiting', stateSince: now - 3 * 60_000, startedAt: 2 }),
        agentRow({ pid: 3, state: 'unknown', stateSince: null, startedAt: 3 })
      ]
    })
    expect(tableFor('agents', s).rows.map((r) => r.cells.status.text)).toEqual([
      '작업 중 · 12분',
      '권한 대기 · 3분',
      '확인 중'
    ])
  })

  test('개발 서버 표에 CPU 칸(OS 기준)과 메모리 증가 배지', () => {
    const s = snapshot({
      platform: 'win32',
      cpuCount: 8,
      servers: [
        serverRow({
          cpuPercent: 40,
          memoryGrowth: { fromBytes: 2 * GB, toBytes: 3.6 * GB, minutes: 30 }
        }),
        serverRow({ pid: 9, cpuPercent: null })
      ]
    })
    const [grown, plain] = tableFor('ports', s).rows
    expect(grown.cells.cpu).toMatchObject({ text: '5.0%', sort: 5 })
    expect(grown.cells.status.badge).toBe('메모리 증가')
    expect(grown.cells.status.title).toContain('30분 동안 2.0 GB → 3.6 GB')
    expect(plain.cells.cpu).toMatchObject({ text: '—', muted: true })
    expect(plain.cells.status.badge).toBeUndefined()
  })

  test('다른 포트 표는 고를 수 없다', () => {
    const POSTGRES = 'C:\\Program Files\\PostgreSQL\\16\\bin\\postgres.exe'
    const s = snapshot({
      otherPorts: [
        otherPort({ port: 9229, pid: 4410, processName: 'chrome.exe', memoryBytes: 300 * MB }),
        otherPort({ port: 5432, pid: 812, exePath: POSTGRES })
      ]
    })
    const t = otherPortsTable(s)
    // 커밋을 하나도 모르면 커밋 칸은 없다(다른 표와 같은 규칙).
    expect(t.columns.map((c) => [c.id, c.label, c.width])).toEqual([
      ['port', '포트', 110],
      ['name', '프로세스', 300],
      ['pid', 'PID', 90],
      ['memory', '메모리', 96]
    ])
    expect(t.sort).toEqual({ id: 'port', dir: 'asc' })
    expect(sortRows(t.rows, 'port', 'asc').map((r) => r.cells.port.text)).toEqual([
      ':5432',
      ':9229'
    ])
    const pg = t.rows.find((r) => r.cells.port.sort === 5432)!
    expect(pg.key).toBeNull()
    expect(pg.actions).toEqual([])
    expect(pg.cells.port).toMatchObject({ text: ':5432', mono: true })
    expect(pg.cells.name.text).toBe('postgres.exe')
    expect(pg.cells.name.icon).toMatchObject({ exePath: POSTGRES, prefer: 'native' })
    expect(pg.cells.pid).toMatchObject({ text: '812', sort: 812, mono: true })
    expect(pg.cells.memory).toMatchObject({ text: '40 MB', sort: 40 * MB })
    expect(new Set(t.rows.map((r) => r.id)).size).toBe(2)
    // 포트(: 있거나 없거나)와 프로세스 이름으로 찾는다.
    for (const q of [':5432', '5432', 'POSTGRES'])
      expect(filterRows(t.rows, q).map((r) => r.cells.port.text)).toEqual([':5432'])
    // 커밋을 하나라도 알면 커밋 칸이 메모리 뒤에.
    const known = otherPortsTable(snapshot({ otherPorts: [otherPort({ commitBytes: GB })] }))
    expect(known.columns.map((c) => c.id)).toEqual(['port', 'name', 'pid', 'memory', 'commit'])
  })

  test('숨긴 서버 표: 숨김 풀기 버튼만 있고 상태는 숨김', () => {
    const s = snapshot({
      servers: [],
      hiddenServers: [serverRow({ ports: [2375], processName: 'docker.exe' })]
    })
    const t = hiddenServerTable(s)
    expect(t.rows.map((r) => [r.cells.port.text, r.cells.status.text])).toEqual([[':2375', '숨김']])
    expect(t.rows[0].actions.map((a) => a.kind)).toEqual(['unhide'])
  })
})

describe('커밋 칸', () => {
  test('커밋을 하나라도 알면 커밋 칸이 메모리 칸 뒤에, 하나도 모르면 칸이 없다', () => {
    const ids = (t: ReturnType<typeof tableFor>): string[] => t.columns.map((c) => c.id)
    const known = snapshot({
      servers: [serverRow({ commitBytes: 2 * GB })],
      agents: [agentRow({ commitBytes: 1 * GB })],
      leftovers: [leftoverRow({ commitBytes: 1 * GB })],
      heavyJobs: [heavyJob({ commitBytes: 1 * GB })],
      apps: [
        {
          name: 'a.exe',
          owner: null,
          memoryBytes: GB,
          commitBytes: GB,
          processCount: 1,
          exePath: null
        }
      ]
    })
    for (const tab of ['ports', 'agents', 'leftovers', 'heavy', 'apps'] as const) {
      const cols = ids(tableFor(tab, known))
      expect(cols[cols.indexOf('memory') + 1]).toBe('commit')
    }
    expect(tableFor('ports', known).columns.find((c) => c.id === 'commit')).toMatchObject({
      label: '커밋',
      width: 96,
      align: 'right'
    })
    const unknown = snapshot({
      servers: [serverRow()],
      agents: [agentRow()],
      leftovers: [leftoverRow()],
      heavyJobs: [heavyJob()]
    })
    for (const tab of ['ports', 'agents', 'leftovers', 'heavy', 'apps'] as const)
      expect(ids(tableFor(tab, unknown))).not.toContain('commit')
    // 숨긴 서버 표도 같은 규칙(그 표의 행만 본다).
    expect(ids(hiddenServerTable(snapshot({ hiddenServers: [serverRow()] })))).not.toContain(
      'commit'
    )
    expect(
      ids(hiddenServerTable(snapshot({ hiddenServers: [serverRow({ commitBytes: GB })] })))
    ).toContain('commit')
  })

  test('커밋 칸은 커밋으로 정렬하고 모르는 행은 —', () => {
    const s = snapshot({
      servers: [
        serverRow({ pid: 1, ports: [1], commitBytes: 1 * GB }),
        serverRow({ pid: 2, ports: [2], commitBytes: null }),
        serverRow({ pid: 3, ports: [3], commitBytes: 4 * GB })
      ]
    })
    const rows = tableFor('ports', s).rows
    expect(rows[0].cells.commit).toMatchObject({ text: '1.0 GB', sort: GB })
    expect(rows[1].cells.commit).toMatchObject({ text: '—', sort: -1 })
    expect(sortRows(rows, 'commit', 'desc').map((r) => r.cells.commit.text)).toEqual([
      '4.0 GB',
      '1.0 GB',
      '—'
    ])
  })

  test('묶음 머리와 작업 공간 요약은 커밋 합을 같이 낸다(모르면 null)', () => {
    const WS = { root: 'C:\\work\\ws', name: 'ws', branch: 'main', outer: true }
    const a = serverRow({ pid: 1, ports: [1], workspace: WS, commitBytes: 1 * GB })
    const b = serverRow({ pid: 2, ports: [2], workspace: WS, commitBytes: 2 * GB })
    const s = snapshot({ servers: [a, b] })
    const rows = tableFor('ports', s).rows
    expect(groupServers(rows, s.servers, [])[0].group?.commitBytes).toBe(3 * GB)
    expect(workspaceSummary(s)[0].commitBytes).toBe(3 * GB)
    const none = snapshot({
      servers: [
        serverRow({ pid: 1, workspace: WS }),
        serverRow({ pid: 2, ports: [2], workspace: WS })
      ]
    })
    expect(
      groupServers(tableFor('ports', none).rows, none.servers, [])[0].group?.commitBytes
    ).toBeNull()
  })
})

test('커밋 칸이 있어도 표의 칸 너비 합은 기본 창 너비(1280px)에 들어간다', () => {
  const server = serverRow({ commitBytes: GB })
  const agent = agentRow({
    commitBytes: GB,
    activity: {
      title: '로그인 버그',
      prompt: null,
      tool: { name: 'Bash', summary: 'npm run build', since: 0 },
      waiting: null
    }
  })
  const leftover = leftoverRow({ commitBytes: GB })
  const heavy = heavyJob({ commitBytes: GB })
  const s = snapshot({
    servers: [server],
    // 하는 일 칸까지 있는 에이전트 표.
    agents: [agent],
    leftovers: [leftover],
    heavyJobs: [heavy],
    workspaces: [
      workspaceRow({
        serverKeys: [selectionKey.server(server)],
        agentKeys: [selectionKey.agent(agent)],
        leftoverKeys: [selectionKey.leftover(leftover)],
        heavyKeys: [selectionKey.heavy(heavy)]
      })
    ]
  })
  expect(tableFor('agents', s).columns.map((col) => col.id)).toEqual(
    expect.arrayContaining(['activity', 'commit'])
  )
  expect(tableFor('workspaces', s).columns.find((col) => col.id === 'commit')?.width).toBe(88)
  for (const tab of ['workspaces', 'ports', 'agents', 'leftovers', 'heavy'] as const) {
    const sum = tableFor(tab, s).columns.reduce((n, col) => n + col.width, 0)
    // 120 은 ItemTable 이 더하는 동작 칸 너비, 1240 은 세로 스크롤바·테두리 여유.
    expect(sum + 120, tab).toBeLessThanOrEqual(1240)
  }
  // 다른 포트 표는 동작 칸이 없다.
  const other = otherPortsTable(snapshot({ otherPorts: [otherPort({ commitBytes: GB })] }))
  expect(other.columns.map((col) => col.id)).toContain('commit')
  expect(other.columns.reduce((n, col) => n + col.width, 0)).toBeLessThanOrEqual(1240)
})
