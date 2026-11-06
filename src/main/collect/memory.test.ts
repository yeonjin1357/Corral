import { parseVmStat, readMemory, VM_STAT_ARGV } from './memory'

const vmStat = (pageSize: number): string =>
  [
    `Mach Virtual Memory Statistics: (page size of ${pageSize} bytes)`,
    'Pages free:                               12000.',
    'Pages active:                            300000.',
    'Pages inactive:                          290000.',
    'Pages speculative:                        10000.',
    'Pages throttled:                              0.',
    'Pages wired down:                        150000.',
    'Pages purgeable:                           5000.',
    '"Translation faults":                 123456789.',
    'Pages stored in compressor:              80000.'
  ].join('\n')

test('macOS vm_stat: 사용 가능 = free + inactive + speculative + purgeable', () => {
  expect(parseVmStat(vmStat(16384))).toEqual({
    availableBytes: (12000 + 290000 + 10000 + 5000) * 16384
  })
  expect(parseVmStat(vmStat(4096))).toEqual({
    availableBytes: (12000 + 290000 + 10000 + 5000) * 4096
  })
})

test('vm_stat 형식이 아니면 null', () => {
  expect(parseVmStat('')).toBeNull()
  expect(parseVmStat('Pages free: 1.')).toBeNull()
})

test('Windows 는 OS 값(사용 가능 물리 메모리)을 그대로 쓴다', async () => {
  const run = vi.fn()
  await expect(
    readMemory('win32', { totalmem: () => 100, freemem: () => 30, run })
  ).resolves.toEqual({
    totalBytes: 100,
    freeBytes: 30
  })
  expect(run).not.toHaveBeenCalled()
})

test('macOS 는 vm_stat 으로 계산하고, 총량을 넘지 않는다', async () => {
  const run = vi.fn(async () => ({ stdout: vmStat(16384), stderr: '', exitCode: 0 }))
  const total = 8 * 1024 ** 3
  const r = await readMemory('darwin', { totalmem: () => total, freemem: () => 1, run })
  expect(run).toHaveBeenCalledWith(VM_STAT_ARGV, expect.anything())
  expect(r).toEqual({
    totalBytes: total,
    freeBytes: Math.min(total, (12000 + 290000 + 10000 + 5000) * 16384)
  })
})

test('macOS 에서 vm_stat 이 실패하면 OS 값으로 대신한다', async () => {
  const run = vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 1 }))
  await expect(
    readMemory('darwin', { totalmem: () => 100, freemem: () => 7, run })
  ).resolves.toEqual({
    totalBytes: 100,
    freeBytes: 7
  })
  const throwing = vi.fn(async () => {
    throw new Error('timeout')
  })
  await expect(
    readMemory('darwin', { totalmem: () => 100, freemem: () => 7, run: throwing })
  ).resolves.toEqual({
    totalBytes: 100,
    freeBytes: 7
  })
})
