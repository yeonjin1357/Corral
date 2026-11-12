/**
 * 설치된 Corral.app 을 Finder 로 연 것처럼(open) 띄우고, 원격 디버깅 포트(CDP)로 화면에 붙어 확인한다(macOS 러너용).
 * 의존성 없이 Node 22 의 fetch·WebSocket 만 쓴다. 결과는 SMOKE_OUT 에 남긴다(results.json·summary.md·스크린샷).
 *
 * 확인마다 등급이 있다 — required: 실패하면 작업이 실패한다, info: 러너 사정으로 안 될 수 있어 기록만 한다.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const OUT = process.env.SMOKE_OUT
if (!OUT) throw new Error('SMOKE_OUT 이 필요하다')
const APP = process.env.SMOKE_APP ?? '/Applications/Corral.app'
const PORT = Number(process.env.SMOKE_CDP_PORT ?? 9333)
const CDP = `http://127.0.0.1:${PORT}`
const USER_DATA = join(homedir(), 'Library', 'Application Support', 'pitwall')
const CLAUDE_SETTINGS = join(homedir(), '.claude', 'settings.json')
const fixtures = JSON.parse(readFileSync(join(OUT, 'fixtures.json'), 'utf8'))

const ICON = { pass: '✅', fail: '❌', warn: '⚠️' }
const results = []
let shots = 10

function record(name, status, detail = '') {
  results.push({ name, status, detail })
  console.log(`${ICON[status]} ${name}${detail ? ` — ${detail}` : ''}`)
}

async function check(name, level, fn) {
  try {
    const detail = await fn()
    record(name, 'pass', typeof detail === 'string' ? detail : '')
  } catch (e) {
    record(name, level === 'required' ? 'fail' : 'warn', e instanceof Error ? e.message : String(e))
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const sh = (command, args, options = {}) =>
  spawnSync(command, args, { encoding: 'utf8', timeout: 60_000, ...options })

function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return e.code === 'EPERM'
  }
}

const appRunning = () => sh('pgrep', ['-x', 'Corral']).status === 0

const osa = (script, timeout = 30_000) => sh('osascript', ['-e', script], { timeout })

/** 지금 맨 앞에 있는 앱 이름. */
const frontmost = () =>
  osa(
    'tell application "System Events" to get name of first application process whose frontmost is true'
  ).stdout.trim()

/** OS 가 띄운 창(권한 요청·경고·알림)의 글자. 읽지 못하면 빈 문자열. */
function systemDialogs() {
  const r = osa(`set AppleScript's text item delimiters to " / "
set found to ""
tell application "System Events"
  repeat with procName in {"UserNotificationCenter", "CoreServicesUIAgent", "NotificationCenter"}
    repeat with p in (every process whose name is procName)
      repeat with w in (every window of p)
        try
          set found to found & procName & ": " & ((value of every static text of w) as text) & " [" & ((name of every button of w) as text) & "]" & linefeed
        end try
        try
          set found to found & procName & " (안쪽): " & ((value of every static text of entire contents of w) as text) & linefeed
        end try
      end repeat
    end repeat
  end repeat
end tell
return found`)
  return (r.stdout ?? '').replace(/\s+/g, ' ').trim()
}

/** macOS 기본 파일 시스템은 대소문자·정규화를 가리지 않는다. */
const pathKey = (path) =>
  String(path ?? '')
    .normalize('NFC')
    .replace(/\/+$/, '')
    .toLowerCase()
const samePath = (a, b) => pathKey(a) === pathKey(b)

async function waitFor(fn, timeoutMs, everyMs = 500) {
  const until = Date.now() + timeoutMs
  for (;;) {
    let value = null
    try {
      value = await fn()
    } catch {
      // 아직 준비가 안 됐으면 다시 본다.
    }
    if (value) return value
    if (Date.now() >= until) return null
    await sleep(everyMs)
  }
}

/** CDP 대상 하나(창)에 붙는다. */
class Target {
  constructor(ws) {
    this.ws = ws
    this.nextId = 1
    this.pending = new Map()
    this.errors = []
    ws.addEventListener('message', (message) => {
      const msg = JSON.parse(message.data)
      if (msg.id) {
        const waiting = this.pending.get(msg.id)
        if (!waiting) return
        this.pending.delete(msg.id)
        clearTimeout(waiting.timer)
        if (msg.error) waiting.reject(new Error(`${waiting.method}: ${msg.error.message}`))
        else waiting.resolve(msg.result)
        return
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails
        this.errors.push(`exception: ${d.exception?.description ?? d.text}`)
      } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        this.errors.push(
          `console.error: ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`
        )
      } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
        this.errors.push(`log: ${msg.params.entry.text} ${msg.params.entry.url ?? ''}`)
      }
    })
  }

  static async attach(url) {
    const ws = new WebSocket(url)
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true })
      ws.addEventListener('error', () => reject(new Error(`CDP 연결 실패: ${url}`)), {
        once: true
      })
    })
    const target = new Target(ws)
    await target.send('Runtime.enable')
    await target.send('Page.enable')
    await target.send('Log.enable')
    return target
  }

  send(method, params = {}, timeoutMs = 20_000) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method}: ${timeoutMs}ms 안에 답이 없다`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer, method })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  /** 화면에서 식을 실행하고 값(JSON 으로 옮길 수 있는 것)을 받는다. Promise 는 기다린다. */
  async eval(expression, timeoutMs = 20_000) {
    const r = await this.send(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true, userGesture: true },
      timeoutMs
    )
    if (r.exceptionDetails)
      throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
    return r.result.value
  }

  async screenshot(file) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' }, 20_000)
    writeFileSync(file, Buffer.from(r.data, 'base64'))
  }

  async key(key, code, keyCode) {
    const base = { key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode }
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base })
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
  }
}

const listTargets = async () => (await fetch(`${CDP}/json/list`)).json()

let page = null

async function shot(name) {
  const file = join(OUT, `${String(shots++).padStart(2, '0')}-${name}.png`)
  try {
    await page.screenshot(file)
  } catch (e) {
    console.log(`  (스크린샷 ${name} 실패: ${e.message})`)
  }
}

/** 화면 전체(메뉴 막대·알림·다른 창까지). 러너가 허락하지 않으면 건너뛴다. */
function screenShot(name) {
  const file = join(OUT, `${String(shots++).padStart(2, '0')}-${name}.png`)
  const r = sh('screencapture', ['-x', file])
  if (r.status !== 0) console.log(`  (화면 전체 캡처 ${name} 실패: ${r.stderr.trim()})`)
}

const latest = () => page.eval('window.pitwall.getLatest()')
const click = (selector) =>
  page.eval(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (!el) return false
    el.click()
    return true
  })()`)

