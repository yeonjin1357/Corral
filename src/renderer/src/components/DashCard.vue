<script setup lang="ts">
import { computed } from 'vue'
import { text } from '../../../shared/text'

const props = withDefaults(
  defineProps<{
    title: string
    summary: string
    expanded: boolean
    /** 다음 단계에서 채워질 카드: 안내만 보이고 펼쳐지지 않는다. */
    pending?: boolean
    tone?: 'primary' | 'secondary' | 'warning' | 'danger'
  }>(),
  { pending: false, tone: 'primary' }
)
const emit = defineEmits<{ toggle: [] }>()

// Uptime Kuma 의 .num 기본 색은 primary. 나머지 톤만 글자색을 바꾼다.
const toneClass = computed(() => (props.tone === 'primary' ? '' : `text-${props.tone}`))
</script>

<template>
  <section class="shadow-box big-padding dash-card" :class="{ expanded }">
    <button type="button" class="card-head" :aria-expanded="expanded" :disabled="pending" @click="emit('toggle')">
      <h3>{{ title }}</h3>
      <span class="num" :class="toneClass">{{ summary }}</span>
      <small v-if="pending" class="text-secondary">{{ text.ui.pending }}</small>
    </button>
    <div v-if="expanded && !pending" class="card-detail mt-3">
      <slot name="detail" />
    </div>
  </section>
</template>

<style scoped>
.card-head {
  display: block;
  width: 100%;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  text-align: center;
  cursor: pointer;
}

.card-head:disabled {
  cursor: default;
}
</style>
