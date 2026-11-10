import type { AgentRow, DashboardSnapshot } from '../shared/types'
import type { NotifySettings } from '../shared/settings'
import {
  formatDuration,
  formatFreed,
  pressureText,
  worktreeFolder,
  worktreeLabel
} from '../shared/format'
import { agentKey, selectionKey } from '../shared/keys'
import { cleanupRecommendation } from '../shared/recommend'
import { text } from '../shared/text'

/**
 * OS 알림 하나. target 은 누르면 갈 목록 항목(선택 키), null 이면 한눈에 보기.
 * focusAgentKey 는 지금 있는 에이전트 하나에 대한 알림이면 그 에이전트의 선택 키(누르면 그 에이전트의 창으로 가 본다,
 * 설정 notifyClickFocus). 꺼짐 알림에는 없다.
 * 제목·본문에는 명령·프롬프트·세션 제목을 넣지 않는다(OS 알림 센터가 디스크에 남긴다). 도구 이름까지만.
 */
export interface Notice {
  title: string
  body: string
  target: string | null
  focusAgentKey?: string
}

/** 꺼짐 알림에 쓰려고 지난 스냅샷에서 기억해 두는 에이전트(하는 일 내용은 들고 있지 않는다). */
type AgentBrief = Pick<AgentRow, 'pid' | 'startedAt' | 'tool' | 'worktree' | 'state'>

const RAM_COOLDOWN_MS = 30 * 60 * 1000
/** 위험 아래로 이만큼 이어서 내려가 있었으면 정상까지 안 내려와도 다시 알릴 수 있다(늘 경고 근처인 PC). */
const RAM_REARM_MS = 5 * 60 * 1000
const HEAVY_COOLDOWN_MS = 10 * 60 * 1000
/**
 * 이보다 짧게 일한 뒤 끝난 것은 알리지 않는다(터미널에서 주고받는 짧은 답마다 알리면 시끄럽다).
 * 기록(G3g)의 작업 끝남도 같은 기준을 쓴다.
 */
export const DONE_MIN_WORK_MS = 2 * 60 * 1000

const toolName = (a: Pick<AgentRow, 'tool'>): string => text.ui.agent.tools[a.tool]

/**
 * 에이전트 알림: 하나면 그 에이전트로 가는 알림(창으로 가기 키 포함), 여럿이면 하나로 묶는다(본문은 폴더 · 브랜치들).
 */
function agentNotice<A extends Pick<AgentRow, 'pid' | 'startedAt' | 'worktree'>>(
  agents: A[],
  one: (a: A) => { title: string; body: string },
  manyTitle: string
): Notice {
  if (agents.length === 1) {
    const key = selectionKey.agent(agents[0])
    return { ...one(agents[0]), target: key, focusAgentKey: key }
  }
  return {
    title: manyTitle,
    body: agents.map((a) => worktreeLabel(a.worktree)).join(', '),
    target: null
  }
}

/**
 * 스냅샷 변화의 "넘어가는 순간"에만 OS 알림을 보낸다(스펙 §8, 항목별로 끔).
 * - 첫 스냅샷은 기준선이다(시작할 때 이미 그런 상태는 알리지 않는다). 지연된 스냅샷은 건너뛴다.
 * - RAM 부족(메모리 단계 = RAM·커밋 중 높은 쪽): 위험으로 넘어갈 때. 정상으로 내려오거나 위험 아래로 5분 있었으면
 *   다시, 30분 안에는 다시 알리지 않는다. 제목은 원인을 따른다(RAM 이 위험이면 RAM, 아니면 커밋).
 * - 무거운 작업 겹침: 겹침이 시작될 때. 끝나야 다시, 10분 안에는 다시 알리지 않는다.
 * 에이전트 알림은 모두 pitwall 창이 앞에 있으면 보내지 않고, 한꺼번에 여럿이면 하나로 묶는다.
 * - 권한 대기: 훅이나 Claude 세션 파일로 응답 대기가 된 세션마다. 본문에 기다리는 도구 이름(G3e, 훅만 안다). 세션 파일로
 *   안 대기가 질문·입력 요청 등이면 제목이 "답을 기다려요". 계속 기다리면 마지막으로 알린(알릴 때였던) 뒤 reminderMs
 *   마다 다시(0 이면 끔). 풀렸다가 다시 기다리면 새 대기라 첫 알림부터.
 * - 작업 끝남(F4): 정확한 상태(CPU 추정 아님)의 에이전트가 2분 넘게 작업 중이다가 쉬는 중이 될 때.
 * - 조용함(G3c): 조용한 에이전트가 생길 때 한 번.
 * - 꺼짐: 지난 스냅샷에 정확한 상태로 작업 중·권한 대기이던 에이전트가 이번 스냅샷에 없을 때.
 */
