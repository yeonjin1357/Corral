import type { DashboardSnapshot } from '../shared/types'
import type { NotifySettings } from '../shared/settings'
import { formatBytes, worktreeLabel } from '../shared/format'
import { agentKey, selectionKey } from '../shared/keys'
import { cleanupRecommendation } from '../shared/recommend'
import { text } from '../shared/text'

/** OS 알림 하나. target 은 누르면 갈 목록 항목(선택 키), null 이면 한눈에 보기. */
export interface Notice {
  title: string
  body: string
  target: string | null
}

const RAM_COOLDOWN_MS = 30 * 60 * 1000
const HEAVY_COOLDOWN_MS = 10 * 60 * 1000

/**
 * 스냅샷 변화의 "넘어가는 순간"에만 OS 알림을 보낸다(스펙 §8, 항목별로 끔).
 * - 첫 스냅샷은 기준선이다(시작할 때 이미 그런 상태는 알리지 않는다).
 * - RAM 부족: 위험으로 넘어갈 때. 정상으로 내려와야 다시, 30분 안에는 다시 알리지 않는다.
 * - Claude 권한 대기: 훅으로 권한 대기가 된 세션마다(여럿이면 하나로). pitwall 창이 앞에 있으면 알리지 않는다.
 * - 무거운 작업 겹침: 겹침이 시작될 때. 끝나야 다시, 10분 안에는 다시 알리지 않는다.
 */
export function createNotifier(deps: {
  show: (notice: Notice) => void
  settings: () => NotifySettings
  isFocused: () => boolean
  now: () => number
}): { update(s: DashboardSnapshot): void } {
  let started = false
  let ramArmed = true
  let ramLastAt = Number.NEGATIVE_INFINITY
  let heavyArmed = true
  let heavyLastAt = Number.NEGATIVE_INFINITY
  let waiting = new Set<string>()

  function ram(s: DashboardSnapshot, notify: boolean): void {
    const level = s.memory.level
    if (level === 'normal') ramArmed = true
    if (level !== 'danger' || !ramArmed) return
    ramArmed = false
    if (!notify || deps.now() - ramLastAt < RAM_COOLDOWN_MS) return
    ramLastAt = deps.now()
    if (!deps.settings().ramLow) return
    const rec = cleanupRecommendation(s)
    deps.show({
      title: text.notify.ramTitle(Math.floor(s.memory.usedPercent)),
      body:
        rec.items.length > 0
          ? text.notify.ramBody(rec.items.length, formatBytes(rec.totalBytes))
          : text.notify.ramNoCandidates,
      target: null
    })
  }

  function claude(s: DashboardSnapshot, notify: boolean): void {
    const now = s.agents.filter((a) => a.state === 'waiting' && a.stateSource === 'hook')
    const fresh = now.filter((a) => !waiting.has(agentKey(a)))
    waiting = new Set(now.map(agentKey))
    if (!notify || fresh.length === 0) return
    if (!deps.settings().claudeWaiting || deps.isFocused()) return
    const where = fresh.map((a) => worktreeLabel(a.worktree))
    deps.show(
      fresh.length === 1
        ? {
            title: text.notify.waitingTitle,
            body: where[0],
            target: selectionKey.agent(fresh[0])
          }
        : {
            title: text.notify.waitingManyTitle(fresh.length),
            body: where.join(', '),
            target: null
          }
    )
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
      title: text.notify.heavyTitle(Math.floor(s.memory.usedPercent)),
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
      heavy(s, notify)
    }
  }
}
