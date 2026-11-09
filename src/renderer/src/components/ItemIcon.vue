<!--
  NeoHtop (MIT) process/ProcessIcon.svelte 처럼 행마다 앱 아이콘을 보인다.
  순서: 넣어 둔 로고(Claude Code·Codex) → OS 앱 아이콘(실행 파일) 또는 브랜드 로고(prefer 로 정함) → 기본 아이콘.
-->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { AppWindow, FolderGit2, Globe, Hammer, SquareTerminal, Unplug } from '@lucide/vue'
import type { RowIcon } from '../rows'
import { brandColor } from '../brand'
import { nativeIcon } from '../nativeIcons'

const props = withDefaults(defineProps<{ icon: RowIcon; size?: number }>(), { size: 16 })

const FALLBACK = {
  globe: Globe,
  terminal: SquareTerminal,
  app: AppWindow,
  folder: FolderGit2,
  hammer: Hammer,
  unplug: Unplug
} as const

const native = ref<string | null>(null)
watch(
  () => props.icon.exePath,
  async (path, _old, onCleanup) => {
    let stale = false
    onCleanup(() => (stale = true))
    native.value = null
    if (!path) return
    const icon = await nativeIcon(path)
    if (!stale) native.value = icon
  },
  { immediate: true }
)

const choice = computed<'image' | 'native' | 'brand' | 'fallback'>(() => {
  if (props.icon.image) return 'image'
  const brand = !!props.icon.brand
  if (props.icon.prefer === 'native') return native.value ? 'native' : brand ? 'brand' : 'fallback'
  return brand ? 'brand' : native.value ? 'native' : 'fallback'
})
</script>

<template>
  <img
    v-if="choice === 'image'"
    :src="icon.image!"
    :width="size"
    :height="size"
    alt=""
    aria-hidden="true"
    draggable="false"
    class="shrink-0 object-contain"
  />
  <img
    v-else-if="choice === 'native'"
    :src="native!"
    :width="size"
    :height="size"
    alt=""
    aria-hidden="true"
    draggable="false"
    class="shrink-0 object-contain"
  />
  <svg
    v-else-if="choice === 'brand'"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    role="img"
    :aria-label="icon.brand!.title"
    class="shrink-0"
  >
    <title>{{ icon.brand!.title }}</title>
    <path :d="icon.brand!.path" :fill="brandColor(icon.brand!.hex)" />
  </svg>
  <component
    :is="FALLBACK[icon.fallback]"
    v-else
    class="shrink-0 text-muted-foreground"
    :style="{ width: `${size}px`, height: `${size}px` }"
    aria-hidden="true"
  />
</template>
