<!--
  밑줄 탭(G4): 화면·구역을 옮기는 탭 줄. 고른 탭은 굵게 + 아래 2px 민트 줄.
  자주 안 쓰는 탭은 `more` 로 "더 보기" 메뉴에 둔다(고른 값이 거기 있으면 단추가 그 이름을 보인다).
  목록/묶음 같은 보기 전환은 이 탭이 아니라 ToggleGroup 을 쓴다.
-->
<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { ChevronDown } from '@lucide/vue'
import { cn } from './cn'
import Popover from './Popover.vue'
import { MENU_ITEM_CLASS } from './variants'
import type { ToggleOption } from './ToggleGroup.vue'

/** ToggleGroup 의 옵션과 같은 모양. */
export type TabOption = ToggleOption

const props = defineProps<{
  options: TabOption[]
  more?: TabOption[]
  moreLabel?: string
  ariaLabel?: string
}>()
const model = defineModel<string>({ required: true })

const root = ref<HTMLElement | null>(null)
const moreSelected = computed(() => props.more?.find((o) => o.value === model.value))

const TAB_CLASS =
  'inline-flex h-8 shrink-0 cursor-pointer items-center gap-1 border-b-2 border-transparent px-3 text-sm whitespace-nowrap text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3.5 [&_svg]:shrink-0'
const SELECTED_CLASS = 'border-primary font-semibold text-foreground'

/** ←/→: 이웃한 칸(탭·더 보기 단추)에 초점을 옮긴다. 끝에서는 처음으로 돌고, 탭이면 바로 고른다. */
function onKeydown(event: KeyboardEvent): void {
  const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
  if (!step) return
  const stops = Array.from(
    root.value?.querySelectorAll<HTMLElement>('[data-slot="tab"], [data-slot="tab-more"]') ?? []
  )
  const at = stops.indexOf(event.target as HTMLElement)
  if (at < 0) return
  event.preventDefault()
  const next = stops[(at + step + stops.length) % stops.length]
  next.focus()
  if (next.dataset.slot === 'tab') model.value = next.dataset.value as string
}

function moreButton(): HTMLElement | null {
  return root.value?.querySelector<HTMLElement>('[data-slot="tab-more"]') ?? null
}
function menuItems(): HTMLElement[] {
  return Array.from(root.value?.querySelectorAll<HTMLElement>('[data-slot="tab-more-item"]') ?? [])
}
/** 메뉴가 그려진 뒤 고른 줄(없으면 첫 줄)로 초점을 옮긴다. */
async function focusMenu(): Promise<void> {
  await nextTick()
  const items = menuItems()
  ;(items.find((i) => i.dataset.value === model.value) ?? items[0])?.focus()
}
/** 더 보기 단추: ↓ 로 열고, 키보드(Enter·Space)로 열 때도 메뉴로 초점을 옮긴다. */
function onMoreClick(event: MouseEvent, open: boolean, toggle: () => void): void {
  toggle()
  if (!open && event.detail === 0) void focusMenu()
}
function onMoreDown(open: boolean, toggle: () => void): void {
  if (!open) toggle()
  void focusMenu()
}
/** 메뉴 줄: ↑/↓ 로 옮기고(끝에서 돈다), Esc 는 닫고 더 보기 단추로 초점을 돌려준다. */
function onMenuKeydown(event: KeyboardEvent, close: () => void): void {
  if (event.key === 'Escape') {
    close()
    moreButton()?.focus()
    return
  }
  const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
  if (!step) return
  const items = menuItems()
  const at = items.indexOf(event.target as HTMLElement)
  if (at < 0) return
  event.preventDefault()
  items[(at + step + items.length) % items.length].focus()
}
function chooseMore(value: string, close: () => void): void {
  model.value = value
  close()
  moreButton()?.focus()
}
</script>

<template>
  <div
    ref="root"
    role="tablist"
    data-slot="tab-bar"
    :aria-label="ariaLabel"
    class="flex w-fit flex-row items-center"
    @keydown="onKeydown"
  >
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      role="tab"
      data-slot="tab"
      :data-value="option.value"
      :aria-selected="model === option.value"
      :tabindex="model === option.value ? 0 : -1"
      :class="cn(TAB_CLASS, model === option.value && SELECTED_CLASS)"
      @click="model = option.value"
    >
      <component :is="option.icon" v-if="option.icon" />
      {{ option.label }}
      <span
        v-if="option.count != null"
        :class="
          cn(
            'text-xs font-normal tabular-nums',
            model === option.value ? 'text-primary' : 'text-muted-foreground'
          )
        "
        >{{ option.count }}</span
      >
    </button>
    <Popover v-if="more?.length" kind="menu" class="w-40">
      <template #trigger="{ toggle, open }">
        <button
          type="button"
          data-slot="tab-more"
          aria-haspopup="menu"
          :aria-expanded="open"
          :tabindex="moreSelected ? 0 : -1"
          :class="cn(TAB_CLASS, moreSelected && SELECTED_CLASS)"
          @click="onMoreClick($event, open, toggle)"
          @keydown.down.prevent="onMoreDown(open, toggle)"
        >
          {{ moreSelected ? moreSelected.label : moreLabel }}
          <ChevronDown />
        </button>
      </template>
      <template #default="{ close }">
        <div role="menu" class="flex flex-col" @keydown="onMenuKeydown($event, close)">
          <button
            v-for="option in more"
            :key="option.value"
            type="button"
            role="menuitemradio"
            data-slot="tab-more-item"
            :data-value="option.value"
            :aria-checked="model === option.value"
            :class="cn(MENU_ITEM_CLASS, model === option.value && 'font-semibold')"
            @click="chooseMore(option.value, close)"
          >
            <component :is="option.icon" v-if="option.icon" />
            {{ option.label }}
          </button>
        </div>
      </template>
    </Popover>
  </div>
</template>
