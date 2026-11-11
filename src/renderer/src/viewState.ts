/**
 * 개발 서버 탭의 보기(목록 / 작업 공간 묶음). 정렬처럼 이 PC 화면에서만 쓰는 편의 값이라 localStorage 에 둔다.
 * 처음은 묶음 보기. 막히거나 깨져도 묶음으로 넘어간다.
 */
import type { StorageLike } from './storage'

export type ServerView = 'list' | 'group'

const KEY = 'pitwall.serverView'

export function readServerView(storage: StorageLike | null): ServerView {
  try {
    return storage?.getItem(KEY) === 'list' ? 'list' : 'group'
  } catch {
    return 'group'
  }
}

export function writeServerView(storage: StorageLike | null, view: ServerView): void {
  try {
    storage?.setItem(KEY, view)
  } catch {
    // 저장소가 막혀도 이번 실행 동안은 화면 상태로 유지된다.
  }
}