/** 탭으로 간다(탭 막대에 없으면 "더 보기" 안에서 찾는다). */
async function gotoTab(value) {
  if (await click(`[data-slot="tab"][data-value="${value}"]`)) return true
  if (!(await click('[data-slot="tab-more"]'))) return false
  await sleep(250)
  return click(`[data-slot="tab-more-item"][data-value="${value}"]`)
}

/** 확인 창이 뜨면 글자를 읽고 스크린샷을 찍은 뒤 버튼을 누른다(0 = 실행). */
async function answerConfirm(shotName, button = 0) {
  const selector = `[data-confirm-button="${button}"]`
  const shown = await waitFor(
    () => page.eval(`!!document.querySelector(${JSON.stringify(selector)})`),
    15_000,
    200
  )
  assert(shown, '확인 창이 뜨지 않았다')
  await sleep(400)
  const dialogText = await page.eval(
    `document.querySelector('[role="alertdialog"]')?.innerText ?? ''`
  )
  if (shotName) await shot(shotName)
  await click(selector)
  return dialogText
}

/** 확인 창을 거치는 동작(끄기·지우기·연동)을 부르고, 확인을 누른 뒤 결과를 받는다. */
async function callWithConfirm(expression, shotName) {
  await page.eval(`(() => {
    window.__smoke = { done: false }
    ;(${expression}).then(
      (value) => { window.__smoke = { done: true, value } },
      (error) => { window.__smoke = { done: true, error: String(error) } }
    )
    return true
  })()`)
  const dialogText = await answerConfirm(shotName)
  const settled = await waitFor(
    async () => {
      const state = await page.eval('window.__smoke')
      return state.done ? state : null
    },
    40_000,
    300
  )
  assert(settled, '확인을 누른 뒤 40초 안에 끝나지 않았다')
  if (settled.error) throw new Error(settled.error)
  return { value: settled.value, dialogText }
}

function finish() {
  const facts = existsSync(join(OUT, 'install-facts.tsv'))
    ? readFileSync(join(OUT, 'install-facts.tsv'), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => line.split('\t'))
    : []
  writeFileSync(join(OUT, 'results.json'), JSON.stringify({ facts, results }, null, 2))
  const cell = (value) => String(value).replace(/\|/g, '\\|').replace(/\s+/g, ' ').slice(0, 400)
  const failed = results.filter((r) => r.status === 'fail').length
  const warned = results.filter((r) => r.status === 'warn').length
  const summary = [
    `## Corral macOS 실행 확인 — ${facts.find((f) => f[0] === 'os')?.[1] ?? ''} ${facts.find((f) => f[0] === 'arch')?.[1] ?? ''}`,
    '',
    `통과 ${results.length - failed - warned} · 실패 ${failed} · 참고 ${warned}`,
    '',
    '| | 확인 | 내용 |',
    '|---|---|---|',
    ...results.map((r) => `| ${ICON[r.status]} | ${cell(r.name)} | ${cell(r.detail)} |`),
    '',
    '### 설치 과정에서 본 것',
    '',
    '| 항목 | 값 |',
    '|---|---|',
    ...facts.map(([key, value]) => `| ${cell(key)} | ${cell(value ?? '')} |`),
    ''
  ].join('\n')
  writeFileSync(join(OUT, 'summary.md'), summary)
  console.log(`\n통과 ${results.length - failed - warned} · 실패 ${failed} · 참고 ${warned}`)
  process.exit(failed > 0 ? 1 : 0)
}

function collectDiagnostics() {
  // 충돌 보고서.
  const reports = join(homedir(), 'Library', 'Logs', 'DiagnosticReports')
  const crashes = existsSync(reports)
    ? readdirSync(reports).filter((name) => /corral|pitwall/i.test(name))
    : []
  for (const name of crashes.slice(0, 3))
    writeFileSync(join(OUT, `crash-${name}.txt`), readFileSync(join(reports, name)))
  // 앱이 남긴 시스템 로그(끝부분).
  const log = sh(
    'log',
    ['show', '--last', '15m', '--style', 'compact', '--predicate', 'process BEGINSWITH "Corral"'],
    { timeout: 120_000, maxBuffer: 256 * 1024 * 1024 }
  )
  if (log.stdout)
    writeFileSync(join(OUT, 'unified-log-tail.txt'), log.stdout.split('\n').slice(-400).join('\n'))
  return crashes
}

// ───────────────────────── 실행 ─────────────────────────

