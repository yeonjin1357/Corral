/**
 * 연동 안내 카드: 에이전트를 돌리는데 그 도구의 연동이 꺼져 있으면 대시보드에서 한 번 권한다.
 * 연동은 설정 화면 안에 있어 모르고 지나치기 쉽다. 닫으면 그 도구는 다시 권하지 않는다(이 PC 화면의 편의 값이라
 * localStorage 에 둔다).
 */
import type { AgentTool, DashboardSnapshot } from '../../shared/types'
import type { StorageLike } from './storage'

/** 권하는 순서. */
const TOOLS: readonly AgentTool[] = ['claude', 'codex']

/**
 * 연동을 권할 도구: 그 도구의 에이전트가 실행 중이고, 연동이 꺼져 있고(off), 사용자가 닫지 않은 것.
 * 상태를 아직 모르거나(null) 다시 켜야 하는 상태·문제가 있는 상태는 권하지 않는다(설정 화면이 다룬다).
 */
export function hintTools(
  snapshot: Pick<DashboardSnapshot, 'agents' | 'hook' | 'codexHook'> | null,
  dismissed: readonly AgentTool[]
): AgentTool[] {
  if (!snapshot) return []
  const state = { claude: snapshot.hook?.state, codex: snapshot.codexHook?.state }
  return TOOLS.filter(
    (tool) =>
      state[tool] === 'off' &&
      !dismissed.includes(tool) &&
      snapshot.agents.some((a) => a.tool === tool)
  )
}

const KEY = 'pitwall.integrationHintDismissed'

/** 닫은 도구들. 저장소가 없거나 값이 깨졌으면 닫은 것이 없는 것으로 본다(다시 권한다). */
export function readHintDismissed(storage: StorageLike | null): AgentTool[] {
  if (!storage) return []
  try {
    const value: unknown = JSON.parse(storage.getItem(KEY) ?? '[]')
    return Array.isArray(value) ? TOOLS.filter((tool) => value.includes(tool)) : []
  } catch {
    return []
  }
}

export function writeHintDismissed(storage: StorageLike | null, tools: readonly AgentTool[]): void {
  try {
    storage?.setItem(KEY, JSON.stringify(tools))
  } catch {
    // 저장소가 막혀도 이번 실행 동안은 화면 상태로 유지된다.
  }
}
