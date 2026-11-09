<!-- NeoHtop (MIT) ui/native-select/native-select.svelte -->
<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { ChevronDown } from '@lucide/vue'
import { cn } from './cn'
import { SELECT_CLASS } from './variants'

const props = withDefaults(
  defineProps<{ size?: 'default' | 'sm'; class?: HTMLAttributes['class']; id?: string }>(),
  { size: 'default', class: undefined, id: undefined }
)
const model = defineModel<string | number>()
</script>

<template>
  <div
    :class="cn('group/native-select relative w-fit has-[select:disabled]:opacity-50', props.class)"
    data-slot="native-select-wrapper"
    :data-size="size"
  >
    <select
      :id="id"
      v-model="model"
      data-slot="native-select"
      :data-size="size"
      :class="SELECT_CLASS"
    >
      <slot />
    </select>
    <ChevronDown
      class="text-muted-foreground top-1/2 right-2.5 size-4 -translate-y-1/2 pointer-events-none absolute select-none"
    />
  </div>
</template>
