import { describe, expect, test } from 'vitest'
import type { ProcessInfo } from '../shared/types'
import { processHint, summarizeProcesses } from './processSummary'

const MB = 1024 * 1024
let nextPid = 100
function proc(name: string, commandLine: string, memoryMb = 10): ProcessInfo {
  return { pid: nextPid++, ppid: 1, name, commandLine, memoryBytes: memoryMb * MB, startedAt: 1 }
}

describe('processHint: 무엇인지 알 수 있는 짧은 이름(패키지·스크립트 이름만)', () => {
  test.each([
    [
      'node_modules 안 패키지(범위 이름 포함)',
      proc(
        'node.exe',
        String.raw`"C:\Program Files\nodejs\node.exe" C:\Users\dev\AppData\Local\npm-cache\_npx\1a2b\node_modules\@upstash\context7-mcp\dist\index.js`
      ),
      '@upstash/context7-mcp'
    ],
    [
      '겹친 node_modules 는 실제 스크립트의 패키지',
      proc('node', '/usr/local/bin/node /work/app/node_modules/a/node_modules/b/bin/run.js'),
      'b'
    ],
    [
      'npx 로 띄운 패키지(버전 꼬리는 뗀다)',
      proc('node.exe', 'npx -y @scope/some-server@latest --port 1234'),
      '@scope/some-server'
    ],
    ['uvx 로 띄운 패키지', proc('uvx.exe', 'uvx mcp-server-fetch'), 'mcp-server-fetch'],
    ['python -m 모듈', proc('python.exe', 'python.exe -m http.server 9000'), 'http.server'],
    [
      '스크립트 파일 이름',
      proc('node.exe', String.raw`node C:\work\shop-web\scripts\seed.mjs --fast`),
      'seed.mjs'
    ],
    [
      'java -jar',
      proc('java.exe', String.raw`java -Xmx2g -jar C:\work\api\build\app.jar`),
      'app.jar'
    ],
    [
      '이미 아는 개발 도구는 그 이름',
      proc('node.exe', 'node /work/app/node_modules/@playwright/mcp/cli.js'),
      'Playwright MCP'
    ]
  ])('%s', (_case, p, hint) => {
    expect(processHint(p)).toBe(hint)
  })

  test('셸·콘솔·명령줄이 없는 프로세스는 null', () => {
    expect(
      processHint(proc('conhost.exe', String.raw`\??\C:\Windows\system32\conhost.exe 0x4`))
    ).toBeNull()
    expect(processHint(proc('bash.exe', '/usr/bin/bash'))).toBeNull()
    expect(processHint(proc('svchost.exe', ''))).toBeNull()
  })

  test('셸·콘솔은 무엇을 띄웠든 짧은 이름을 붙이지 않는다(띄운 프로세스가 따로 보이므로)', () => {
    expect(
      processHint(proc('cmd.exe', 'cmd.exe /d /s /c "npx -y @playwright/mcp@latest"'))
    ).toBeNull()
    expect(
      processHint(proc('bash.exe', 'bash -c "node /x/node_modules/@scope/pkg/index.js"'))
    ).toBeNull()
    expect(processHint(proc('pwsh.exe', 'pwsh -File C:/x/run.ps1'))).toBeNull()
    expect(processHint(proc('zsh', 'zsh -c vitest'))).toBeNull()
  })

  test('러너의 값을 받는 옵션·python 이 아닌 -m·공백 든 낱말에서 인자가 새지 않는다', () => {
    expect(
      processHint(proc('uvx.exe', 'uvx --from git+https://user:TOKEN123@github.com/org/repo tool'))
    ).toBe('tool')
    expect(processHint(proc('node.exe', 'npx --registry https://u:pw@reg.example.com pkg'))).toBe(
      'pkg'
    )
    expect(processHint(proc('git.exe', 'git commit -m "secret release note"'))).toBeNull()
    expect(processHint(proc('curl.exe', 'curl -m 2 http://x'))).toBeNull()
    expect(
      processHint(proc('wsl.exe', 'wsl.exe -e bash -lc "cd /x && python app.py --api-key=X x.py"'))
    ).toBeNull()
    expect(processHint(proc('python3', 'python3 -m uvicorn app:main'))).toBe('uvicorn')
  })

  test('명령줄의 다른 인자(토큰·주소 등)는 담지 않는다', () => {
    const p = proc('node.exe', 'node server.js --token=abc123secret --db postgres://u:pw@host/db')
    expect(processHint(p)).toBe('server.js')
  })

  test('너무 긴 이름은 자른다', () => {
    const long = 'x'.repeat(200)
    expect(
      processHint(proc('node.exe', `node /work/node_modules/${long}/index.js`))!.length
    ).toBeLessThanOrEqual(60)
  })
})

describe('summarizeProcesses: 이름·짧은 이름별로 묶어 메모리 큰 순', () => {
  test('같은 이름과 짧은 이름은 하나로 묶어 개수와 메모리를 더한다', () => {
    const list = summarizeProcesses([
      proc('claude.exe', 'claude', 300),
      proc('node.exe', 'node /a/node_modules/@scope/mcp-one/index.js', 100),
      proc('node.exe', 'node /b/node_modules/@scope/mcp-one/index.js', 50),
      proc('node.exe', 'node /a/node_modules/other-mcp/index.js', 40),
      proc('cmd.exe', 'cmd.exe', 5),
      proc('CMD.EXE', 'cmd.exe', 5)
    ])
    const row = (name: string, hint: string | null, count: number, mb: number): object => ({
      name,
      hint,
      count,
      memoryBytes: mb * MB,
      commitBytes: null
    })
    expect(list).toEqual([
      row('claude.exe', null, 1, 300),
      row('node.exe', '@scope/mcp-one', 2, 150),
      row('node.exe', 'other-mcp', 1, 40),
      row('cmd.exe', null, 2, 10)
    ])
  })

  test('묶인 프로세스의 커밋은 아는 것만 더하고, 하나도 모르면 null', () => {
    const commit = (p: ProcessInfo, mb: number | null): ProcessInfo => ({
      ...p,
      commitBytes: mb == null ? null : mb * MB
    })
    const list = summarizeProcesses([
      commit(proc('java.exe', 'java', 300), null),
      commit(proc('java.exe', 'java', 200), 900),
      commit(proc('java.exe', 'java', 100), 400),
      commit(proc('cmd.exe', 'cmd.exe', 5), null),
      proc('cmd.exe', 'cmd.exe', 5)
    ])
    expect(list.map((g) => [g.name, g.count, g.commitBytes])).toEqual([
      ['java.exe', 3, 1300 * MB],
      ['cmd.exe', 2, null]
    ])
  })

  test('묶음이 한도를 넘으면 메모리 큰 것부터 한도만큼', () => {
    const many = Array.from({ length: 50 }, (_, i) => proc(`p${i}.exe`, '', i + 1))
    const list = summarizeProcesses(many, 30)
    expect(list).toHaveLength(30)
    expect(list[0]).toMatchObject({ name: 'p49.exe' })
  })
})
