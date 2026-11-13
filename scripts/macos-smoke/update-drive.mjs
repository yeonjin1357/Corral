/**
 * macOS 의 앱 안 업데이트를 실제 앱으로 확인한다(macOS 러너용, check-update.sh 가 부른다).
 * 깔려 있는 지금 버전을 띄워 설정 > 정보의 업데이트 버튼을 누르고, 앱이 새 버전으로 바뀌어 다시 켜지는지 본다.
 * 그다음 확인 값이 틀린 릴리스 정보를 주고, 앱이 그대로 남아 설치 한 줄을 안내하는지 본다.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const OUT = process.env.SMOKE_OUT
const OLD = process.env.SMOKE_OLD_VERSION
const NEW = process.env.SMOKE_NEW_VERSION
const APP = '/Applications/Corral.app'
const PORT = 9333
const USER_DATA = join(homedir(), 'Library', 'Application Support', 'pitwall')
const GOOD_FEED = 'http://127.0.0.1:8765'
const BAD_FEED = 'http://127.0.0.1:8766'
const COMMAND =
  'curl -fsSL https://raw.githubusercontent.com/yeonjin1357/Corral/main/scripts/install-mac.sh | bash'

const ICON = { pass: '✅', fail: '❌' }
const results = []
let shots = 1

async function check(name, fn) {
  try {
    const detail = await fn()
    results.push({ name, status: 'pass', detail: typeof detail === 'string' ? detail : '' })
    console.log(`✅ ${name}${typeof detail === 'string' && detail ? ` — ${detail}` : ''}`)
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    results.push({ name, status: 'fail', detail })
    console.log(`❌ ${name} — ${detail}`)
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message)
}
const sh = (command, args, options = {}) =>
  spawnSync(command, args, { encoding: 'utf8', timeout: 60_000, ...options })
const pidOf = () => Number(sh('pgrep', ['-x', 'Corral']).stdout.trim().split('\n')[0]) || null
const installedVersion = () =>
  sh('/usr/libexec/PlistBuddy', [
    '-c',
    'Print :CFBundleShortVersionString',
    `${APP}/Contents/Info.plist`
  ]).stdout.trim()
const leftovers = () => readdirSync('/Applications').filter((name) => /^Corral\.app\./.test(name))
const screenShot = (name) =>
  sh('screencapture', ['-x', join(OUT, `update-${String(shots++).padStart(2, '0')}-${name}.png`)])

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

/** 메인 창에 붙는다(식을 실행하고 스크린샷을 찍는 만큼만). */
async function attach() {
  const target = await waitFor(async () => {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
    return list.find(
      (t) => t.type === 'page' && t.url.includes('index.html') && !t.url.includes('view=tray')
    )
  }, 60_000)
  assert(target, '메인 창을 찾지 못했다')
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', () => reject(new Error('CDP 연결 실패')), { once: true })
  })
  let nextId = 1
  const pending = new Map()
  ws.addEventListener('message', (message) => {
    const msg = JSON.parse(message.data)
    const waiting = pending.get(msg.id)
    if (!waiting) return
    pending.delete(msg.id)
    if (msg.error) waiting.reject(new Error(msg.error.message))
    else waiting.resolve(msg.result)
  })
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => pending.delete(id) && reject(new Error(`${method}: 답이 없다`)), 30_000)
    })
  const page = {
    async eval(expression) {
      const r = await send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
        userGesture: true
      })
      if (r.exceptionDetails)
        throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
      return r.result.value
    },
    async shot(name) {
      const r = await send('Page.captureScreenshot', { format: 'png' })
      writeFileSync(
        join(OUT, `update-${String(shots++).padStart(2, '0')}-${name}.png`),
        Buffer.from(r.data, 'base64')
      )
    },
    click: (selector) =>
      page.eval(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)})
        if (!el) return false
        el.click()
        return true
      })()`)
  }
  const ready = await waitFor(
    () => page.eval(`document.readyState === 'complete' && typeof window.pitwall === 'object'`),
    30_000
  )
  assert(ready, '화면이 다 뜨지 않았다')
  return page
}

/** 앱을 띄운다(릴리스 정보를 받을 이 러너 안의 주소를 준다). */
function launch(feed) {
  const r = sh('open', [
    APP,
    '--args',
    `--update-feed=${feed}`,
    `--remote-debugging-port=${PORT}`,
    '--remote-allow-origins=*'
  ])
  assert(r.status === 0, `open 실패: ${r.stderr}`)
}
async function quit() {
  sh('osascript', ['-e', 'tell application "Corral" to quit'])
  const gone = await waitFor(() => pidOf() === null, 15_000, 300)
  if (!gone) sh('pkill', ['-x', 'Corral'])
  await sleep(1000)
}
/** 설정 > 정보로 간다(제목줄 메뉴의 "새 버전 확인…"). */
async function openAbout(page) {
  assert(await page.click('[aria-label="Corral 메뉴"]'), '메뉴 버튼이 없다')
  await sleep(300)
  const opened = await page.eval(`(() => {
    const item = [...document.querySelectorAll('button')].find((b) => b.innerText.includes('새 버전 확인'))
    if (!item) return false
    item.click()
    return true
  })()`)
  assert(opened, '"새 버전 확인…" 항목이 없다')
  await sleep(800)
}

// ───────────────────────── 1. 업데이트 버튼으로 새 버전이 된다 ─────────────────────────
let page = null
let oldPid = null

await check(`지금 버전(${OLD})이 뜨고 새 버전(${NEW})이 있다고 알린다`, async () => {
  assert(installedVersion() === OLD, `깔린 버전 ${installedVersion()}`)
  launch(GOOD_FEED)
  page = await attach()
  oldPid = pidOf()
  const info = await page.eval('window.pitwall.appInfo()')
  assert(info.version === OLD, `실행 중인 버전 ${info.version}`)
  const status = await page.eval('window.pitwall.update.check()')
  assert(status?.state === 'available', `상태 ${JSON.stringify(status)}`)
  assert(status.version === NEW, `알린 버전 ${status.version}`)
  assert(status.selfInstall === true, `앱 안 업데이트를 권하지 않는다: ${JSON.stringify(status)}`)
  // 업데이트 뒤에도 설정이 남는지 보려고 하나 바꿔 둔다(기본은 어두운 테마).
  const settings = await page.eval('window.pitwall.settings.get()')
  const saved = await page.eval(
    `window.pitwall.settings.save(${JSON.stringify({ ...settings, theme: 'light' })})`
  )
  assert(saved.theme === 'light', `설정 저장: ${saved.theme}`)
  return `pid ${oldPid}, 상태 ${JSON.stringify(status)}`
})

await check('설정 > 정보에 업데이트 버튼이 보인다', async () => {
  await openAbout(page)
  const button = await waitFor(
    () =>
      page.eval(`document.querySelector('[data-action="update-self-install"]')?.innerText ?? null`),
    10_000
  )
  assert(button, '업데이트 버튼이 없다')
  await page.shot('button')
  return `버튼 "${button.trim()}", 문구 "${await page.eval(`document.querySelector('.update-state')?.innerText ?? ''`)}"`
})

await check('업데이트를 누르면 앱이 끝나고, 새 버전으로 바뀌어 다시 켜진다', async () => {
  const startedAt = Date.now()
  assert(await page.click('[data-action="update-self-install"]'), '버튼을 누르지 못했다')
  const ended = await waitFor(() => pidOf() !== oldPid, 120_000, 300)
  assert(ended, '2분 안에 예전 앱이 끝나지 않았다')
  const newPid = await waitFor(
    () => {
      const pid = pidOf()
      return pid && pid !== oldPid ? pid : null
    },
    60_000,
    300
  )
  screenShot('relaunched')
  assert(
    newPid,
    `다시 켜지지 않았다(깔린 버전 ${installedVersion()}, 남은 것 ${leftovers().join(', ')})`
  )
  assert(installedVersion() === NEW, `깔린 버전이 ${installedVersion()}`)
  assert(leftovers().length === 0, `임시 폴더가 남았다: ${leftovers().join(', ')}`)
  assert(!existsSync(join(USER_DATA, 'update-failed')), '실패 표시가 남았다')
  const signed = sh('codesign', ['--verify', '--deep', '--strict', APP])
  assert(signed.status === 0, `바꿔 넣은 앱의 서명이 깨졌다: ${signed.stderr}`)
  return `${Date.now() - startedAt}ms, pid ${oldPid} → ${newPid}, 깔린 버전 ${installedVersion()}`
})

await check('다시 켜진 새 버전이 정상으로 일하고, 설정은 그대로다', async () => {
  // 도우미가 켠 앱에는 디버깅 포트가 없다. 끝내고 포트를 열어 다시 띄운다.
  await sleep(4000)
  await quit()
  launch(GOOD_FEED)
  page = await attach()
  const info = await page.eval('window.pitwall.appInfo()')
  assert(info.version === NEW, `실행 중인 버전 ${info.version}`)
  const snapshot = await waitFor(
    async () => {
      const s = await page.eval('window.pitwall.getLatest()')
      return s && !s.stale ? s : null
    },
    60_000,
    1000
  )
  assert(snapshot && snapshot.error == null, `수집: ${JSON.stringify(snapshot?.error)}`)
  const status = await page.eval('window.pitwall.update.check()')
  assert(status?.state === 'none', `새 버전인데도 상태가 ${JSON.stringify(status)}`)
  const settings = await page.eval('window.pitwall.settings.get()')
  assert(settings.theme === 'light', `업데이트 전에 바꾼 설정이 사라졌다(테마 ${settings.theme})`)
  return `버전 ${info.version}, 다른 앱 ${snapshot.apps.length}줄, 새 버전 확인 "${status.state}", 바꿔 둔 설정(밝은 테마) 그대로`
})

// ───────────────────────── 2. 확인 값이 틀리면 앱은 그대로 ─────────────────────────
await check(
  '내려받은 파일의 확인 값이 다르면 바꿔 넣지 않고, 까닭과 설치 한 줄을 알린다',
  async () => {
    // 새 버전(99.0.0)이 깔린 채로는 "새 버전 있음"이 되지 않는다. 지금 버전으로 되돌려 놓고 틀린 릴리스 정보를 준다.
    await quit()
    const old = readdirSync('dist').find((name) => name.endsWith('.dmg'))
    const volume = join(process.env.RUNNER_TEMP, 'update-volume-2')
    assert(
      sh('hdiutil', ['attach', join('dist', old), '-nobrowse', '-readonly', '-mountpoint', volume])
        .status === 0,
      '예전 버전 설치 파일을 열지 못했다'
    )
    sh('rm', ['-rf', APP])
    sh('ditto', [join(volume, 'Corral.app'), APP])
    sh('hdiutil', ['detach', volume, '-quiet'])
    assert(installedVersion() === OLD, `되돌린 버전 ${installedVersion()}`)

    launch(BAD_FEED)
    page = await attach()
    const pid = pidOf()
    const before = await page.eval('window.pitwall.update.check()')
    assert(before?.state === 'available' && before.selfInstall === true, JSON.stringify(before))
    await openAbout(page)
    await waitFor(
      () => page.eval(`!!document.querySelector('[data-action="update-self-install"]')`),
      10_000
    )
    assert(await page.click('[data-action="update-self-install"]'), '버튼을 누르지 못했다')
    const after = await waitFor(
      async () => {
        const s = await page.eval('window.pitwall.update.get()')
        return s?.state === 'available' && s.selfInstall === false ? s : null
      },
      120_000,
      500
    )
    assert(
      after,
      `실패로 돌아오지 않았다: ${JSON.stringify(await page.eval('window.pitwall.update.get()'))}`
    )
    assert(after.error === '내려받은 파일이 릴리스의 확인 값과 달라요.', `까닭: ${after.error}`)
    assert(after.installCommand === COMMAND, `설치 한 줄: ${after.installCommand}`)
    assert(pidOf() === pid, '앱이 끝났다')
    assert(installedVersion() === OLD, `깔린 버전이 ${installedVersion()} 로 바뀌었다`)
    assert(leftovers().length === 0, `풀다 만 것이 남았다: ${leftovers().join(', ')}`)
    await sleep(500)
    await page.shot('failed')
    return `까닭 "${after.error}", 앱은 pid ${pid} 그대로 버전 ${installedVersion()}`
  }
)

await check('실패했을 때 한 줄 복사를 누르면 설치 한 줄이 클립보드에 들어간다', async () => {
  sh('bash', ['-c', 'printf "" | pbcopy'])
  assert(await page.click('[data-action="update-copy-command"]'), '복사 버튼이 없다')
  const pasted = await waitFor(
    () => {
      const value = sh('pbpaste', []).stdout
      return value === COMMAND ? value : null
    },
    5000,
    200
  )
  assert(pasted, `클립보드: ${sh('pbpaste', []).stdout}`)
  return pasted
})

await quit()

const failed = results.filter((r) => r.status === 'fail').length
const cell = (value) => String(value).replace(/\|/g, '\\|').replace(/\s+/g, ' ').slice(0, 400)
writeFileSync(join(OUT, 'update-results.json'), JSON.stringify(results, null, 2))
writeFileSync(
  join(OUT, 'update-summary.md'),
  [
    `## Corral macOS 앱 안 업데이트 확인 (${OLD} → ${NEW})`,
    '',
    `통과 ${results.length - failed} · 실패 ${failed}`,
    '',
    '| | 확인 | 내용 |',
    '|---|---|---|',
    ...results.map((r) => `| ${ICON[r.status]} | ${cell(r.name)} | ${cell(r.detail)} |`),
    ''
  ].join('\n')
)
console.log(`\n통과 ${results.length - failed} · 실패 ${failed}`)
process.exit(failed > 0 ? 1 : 0)
