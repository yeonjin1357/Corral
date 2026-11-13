/**
 * 할 일 띠(G3)의 줄: 지금 사용자가 처리할 것(응답 대기 에이전트·새로 끝난 에이전트·메모리 정리 추천·정리 후보 서버·
 * 무거운 작업 겹침)을 스냅샷에서 만든다. 화면 모양과 상관없는 순수 함수.
 */
import type { DashboardSnapshot } from '../../shared/types'
import { selectionKey } from '../../shared/keys'
import { cleanupRecommendation } from '../../shared/recommend'
import { formatDuration, formatBytes, formatFreed, pressureText } from '../../shared/format'
import { text } from '../../shared/text'
import { agentLine, folderOf, isNewlyDone, serverName, type Tone } from './rows'

export type AttentionKind = 'waiting' | 'done' | 'recommend' | 'candidate' | 'overlap'

export interface AttentionItem {
  /**
   * 같은 대상이면 갱신해도 같다: `waiting:<에이전트 키>` · `done:<에이전트 키>` · 'recommend' · `candidate:<서버 키>` ·
   * 'overlap'.
   */
  id: string
  /** 닫은 뒤 이 값이 바뀌면 다시 보인다. */
  state: string
  kind: AttentionKind
  /** 줄 왼쪽 점·메시지 색. recommend 는 메모리 단계(warn → 'warn', danger → 'stopped'). */
  tone: Tone
  /** 굵은 이름과 흐린 위치("Codex" · "shop-web", "next :3000" · "admin-console"). */
  name: string
  where: string | null
  message: string
  detail: string | null
  /** 단추가 쓰는 선택 키(waiting·done: 에이전트 키, candidate: 서버 키). */
  key: string | null
  /** recommend 만: 끌 키 전부. */
  keys?: string[]
}

/** 이른 순(모르는 null 은 맨 뒤), 같으면 id 순. */
const bySince = (a: { since: number | null; id: string }, b: typeof a): number =>
  (a.since ?? Infinity) === (b.since ?? Infinity)
    ? a.id < b.id
      ? -1
      : a.id > b.id
        ? 1
        : 0
    : (a.since ?? Infinity) < (b.since ?? Infinity)
      ? -1
      : 1

export function attentionItems(s: DashboardSnapshot, now: number): AttentionItem[] {
  const waiting: { since: number | null; id: string; item: AttentionItem }[] = []
  for (const a of s.agents) {
    if (a.state !== 'waiting') continue
    const key = selectionKey.agent(a)
    const line = agentLine(a, s)
    const activity = line.cells.activity
    waiting.push({
      since: a.stateSince,
      id: key,
      item: {
        id: `waiting:${key}`,
        state: `${a.stateSince}`,
        kind: 'waiting',
        tone: 'warn',
        name: text.ui.agent.toolNames[a.tool],
        where: folderOf(a.worktree),
        message: line.cells.status.text,
        detail: activity.muted ? null : activity.text,
        key
      }
    })
  }
  waiting.sort(bySince)

  // 새로 끝남: 끝냈는데 아직 확인하지 않은 에이전트(먼저 끝난 순). 마지막 말을 알면 붙인다.
  const done: { since: number | null; id: string; item: AttentionItem }[] = []
  for (const a of s.agents) {
    if (!isNewlyDone(a)) continue
    const key = selectionKey.agent(a)
    const line = agentLine(a, s)
    const activity = line.cells.activity
    done.push({
      since: a.doneSince,
      id: key,
      item: {
        id: `done:${key}`,
        state: `${a.doneSince}`,
        kind: 'done',
        tone: 'running',
        name: text.ui.agent.toolNames[a.tool],
        where: folderOf(a.worktree),
        message: line.cells.status.text,
        detail: activity.muted ? null : activity.text,
        key
      }
    })
  }
  done.sort(bySince)

  const items: AttentionItem[] = [...waiting, ...done].map((w) => w.item)

  const rec = cleanupRecommendation(s)
  const recKeys = rec.items.map((i) => i.key)
  const showRecommend =
    s.memory.totalBytes > 0 && s.memory.level !== 'normal' && rec.items.length > 0
  if (showRecommend) {
    items.push({
      id: 'recommend',
      state: `${s.memory.level}|${[...recKeys].sort().join(',')}`,
      kind: 'recommend',
      tone: s.memory.level === 'danger' ? 'stopped' : 'warn',
      name: text.ui.home.recommendTitle,
      where: null,
      message: text.ui.home.recommendSummary(
        rec.items.length,
        formatFreed(rec.totalBytes, rec.totalCommitBytes)
      ),
      detail: null,
      key: null,
      keys: recKeys
    })
  }

  // 추천에 든 서버는 (추천을 닫았어도) 후보 줄로 또 나오지 않는다.
  const inRecommend = new Set(showRecommend ? recKeys : [])
  const candidates: { since: number | null; id: string; item: AttentionItem }[] = []
  for (const p of s.servers) {
    if (p.judgement !== 'candidate') continue
    const key = selectionKey.server(p)
    if (inRecommend.has(key)) continue
    candidates.push({
      since: p.idleSince,
      id: key,
      item: {
        id: `candidate:${key}`,
        state: `${p.idleSince}`,
        kind: 'candidate',
        tone: 'stopped',
        name: `${serverName(p, s.platform)} :${p.ports[0]}`,
        where: p.workspace?.name ?? folderOf(p.worktree),
        message: text.ui.attention.idleFor(
          p.idleSince == null ? text.ui.none : formatDuration(now - p.idleSince)
        ),
        detail: formatBytes(p.memoryBytes),
        key
      }
    })
  }
  candidates.sort(bySince)
  items.push(...candidates.map((c) => c.item))

  if (s.heavyOverlap) {
    items.push({
      id: 'overlap',
      state: s.heavyJobs
        .map((j) => selectionKey.heavy(j))
        .sort()
        .join(','),
      kind: 'overlap',
      tone: 'warn',
      name: text.ui.recommend.overlapTitle,
      where: null,
      message: text.ui.home.heavyOverlap(pressureText(s.memory), s.heavyJobs.length),
      detail: null,
      key: null
    })
  }
  return items
}

/** 닫은 줄(같은 state)을 뺀다. state 가 바뀌면 다시 보인다. */
export function visibleAttention(
  items: AttentionItem[],
  dismissed: ReadonlyMap<string, string>
): AttentionItem[] {
  return items.filter((i) => dismissed.get(i.id) !== i.state)
}