await check('앱이 뜬다(Finder 로 연 것처럼 open)', 'required', async () => {
  const args = ['--args', `--remote-debugging-port=${PORT}`, '--remote-allow-origins=*']
  const logs = ['--stdout', join(OUT, 'app-stdout.log'), '--stderr', join(OUT, 'app-stderr.log')]
  const startedAt = Date.now()
  // 경고 창이 뜨면 open 은 끝나지 않는다. 30초만 기다린다.
  let opened = sh('open', [APP, ...logs, ...args], { timeout: 30_000 })
  if (opened.status !== 0 && opened.signal == null)
    opened = sh('open', [APP, ...args], { timeout: 30_000 })
  if (opened.status !== 0) {
    screenShot('screen-open-failed')
    throw new Error(
      opened.signal
        ? 'open 이 30초 안에 끝나지 않았다(경고 창이 답을 기다리는 것으로 보인다)'
        : `open 실패: ${opened.stderr.trim()}`
    )
  }
  const version = await waitFor(async () => (await fetch(`${CDP}/json/version`)).json(), 60_000)
  if (!version) screenShot('screen-no-debug-port')
  assert(
    version,
    `60초 안에 디버깅 포트가 열리지 않았다(프로세스 ${appRunning() ? '있음' : '없음'})`
  )
  assert(appRunning(), 'Corral 프로세스가 없다')
  return `${Date.now() - startedAt}ms, ${version['User-Agent'] ?? version.Browser}`
})

if (results.some((r) => r.status === 'fail')) {
  const crashes = collectDiagnostics()
  record('충돌 보고서', crashes.length ? 'fail' : 'pass', crashes.join(', '))
  finish()
}

await check('메인 창이 뜬다', 'required', async () => {
  const target = await waitFor(async () => {
    const targets = await listTargets()
    return targets.find(
      (t) => t.type === 'page' && t.url.includes('index.html') && !t.url.includes('view=tray')
    )
  }, 30_000)
  assert(target, `메인 창이 없다: ${JSON.stringify(await listTargets())}`)
  page = await Target.attach(target.webSocketDebuggerUrl)
  const ready = await waitFor(
    () => page.eval(`document.readyState === 'complete' && typeof window.pitwall === 'object'`),
    20_000
  )
  assert(ready, '화면이 다 뜨지 않았거나 window.pitwall 이 없다')
  const info = await page.eval(`({
    title: document.title,
    size: innerWidth + 'x' + innerHeight,
    dpr: devicePixelRatio,
    visible: document.visibilityState
  })`)
  return JSON.stringify(info)
})

if (!page) {
  collectDiagnostics()
  finish()
}

let first = null
await check('첫 수집이 오류 없이 온다', 'required', async () => {
  first = await waitFor(
    async () => {
      const s = await latest()
      return s && !s.stale ? s : null
    },
    60_000,
    1000
  )
  if (!first) {
    const stale = await latest()
    throw new Error(`60초 안에 수집이 되지 않았다: ${JSON.stringify(stale?.error ?? stale)}`)
  }
  assert(first.error == null, `수집 오류: ${first.error}`)
  assert(first.collectMode === 'darwin', `수집 방식이 ${first.collectMode}`)
  assert(first.platform === 'darwin', `platform 이 ${first.platform}`)
  return `프로세스 묶음 ${first.groups.length}, 다른 앱 ${first.apps.length}, 서버 ${first.servers.length}, 에이전트 ${first.agents.length}`
})

await shot('first')

await check('메모리 숫자가 맞다', 'required', async () => {
  const s = await latest()
  const total = Number(sh('sysctl', ['-n', 'hw.memsize']).stdout.trim())
  assert(s.memory.totalBytes === total, `전체 ${s.memory.totalBytes} ≠ hw.memsize ${total}`)
  assert(
    s.memory.usedPercent > 3 && s.memory.usedPercent < 99.5,
    `사용률이 이상하다: ${s.memory.usedPercent}%`
  )
  const groups = s.groups.map((g) => `${g.group} ${(g.memoryBytes / 2 ** 30).toFixed(2)}GB`)
  return `전체 ${(total / 2 ** 30).toFixed(0)}GB, 사용 ${s.memory.usedPercent}%, ${groups.join(' · ')}`
})

// 두 번째 수집부터 CPU·상태가 채워진다.
await sleep(7000)
let snap = await latest()
writeFileSync(join(OUT, 'snapshot.json'), JSON.stringify(snap, null, 2))

await check('개발 서버를 찾고 워크트리·브랜치를 안다', 'required', async () => {
  const row = snap.servers.find((r) => r.ports.includes(fixtures.serverA.port))
  assert(
    row,
    `${fixtures.serverA.port} 포트 서버가 없다: ${JSON.stringify(snap.servers.map((r) => r.ports))}`
  )
  assert(row.pid === fixtures.serverA.pid, `pid ${row.pid} ≠ ${fixtures.serverA.pid}`)
  assert(
    samePath(row.worktree?.root, fixtures.mainRoot),
    `워크트리 ${row.worktree?.root} ≠ ${fixtures.mainRoot}`
  )
  assert(row.worktree.branch === 'main', `브랜치 ${row.worktree.branch}`)
  assert(row.memoryBytes > 5 * 2 ** 20, `메모리 ${row.memoryBytes}`)
  return `:${row.ports.join(',')} ${row.processName} ${row.worktree.root} [${row.worktree.branch}] ${(row.memoryBytes / 2 ** 20).toFixed(0)}MB`
})

await check('연결된 워크트리의 서버도 찾는다(자식 프로세스 포함)', 'required', async () => {
  const row = snap.servers.find((r) => r.ports.includes(fixtures.serverB.port))
  assert(row, `${fixtures.serverB.port} 포트 서버가 없다`)
  assert(samePath(row.worktree?.root, fixtures.loginRoot), `워크트리 ${row.worktree?.root}`)
  assert(row.worktree.branch === 'feature/login', `브랜치 ${row.worktree.branch}`)
  assert(row.worktree.isLinkedWorktree === true, '연결된 워크트리로 보지 않는다')
  assert(
    row.descendantPids.includes(fixtures.serverB.childPid),
    `자식 ${fixtures.serverB.childPid} 이 없다: ${JSON.stringify(row.descendantPids)}`
  )
  return `:${row.ports.join(',')} [${row.worktree.branch}] 자손 ${row.descendantPids.length}`
})

