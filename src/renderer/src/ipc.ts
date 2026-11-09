/**
 * 메인 프로세스로 보낼 값을 보통 JSON 값으로 바꾼다.
 * IPC 는 값을 구조화 복제하는데 Vue 반응형 객체(Proxy)는 복제할 수 없어 "An object could not be cloned" 로 실패한다.
 * 설정처럼 JSON 으로 나타낼 수 있는 값에만 쓴다(함수·Date 등은 없다).
 */
export function toIpc<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
