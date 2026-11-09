<!-- shadcn (MIT) textarea: NeoHtop 입력칸과 같은 테두리·초점 규칙 -->
<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from './cn'
import { TEXTAREA_CLASS } from './variants'

const props = defineProps<{ class?: HTMLAttributes['class'] }>()
const model = defineModel<string>()
</script>

<template>
  <textarea v-model="model" data-slot="textarea" :class="cn(TEXTAREA_CLASS, props.class)" />
</template>
