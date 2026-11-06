<script setup lang="ts">
import type { PortRow } from '../../../shared/types'
import { formatBytes, worktreeLabel } from '../../../shared/format'
import { text } from '../../../shared/text'
import StatusBadge from './StatusBadge.vue'

withDefaults(defineProps<{ ports: PortRow[]; busyPid?: number | null }>(), { busyPid: null })
const emit = defineEmits<{ kill: [port: number, pid: number] }>()
</script>

<template>
  <p v-if="ports.length === 0" class="text-secondary m-0">{{ text.ui.ports.empty }}</p>
  <div v-else class="table-wrapper">
    <table class="table table-hover align-middle m-0">
      <thead>
        <tr>
          <th>{{ text.ui.ports.port }}</th>
          <th>{{ text.ui.ports.worktree }}</th>
          <th>{{ text.ui.ports.clients }}</th>
          <th class="text-end">{{ text.ui.ports.memory }}</th>
          <th />
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in ports" :key="`${row.port}:${row.pid}`">
          <td class="fw-bold">:{{ row.port }}</td>
          <td>
            <div :class="{ 'text-secondary': row.unresolvable }">{{ worktreeLabel(row.worktree) }}</div>
            <small class="text-secondary">{{ row.processName }} · PID {{ row.pid }}</small>
          </td>
          <td>
            <StatusBadge
              :tone="row.clientCount > 0 ? 'primary' : 'secondary'"
              :text="row.clientCount > 0 ? text.ui.ports.clientCount(row.clientCount) : text.ui.ports.noClients"
            />
          </td>
          <td class="text-end">{{ formatBytes(row.memoryBytes) }}</td>
          <td class="text-end">
            <button
              v-if="!row.unresolvable"
              type="button"
              class="btn btn-danger btn-sm"
              :disabled="busyPid === row.pid"
              @click="emit('kill', row.port, row.pid)"
            >
              {{ text.ui.ports.kill }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
/* Uptime Kuma DashboardHome.vue 표 스타일 */
table {
  font-size: 14px;
}

.table-wrapper {
  overflow-x: auto;
}
</style>
