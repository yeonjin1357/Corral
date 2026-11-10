import { agentCovers, worktreeKey } from './format'

interface Placed {
  workspace: { root: string } | null
  worktree: { root: string } | null
}

/**
 * 그 작업 공간에서 일하는 에이전트: 같은 작업 공간이거나, 묶음 항목(서버·남은 프로세스)의 워크트리를 감싸는
 * 폴더에서 일한다(작업 공간 판별에 실패한 에이전트 포함). 묶음 머리와 작업 공간 정리 확인 창이 같이 쓴다.
 */
export function agentsInWorkspace<A extends Placed>(
  agents: A[],
  root: string,
  memberRoots: string[]
): A[] {
  const key = worktreeKey(root)
  return agents.filter(
    (a) =>
      (a.workspace && worktreeKey(a.workspace.root) === key) ||
      (a.worktree && memberRoots.some((r) => agentCovers([a.worktree!.root], r)))
  )
}
