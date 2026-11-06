import { randomBytes, randomInt } from 'node:crypto'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join } from 'node:path'

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
  try {
    const value = JSON.parse(await readFile(join(userData, CONFIG_FILE), 'utf8')) as {
      hook?: unknown
    }
    return { hook: validHook(value?.hook) }
  } catch {
    return { hook: null }
  }
}

export async function saveConfig(userData: string, config: PitwallConfig): Promise<void> {
  const path = join(userData, CONFIG_FILE)
  const tmp = `${path}.tmp-${process.pid}`
  try {
    await writeFile(tmp, JSON.stringify(config, null, 2) + '\n')
    await rename(tmp, path)
  } catch (e) {
    await rm(tmp, { force: true })
    throw e
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
  const config = await loadConfig(userData)
  if (config.hook) return config.hook
  const hook = { port: await (deps.pickPort ?? pickFreePort)(), token: randomHookToken() }
  await saveConfig(userData, { ...config, hook })
  return hook
}