await check('에이전트(이름이 claude 인 프로세스)를 찾는다', 'required', async () => {
  const row = snap.agents.find((a) => a.pid === fixtures.agent.pid)
  assert(row, `에이전트가 없다: ${JSON.stringify(snap.agents.map((a) => [a.pid, a.tool]))}`)
  assert(row.tool === 'claude', `도구 ${row.tool}`)
  assert(samePath(row.worktree?.root, fixtures.loginRoot), `워크트리 ${row.worktree?.root}`)
  return `${row.tool} 상태 ${row.state}(${row.stateSource}) ${row.worktree.root}`
})

await check('작업 공간으로 묶는다', 'required', async () => {
  const rows = snap.workspaces.filter((w) => w.root)
  const main = rows.find((w) => w.serverKeys.length > 0 && samePath(w.root, fixtures.mainRoot))
  const all = rows.map(
    (w) => `${w.name}(서버 ${w.serverKeys.length}, 에이전트 ${w.agentKeys.length})`
  )
  assert(main || rows.length > 0, `작업 공간이 없다`)
  return all.join(' · ')
})

await check('Finder 로 만든 것 같은 한글 폴더(자소 분리형 이름)의 서버', 'info', async () => {
  assert(fixtures.nfd?.pid, '준비하지 못했다')
  const row = snap.servers.find((r) => r.ports.includes(fixtures.nfd.port))
  assert(row, `${fixtures.nfd.port} 포트 서버가 없다`)
  const root = row.worktree?.root
  assert(root, `워크트리를 모른다(unresolvable=${row.unresolvable})`)
  assert(samePath(root, fixtures.nfd.doneRoot), `워크트리 ${root} ≠ ${fixtures.nfd.doneRoot}`)
  assert(row.worktree.branch === 'feature/blog-done', `브랜치 ${row.worktree.branch}`)
  const form = root === root.normalize('NFC') ? '조합형(NFC)' : '자소 분리형(NFD)'
  return `${root} [${row.worktree.branch}] — Corral 이 든 경로는 ${form}, 작업 공간 ${row.workspace?.name}`
})

await check('터미널 안에서 띄운 에이전트: 띄운 앱(Terminal)을 안다', 'info', async () => {
  assert(fixtures.terminalAgent?.pid, '터미널에서 띄우지 못했다')
  const row = snap.agents.find((a) => a.pid === fixtures.terminalAgent.pid)
  assert(row, `에이전트가 없다: ${JSON.stringify(snap.agents.map((a) => a.pid))}`)
  assert(/Terminal\.app$/.test(row.host?.app ?? ''), `띄운 앱: ${JSON.stringify(row.host)}`)
  return row.host.app
})

await check('창으로 가기: 에이전트가 떠 있는 Terminal 이 앞으로 온다', 'info', async () => {
  assert(fixtures.terminalAgent?.pid, '터미널에서 띄우지 못했다')
  const row = snap.agents.find((a) => a.pid === fixtures.terminalAgent.pid)
  assert(row, '에이전트가 없다')
  sh('open', [APP])
  await sleep(1500)
  const before = frontmost()
  const key = `agent:${row.pid}:${row.startedAt ?? ''}`
  const ok = await page.eval(`window.pitwall.focusAgent(${JSON.stringify(key)})`)
  assert(ok === true, `focusAgent 가 ${ok}`)
  const moved = await waitFor(() => frontmost() === 'Terminal', 10_000)
  assert(moved, `맨 앞 앱이 ${frontmost()}(누르기 전 ${before})`)
  screenShot('screen-focus-terminal')
  sh('open', [APP])
  await sleep(1000)
  return `${before} → Terminal`
})

for (const [tool, started] of [
  ['claude', fixtures.realClaude],
  ['codex', fixtures.realCodex]
]) {
  await check(
    `진짜 ${tool === 'claude' ? 'Claude Code' : 'Codex'} CLI 를 에이전트로 알아본다`,
    'info',
    async () => {
      assert(started, '러너에 설치하지 못해 확인하지 못했다')
      const ps = sh('/bin/ps', ['-axww', '-o', 'pid=,comm=']).stdout.split('\n')
      const live = ps.filter(
        (line) =>
          new RegExp(tool, 'i').test(line) &&
          !/\/(script|tail)$/.test(line.trim()) &&
          !line.includes(`${fixtures.root}/bin/claude`)
      )
      assert(
        live.length > 0,
        '실행 중인 CLI 프로세스가 없어 확인하지 못했다(로그인 없이 바로 끝났을 수 있다)'
      )
      const rows = snap.agents.filter(
        (a) =>
          a.tool === tool && a.pid !== fixtures.agent.pid && a.pid !== fixtures.terminalAgent?.pid
      )
      assert(
        rows.length > 0,
        `Corral 이 알아보지 못했다. ps 가 본 것: ${live.map((l) => l.trim()).join(' ; ')}`
      )
      return rows
        .map(
          (a) =>
            `pid ${a.pid} 상태 ${a.state}(${a.stateSource}) ${a.worktree?.root ?? '워크트리 모름'} ← ps: ${live.map((l) => l.trim()).join(' ; ')}`
        )
        .join(' / ')
    }
  )
}

await check('다른 앱 목록과 앱 아이콘(OS 아이콘)', 'required', async () => {
  assert(snap.apps.length > 5, `다른 앱이 ${snap.apps.length}개뿐이다`)
  const withPath = snap.apps.filter((a) => a.exePath)
  assert(
    withPath.length > 0,
    `실행 파일 경로를 아는 앱이 없다: ${snap.apps
      .slice(0, 8)
      .map((a) => a.name)
      .join(', ')}`
  )
  let icon = null
  let from = ''
  for (const app of withPath.slice(0, 8)) {
    icon = await page.eval(`window.pitwall.fileIcon(${JSON.stringify(app.exePath)})`)
    from = app.exePath
    if (icon) break
  }
  assert(typeof icon === 'string' && icon.startsWith('data:image'), `아이콘을 받지 못했다(${from})`)
  return `앱 ${snap.apps.length}개(경로 아는 것 ${withPath.length}), 아이콘 ${from} ${icon.length}자`
})

