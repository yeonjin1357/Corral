import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { downloadSha512 } from './download'

describe('downloadSha512', () => {
  let dir = ''
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'corral-download-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  /** 여러 조각으로 나눠 보내는 응답. */
  const chunked = (chunks: string[], status = 200): Response =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk))
          controller.close()
        }
      }),
      { status }
    )

  test('받은 내용을 파일에 쓰고 그 sha512(base64)를 돌려준다', async () => {
    const file = join(dir, 'app.dmg')
    const requested: string[] = []
    const sha = await downloadSha512(
      async (url) => {
        requested.push(url)
        return chunked(['corral ', 'update ', 'payload\n'])
      },
      'https://example.invalid/app.dmg',
      file
    )
    // `printf 'corral update payload\n' | shasum -a 512 | xxd -r -p | base64` 로 따로 구한 값.
    expect(sha).toBe(
      '5Lb3qd9PPczfmxFS7BEaBTECyMgkMaaiDWwanbMjKwgZ3cujybiQZ3/cqK0vN4ygMFDlxpH+HmxvAmtCAMm1qQ=='
    )
    expect(readFileSync(file, 'utf8')).toBe('corral update payload\n')
    expect(requested).toEqual(['https://example.invalid/app.dmg'])
  })

  test('서버가 오류로 답하면 실패한다', async () => {
    await expect(
      downloadSha512(
        async () => chunked(['Not Found'], 404),
        'https://example.invalid/x',
        join(dir, 'x')
      )
    ).rejects.toThrow('HTTP 404')
  })
})
