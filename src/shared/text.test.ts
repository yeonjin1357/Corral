import { text } from './text'

// '화면 문구에 예전 제품 이름이 남지 않는다'는 text.ts 원문을 읽어야 해 src/main/text-name-guard.test.ts 에 둔다
// (src/shared 는 렌더러 타입 검사에도 들어가 fs 를 쓸 수 없다).

test('질문 훅 문구의 머리말은 Corral', () => {
  // 에이전트가 읽는 문구라 누가 미뤘는지 알 수 있게 제품 이름으로 시작한다.
  expect(text.guard.defer('vue-tsc', 91)).toMatch(/^Corral:/)
  expect(text.guard.note('vue-tsc', 91)).toMatch(/^Corral 참고:/)
})