await check('화면에 오류 문구가 없고 내용이 보인다', 'required', async () => {
  const body = await page.eval('document.body.innerText')
  writeFileSync(join(OUT, 'ui-text.txt'), body)
  assert(body.length > 200, `화면 글자가 ${body.length}자뿐이다`)
  assert(!/가져오지 못했어요|exited with/.test(body), '수집 오류 문구가 보인다')
  return `${body.length}자`
})

await check('시각이 한국어(오전·오후)로 나온다', 'required', async () => {
  // src/shared/format.ts 와 같은 호출. 앱 화면은 Electron(Chromium)의 로케일 자료를 쓴다.
  const formatted = await page.eval(
    `new Date(2026, 10, 10, 15, 4, 5).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit', second: '2-digit' })`
  )
  assert(formatted === '오후 3:04:05', `'${formatted}'`)
  return formatted
})

// ── 탭마다 스크린샷 ──
for (const tab of [
  'workspaces',
  'ports',
  'agents',
  'leftovers',
  'heavy',
  'disk',
  'apps',
  'events'
]) {
  if (await gotoTab(tab)) {
    await sleep(700)
    await shot(`tab-${tab}`)
  } else console.log(`  (탭 ${tab} 을 찾지 못했다)`)
}

await check('행을 누르면 상세 패널이 열린다', 'info', async () => {
  assert(await gotoTab('ports'), '개발 서버 탭이 없다')
  await sleep(500)
  assert(
    await click('tr[data-key] button[data-variant="link"], tr[data-key] button'),
    '누를 행이 없다'
  )
  await sleep(800)
  await shot('sheet-server')
  await page.key('Escape', 'Escape', 27)
  await sleep(400)
})

await check('경로 복사(클립보드)', 'required', async () => {
  const ok = await page.eval(`window.pitwall.quick('copy', ${JSON.stringify(fixtures.mainRoot)})`)
  assert(ok === true, `quick copy 가 ${ok}`)
  const pasted = sh('pbpaste', []).stdout
  assert(samePath(pasted, fixtures.mainRoot), `클립보드: ${pasted}`)
  return pasted
})

await check('터미널에서 열기', 'info', async () => {
  const ok = await page.eval(
    `window.pitwall.quick('terminal', ${JSON.stringify(fixtures.mainRoot)})`
  )
  assert(ok === true, `quick terminal 이 ${ok}`)
  const running = await waitFor(() => sh('pgrep', ['-x', 'Terminal']).status === 0, 15_000)
  assert(running, 'Terminal 이 뜨지 않았다')
  await sleep(2000)
  screenShot('screen-terminal')
})

// ── Claude 훅 연동: 켜고, 설정 파일에 들어간 명령을 Claude 가 하듯 실행해 이벤트가 닿는지 본다 ──
let hookCommand = null
await check('Claude 연동 켜기(~/.claude/settings.json 에 훅 추가)', 'required', async () => {
  const { value, dialogText } = await callWithConfirm(
    'window.pitwall.claudeHook.enable()',
    'confirm-hook-enable'
  )
  assert(
    value?.status === 'done',
    `결과 ${JSON.stringify(value)} / 창: ${dialogText.slice(0, 120)}`
  )
  assert(existsSync(CLAUDE_SETTINGS), `${CLAUDE_SETTINGS} 이 없다`)
  const settings = JSON.parse(readFileSync(CLAUDE_SETTINGS, 'utf8'))
  writeFileSync(join(OUT, 'claude-settings-after-enable.json'), JSON.stringify(settings, null, 2))
  hookCommand = settings.hooks?.SessionStart?.flatMap((group) => group.hooks ?? []).find((h) =>
    String(h.command).includes('/pitwall-hook/claude')
  )?.command
  assert(hookCommand, 'SessionStart 훅 명령이 없다')
  const status = await page.eval('window.pitwall.claudeHook.status()')
  assert(status.state === 'on', `연동 상태 ${JSON.stringify(status)}`)
  return hookCommand.replace(/t=[A-Za-z0-9_-]+/, 't=…')
})

function sendHook(event) {
  // Claude Code 는 macOS 에서 훅 명령을 sh -c 로 실행하고 이벤트 JSON 을 표준입력으로 준다.
  const r = sh('/bin/sh', ['-c', hookCommand], {
    input: JSON.stringify({
      session_id: 'smoke-session-1',
      cwd: fixtures.loginRoot,
      transcript_path: join(homedir(), '.claude', 'projects', 'smoke', 'smoke-session-1.jsonl'),
      ...event
    }),
    timeout: 15_000
  })
  assert(r.status === 0, `훅 명령이 ${r.status} 로 끝났다: ${r.stderr}`)
}

let notification = null
const agentRow = async () => {
  await page.eval('window.pitwall.refreshNow()')
  return (await latest()).agents.find((a) => a.pid === fixtures.agent.pid)
}

