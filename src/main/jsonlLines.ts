import { realpath, type FileHandle } from 'fs/promises'
import { resolve, sep } from 'path'

/**
 * JSON Lines 세션 기록(Claude·Codex)을 읽는 공용 도구: 경로 확인, 숫자 확인, 덩어리 단위 줄 읽기.
 * 기록은 한 줄에 JSON 하나이고, 대화 내용이 든 아주 긴 줄도 있다. 필요한 줄만 골라 해석하고 나머지는 메모리에 오래
 * 두지 않는다.
 */

const MB = 1024 * 1024
/** 한 번에 읽을 크기. */
export const CHUNK_BYTES = MB
/** 이보다 긴 한 줄은 모으지 않고 건너뛴다. */
export const MAX_LINE_BYTES = 32 * MB
const NEWLINE = 0x0a
const EMPTY = Buffer.alloc(0)

/** Windows·macOS 는 경로 대소문자를 가리지 않는다. */
const SAME_CASE = process.platform === 'win32' || process.platform === 'darwin'

/** path 가 dir 안인지(dir 자신은 아니다). 대소문자는 플랫폼 규칙을 따른다. */
function insideDir(path: string, dir: string): boolean {
  const prefix = dir.endsWith(sep) ? dir : dir + sep
  return SAME_CASE ? path.toLowerCase().startsWith(prefix.toLowerCase()) : path.startsWith(prefix)
}

/**
 * 받은 경로가 dir 안의 .jsonl 이면 그 실제 경로(링크를 풀어도 dir 의 실제 경로 안의 .jsonl 이어야 한다). 아니거나
 * 없으면 null. Windows 의 `\\?\` 앞머리는 뗀다. 상대 경로는 이 프로세스의 작업 폴더 기준이라 보통 밖이다.
 */
export async function jsonlInside(
  given: string | null | undefined,
  dir: string
): Promise<string | null> {
  const path = given?.replace(/^\\\\\?\\/, '')
  if (!path || !/\.jsonl$/i.test(path) || !insideDir(resolve(path), resolve(dir))) return null
  const [real, realDir] = await Promise.all([
    realpath(path).catch(() => null),
    realpath(dir).catch(() => null)
  ])
  return real && realDir && /\.jsonl$/i.test(real) && insideDir(real, realDir) ? real : null
}

/** 0 이상의 유한한 숫자만 그 값, 아니면 null(없음 — 0 으로 보지 않는다). */
export function nonNegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

/**
 * 파일이 없어졌다는 오류인지. 그 밖의 오류(EBUSY·EPERM·EACCES 등)는 잠깐의 실패로 보고 알던 값과 읽던 위치를 둔다.
 */
