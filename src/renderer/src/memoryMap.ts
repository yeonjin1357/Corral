/**
 * 메모리 지도(G6)의 칸: 1단계는 메모리 구성(G4)의 묶음(0 인 것은 뺀다), 2단계는 그 묶음의 줄.
 * 2단계 합이 묶음과 다르면(에이전트 줄은 자손의 무거운 작업까지 세는 등) 같은 비율로 줄이거나 "그 밖" 칸으로 채워
 * 지도가 늘 묶음 값과 맞다(같은 메모리를 두 번 세지 않는다).
 */
import type { DashboardSnapshot, ProcessGroup } from '../../shared/types'
import { selectionKey } from '../../shared/keys'
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
}

export interface MapGroup {
  group: ProcessGroup
  bytes: number
  tiles: MapTile[]
}

/** 다른 앱은 큰 순으로 이만큼만 칸을 두고, 나머지는 "기타 n개" 한 칸. */
const APP_TILES = 12

const t = text.ui.memorySheet

/** 개발 서버 칸 이름: 표의 이름(폴더) · 작업 공간. 작업 공간을 모르거나 이름과 같으면 이름만. */
function serverLabel(row: DashboardSnapshot['servers'][number]): string {
  const name = folderOf(row.worktree)
  const ws = row.workspace?.name
  return ws && ws !== name ? `${name} · ${ws}` : name
}

/** 그 묶음의 줄(맞추기 전). */
function rowsOf(group: ProcessGroup, s: DashboardSnapshot): MapTile[] {
  switch (group) {
    case 'devServer':
      return [
        ...s.servers.map((row) => {
          const key = selectionKey.server(row)
          return { id: key, label: serverLabel(row), bytes: row.memoryBytes, key }
        }),
        // 숨긴 서버도 개발 서버 메모리지만 표에 줄이 없어 누를 수 없다.
        ...s.hiddenServers.map((row) => ({
          id: `hidden:${selectionKey.server(row)}`,
          label: serverLabel(row),
          bytes: row.memoryBytes,
          key: null
        }))
      ]
    case 'agent':
      return s.agents.map((row) => {
        const key = selectionKey.agent(row)
        return { id: key, label: folderOf(row.worktree), bytes: row.memoryBytes, key }
      })
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

/** 칸 합을 묶음 값에 맞춘다: 크면 같은 비율로 줄이고, 작으면 남는 몫을 "그 밖" 칸으로. */
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
