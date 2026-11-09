import { randomBytes, randomInt } from 'node:crypto'
import { copyFile, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { normalizeSettings, type Settings } from '../shared/settings'

/**
 * 훅 서버 포트를 고르는 범위. 개발 서버가 흔히 쓰는 포트(3000·5173·8080 등)와 겹치지 않고,
 * OS 가 나가는 연결에 임시로 쓰는 동적 포트(49152~65535)보다 아래다.
 */
export const HOOK_PORT_MIN = 40000
export const HOOK_PORT_MAX = 48999

export interface HookConfig {
  port: number
  token: string
}

/** pitwall 자신의 설정(앱 데이터 폴더의 config.json). */
export interface PitwallConfig {
  hook: HookConfig | null
  settings: Settings
}

const CONFIG_FILE = 'config.json'
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/

export function randomHookToken(): string {
  return randomBytes(32).toString('base64url')
}

function validHook(value: unknown): HookConfig | null {
  if (!value || typeof value !== 'object') return null
  const { port, token } = value as { port?: unknown; token?: unknown }
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) return null
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) return null
  return { port, token }
}

export async function loadConfig(userData: string): Promise<PitwallConfig> {
  let value: unknown = null
  try {
    value = JSON.parse(await readFile(join(userData, CONFIG_FILE), 'utf8'))
  } catch {
    // 없거나 깨진 파일은 빈 설정으로 본다(앱은 기본값으로 뜬다).
  }
  const v = (value && typeof value === 'object' ? value : {}) as {
    hook?: unknown
    settings?: unknown
  }
  return { hook: validHook(v.hook), settings: normalizeSettings(v.settings) }
}

/** 바로 쓰기보다 updateConfig 를 쓴다(같은 파일을 동시에 고치면 한쪽이 지워질 수 있다). */
export async function saveConfig(userData: string, config: PitwallConfig): Promise<void> {
  const path = join(userData, CONFIG_FILE)
  const tmp = `${path}.tmp-${process.pid}`
  const data = { hook: config.hook, settings: normalizeSettings(config.settings) }
  try {
    await writeFile(tmp, JSON.stringify(data, null, 2) + '\n')
    await rename(tmp, path)
  } catch (e) {
    await rm(tmp, { force: true })
    throw e
  }
}

/**
 * 있는데 읽을 수 없는(깨진) 설정 파일은 덮어쓰기 전에 옆에 남긴다. 그 안의 훅 포트·토큰이 Claude 설정에 들어간
 * 명령과 맞아야 하므로, 사용자가 되살릴 수 있게 한다.
 */
async function keepBrokenFile(path: string): Promise<void> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    return
  }
  try {
    JSON.parse(text)
  } catch {
    await copyFile(path, `${path}.broken-${Date.now()}`).catch(() => {})
  }
}

/** 파일마다 읽기·고치기·쓰기를 한 줄로 세운다. 훅 설정과 일반 설정을 동시에 저장해도 서로 지우지 않는다. */
const queues = new Map<string, Promise<unknown>>()

export async function updateConfig(
  userData: string,
  mutate: (current: PitwallConfig) => PitwallConfig | Promise<PitwallConfig>
): Promise<PitwallConfig> {
  const path = join(userData, CONFIG_FILE)
  const previous = queues.get(path) ?? Promise.resolve()
  const run = previous
    .catch(() => {})
    .then(async () => {
      const current = await loadConfig(userData)
      const next = await mutate(current)
      if (next !== current) {
        await keepBrokenFile(path)
        await saveConfig(userData, next)
      }
      return next
    })
  queues.set(path, run)
  try {
    return await run
  } finally {
    if (queues.get(path) === run) queues.delete(path)
  }
}

function isFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', () => resolve(false))
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)))
  })
}

/** 범위 안에서 무작위로 골라 실제로 열어 보고 빈 포트를 돌려준다. */
export async function pickFreePort(
  candidate: () => number = () => randomInt(HOOK_PORT_MIN, HOOK_PORT_MAX + 1),
  tries = 20
): Promise<number> {
  for (let i = 0; i < tries; i++) {
    const port = candidate()
    if (await isFree(port)) return port
  }
  throw new Error('no free port for the hook server')
}

/** 훅 설정이 없으면 빈 포트와 새 토큰을 만들어 저장한다. 있으면 그대로(설치된 훅 명령과 맞아야 하므로). */
export async function ensureHookConfig(
  userData: string,
  deps: { pickPort?: () => Promise<number> } = {}
): Promise<HookConfig> {
  const config = await updateConfig(userData, async (current) =>
    current.hook
      ? current
      : {
          ...current,
          hook: { port: await (deps.pickPort ?? pickFreePort)(), token: randomHookToken() }
        }
  )
  return config.hook!
}
