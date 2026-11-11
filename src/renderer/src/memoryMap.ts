/**
 * 메모리 지도(G6)의 칸: 1단계는 메모리 구성(G4)의 묶음(0 인 것은 뺀다), 2단계는 그 묶음의 줄.
 * 에이전트 칸은 표의 메모리(자손의 무거운 작업까지)가 아니라 무거운 작업을 뺀 자기 몫(ownMemoryBytes)이라
 * 에이전트 묶음과 같은 규칙이다. 그래도 2단계 합이 묶음과 다르면(측정 시점 차이로 묶음을 사용량에 맞춰 줄였을 때 등)
 * 같은 비율로 줄이거나 "그 밖" 칸으로 채워 지도가 늘 묶음 값과 맞다(같은 메모리를 두 번 세지 않는다).
 */
import type { DashboardSnapshot, ProcessGroup, ServerRow } from '../../shared/types'
import { selectionKey } from '../../shared/keys'
import { portList } from '../../shared/format'
import { text } from '../../shared/text'
import { memoryComposition } from './memory'
import { appName, appRowId, folderOf } from './rows'

export interface MapTile {
  /** 지도 안에서 겹치지 않는 id. 누를 수 있는 칸은 선택 키와 같다. */
  id: string
  label: string
  bytes: number
  /** 누르면 열 줄의 선택 키. 줄이 없거나 찾을 수 없는 칸(숨긴 서버·다른 앱·기타·그 밖·시스템)은 null. */
  key: string | null
  /** 에이전트 칸의 값이 표의 메모리와 다르면(자손의 무거운 작업을 뺌) true — 풍선말에 그렇게 적는다. */
  excludesHeavy?: boolean
}

export interface MapGroup {
  group: ProcessGroup
  bytes: number
  tiles: MapTile[]
}

/** 다른 앱은 큰 순으로 이만큼만 칸을 두고, 나머지는 "기타 n개" 한 칸. */
const APP_TILES = 12

const t = text.ui.memorySheet

/**
 * 칸 이름: 같은 이름이 둘 이상이면 그 줄들에만 구분할 꼬리를 붙인다(같은 폴더의 서버·에이전트가 풍선말까지 같지 않게).
 */
function distinct<R>(
  rows: R[],
  name: (row: R) => string,
  tail: (row: R, name: string) => string
): string[] {
  const names = rows.map(name)
  const count = new Map<string, number>()
  for (const n of names) count.set(n, (count.get(n) ?? 0) + 1)
  return rows.map((row, i) => (count.get(names[i])! > 1 ? tail(row, names[i]) : names[i]))
}

/** 개발 서버 칸 이름: 표의 이름(폴더) · 작업 공간. 작업 공간을 모르거나 이름과 같으면 이름만. */
function serverLabel(row: ServerRow): string {
  const name = folderOf(row.worktree)
  const ws = row.workspace?.name
  return ws && ws !== name ? `${name} · ${ws}` : name
}

/** 그 묶음의 줄(맞추기 전). */
function rowsOf(group: ProcessGroup, s: DashboardSnapshot): MapTile[] {
  switch (group) {
    case 'devServer': {
      // 숨긴 서버도 개발 서버 메모리지만 표에 줄이 없어 누를 수 없다. 이름이 같으면 표의 포트 칸처럼 포트를 붙인다.
      const rows = [...s.servers, ...s.hiddenServers]
      const labels = distinct(rows, serverLabel, (row, name) => `${name} · ${portList(row.ports)}`)
      return rows.map((row, i) => {
        const key = selectionKey.server(row)
        return i < s.servers.length
          ? { id: key, label: labels[i], bytes: row.memoryBytes, key }
          : { id: `hidden:${key}`, label: labels[i], bytes: row.memoryBytes, key: null }
      })
    }
    case 'agent': {
      // 폴더 · 도구(같은 폴더의 Claude·Codex), 그래도 같으면 PID 까지.
      const labels = distinct(
        s.agents,
        (row) => `${folderOf(row.worktree)} · ${text.ui.agent.toolNames[row.tool]}`,
        (row, name) => t.mapWithPid(name, row.pid)
      )
      // 무거운 작업은 무거운 작업 묶음에 있으므로 에이전트 칸은 그것을 뺀 자기 몫.
      return s.agents.map((row, i) => {
        const key = selectionKey.agent(row)
        return {
          id: key,
          label: labels[i],
          bytes: row.ownMemoryBytes,
          key,
          excludesHeavy: row.ownMemoryBytes !== row.memoryBytes
        }
      })
    }
    case 'heavy':
      return s.heavyJobs.map((row) => {
        const key = selectionKey.heavy(row)
        return { id: key, label: row.label, bytes: row.memoryBytes, key }
      })
    case 'otherApps': {
      const apps = [...s.apps].sort((a, b) => b.memoryBytes - a.memoryBytes)
      const rest = apps.slice(APP_TILES)
      return [
        ...apps.slice(0, APP_TILES).map((app) => ({
          id: appRowId(app),
          label: appName(app),
          bytes: app.memoryBytes,
          key: null
        })),
        ...(rest.length
          ? [
              {
                id: 'app-others',
                label: t.mapOthers(rest.length),
                bytes: rest.reduce((n, app) => n + app.memoryBytes, 0),
                key: null
              }
            ]
          : [])
      ]
    }
    case 'system':
      return []
  }
}

/** 칸 합을 묶음 값에 맞춘다(그래도 다를 때만): 크면 같은 비율로 줄이고, 작으면 남는 몫을 "그 밖" 칸으로. */
function fit(group: ProcessGroup, tiles: MapTile[], bytes: number): MapTile[] {
  const positive = tiles.filter((tile) => tile.bytes > 0)
  const sum = positive.reduce((n, tile) => n + tile.bytes, 0)
  if (sum > bytes) return positive.map((tile) => ({ ...tile, bytes: (tile.bytes * bytes) / sum }))
  const rest = bytes - sum
  if (!(rest > 0)) return positive
  // 시스템·공유 메모리는 줄이 없어 묶음 전체가 한 칸이다.
  const tile =
    group === 'system'
      ? { id: 'system', label: text.ui.groups.system }
      : { id: `${group}:rest`, label: t.mapRest }
  return [...positive, { ...tile, bytes: rest, key: null }]
}

/** 메모리 지도의 묶음과 칸. 전체 RAM 을 모르면(아직 수집 전) 빈 목록. */
export function memoryMapGroups(s: DashboardSnapshot): MapGroup[] {
  const composition = memoryComposition(s.memory, s.groups)
  if (!composition) return []
  return composition.parts
    .filter((part) => part.bytes > 0)
    .map((part) => ({
      group: part.group,
      bytes: part.bytes,
      tiles: fit(part.group, rowsOf(part.group, s), part.bytes)
    }))
}
