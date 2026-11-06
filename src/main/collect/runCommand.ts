import { execFile, type ExecFileException } from 'child_process'
import { COMMAND_TIMEOUT_MS } from '../../shared/defaults'

export interface CommandResult {
  stdout: string
  exitCode: number
}

const MAX_BUFFER_BYTES = 32 * 1024 * 1024

/**
 * 셸 없이 명령을 실행한다. 0 이 아닌 종료 코드는 reject 하지 않고 돌려주며,
 * 시간 초과는 `Error('timeout')`, 실행 자체가 안 되면(없는 명령 등) 원래 에러로 reject 한다.
 */
export function runCommand(argv: string[], opts: { timeoutMs?: number } = {}): Promise<CommandResult> {
  const [file, ...args] = argv
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        encoding: 'buffer',
        windowsHide: true,
        maxBuffer: MAX_BUFFER_BYTES,
        timeout: opts.timeoutMs ?? COMMAND_TIMEOUT_MS
      },
      (error: ExecFileException | null, stdout: Buffer) => {
        const text = stdout.toString('utf8')
        if (!error) return resolve({ stdout: text, exitCode: 0 })
        if (error.killed) return reject(new Error('timeout'))
        if (typeof error.code === 'number') return resolve({ stdout: text, exitCode: error.code })
        reject(error)
      }
    )
  })
}
