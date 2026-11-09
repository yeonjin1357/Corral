/**
 * 표 정렬(탭별). 데이터가 새로 와도, 탭을 오가도, 앱을 다시 켜도 사용자가 고른 정렬을 유지한다.
 * 이 PC 화면에서만 쓰는 편의 값이라 브라우저 저장소(localStorage)에 둔다. 막히거나 깨져도 기본 정렬로 넘어간다.
 */
import type { Table, TabKey } from './rows'

export interface SortState {
  id: string
  dir: 'asc' | 'desc'
}
export type Sorts = Partial<Record<TabKey, SortState>>

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const KEY = 'pitwall.tableSort'

const isSort = (v: unknown): v is SortState =>
  !!v &&
  typeof (v as SortState).id === 'string' &&
  ((v as SortState).dir === 'asc' || (v as SortState).dir === 'desc')

export function readSorts(storage: StorageLike | null): Sorts {
  if (!storage) return {}
  try {
    const raw = storage.getItem(KEY)
    const value = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
    if (!value || typeof value !== 'object') return {}
    return Object.fromEntries(Object.entries(value).filter(([, v]) => isSort(v))) as Sorts
  } catch {
    return {}
  }
}

export function writeSorts(storage: StorageLike | null, sorts: Sorts): void {
  try {
    storage?.setItem(KEY, JSON.stringify(sorts))
  } catch {
    // 저장소가 막혀도 이번 실행 동안은 화면 상태로 유지된다.
  }
}

/** 저장한 정렬의 칸이 지금 표에 있으면 그것, 없으면 표의 기본 정렬. */
export function resolveSort(saved: SortState | undefined, table: Table): SortState {
  return saved && table.columns.some((c) => c.id === saved.id) ? saved : table.sort
}
