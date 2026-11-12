import { spawn, type ChildProcess } from 'child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'fs'
import { connect, type Socket } from 'net'
import { tmpdir, totalmem } from 'os'
import { join } from 'path'
import type { ProcessInfo, RawSample } from '../../shared/types'
import { allCwdsDarwin, sampleDarwin } from './darwin'
import { parseVmStat, readMemory, VM_STAT_ARGV } from './memory'
import { runCommand } from './runCommand'

/**
 * 실제 macOS 의 ps·lsof·vm_stat 으로 수집을 확인한다. macOS 에서만 돈다(GitHub Actions 의 macOS 러너).
 * darwin.test.ts 는 손으로 쓴 출력으로 파싱만 보므로, 진짜 출력이 그 형식과 같은지는 여기서 본다.
 */
const onMac = process.platform === 'darwin'

/** 포트 셋을 연다: IPv4 루프백, IPv6 루프백, 모든 주소. 열지 못한 것은 null. 다 열면 포트 목록을 한 줄로 찍는다. */
const SERVER = `
const http = require('http')
const hosts = ['127.0.0.1', '::1', '::']
const ports = hosts.map(() => null)
let left = hosts.length
const done = () => { if (--left === 0) console.log(JSON.stringify(ports)) }
hosts.forEach((host, i) => {
  const server = http.createServer((req, res) => res.end('ok'))
  server.once('error', done)
  server.listen(0, host, () => { ports[i] = server.address().port; done() })
})
`

const nfc = (path: string): string => path.normalize('NFC')

