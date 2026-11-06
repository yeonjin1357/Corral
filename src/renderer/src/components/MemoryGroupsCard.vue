<script setup lang="ts">
import { computed } from 'vue'
import type { GroupUsage, ProcessGroup } from '../../../shared/types'
import { formatBytes } from '../../../shared/format'
import { text } from '../../../shared/text'

const props = defineProps<{ groups: GroupUsage[] }>()

const ORDER: ProcessGroup[] = ['devServer', 'agent', 'other']
const LABEL: Record<ProcessGroup, string> = {
  devServer: text.ui.groups.devServer,
  agent: text.ui.groups.agent,
  other: text.ui.groups.other
}
const rows = computed(() =>
  ORDER.map((group) => props.groups.find((g) => g.group === group)).filter(
    (g): g is GroupUsage => !!g
  )
)
</script>

<template>
  <table class="table align-middle m-0">
    <tbody>
      <tr v-for="row in rows" :key="row.group">
        <td>{{ LABEL[row.group] }}</td>
        <td class="text-end fw-bold">{{ formatBytes(row.memoryBytes) }}</td>
        <td class="text-end text-secondary">{{ text.ui.groups.processes(row.processCount) }}</td>
      </tr>
    </tbody>
  </table>
</template>

<style scoped>
table {
  font-size: 14px;
}
</style>
