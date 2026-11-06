<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import type { DashboardSnapshot } from '../../shared/types'

// Task 7 에서 대시보드로 바뀌는 임시 화면: 스냅샷이 IPC 로 잘 오는지만 보여준다.
const snapshot = ref<DashboardSnapshot | null>(null)
let unsubscribe: () => void = () => {}

onMounted(async () => {
  unsubscribe = window.pitwall.onSnapshot((s) => (snapshot.value = s))
  const latest = await window.pitwall.getLatest()
  if (!snapshot.value) snapshot.value = latest
})
onUnmounted(() => unsubscribe())
</script>

<template>
  <pre id="snapshot">{{ snapshot ? JSON.stringify(snapshot, null, 2) : 'loading' }}</pre>
</template>
