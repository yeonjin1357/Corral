import type { AgentTool } from '../shared/types'
import type { HookConfig } from './config'
import { createHookServer, type HookServer } from './hookServer'

/**
 * Claude·Codex 연동이 같이 쓰는 훅 서버 하나. 켜진 연동이 하나라도 있으면 열어 두고, 모두 놓으면 닫는다.
 * 같은 포트·토큰(config.json 의 hook)을 쓰므로 한쪽을 꺼도 다른 쪽 이벤트는 계속 받는다.
 */
export interface HookHub {
  /** 그 연동이 서버를 쓴다고 알린다. 다른 포트·토큰으로 열려 있으면 새로 연다. 열지 못하면 예외. */
  claim(owner: AgentTool, hook: HookConfig): Promise<void>
  /** 그 연동이 서버를 그만 쓴다. 아무도 안 쓰면 닫는다. */
  release(owner: AgentTool): Promise<void>
  stop(): Promise<void>
}

export function createHookHub(opts: {
  onEvent: (event: Record<string, unknown>, tool: AgentTool) => void
  open?: typeof createHookServer
}): HookHub {
  const open = opts.open ?? createHookServer
  const owners = new Set<AgentTool>()
  let server: HookServer | null = null
  let serverHook: HookConfig | null = null

  async function close(): Promise<void> {
    const s = server
    server = null
    serverHook = null
    if (s) await s.close()
  }

  return {
    async claim(owner, hook) {
      if (!(server && serverHook?.port === hook.port && serverHook.token === hook.token)) {
        await close()
        server = await open({ port: hook.port, token: hook.token, onEvent: opts.onEvent })
        serverHook = hook
      }
      owners.add(owner)
    },
    async release(owner) {
      owners.delete(owner)
      if (owners.size === 0) await close()
    },
    async stop() {
      owners.clear()
      await close()
    }
  }
}
