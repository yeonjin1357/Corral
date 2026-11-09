<!--
  NeoHtop (MIT) ui/popover/popover-content.svelte · ui/dropdown-menu/dropdown-menu-content.svelte 의 모양.
  여닫기만 하는 단순한 판(바깥을 누르거나 Esc 로 닫는다).
-->
<script setup lang="ts">
import { onBeforeUnmount, ref, watch, type HTMLAttributes } from 'vue'
import { cn } from './cn'
import { MENU_CLASS, POPOVER_CLASS } from './variants'

const props = withDefaults(
  defineProps<{ kind?: 'popover' | 'menu'; class?: HTMLAttributes['class'] }>(),
  { kind: 'popover', class: undefined }
)
const open = ref(false)
const root = ref<HTMLElement | null>(null)

function toggle(): void {
  open.value = !open.value
}
function close(): void {
  open.value = false
}
function onPointer(event: PointerEvent): void {
  if (root.value && !root.value.contains(event.target as Node)) close()
}
function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') close()
}
watch(open, (value) => {
  if (value) {
    document.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey)
  } else {
    document.removeEventListener('pointerdown', onPointer)
    window.removeEventListener('keydown', onKey)
  }
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onPointer)
  window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <div ref="root" class="relative inline-flex" data-no-drag>
    <slot name="trigger" :toggle="toggle" :open="open" />
    <div
      v-if="open"
      data-no-drag
      :class="
        cn(
          kind === 'menu' ? MENU_CLASS : POPOVER_CLASS,
          'absolute right-0 top-full mt-1',
          props.class
        )
      "
    >
      <slot :close="close" />
    </div>
  </div>
</template>
