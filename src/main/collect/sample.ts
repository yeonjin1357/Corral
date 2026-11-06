import type { Platform, RawSample } from '../../shared/types'
import { sampleWindows } from './windows'
import { sampleDarwin } from './darwin'

export function toPlatform(nodePlatform: string): Platform | null {
  if (nodePlatform === 'win32' || nodePlatform === 'darwin') return nodePlatform
  return null
}

type Samplers = Record<Platform, () => Promise<RawSample>>

const defaultSamplers: Samplers = { win32: sampleWindows, darwin: () => sampleDarwin() }

export function sample(
  platform: Platform,
  samplers: Samplers = defaultSamplers
): Promise<RawSample> {
  return samplers[platform]()
}
