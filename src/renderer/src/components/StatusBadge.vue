<!--
  Uptime Kuma (MIT) src/components/Status.vue 의 배지 마크업과 스타일을 가져옴.
  바꾼 점: 모니터 상태 숫자 대신 톤(primary/warning/danger/secondary)과 문구를 직접 받는다.
-->
<script setup lang="ts">
defineProps<{ tone: 'primary' | 'warning' | 'danger' | 'secondary'; text: string }>()
</script>

<template>
  <span class="badge rounded-pill" :class="'bg-' + tone">{{ text }}</span>
</template>

<style scoped>
span {
  min-width: 64px;
}
</style>