await check(
  '훅 이벤트가 닿아 에이전트 상태가 바뀐다(작업 중 → 응답 대기 → 쉬는 중)',
  'required',
  async () => {
    assert(hookCommand, '훅 명령이 없어 확인하지 못했다')
    const prompt = '로그인 화면을 고쳐 줘'
    sendHook({ hook_event_name: 'SessionStart', source: 'startup' })
    sendHook({ hook_event_name: 'UserPromptSubmit', prompt })
    const working = await waitFor(
      async () => {
        const row = await agentRow()
        return row?.stateSource === 'hook' && row.state === 'working' ? row : null
      },
      20_000,
      1000
    )
    assert(working, `작업 중이 되지 않았다: ${JSON.stringify(await agentRow())}`)
    assert(
      working.activity?.prompt === prompt,
      `요청 문구(한글)가 다르다: ${JSON.stringify(working.activity)}`
    )

    // Corral 창이 앞에 있으면 알림을 보내지 않는다. 다른 앱을 앞에 두고 응답 대기로 만든다.
    osa('tell application "Finder" to activate')
    await waitFor(() => frontmost() !== 'Corral', 8000)
    sendHook({
      hook_event_name: 'PermissionRequest',
      tool_name: 'Bash',
      tool_input: { command: 'npm test' }
    })
    const waiting = await waitFor(
      async () => {
        const row = await agentRow()
        return row?.state === 'waiting' ? row : null
      },
      20_000,
      1000
    )
    assert(waiting, `응답 대기가 되지 않았다: ${JSON.stringify(await agentRow())}`)
    await gotoTab('agents')
    await sleep(1500)
    await shot('agent-waiting')
    // 응답 대기 알림(OS 알림)이 화면에 보이는지.
    await sleep(3500)
    screenShot('screen-notification')
    notification = { front: frontmost(), dialogs: systemDialogs() }
    const noteLog = sh(
      'log',
      [
        'show',
        '--last',
        '1m',
        '--style',
        'compact',
        '--predicate',
        '(process == "usernoted" OR process == "NotificationCenter" OR process BEGINSWITH "Corral") AND (eventMessage CONTAINS[c] "notif" OR eventMessage CONTAINS[c] "pitwall")'
      ],
      { timeout: 90_000, maxBuffer: 64 * 1024 * 1024 }
    )
    writeFileSync(
      join(OUT, 'notification-log.txt'),
      (noteLog.stdout ?? '').split('\n').slice(-200).join('\n')
    )
    sh('open', [APP])
    await sleep(1000)

    sendHook({ hook_event_name: 'Stop' })
    const idle = await waitFor(
      async () => {
        const row = await agentRow()
        return row?.state === 'idle' ? row : null
      },
      20_000,
      1000
    )
    assert(idle, `쉬는 중이 되지 않았다: ${JSON.stringify(await agentRow())}`)
    return `요청 "${working.activity.prompt}", 대기 도구 ${waiting.activity?.waiting?.tool ?? '?'}`
  }
)

await check('응답 대기 알림(OS 알림)이 뜬다', 'info', async () => {
  assert(notification, '응답 대기까지 가지 못했다')
  assert(notification.front !== 'Corral', 'Corral 이 앞에 있어 알림을 보내지 않는 상황이었다')
  assert(
    /Corral|Claude|응답|권한|Notifications/i.test(notification.dialogs),
    `화면에서 알림 글자를 읽지 못했다(스크린샷 screen-notification 을 볼 것). 읽은 것: ${notification.dialogs || '없음'}`
  )
  return notification.dialogs.slice(0, 300)
})

await check('Claude 연동 끄기(넣은 훅만 뺀다)', 'required', async () => {
  const { value } = await callWithConfirm(
    'window.pitwall.claudeHook.disable()',
    'confirm-hook-disable'
  )
  assert(value?.status === 'done', `결과 ${JSON.stringify(value)}`)
  const text = readFileSync(CLAUDE_SETTINGS, 'utf8')
  assert(!text.includes('/pitwall-hook/'), `훅이 남아 있다: ${text.slice(0, 300)}`)
  return value.message ?? ''
})

// ── 디스크 정리 ──
let diskRow = null
await check('디스크 정리: 끝난 워크트리의 의존성 폴더를 찾고 크기를 잰다', 'required', async () => {
  await page.eval('window.pitwall.diskScan()', 120_000)
  diskRow = await waitFor(
    async () => {
      const rows = (await latest()).disk?.rows ?? []
      const row = rows.find((r) => samePath(r.worktreeRoot, fixtures.doneRoot))
      return row && row.totalBytes != null ? row : null
    },
    60_000,
    1000
  )
  const disk = (await latest()).disk
  assert(diskRow, `끝난 워크트리가 목록에 없다: ${JSON.stringify(disk)}`)
  assert(diskRow.evidence === 'upstreamGone', `근거 ${diskRow.evidence}`)
  assert(diskRow.inUse === false, '사용 중으로 본다')
  const mb = diskRow.totalBytes / 2 ** 20
  assert(mb > 4.5 && mb < 6.5, `크기 ${mb.toFixed(2)}MB(5MB 를 넣었다)`)
  await gotoTab('disk')
  await sleep(800)
  await shot('disk-found')
  return `${diskRow.branch} ${diskRow.folders.map((f) => f.name).join(',')} ${mb.toFixed(2)}MB`
})

await check('디스크 정리: 확인 뒤 의존성 폴더만 지운다', 'required', async () => {
  assert(diskRow, '지울 줄이 없다')
  const { value } = await callWithConfirm(
    `window.pitwall.diskRemove(${JSON.stringify(diskRow.worktreeRoot)})`,
    'confirm-disk-remove'
  )
  assert(value?.status === 'killed', `결과 ${JSON.stringify(value)}`)
  assert(!existsSync(join(fixtures.doneRoot, 'node_modules')), 'node_modules 가 남아 있다')
  assert(existsSync(join(fixtures.doneRoot, 'done.txt')), '소스 파일까지 지워졌다')
  return value.message ?? JSON.stringify(value.freed)
})