export function createNotifier(deps: {
  show: (notice: Notice) => void
  settings: () => NotifySettings
  isFocused: () => boolean
  now: () => number
  /** 계속 권한 대기일 때 다시 알릴 간격(ms). 0 이면 다시 알리지 않는다. */
  reminderMs: () => number
}): { update(s: DashboardSnapshot): void } {
  let started = false
  let ramArmed = true
  let ramLastAt = Number.NEGATIVE_INFINITY
  /** 위험 아래로 내려간 시각(지금 위험이면 null). */
  let ramBelowSince: number | null = null
  let heavyArmed = true
  let heavyLastAt = Number.NEGATIVE_INFINITY
  /** 권한 대기 중인 에이전트: 처음 본 시각과 마지막으로 알린(창이 앞에 있어 건너뛴 것 포함) 시각. */
  let waiting = new Map<string, { firstSeen: number; notifiedAt: number }>()
  /** 정확한 상태로 작업 중인 에이전트와 그 작업이 시작된 시각. */
  let working = new Map<string, number | null>()
  /** 조용한 에이전트. */
  let quiet = new Set<string>()
  /** 정확한 상태로 작업 중·권한 대기인 에이전트(다음 스냅샷에 없으면 꺼짐). */
  let active = new Map<string, AgentBrief>()

  /** 이 에이전트 알림을 보내도 되는지(설정에서 켰고 pitwall 창이 앞에 있지 않음). */
  const allowed = (flag: keyof NotifySettings): boolean =>
    deps.settings()[flag] && !deps.isFocused()

  function ram(s: DashboardSnapshot, notify: boolean): void {
    const { memory } = s
    const now = deps.now()
    if (memory.level !== 'danger') {
      ramBelowSince ??= now
      if (memory.level === 'normal' || now - ramBelowSince >= RAM_REARM_MS) ramArmed = true
      return
    }
    ramBelowSince = null
    if (!ramArmed) return
    ramArmed = false
    if (!notify || now - ramLastAt < RAM_COOLDOWN_MS) return
    ramLastAt = now
    if (!deps.settings().ramLow) return
    const rec = cleanupRecommendation(s)
    deps.show({
      title:
        memory.ramLevel === 'danger' || !memory.commit
          ? text.notify.ramTitle(Math.floor(memory.usedPercent))
          : text.notify.commitTitle(Math.floor(memory.commit.percent)),
      body:
        rec.items.length > 0
          ? text.notify.ramBody(rec.items.length, formatFreed(rec.totalBytes, rec.totalCommitBytes))
          : text.notify.ramNoCandidates,
      target: null
    })
  }

  function claude(s: DashboardSnapshot, notify: boolean): void {
    const now = deps.now()
    const reminderMs = deps.reminderMs()
    const fresh: AgentRow[] = []
    /** 다시 알릴 때가 된 에이전트와 기다린 시간. */
    const still = new Map<AgentRow, number>()
    const next = new Map<string, { firstSeen: number; notifiedAt: number }>()
    for (const a of s.agents) {
      if (a.state !== 'waiting' || (a.stateSource !== 'hook' && a.stateSource !== 'file')) continue
      const key = agentKey(a)
      const prev = waiting.get(key)
      if (!prev) {
        fresh.push(a)
        next.set(key, { firstSeen: now, notifiedAt: now })
      } else if (reminderMs > 0 && now - prev.notifiedAt >= reminderMs) {
        still.set(a, now - (a.stateSince ?? prev.firstSeen))
        next.set(key, { ...prev, notifiedAt: now })
      } else next.set(key, prev)
    }
    waiting = next
    if (!notify || (fresh.length === 0 && still.size === 0) || !allowed('claudeWaiting')) return
    // 명령 요약(activity.waiting.summary)은 넣지 않는다 — 도구 이름까지만.
    const body = (a: AgentRow): string =>
      text.notify.waitingBody(worktreeLabel(a.worktree), a.activity?.waiting?.tool ?? null)
    const manyTitle = (agents: AgentRow[]): string =>
      text.notify.waitingManyTitle(
        agents.length,
        agents.every((a) => a.tool === agents[0].tool) ? toolName(agents[0]) : null
      )
    // 세션 파일로 안 대기는 이유를 따른다: 질문·입력 요청·목표 제안·모르는 이유는 "답을 기다려요"(권한이 아니다).
    const title = (a: AgentRow): string =>
      a.waitReason === 'input' || a.waitReason === 'goal' || a.waitReason === 'other'
        ? text.notify.waitingInputTitle(toolName(a))
        : text.notify.waitingTitle(toolName(a))
    if (fresh.length > 0)
      deps.show(agentNotice(fresh, (a) => ({ title: title(a), body: body(a) }), manyTitle(fresh)))
    if (still.size > 0) {
      const agents = [...still.keys()]
      deps.show(
        agentNotice(
          agents,
          (a) => ({
            title: text.notify.waitingStillTitle(toolName(a), formatDuration(still.get(a)!)),
            body: body(a)
          }),
          manyTitle(agents)
        )
      )
    }
  }

  function agentDone(s: DashboardSnapshot, notify: boolean): void {
    const workedMs = new Map<AgentRow, number>()
    const next = new Map<string, number | null>()
    for (const a of s.agents) {
      // CPU 추정은 잠깐 쉬어도 쉬는 중이 되므로 알리지 않는다(잘못 알리기 쉬움).
      if (a.stateSource === 'cpu') continue
      const key = agentKey(a)
      if (a.state === 'working') next.set(key, a.stateSince)
      else if (a.state === 'idle' && working.has(key)) {
        const since = working.get(key)
        if (since != null) workedMs.set(a, deps.now() - since)
      }
    }
    working = next
    const long = [...workedMs].filter(([, ms]) => ms >= DONE_MIN_WORK_MS).map(([a]) => a)
    if (!notify || long.length === 0 || !allowed('agentDone')) return
    deps.show(
      agentNotice(
        long,
        (a) => ({
          title: text.notify.doneTitle(worktreeFolder(a.worktree), toolName(a)),
          body: text.notify.doneBody(formatDuration(workedMs.get(a)!))
        }),
        text.notify.doneManyTitle(long.length)
      )
    )
  }

  function agentQuiet(s: DashboardSnapshot, notify: boolean): void {
    const rows = s.agents.filter((a) => a.quietSince != null)
    const fresh = rows.filter((a) => !quiet.has(agentKey(a)))
    quiet = new Set(rows.map(agentKey))
    if (!notify || fresh.length === 0 || !allowed('agentQuiet')) return
    deps.show(
      agentNotice(
        fresh,
        (a) => ({
          title: text.notify.quietTitle(worktreeFolder(a.worktree), toolName(a)),
          body: text.notify.quietBody(formatDuration(deps.now() - a.quietSince!))
        }),
        text.notify.quietManyTitle(fresh.length)
      )
    )
  }

  function agentGone(s: DashboardSnapshot, notify: boolean): void {
    const present = new Set(s.agents.map(agentKey))
    const gone = [...active.values()].filter((a) => !present.has(agentKey(a)))
    active = new Map(
      s.agents
        .filter((a) => a.stateSource !== 'cpu' && (a.state === 'working' || a.state === 'waiting'))
        .map((a) => [
          agentKey(a),
          { pid: a.pid, startedAt: a.startedAt, tool: a.tool, worktree: a.worktree, state: a.state }
        ])
    )
    if (!notify || gone.length === 0 || !allowed('agentGone')) return
    const { title, body } = agentNotice(
      gone,
      (a) => ({
        title: text.notify.goneTitle(worktreeFolder(a.worktree), toolName(a)),
        body: text.notify.goneBody[a.state === 'waiting' ? 'waiting' : 'working']
      }),
      text.notify.goneManyTitle(gone.length)
    )
    // 꺼진 에이전트는 목록 행도 창도 없다: 갈 항목·창으로 가기 키 없이 누르면 한눈에 보기를 연다.
    deps.show({ title, body, target: null })
  }

  function heavy(s: DashboardSnapshot, notify: boolean): void {
    if (!s.heavyOverlap) {
      heavyArmed = true
      return
    }
    if (!heavyArmed) return
    heavyArmed = false
    if (!notify || deps.now() - heavyLastAt < HEAVY_COOLDOWN_MS) return
    heavyLastAt = deps.now()
    if (!deps.settings().heavyOverlap) return
    deps.show({
      title: text.notify.heavyTitle(pressureText(s.memory)),
      body: text.notify.heavyBody(s.heavyJobs.map((j) => j.label).join(', ')),
      target: null
    })
  }

  return {
    update(s) {
      // 지연된 스냅샷·RAM 정보가 없는 스냅샷으로는 상태가 넘어갔다고 보지 않는다.
      if (s.stale || s.memory.totalBytes <= 0) return
      const notify = started
      started = true
      ram(s, notify)
      claude(s, notify)
      agentDone(s, notify)
      agentQuiet(s, notify)
      agentGone(s, notify)
      heavy(s, notify)
    }
  }
}
