/** 파일 내려받기(macOS 의 앱 안 업데이트가 쓴다). */
import { createHash } from 'crypto'
import { createWriteStream } from 'fs'
import { once } from 'events'
import { finished } from 'stream/promises'

/**
 * 주소의 내용을 파일에 쓰고 그 sha512(base64)를 준다. 서버가 오류로 답하면 실패한다(`HTTP 404`).
 * 큰 파일(설치 파일은 120 MB 쯤)을 메모리에 다 올리지 않게 받는 대로 쓰면서 셈한다.
 */
export async function downloadSha512(
  fetch: (url: string) => Promise<Response>,
  url: string,
  file: string
): Promise<string> {
  const response = await fetch(url)
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
  const hash = createHash('sha512')
  const out = createWriteStream(file)
  const reader = response.body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      hash.update(value)
      if (!out.write(value)) await once(out, 'drain')
    }
  } finally {
    out.end()
    await finished(out)
  }
  return hash.digest('base64')
}