await check(
  '한글 폴더(자소 분리형)의 워크트리: 서버가 도는 동안은 사용 중으로 본다',
  'info',
  async () => {
    assert(fixtures.nfd?.pid, '준비하지 못했다')
    assert(alive(fixtures.nfd.pid), '서버가 이미 끝났다')
    const rows = (await latest()).disk?.rows ?? []
    const row = rows.find((r) => samePath(r.worktreeRoot, fixtures.nfd.doneRoot))
    assert(row, `목록에 없다(목록: ${rows.map((r) => r.worktreeRoot).join(', ') || '비어 있음'})`)
    const form = row.worktreeRoot === row.worktreeRoot.normalize('NFC') ? 'NFC' : 'NFD'
    assert(
      row.inUse === true,
      `서버(:${fixtures.nfd.port})가 그 폴더에서 도는데 사용 중이 아니라고 본다 — 지울 수 있는 줄로 나온다(git 이 준 경로는 ${form})`
    )
    return `사용 중으로 봄(git 이 준 경로는 ${form})`
  }
)

// ── 끄기 ──
await check('서버 끄기: 확인 뒤 종료(SIGTERM)', 'required', async () => {
  await gotoTab('ports')
  const { value, dialogText } = await callWithConfirm(
    `window.pitwall.killServer(${fixtures.serverA.pid})`,
    'confirm-kill'
  )
  assert(
    value?.status === 'killed',
    `결과 ${JSON.stringify(value)} / 창: ${dialogText.slice(0, 120)}`
  )
  const gone = await waitFor(() => !alive(fixtures.serverA.pid), 10_000, 200)
  assert(gone, '프로세스가 살아 있다')
  return dialogText.replace(/\s+/g, ' ').slice(0, 160)
})

await check('서버 끄기: SIGTERM 을 무시하면 3초 뒤 강제 종료(자식 포함)', 'required', async () => {
  const startedAt = Date.now()
  const { value } = await callWithConfirm(
    `window.pitwall.killServer(${fixtures.serverB.pid})`,
    null
  )
  assert(value?.status === 'killed', `결과 ${JSON.stringify(value)}`)
  const gone = await waitFor(
    () => !alive(fixtures.serverB.pid) && !alive(fixtures.serverB.childPid),
    10_000,
    200
  )
  assert(
    gone,
    `살아 있다: 서버 ${alive(fixtures.serverB.pid)}, 자식 ${alive(fixtures.serverB.childPid)}`
  )
  assert(alive(fixtures.agent.pid), '같은 워크트리의 에이전트까지 꺼졌다')
  return `${Date.now() - startedAt}ms`
})

await check('끈 서버가 목록에서 사라지고 기록에 남는다', 'required', async () => {
  await page.eval('window.pitwall.refreshNow()')
  const s = await waitFor(
    async () => {
      const now = await latest()
      return now.servers.every(
        (r) => !r.ports.includes(fixtures.serverA.port) && !r.ports.includes(fixtures.serverB.port)
      )
        ? now
        : null
    },
    20_000,
    1000
  )
  assert(s, '끈 서버가 목록에 남아 있다')
  const events = await page.eval('window.pitwall.events.get()')
  await gotoTab('events')
  await sleep(700)
  await shot('events-after')
  return `기록 ${events.length}건`
})

// ── 설정·테마 ──
await check('설정 화면', 'info', async () => {
  assert(await click('[aria-label="Corral 메뉴"]'), '메뉴 버튼이 없다')
  await sleep(300)
  const opened = await page.eval(`(() => {
    const item = [...document.querySelectorAll('button')].find((b) => b.innerText.includes('설정…'))
    if (!item) return false
    item.click()
    return true
  })()`)
  assert(opened, '설정 항목이 없다')
  await sleep(900)
  await shot('settings')
  await page.eval('window.scrollTo(0, document.body.scrollHeight)')
  const settings = await page.eval('window.pitwall.settings.get()')
  return `테마 ${settings.theme}, 로그인할 때 실행 ${settings.launchAtLogin}, 새로고침 ${settings.refresh}`
})

await check('밝은 테마', 'info', async () => {
  const before = await page.eval('window.pitwall.settings.get()')
  await page.eval(`window.pitwall.settings.save(${JSON.stringify({ ...before, theme: 'light' })})`)
  await page.eval(`(() => {
    const back = [...document.querySelectorAll('button')].find(
      (b) => (b.getAttribute('aria-label') ?? b.title ?? b.innerText).includes('대시보드로')
    )
    back?.click()
    return !!back
  })()`)
  await sleep(600)
  await gotoTab('workspaces')
  await sleep(900)
  await shot('light-theme')
  await page.eval(`window.pitwall.settings.save(${JSON.stringify(before)})`)
  await sleep(500)
})

await check('새 버전 확인(macOS 는 알리기만 한다)', 'info', async () => {
  const status = await page.eval('window.pitwall.update.check()', 40_000)
  assert(status && status.state !== 'error', `상태 ${JSON.stringify(status)}`)
  return JSON.stringify(status)
})

await check('화면 오류(console.error·예외)가 없다', 'info', async () => {
  writeFileSync(join(OUT, 'renderer-errors.txt'), page.errors.join('\n'))
  assert(
    page.errors.length === 0,
    `${page.errors.length}건: ${page.errors.slice(0, 3).join(' | ')}`
  )
})

// ── 메뉴 막대(트레이) ──
await check('메뉴 막대 아이콘을 누르면 요약 창이 뜬다', 'info', async () => {
  screenShot('screen-menubar')
  const r = sh('osascript', [
    '-e',
    'tell application "System Events" to tell process "Corral" to click menu bar item 1 of menu bar 2'
  ])
  assert(r.status === 0, `아이콘을 누르지 못했다: ${r.stderr.trim()}`)
  const target = await waitFor(async () => {
    const targets = await listTargets()
    return targets.find((t) => t.type === 'page' && t.url.includes('view=tray'))
  }, 15_000)
  assert(target, '요약 창이 뜨지 않았다')
  const tray = await Target.attach(target.webSocketDebuggerUrl)
  await sleep(1500)
  await tray.screenshot(join(OUT, `${String(shots++).padStart(2, '0')}-tray-window.png`))
  screenShot('screen-tray-open')
  const text = await tray.eval('document.body.innerText')
  assert(text.length > 20, `요약 창이 비어 있다: ${text}`)
  return text.replace(/\s+/g, ' ').slice(0, 160)
})

