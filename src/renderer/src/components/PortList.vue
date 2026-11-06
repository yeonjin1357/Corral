<!--
  Uptime Kuma (MIT) src/components/MonitorList.vue 의 목록 상자(검색창이 있는 머리 + 스크롤 목록)를 가져옴.
  바꾼 점: 감시 대상 대신 개발 서버 포트를 보여 주고, 필터·선택 모드·끌어 놓기는 없다.
-->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { faMagnifyingGlass, faXmark } from '@fortawesome/free-solid-svg-icons'
import type { PortRow } from '../../../shared/types'
import { worktreeLabel } from '../../../shared/format'
import { text } from '../../../shared/text'
import { portKey, type PortHistory } from '../history'
import PortListItem from './PortListItem.vue'

const props = defineProps<{
  ports: PortRow[]
  history: Record<string, PortHistory>
  selectedKey: string | null
}>()
const emit = defineEmits<{ select: [key: string] }>()

const search = ref('')

const visible = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return props.ports
  const portQuery = q.replace(/^:/, '')
  return props.ports.filter(
    (row) =>
      worktreeLabel(row.worktree).toLowerCase().includes(q) ||
      row.processName.toLowerCase().includes(q) ||
      String(row.port).includes(portQuery)
  )
})
</script>

<template>
  <div class="shadow-box mb-3 list-box">
    <div class="list-header">
      <div class="search-wrapper">
        <a
          v-if="search"
          href="#"
          class="search-icon"
          :title="text.ui.list.clearSearch"
          @click.prevent="search = ''"
        >
          <FontAwesomeIcon :icon="faXmark" />
        </a>
        <span v-else class="search-icon"><FontAwesomeIcon :icon="faMagnifyingGlass" /></span>
        <input
          v-model="search"
          class="form-control search-input"
          :placeholder="text.ui.list.search"
        />
      </div>
    </div>
    <div class="monitor-list scrollbar">
      <p v-if="ports.length === 0" class="text-secondary px-3">{{ text.ui.list.empty }}</p>
      <p v-else-if="visible.length === 0" class="text-secondary px-3">{{ text.ui.list.noMatch }}</p>
      <PortListItem
        v-for="row in visible"
        :key="portKey(row)"
        :row="row"
        :beats="history[portKey(row)]?.beats ?? []"
        :active="selectedKey === portKey(row)"
        @select="emit('select', portKey(row))"
      />
    </div>
  </div>
</template>

<style scoped lang="scss">
@import '../styles/vars.scss';

/* Uptime Kuma MonitorList.vue */
.shadow-box {
  height: calc(100vh - 150px);
  position: sticky;
  top: 10px;
}

.list-header {
  border-bottom: 1px solid #dee2e6;
  border-radius: 10px 10px 0 0;
  margin-bottom: 10px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;

  .dark & {
    background-color: $dark-header-bg;
    border-bottom: 0;
  }
}

.search-wrapper {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-left: auto;
  width: 100%;
  max-width: 300px;
}

.search-icon {
  color: #c0c0c0;
  cursor: pointer;
  transition: all ease-in-out 0.1s;

  &:hover {
    opacity: 0.5;
  }
}

.search-input {
  width: 100%;
  transition: none !important;
}

.monitor-list.scrollbar {
  height: calc(100% - 70px);
  overflow-y: auto;
}
</style>
