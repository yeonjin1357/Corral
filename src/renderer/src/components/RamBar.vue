<script setup lang="ts">
import { computed } from 'vue'
import type { MemorySummary } from '../../../shared/types'
import { formatBytes } from '../../../shared/format'
import { text } from '../../../shared/text'

const props = defineProps<{ memory: MemorySummary }>()

const LEVEL_CLASS = { normal: 'bg-primary', warn: 'bg-warning', danger: 'bg-danger' } as const
const barClass = computed(() => LEVEL_CLASS[props.memory.level])
// 내림: 경고 기준(정수 %)과 표시가 어긋나지 않게 한다(79.6% 를 80% 로 보여 주면서 초록으로 칠하지 않도록).
const roundedPercent = computed(() => Math.floor(props.memory.usedPercent))
const usage = computed(() =>
  text.ui.ramUsage(formatBytes(props.memory.usedBytes), formatBytes(props.memory.totalBytes), roundedPercent.value)
)
</script>

<template>
  <section class="shadow-box big-padding mb-3">
    <div class="d-flex align-items-baseline mb-2">
      <h3 class="m-0">{{ text.ui.ram }}</h3>
      <span class="ms-auto">{{ usage }}</span>
    </div>
    <div class="progress">
      <div
        class="progress-bar"
        :class="barClass"
        role="progressbar"
        :style="{ width: memory.usedPercent + '%' }"
        :aria-valuenow="roundedPercent"
        aria-valuemin="0"
        aria-valuemax="100"
      />
    </div>
  </section>
</template>
