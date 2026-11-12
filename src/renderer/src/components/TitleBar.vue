<!--
  NeoHtop (MIT) TitleBar.svelte · ThemeSwitcher.svelte · ThemeGallery.svelte.
  바꾼 점: 일시정지·메뉴바 요약 버튼 대신 지금 새로고침. 테마는 pitwall 의 세 가지(밝게·어둡게·OS 따라).
  창 단추(최소화·최대화·닫기)는 Windows 는 오른쪽 위(제목줄 겹침 영역), macOS 는 왼쪽 위 신호등 자리라 그만큼 비운다.
-->
<script setup lang="ts">
import {
  Check,
  Ellipsis,
  Info,
  Monitor,
  Moon,
  Palette,
  RefreshCw,
  Settings2,
  Sun
} from '@lucide/vue'
import type { ThemeChoice } from '../../../shared/settings'
import { text } from '../../../shared/text'
import logo from '../../../../resources/icon-small.png'
import Button from '../ui/Button.vue'
import Popover from '../ui/Popover.vue'
import { MENU_ITEM_CLASS, MENU_SEPARATOR_CLASS, MENU_SHORTCUT_CLASS } from '../ui/variants'

defineProps<{
  stale: boolean
  refreshing: boolean
  /** 창이 열려 있을 때 갱신 주기(초). */
  liveSec: number
  theme: ThemeChoice
  isMac: boolean
}>()
const emit = defineEmits<{
  home: []
  refresh: []
  theme: [choice: ThemeChoice]
  settings: []
  about: []
  checkUpdate: []
}>()

const THEMES: { key: ThemeChoice; icon: unknown; colors: string[] }[] = [
  { key: 'light', icon: Sun, colors: ['#16774a', '#93590a', '#b13a2e'] },
  { key: 'dark', icon: Moon, colors: ['#8fdcaa', '#f0b45c', '#f07a6e'] },
  { key: 'auto', icon: Monitor, colors: [] }
]
const shortcut = navigator.userAgent.includes('Mac') ? '⌘,' : 'Ctrl+,'
</script>

<template>
  <div
    class="title-bar flex h-12 shrink-0 items-center gap-3 border-b border-border bg-card pr-4"
    :class="isMac ? 'pl-20' : 'pl-4'"
  >
    <button
      type="button"
      class="flex items-center gap-2 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      @click="emit('home')"
    >
      <img :src="logo" alt="" class="size-5" />
      <h1 class="text-sm font-semibold tracking-tight">{{ text.appName }}</h1>
    </button>
    <div class="h-full min-w-4 flex-1"></div>
    <div class="title-bar-actions flex items-center gap-1">
      <span class="mr-2 flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
        <span
          class="size-1.5 rounded-[1px]"
          :style="{ background: stale ? 'var(--status-waiting)' : 'var(--status-running)' }"
        ></span
        >{{ stale ? text.ui.stale : text.ui.bar.live(liveSec) }}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        :aria-label="text.ui.bar.refresh"
        :title="text.ui.bar.refresh"
        :disabled="refreshing"
        data-action="refresh"
        @click="emit('refresh')"
      >
        <RefreshCw :class="{ 'animate-spin': refreshing }" />
      </Button>
      <div class="mx-1 h-4 w-px bg-border"></div>
      <Popover class="w-64">
        <template #trigger="{ toggle, open }">
          <Button
            variant="ghost"
            size="icon-sm"
            :aria-label="text.ui.bar.theme"
            :title="text.ui.bar.theme"
            :aria-expanded="open"
            @click="toggle"
          >
            <Palette />
          </Button>
        </template>
        <template #default="{ close }">
          <h2 class="text-sm font-medium">{{ text.ui.bar.themeTitle }}</h2>
          <div class="-mt-2 grid gap-1">
            <Button
              v-for="t in THEMES"
              :key="t.key"
              :variant="theme === t.key ? 'secondary' : 'ghost'"
              size="sm"
              class="h-auto min-h-9 justify-start gap-2 py-2 text-xs"
              :aria-pressed="theme === t.key"
              :data-theme-choice="t.key"
              @click="(emit('theme', t.key), close())"
            >
              <span v-if="t.colors.length" class="flex shrink-0 gap-0.5" aria-hidden="true">
                <span
                  v-for="color in t.colors"
                  :key="color"
                  class="size-2 rounded-full"
                  :style="{ background: color }"
                ></span>
              </span>
              <component :is="t.icon" v-else class="size-3.5 text-muted-foreground" />
              <span>{{ text.ui.bar.themes[t.key].label }}</span>
              <span class="text-muted-foreground">{{ text.ui.bar.themes[t.key].sub }}</span>
              <Check v-if="theme === t.key" class="ml-auto size-3" />
            </Button>
          </div>
        </template>
      </Popover>
      <Popover kind="menu" class="w-60">
        <template #trigger="{ toggle, open }">
          <Button
            variant="ghost"
            size="icon-sm"
            :aria-label="text.ui.bar.menu"
            :title="text.ui.bar.menu"
            :aria-expanded="open"
            @click="toggle"
          >
            <Ellipsis />
          </Button>
        </template>
        <template #default="{ close }">
          <button type="button" :class="MENU_ITEM_CLASS" @click="(emit('settings'), close())">
            <Settings2 />{{ text.ui.bar.settings
            }}<span :class="MENU_SHORTCUT_CLASS">{{ shortcut }}</span>
          </button>
          <div :class="MENU_SEPARATOR_CLASS"></div>
          <button type="button" :class="MENU_ITEM_CLASS" @click="(emit('about'), close())">
            <Info />{{ text.ui.bar.about }}
          </button>
          <button type="button" :class="MENU_ITEM_CLASS" @click="(emit('checkUpdate'), close())">
            <RefreshCw />{{ text.ui.bar.checkUpdate }}
          </button>
        </template>
      </Popover>
    </div>
  </div>
</template>

<style scoped>
/* Windows: 오른쪽 위 창 단추(제목줄 겹침 영역)만큼 비운다. macOS·브라우저에서는 env 값이 없어 0. */
.title-bar-actions {
  margin-right: calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw));
}
</style>
