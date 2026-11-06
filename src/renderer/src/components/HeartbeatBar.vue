<!--
  Uptime Kuma (MIT) src/components/HeartbeatBar.vue 의 막대 모양(크기·간격·알약 모양·색)을 가져옴.
  바꾼 점: 원본은 canvas 로 그리지만 여기서는 div 로 그린다. 상태는 up(연결 있음)·idle(열려만 있음) 두 가지,
  기록이 없는 칸은 원본처럼 빈 막대로 채운다. 넘치는 왼쪽(오래된) 칸은 잘려 보이지 않는다.
-->
<script setup lang="ts">
import { computed } from 'vue'
import { BEAT_LIMIT, type Beat } from '../history'

const props = withDefaults(defineProps<{ beats: Beat[]; size?: 'small' | 'big' }>(), {
  size: 'big'
})

const slots = computed<(Beat | 'empty')[]>(() => {
  const recent = props.beats.slice(-BEAT_LIMIT)
  return [...Array<'empty'>(BEAT_LIMIT - recent.length).fill('empty'), ...recent]
})
</script>

<template>
  <div class="hp-bar" :class="'hp-bar-' + size">
    <div v-for="(beat, i) in slots" :key="i" class="beat" :class="'beat-' + beat" />
  </div>
</template>

<style scoped lang="scss">
@import '../styles/vars.scss';

.hp-bar {
  --beat-empty-color: #f0f8ff;
  --beat-idle-color: #ced4da;
  display: flex;
  justify-content: flex-end;
  overflow: hidden;
  white-space: nowrap;
}

.dark .hp-bar {
  --beat-empty-color: #848484;
  --beat-idle-color: #adb5bd;
}

.beat {
  flex: 0 0 auto;
  border-radius: 50rem;
  background-color: var(--beat-empty-color);
}

.hp-bar-big .beat {
  width: 10px;
  height: 30px;
  margin: 4px;
}

.hp-bar-small .beat {
  width: 5px;
  height: 16px;
  margin: 2px;
}

.beat-up {
  background-color: $primary;
}

.beat-idle {
  background-color: var(--beat-idle-color);
}
</style>
