import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'

/**
 * scoped 스타일에서 `:global(.dark) &` 는 뒤의 선택자가 빠진 채 전역 `.dark { ... }` 로 바뀌어
 * 화면 전체 글자색·배경을 덮었다(실제로 어두운 테마가 깨졌다). 원본(Uptime Kuma)처럼 `.dark &` 를 쓴다.
 */
test('컴포넌트 scoped 스타일에서 :global( 을 쓰지 않는다', () => {
  const rendererSrc = join(__dirname, '../renderer/src')
  const dirs = [join(rendererSrc, 'components'), rendererSrc]
  const offenders: string[] = []
  for (const dir of dirs) {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.vue')) continue
      const source = readFileSync(join(dir, name), 'utf8')
      const style = source.slice(source.indexOf('<style'))
      if (source.includes('<style') && style.includes(':global(')) offenders.push(name)
    }
  }
  expect(offenders).toEqual([])
})
