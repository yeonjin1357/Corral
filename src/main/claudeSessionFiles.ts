import { open } from 'fs/promises'
import { join } from 'path'
import type { AgentState, WaitReason } from '../shared/types'

/**
 * Claude Code 의 실행 중 세션 파일(G3a). Claude Code 는 실행 중인 프로세스마다 `<Claude 설정 폴더>/sessions/<pid>.json` 을
 * 남긴다(pid·세션 id·상태·상태가 바뀐 시각·응답 대기의 이유·이름 등). 훅 이벤트에는 pid 가 없어 세션과 프로세스를 정확히
 * 잇는 데 쓰고, 훅이 없을 때 작업 중·쉬는 중·응답 대기의 근거로도 쓴다.
 * - 문서화되지 않은 내부 형식이라 모든 칸을 의심한다. 모양이 다르면 버린다(지어내지 않음).
 * - 읽기만 하고, 같은 폴더의 `<pid>.<hash>.key` 같은 다른 파일은 열지 않는다(에이전트 pid 의 `.json` 만).
 */
export interface ClaudeSessionFile {
  pid: number
  sessionId: string
  /**
   * busy: 작업 중, shell: 턴이 끝났는데 그 세션이 띄운 백그라운드 셸(또는 모니터)이 도는 중, idle: 쉬는 중,
   * waiting: 사용자 응답 대기(이유는 waitingFor). 이 네 글자 그대로일 때만, 모르는 글자는 null.
   */
  status: 'idle' | 'busy' | 'shell' | 'waiting' | null
  /** 상태가 바뀐 시각. 모르거나 미래(시계 차이 여유 밖)면 null. */
  statusUpdatedAt: number | null
  /**
   * 응답 대기의 이유(짧은 영어 글 그대로 — 예: 'permission prompt', 'input needed'). 1~40자의 문자열만, 아니면 null.
   * 뜻은 waitReasonOf 가 정한다.
   */
  waitingFor: string | null
  /** 세션 이름(그대로, 자르는 것은 쓰는 쪽). 없으면 null. */
  name: string | null
  /**
   * 이름이 어디서 왔는지(예: 폴더 이름으로 자동으로 붙인 이름은 'derived'). 40자까지의 빈 글이 아닌 문자열만, 아니면 null.
   * 하는 일(G3b)의 제목으로는 derived 가 아닌 이름만 쓴다.
   */
  nameSource: string | null
}

/** 파일의 시작 시각과 프로세스 시작 시각이 이만큼까지 다를 수 있다(파일이 0.5초쯤 늦다). 미래 시각의 여유로도 쓴다. */
const SLACK_MS = 60 * 1000
/** 이보다 큰 파일은 읽지 않는다(실제 파일은 1 KB 안팎). */
const MAX_BYTES = 64 * 1024
const MAX_ID_LENGTH = 200
const MAX_NAME_SOURCE_LENGTH = 40
const MAX_WAITING_FOR_LENGTH = 40
const STATUSES: readonly NonNullable<ClaudeSessionFile['status']>[] = [
  'busy',
  'shell',
  'idle',
  'waiting'
]

/** 1~max 자의 문자열이면 그대로, 아니면 null. */
const shortText = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v && v.length <= max ? v : null

/**
 * 훅과 파일이 둘 다 있을 때, 파일의 상태 시각이 훅 세션의 마지막 활동보다 이 시간을 넘게 늦어야 파일을 따른다.
 * 같은 일(입력·응답 끝·권한 요청)로 둘이 거의 같은 때 바뀌므로 그 차이는 훅을 따른다(어떤 도구가 권한을 기다리는지는
 * 훅만 안다).
 */
export const FILE_NEWER_SLACK_MS = 5000

/** 파일 끝까지(최대 maxBytes + 1 바이트) 읽는다. 한도를 넘으면 null. */
async function readSmall(path: string, maxBytes: number): Promise<string | null> {
  const file = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(maxBytes + 1)
    let length = 0
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, length)
      if (bytesRead <= 0) break
      length += bytesRead
    }
    return length > maxBytes ? null : buffer.subarray(0, length).toString('utf8')
  } finally {
    await file.close()
  }
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** 파일 내용 하나를 해석한다. 그 프로세스의 파일로 받아들일 수 없으면 null. */
function parseSessionFile(
  raw: string,
  agent: { pid: number; startedAt: number },
  now: number,
  slackMs: number
): ClaudeSessionFile | null {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const o = data as Record<string, unknown>
  if (o.pid !== agent.pid) return null
  const sessionId = o.sessionId
  if (typeof sessionId !== 'string' || !sessionId || sessionId.length > MAX_ID_LENGTH) return null
  // 같은 pid 가 다시 쓰였으면 남은 옛 파일이다.
  if (!finite(o.startedAt) || Math.abs(o.startedAt - agent.startedAt) > slackMs) return null
  return {
    pid: agent.pid,
    sessionId,
    status: STATUSES.find((s) => s === o.status) ?? null,
    statusUpdatedAt:
      finite(o.statusUpdatedAt) && o.statusUpdatedAt <= now + slackMs ? o.statusUpdatedAt : null,
    waitingFor: shortText(o.waitingFor, MAX_WAITING_FOR_LENGTH),
    name: typeof o.name === 'string' ? o.name : null,
    nameSource: shortText(o.nameSource, MAX_NAME_SOURCE_LENGTH)
  }
}

