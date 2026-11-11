/**
 * 이 PC 화면에서만 쓰는 편의 값(보기·정렬·화면 배치)을 두는 저장소의 모양. 화면은 localStorage 를, 시험은 가짜를 넣는다.
 * viewState·sortState·layoutState 가 같이 쓴다(읽기·쓰기는 각자 try/catch, 실패하면 기본값).
 */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}