// ── 창 닫기 = 숨기기, 다시 열기 ──
await check('창을 닫으면 숨기만 하고 계속 돈다, 다시 열면 보인다', 'info', async () => {
  sh('open', [APP])
  await sleep(1500)
  let how = '닫기 버튼'
  let r = osa(`tell application "System Events" to tell process "Corral"
  set w to first window whose subrole is "AXStandardWindow"
  click (first button of w whose subrole is "AXCloseButton")
end tell`)
  if (r.status !== 0) {
    how = `Cmd+W(닫기 버튼은 ${r.stderr.trim().slice(0, 120)})`
    r = osa('tell application "System Events" to keystroke "w" using command down')
  }
  assert(r.status === 0, `창을 닫지 못했다: ${r.stderr.trim()}`)
  const hidden = await waitFor(() => page.eval(`document.visibilityState === 'hidden'`), 10_000)
  assert(hidden, `창이 숨지 않았다(${how})`)
  assert(appRunning(), '앱이 끝났다')
  await sleep(1000)
  screenShot('screen-window-closed')
  const dock = osa(
    'tell application "System Events" to get name of every application process whose background only is false'
  ).stdout
  sh('open', [APP])
  const shown = await waitFor(() => page.eval(`document.visibilityState === 'visible'`), 15_000)
  assert(shown, '다시 열어도 창이 보이지 않는다')
  return `${how}; 숨긴 동안 Dock 에 ${/Corral/.test(dock) ? '남아 있음' : '없음'}`
})

// ── 문서 폴더(macOS 가 앱마다 접근 허락을 묻는 곳)의 저장소 ──
await check('문서 폴더 안의 저장소: 권한을 묻는지, 그동안 수집이 멈추는지', 'info', async () => {
  const dir = join(homedir(), 'Documents', 'corral-smoke-docs')
  mkdirSync(dir, { recursive: true })
  const setup = sh('bash', [
    '-c',
    'cd "$1" && git -c init.defaultBranch=main init -q . && cp "$2/server.js" . && git add -A && git -c user.name=smoke -c user.email=smoke@example.invalid commit -qm init',
    '_',
    dir,
    fixtures.mainRoot
  ])
  assert(setup.status === 0, `저장소를 만들지 못했다: ${setup.stderr}`)
  const server = spawn('node', ['server.js', '5175'], { cwd: dir, detached: true, stdio: 'ignore' })
  server.unref()
  await sleep(1500)
  const startedAt = Date.now()
  page.eval('window.pitwall.refreshNow()', 60_000).catch(() => {})
  const row = await waitFor(
    async () => (await latest()).servers.find((r) => r.ports.includes(5175)),
    30_000,
    1000
  )
  const tookMs = Date.now() - startedAt
  await sleep(3000)
  screenShot('screen-documents-permission')
  const dialogs = systemDialogs()
  const now = await latest()
  const facts = `서버 줄 ${row ? `${tookMs}ms 만에 나옴` : '안 나옴'}, 워크트리 ${row?.worktree?.root ?? '모름'}, 브랜치 ${row?.worktree?.branch ?? '모름'}, 수집 지연 ${now.stale}, 오류 ${now.error ?? '없음'}, OS 창: ${dialogs || '없음'}`
  try {
    process.kill(server.pid, 'SIGKILL')
  } catch {
    // 이미 끝났으면 됐다.
  }
  assert(row, facts)
  assert(row.worktree?.branch === 'main', facts)
  return facts
})

// ── 종료 ──
await check('종료(Cmd+Q 와 같은 요청)하면 끝나고 기록을 남긴다', 'required', async () => {
  const startedAt = Date.now()
  let how = 'AppleScript quit'
  const quit = sh('osascript', ['-e', 'tell application "Corral" to quit'], { timeout: 20_000 })
  let gone = await waitFor(() => !appRunning(), 10_000, 300)
  if (!gone) {
    // 러너가 AppleScript 를 막으면 종료 신호로 같은 길(before-quit)을 본다.
    how = `SIGTERM(AppleScript 는 ${quit.stderr.trim() || quit.status})`
    sh('pkill', ['-TERM', '-x', 'Corral'])
    gone = await waitFor(() => !appRunning(), 15_000, 300)
  }
  if (!gone) {
    sh('pkill', ['-KILL', '-x', 'Corral'])
    throw new Error(`끝나지 않아 강제로 껐다(${how})`)
  }
  const files = existsSync(USER_DATA) ? readdirSync(USER_DATA) : []
  assert(files.includes('history.json'), `history.json 이 없다: ${files.join(', ')}`)
  assert(files.includes('config.json'), `config.json 이 없다: ${files.join(', ')}`)
  return `${how}, ${Date.now() - startedAt}ms, 설정 폴더: ${files.join(', ')}`
})

await check('충돌 보고서가 없다', 'required', async () => {
  const crashes = collectDiagnostics()
  assert(crashes.length === 0, crashes.join(', '))
})

await check('로그인할 때 실행 등록(기본값 켬)', 'info', async () => {
  const r = sh('sudo', ['-n', 'sfltool', 'dumpbtm'], { maxBuffer: 64 * 1024 * 1024 })
  const lines = (r.stdout ?? '').split('\n')
  const hits = lines.flatMap((line, i) =>
    /corral|pitwall/i.test(line) ? [lines.slice(Math.max(0, i - 3), i + 8).join('\n')] : []
  )
  writeFileSync(join(OUT, 'login-items.txt'), hits.join('\n---\n') || r.stderr || '(없음)')
  assert(hits.length > 0, `등록된 항목이 없다(sfltool ${r.status})`)
  return `${hits.length}곳에 보인다`
})

finish()
