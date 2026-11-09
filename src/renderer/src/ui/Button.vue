<!-- NeoHtop (MIT) ui/button/button.svelte -->
<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from './cn'
import { buttonClass, type ButtonSize, type ButtonVariant } from './variants'

const props = withDefaults(
  defineProps<{
    variant?: ButtonVariant
    size?: ButtonSize
    type?: 'button' | 'submit'
    /** 있으면 새 창으로 여는 링크(외부 주소). */
    href?: string
    class?: HTMLAttributes['class']
  }>(),
  { variant: 'default', size: 'default', type: 'button', href: undefined, class: undefined }
)
</script>

<template>
  <a
    v-if="href"
    data-slot="button"
    :href="href"
    target="_blank"
    rel="noopener"
    :class="cn(buttonClass(variant, size), props.class)"
    ><slot
  /></a>
  <button
    v-else
    data-slot="button"
    :type="type"
    :class="cn(buttonClass(variant, size), props.class)"
  >
    <slot />
  </button>
</template>
