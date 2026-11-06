import { runCommand } from './runCommand'

const node = process.execPath

test('표준 출력과 종료 코드 0', async () => {
  await expect(runCommand([node, '-e', "process.stdout.write('hi')"])).resolves.toEqual({ stdout: 'hi', exitCode: 0 })
})

test('0 이 아닌 종료 코드도 reject 하지 않고 돌려준다', async () => {
  await expect(runCommand([node, '-e', "process.stdout.write('x'); process.exit(3)"])).resolves.toEqual({ stdout: 'x', exitCode: 3 })
})

test('UTF-8 한글 출력 보존', async () => {
  const r = await runCommand([node, '-e', "process.stdout.write('김개발')"])
  expect(r.stdout).toBe('김개발')
})

test('타임아웃이면 Error("timeout")', async () => {
  await expect(runCommand([node, '-e', 'setTimeout(() => {}, 10000)'], { timeoutMs: 300 })).rejects.toThrow('timeout')
})

test('없는 명령은 reject', async () => {
  await expect(runCommand(['pitwall-no-such-command-xyz'])).rejects.toThrow()
})
