import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * 앱 이름은 Corral(예전 pitwall). 화면 문구(src/shared/text.ts)에 예전 이름이 다시 들어오지 않게 지킨다.
 * 설정 폴더·훅 주소·IPC 이름 같은 내부 이름은 text.ts 밖에 있다. src/shared 는 렌더러 타입 검사에도 들어가
 * fs 를 쓸 수 없어 원문을 읽는 이 검사는 여기에 둔다(renderer-style-guard.test.ts 와 같은 까닭).
 */

/** text.ts 원문에서 주석(블록 주석, 줄 주석 — `http://` 같은 주소 글자는 남긴다)을 뺀 부분. */
function textSourceWithoutComments(): string {
  return readFileSync(join(__dirname, '../shared/text.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/**
 * 예외는 훅 주소의 낱말 `pitwall-hook` 하나: Codex 의 /hooks 에는 훅이 주소(`…/pitwall-hook/codex…`)로 보여,
 * 어느 훅을 승인할지 알리려면 그 낱말을 그대로 적어야 한다. 그 낱말만(대소문자까지 같고, 앞뒤에 글자·`-` 가 붙지
 * 않은 것) 빼고 본다.
 */
const withoutHookAddress = (source: string): string =>
  source.replace(/(?<![\w-])pitwall-hook(?![\w-])/g, '')

test('화면 문구에 예전 제품 이름이 남지 않는다', () => {
  expect(withoutHookAddress(textSourceWithoutComments())).not.toMatch(/pitwall/i)
})

test('예외는 훅 주소의 낱말 pitwall-hook 하나뿐', () => {
  expect(withoutHookAddress('Corral 훅(주소에 pitwall-hook 이 들어 있는 훅)')).not.toMatch(
    /pitwall/i
  )
  for (const other of [
    'pitwall',
    'Pitwall 훅',
    'Pitwall-hook',
    'pitwall-hooks',
    'pitwall-hook-v2',
    'my-pitwall-hook',
    'pitwall.exe'
  ])
    expect(withoutHookAddress(other)).toMatch(/pitwall/i)
})
