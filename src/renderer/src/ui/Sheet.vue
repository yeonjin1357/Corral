<!--
  NeoHtop (MIT) ui/sheet/sheet-content.svelte · sheet-overlay.svelte (오른쪽에서 나오는 패널).
  머리·본문·바닥은 쓰는 쪽에서 NeoHtop 의 sheet-header/footer 클래스를 그대로 쓴다.
-->
<script setup lang="ts">
import { onBeforeUnmount, watch, type HTMLAttributes } from 'vue'
import { X } from '@lucide/vue'
import { cn } from './cn'
import Button from './Button.vue'

const props = withDefaults(
  defineProps<{ class?: HTMLAttributes['class']; closeLabel?: string; ariaLabel?: string }>(),
  { class: undefined, closeLabel: '닫기', ariaLabel: undefined }
)
const open = defineModel<boolean>('open', { required: true })

function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') open.value = false
}
watch(
  open,
  (value) => {
    if (value) window.addEventListener('keydown', onKey)
    else window.removeEventListener('keydown', onKey)
  },
  { immediate: true }
)
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="animate-in fade-in-0 duration-100"
      leave-active-class="animate-out fade-out-0 duration-100"
    >
      <div
        v-if="open"
        data-slot="sheet-overlay"
        class="bg-black/10 supports-backdrop-filter:backdrop-blur-xs fixed inset-0 z-50"
        @click="open = false"
      ></div>
    </Transition>
    <Transition
      enter-active-class="animate-in fade-in-0 slide-in-from-right-10 duration-200 ease-in-out"
      leave-active-class="animate-out fade-out-0 slide-out-to-right-10 duration-200 ease-in-out"
    >
      <div
        v-if="open"
        role="dialog"
        aria-modal="true"
        :aria-label="ariaLabel"
        data-slot="sheet-content"
        data-side="right"
        :class="
          cn(
            'bg-popover text-popover-foreground fixed z-50 flex flex-col gap-4 bg-clip-padding text-sm shadow-lg inset-y-0 right-0 h-full w-3/4 border-l sm:max-w-sm',
            props.class
          )
        "
      >
        <slot />
        <Button
          variant="ghost"
          size="icon-sm"
          class="absolute top-4 right-4"
          :aria-label="closeLabel"
          :title="closeLabel"
          @click="open = false"
        >
          <X />
        </Button>
      </div>
    </Transition>
  </Teleport>
</template>