export function isGone(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

/** 한 파일을 어디까지 읽었는지. */
export interface LineCursor {
  /** 다 읽은 위치(마지막으로 읽은 줄 끝 다음). 덜 쓴 마지막 줄은 들고 있지 않고 다음에 그 처음부터 다시 읽는다. */
  offset: number
  /** 다음 줄바꿈까지 버리는 중(너무 긴 줄, 줄 가운데에서 읽기 시작한 첫 줄). */
  skipping: boolean
  /** 마지막으로 읽었을 때 본 파일 크기(같으면 다시 열지 않고, 줄면 처음부터 읽는다). 아직 안 읽었으면 -1. */
  size: number
}

/**
 * offset 부터 읽기 시작하는 커서. offset 이 줄 처음이면(앞 바이트가 줄바꿈) 그 줄부터 읽고, 줄 가운데면 잘린 첫 줄은
 * 버린다.
 */
export async function cursorAt(file: FileHandle, offset: number): Promise<LineCursor> {
  if (offset <= 0) return { offset: 0, skipping: false, size: -1 }
  const before = Buffer.alloc(1)
  const { bytesRead } = await file.read(before, 0, 1, offset - 1)
  return { offset, skipping: !(bytesRead === 1 && before[0] === NEWLINE), size: -1 }
}

/**
 * cursor 부터 size 까지 줄 단위로 읽어 needles 가운데 하나가 든 줄만 onLine 에 넘긴다(바이트 그대로 — 해석은 받는 쪽).
 * - chunkBytes 씩 읽고 지금 덩어리와 덜 끝난 한 줄의 조각만 메모리에 둔다. 조각마다 needle 을 찾고(조각 경계에 걸친
 *   needle 도 찾도록 앞 조각 끝의 몇 바이트를 이어 본다), needle 이 든 줄만 이어 붙인다(글자 해석도 받는 쪽에서 그 줄만).
 * - maxLineBytes 넘는 한 줄은 모으지 않고 다음 줄바꿈까지 버린다.
 * - 줄바꿈으로 끝난 줄만 넘긴다. 덜 쓴 마지막 줄은 들고 있지 않고(돌려주는 커서가 그 줄 처음을 가리킨다) 다음에 다시 읽는다.
 * 새 커서를 돌려준다. 도중에 오류가 나면 던진다 — 그때까지 넘긴 줄은 그대로이므로, 받는 쪽은 같은 줄을 다시 받아도
 * 결과가 같아야 한다(옛 커서로 다시 읽는다).
 */
export async function readLines(
  file: FileHandle,
  cursor: LineCursor,
  size: number,
  o: { needles: Buffer[]; chunkBytes?: number; maxLineBytes?: number },
  onLine: (line: Buffer) => void
): Promise<LineCursor> {
  const chunkBytes = Math.max(1, o.chunkBytes ?? CHUNK_BYTES)
  const maxLineBytes = o.maxLineBytes ?? MAX_LINE_BYTES
  /** 조각 경계에 걸친 needle 을 찾으려고 앞 조각에서 이어 볼 바이트 수. */
  const overlap = Math.max(0, ...o.needles.map((n) => n.length - 1))
  const hasNeedle = (bytes: Buffer): boolean => o.needles.some((n) => bytes.includes(n))

  let position = cursor.offset
  let lineStart = cursor.offset
  let skipping = cursor.skipping
  /** 덜 끝난 줄의 조각들과 그 길이, needle 을 찾았는지, 끝 overlap 바이트. */
  let pieces: Buffer[] = []
  let pieceBytes = 0
  let found = false
  let edge = EMPTY
  const reset = (): void => {
    pieces = []
    pieceBytes = 0
    found = false
    edge = EMPTY
  }
  /** 이 조각까지 보아 needle 이 있는지(앞 조각 끝과 이 조각 앞을 이은 곳까지). */
  const foundWith = (piece: Buffer): boolean =>
    found ||
    hasNeedle(piece) ||
    (edge.length > 0 && overlap > 0 && hasNeedle(Buffer.concat([edge, piece.subarray(0, overlap)])))

  while (position < size) {
    const length = Math.min(chunkBytes, size - position)
    const chunk = Buffer.allocUnsafe(length)
    const { bytesRead } = await file.read(chunk, 0, length, position)
    if (bytesRead <= 0) break
    const data = chunk.subarray(0, bytesRead)
    let start = 0
    for (let end = data.indexOf(NEWLINE); end >= 0; end = data.indexOf(NEWLINE, start)) {
      const piece = data.subarray(start, end)
      if (!skipping && pieceBytes + piece.length <= maxLineBytes && foundWith(piece))
        onLine(pieceBytes > 0 ? Buffer.concat([...pieces, piece]) : piece)
      skipping = false
      reset()
      start = end + 1
      lineStart = position + start
    }
    if (!skipping && start < data.length) {
      const piece = data.subarray(start)
      if (pieceBytes + piece.length > maxLineBytes) {
        // 너무 긴 줄: 모으지 않고 다음 줄바꿈까지 버린다.
        skipping = true
        reset()
      } else {
        found = foundWith(piece)
        if (!found && overlap > 0)
          edge =
            piece.length >= overlap
              ? Buffer.from(piece.subarray(piece.length - overlap))
              : Buffer.concat([edge, piece]).subarray(-overlap)
        // 덩어리의 일부면 복사해 둔다(앞의 다른 줄까지 붙잡지 않게).
        pieces.push(start === 0 ? piece : Buffer.from(piece))
        pieceBytes += piece.length
      }
    }
    position += bytesRead
  }
  // 덜 쓴 마지막 줄은 다음에 그 처음부터 다시 읽는다(버리는 중이면 읽은 데까지 지나간다).
  return { offset: skipping ? position : lineStart, skipping, size: position }
}