describe.skipIf(!onMac)('실제 macOS 명령으로 수집(ps·lsof·vm_stat)', () => {
  let base = ''
  let workDir = ''
  let linkPath = ''
  let child: ChildProcess | null = null
  let client: Socket | null = null
  let ports: (number | null)[] = []
  let spawnedAt = 0
  let sample: RawSample
  let rawLine = ''

  const fixture = (): ProcessInfo | undefined => sample.processes.find((p) => p.pid === child?.pid)

  beforeAll(async () => {
    base = realpathSync(mkdtempSync(join(tmpdir(), 'corral-real-')))
    // 공백과 한글이 든 작업 폴더, 공백이 든 실행 파일 경로.
    workDir = join(base, '한글 폴더')
    mkdirSync(workDir)
    mkdirSync(join(base, 'my bin'))
    // Claude Code 는 ~/.local/bin/claude 가 버전 파일을 가리키는 심볼릭 링크로 설치된다. 같은 모양으로 띄운다.
    linkPath = join(base, 'my bin', 'claude')
    symlinkSync(process.execPath, linkPath)

    spawnedAt = Date.now()
    const started = spawn(linkPath, ['-e', SERVER, 'corral-real-test', 'arg with space'], {
      cwd: workDir,
      stdio: ['ignore', 'pipe', 'inherit']
    })
    child = started
    ports = await new Promise<(number | null)[]>((resolve, reject) => {
      let out = ''
      started.stdout.on('data', (chunk: Buffer) => {
        out += chunk.toString('utf8')
        if (out.includes('\n')) resolve(JSON.parse(out) as (number | null)[])
      })
      started.once('error', reject)
      started.once('exit', (code) => reject(new Error(`fixture exited with ${code}`)))
    })
    // 연결 하나를 열어 둔다(ESTABLISHED 줄).
    client = await new Promise<Socket>((resolve, reject) => {
      const socket = connect(ports[0]!, '127.0.0.1', () => resolve(socket))
      socket.once('error', reject)
    })

    sample = await sampleDarwin()
    const raw = await runCommand(
      ['/bin/ps', '-ww', '-o', 'pid=,ppid=,rss=,time=,lstart=,comm=', '-p', String(started.pid)],
      { env: { LC_ALL: 'en_US.UTF-8' } }
    )
    rawLine = raw.stdout.trimEnd()
    // CI 로그에서 진짜 형식을 볼 수 있게 남긴다.
    console.log(`ps 원본: ${rawLine}`)
    console.log(`파싱 결과: ${JSON.stringify(fixture())}`)
    console.log(`포트: ${JSON.stringify(ports)}`)
    console.log(
      `lsof TCP: ${JSON.stringify(sample.tcp.filter((t) => t.pid === started.pid || t.pid === process.pid))}`
    )
    console.log(`작업 폴더: ${JSON.stringify(sample.cwds?.[started.pid!])}`)
  }, 60_000)

  afterAll(() => {
    client?.destroy()
    child?.kill('SIGKILL')
    if (base) rmSync(base, { recursive: true, force: true })
  })

  test('프로세스 목록을 거의 빠짐없이 읽는다', async () => {
    const raw = await runCommand(['/bin/ps', '-ax', '-o', 'pid='])
    const count = raw.stdout.split('\n').filter((line) => line.trim()).length
    expect(sample.processes.length).toBeGreaterThan(20)
    // 두 번 받는 사이 프로세스가 생기고 사라지므로 조금의 차이는 둔다.
    expect(sample.processes.length).toBeGreaterThan(count * 0.9)
    expect(sample.collectMode).toBe('darwin')
  })

  test('모든 줄의 숫자·이름이 온전하다(시작 시각·CPU 시간은 95% 이상 읽는다)', () => {
    for (const p of sample.processes) {
      expect(Number.isInteger(p.pid) && p.pid > 0, JSON.stringify(p)).toBe(true)
      expect(Number.isInteger(p.ppid) && p.ppid >= 0, JSON.stringify(p)).toBe(true)
      expect(Number.isFinite(p.memoryBytes) && p.memoryBytes >= 0, JSON.stringify(p)).toBe(true)
      expect(p.name.length, JSON.stringify(p)).toBeGreaterThan(0)
      expect(p.name.includes('/'), JSON.stringify(p)).toBe(false)
    }
    const total = sample.processes.length
    const withStart = sample.processes.filter((p) => p.startedAt != null).length
    const withCpu = sample.processes.filter((p) => p.cpuMs != null).length
    console.log(`시작 시각 ${withStart}/${total}, CPU 시간 ${withCpu}/${total}`)
    expect(withStart / total).toBeGreaterThan(0.95)
    expect(withCpu / total).toBeGreaterThan(0.95)
  })

  test('launchd 는 pid 1 이다', () => {
    const launchd = sample.processes.find((p) => p.pid === 1)
    expect(launchd?.name).toBe('launchd')
    expect(launchd?.ppid).toBe(0)
  })

  test('띄운 프로세스의 부모·메모리·명령줄을 읽는다', () => {
    const p = fixture()
    expect(p, rawLine).toBeDefined()
    expect(p!.ppid, rawLine).toBe(process.pid)
    expect(p!.memoryBytes, rawLine).toBeGreaterThan(5 * 1024 * 1024)
    expect(p!.memoryBytes, rawLine).toBeLessThan(2 * 1024 * 1024 * 1024)
    expect(p!.commandLine).toContain('corral-real-test')
    expect(p!.commandLine).toContain('arg with space')
  })

  test('심볼릭 링크로 띄운 프로세스의 이름은 링크 이름이다(에이전트를 이름으로 알아본다)', () => {
    expect(fixture()?.name, rawLine).toBe('claude')
  })

  test('시작 시각(lstart)이 실제 시작 시각과 맞는다', () => {
    const startedAt = fixture()?.startedAt
    expect(startedAt, rawLine).not.toBeNull()
    expect(Math.abs(startedAt! - spawnedAt), rawLine).toBeLessThan(60_000)
  })

  test('누적 CPU 시간을 읽는다', () => {
    const cpuMs = fixture()?.cpuMs
    expect(typeof cpuMs, rawLine).toBe('number')
    expect(cpuMs!).toBeGreaterThanOrEqual(0)
    expect(cpuMs!).toBeLessThan(60_000)
  })

  test('LISTEN 포트를 읽는다(IPv4 루프백·IPv6 루프백·모든 주소)', () => {
    const listening = sample.tcp.filter((t) => t.pid === child?.pid && t.state === 'Listen')
    const dump = JSON.stringify(listening)
    expect(ports[0], '127.0.0.1 포트를 열지 못했다').not.toBeNull()
    for (const port of ports) {
      if (port == null) continue
      expect(
        listening.some((t) => t.localPort === port),
        `${port} 없음: ${dump}`
      ).toBe(true)
    }
    expect(listening.find((t) => t.localPort === ports[0])?.localAddress).toBe('127.0.0.1')
    if (ports[1] != null)
      expect(listening.find((t) => t.localPort === ports[1])?.localAddress).toBe('::1')
    if (ports[2] != null)
      expect(listening.find((t) => t.localPort === ports[2])?.localAddress).toBe('*')
  })

  test('열린 연결(ESTABLISHED)을 양쪽에서 읽는다', () => {
    const clientPort = client!.localPort!
    const serverSide = sample.tcp.find(
      (t) => t.pid === child?.pid && t.state === 'Established' && t.localPort === ports[0]
    )
    const clientSide = sample.tcp.find(
      (t) => t.pid === process.pid && t.state === 'Established' && t.localPort === clientPort
    )
    expect(serverSide, JSON.stringify(sample.tcp.filter((t) => t.pid === child?.pid))).toBeDefined()
    expect(serverSide!.remotePort).toBe(clientPort)
    expect(clientSide?.remotePort).toBe(ports[0])
  })

  test('작업 폴더를 읽는다(공백·한글 경로)', () => {
    expect(nfc(sample.cwds?.[child!.pid!] ?? '')).toBe(nfc(workDir))
  })

  test('이 사용자의 모든 작업 폴더를 한 번에 읽는다', async () => {
    const cwds = await allCwdsDarwin()
    expect(cwds).not.toBeNull()
    expect(nfc(cwds![child!.pid!] ?? '')).toBe(nfc(workDir))
    expect(cwds![process.pid]).toBe(realpathSync(process.cwd()))
    expect(Object.keys(cwds!).length).toBeGreaterThan(10)
  })

  test('vm_stat 으로 사용 가능한 메모리를 읽는다', async () => {
    const raw = await runCommand(VM_STAT_ARGV)
    console.log(`vm_stat 원본:\n${raw.stdout}`)
    expect(raw.exitCode).toBe(0)
    const parsed = parseVmStat(raw.stdout)
    expect(parsed).not.toBeNull()
    expect(parsed!.availableBytes).toBeGreaterThan(0)
    expect(parsed!.availableBytes).toBeLessThan(totalmem())

    const memory = await readMemory('darwin')
    expect(memory.totalBytes).toBe(totalmem())
    expect(memory.freeBytes).toBeGreaterThan(0)
    expect(memory.freeBytes).toBeLessThan(memory.totalBytes)
    // vm_stat 값을 썼는지(os.freemem 으로 넘어가지 않았는지): 두 번 재는 사이의 차이만 난다.
    expect(Math.abs(memory.freeBytes - parsed!.availableBytes)).toBeLessThan(totalmem() * 0.2)
  })
})
