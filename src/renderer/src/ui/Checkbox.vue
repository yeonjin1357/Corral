<!-- NeoHtop (MIT) ui/checkbox/checkbox.svelte -->
<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { Check } from '@lucide/vue'
import { cn } from './cn'
import { CHECKBOX_CLASS } from './variants'

const props = withDefaults(
  defineProps<{ id?: string; disabled?: boolean; class?: HTMLAttributes['class'] }>(),
  { id: undefined, disabled: false, class: undefined }
)
const model = defineModel<boolean>({ default: false })
</script>

<template>
  <button
    :id="id"
    type="button"
    role="checkbox"
    data-slot="checkbox"
    :aria-checked="model"
    :data-state="model ? 'checked' : 'unchecked'"
    :disabled="disabled"
    :class="cn(CHECKBOX_CLASS, props.class)"
    @click="model = !model"
  >
    <span
      data-slot="checkbox-indicator"
      class="[&>svg]:size-3.5 grid place-content-center text-current"
    >
      <Check v-if="model" />
    </span>
  </button>
</template>