/**
 * 세션 파일 읽기. 에이전트(Claude) pid 마다 `<dir>/<pid>.json` 만 읽는다. 프로세스 시작 시각을 모르면 어느 프로세스의
 * 파일인지 알 수 없어 읽지 않는다. 읽기·해석에 실패하면 그 pid 만 건너뛴다(폴더가 없으면 빈 결과).
 */
export function createSessionFileReader(o: { dir: string; slackMs?: number; maxBytes?: number }): {
  read(
    agents: { pid: number; startedAt: number | null }[],
    now: number
  ): Promise<Map<number, ClaudeSessionFile>>
} {
  const slackMs = o.slackMs ?? SLACK_MS
  const maxBytes = o.maxBytes ?? MAX_BYTES
  return {
    async read(agents, now) {
      const files = await Promise.all(
        agents.map(async ({ pid, startedAt }): Promise<ClaudeSessionFile | null> => {
          if (!Number.isSafeInteger(pid) || pid <= 0 || !finite(startedAt)) return null
          try {
            const raw = await readSmall(join(o.dir, `${pid}.json`), maxBytes)
            return raw === null ? null : parseSessionFile(raw, { pid, startedAt }, now, slackMs)
          } catch {
            // 파일이 없거나(예전 Claude Code·막 꺼짐) 읽을 수 없으면 그 pid 만 건너뛴다.
            return null
          }
        })
      )
      // 에이전트 순서 그대로(읽기가 끝난 순서와 상관없이).
      return new Map(files.flatMap((f) => (f ? [[f.pid, f] as const] : [])))
    }
  }
}

/** 세션 파일의 waitingFor 가운데 아는 것(그대로 같을 때만)과 그 뜻. */
const WAIT_REASONS: Readonly<Record<string, WaitReason | 'dialog'>> = {
  'permission prompt': 'permission',
  'input needed': 'input',
  'sandbox request': 'sandbox',
  'worker request': 'worker',
  'goal proposal': 'goal',
  'dialog open': 'dialog'
}

/**
 * 세션 파일의 응답 대기 이유(waitingFor)의 뜻. dialog: 슬래시 명령 창 등(대개 사용자가 직접 연 창 — 기다림으로 보지
 * 않는다). 모르는 글자·없음은 other(기다리는 것은 맞고 이유만 모른다).
 */
export function waitReasonOf(waitingFor: string | null): WaitReason | 'dialog' {
  return waitingFor !== null && Object.hasOwn(WAIT_REASONS, waitingFor)
    ? WAIT_REASONS[waitingFor]
    : 'other'
}

/**
 * 세션 파일의 상태를 따를 때 그 에이전트 상태. 따르지 않으면 null.
 * - busy → 작업 중, idle·shell → 쉬는 중(shell 은 턴이 끝났고 백그라운드 셸만 돈다).
 * - waiting → 응답 대기. 단 이유가 dialog(사용자가 연 창일 수 있음)면 쉬는 중.
 * 훅 상태가 있으면 더 늦은 근거를 따른다: 파일의 상태 시각이 훅 세션의 마지막 활동보다 FILE_NEWER_SLACK_MS 넘게
 * 늦을 때만 파일(훅 전달이 끊겼거나 끝 이벤트를 놓친 세션이 옛 상태로 굳지 않게 — 파일의 waiting 도 같다: 훅이 같은 때
 * 권한 대기를 알렸으면 도구 이름을 아는 훅). 상태를 모르는 파일은 따르지 않는다.
 * 단 훅이 권한 대기면 파일에서 나온 쉬는 중(idle·shell·dialog)은 아무리 늦어도 따르지 않는다: 권한 창이 떠 있는 동안
 * 파일에 무엇이 쓰이는지 모르고, 훅이 살아 있으니 턴의 끝은 Stop 으로 온다. 더 늦은 busy(새 턴)·waiting 은 따른다.
 */
export function fileStateOver(
  file: ClaudeSessionFile,
  hook: { state: AgentState; lastActivityAt: number } | null
): 'working' | 'idle' | 'waiting' | null {
  if (file.status === null) return null
  const state =
    file.status === 'busy'
      ? 'working'
      : file.status === 'waiting' && waitReasonOf(file.waitingFor) !== 'dialog'
        ? 'waiting'
        : 'idle'
  if (!hook) return state
  if (hook.state === 'waiting' && state === 'idle') return null
  return file.statusUpdatedAt !== null &&
    file.statusUpdatedAt - hook.lastActivityAt > FILE_NEWER_SLACK_MS
    ? state
    : null
}
