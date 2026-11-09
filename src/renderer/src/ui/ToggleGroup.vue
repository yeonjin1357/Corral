<!-- NeoHtop (MIT) ui/toggle-group/toggle-group*.svelte (type="single", 간격 0) -->
<script setup lang="ts">
import type { Component, HTMLAttributes } from 'vue'
import { cn } from './cn'
import { TOGGLE_GROUP_ITEM, toggleClass, type ToggleSize, type ToggleVariant } from './variants'

export interface ToggleOption {
  value: string
  label: string
  icon?: Component
  /** 이름 옆에 흐리게 붙이는 개수(없으면 안 붙임). */
  count?: number | null
}

const props = withDefaults(
  defineProps<{
    options: ToggleOption[]
    variant?: ToggleVariant
    size?: ToggleSize
    ariaLabel?: string
    itemClass?: HTMLAttributes['class']
    class?: HTMLAttributes['class']
  }>(),
  { variant: 'outline', size: 'sm', ariaLabel: undefined, itemClass: undefined, class: undefined }
)
const model = defineModel<string>({ required: true })
</script>

<template>
  <div
    role="group"
    data-slot="toggle-group"
    :data-variant="variant"
    :data-size="size"
    :aria-label="ariaLabel"
    :class="
      cn(
        'rounded-md data-[variant=outline]:shadow-xs group/toggle-group flex w-fit flex-row items-center',
        props.class
      )
    "
  >
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      data-slot="toggle-group-item"
      :data-variant="variant"
      :data-state="model === option.value ? 'on' : 'off'"
      :aria-pressed="model === option.value"
      :data-value="option.value"
      :class="cn(toggleClass(variant, size), TOGGLE_GROUP_ITEM, props.itemClass)"
      @click="model = option.value"
    >
      <component :is="option.icon" v-if="option.icon" class="size-3.5" />
      {{ option.label }}
      <span
        v-if="option.count != null"
        class="ml-0.5 font-normal text-muted-foreground tabular-nums"
        >{{ option.count }}</span
      >
    </button>
  </div>
</template>
