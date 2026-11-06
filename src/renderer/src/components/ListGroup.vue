<!--
  Uptime Kuma (MIT) src/components/MonitorListItem.vue 의 그룹 항목(알약 배지 · 접기 화살표 · 이름, 하위 항목은 20px 들여쓰기,
  slide-fade-up 으로 펼침, 접은 상태는 localStorage 에 기억)을 가져옴.
  바꾼 점: 그룹 자체의 상세 화면이 없어 머리 전체가 접기·펼치기이고, 알약에는 업타임 % 대신 개수를 보여 준다.
  처음에는 펼쳐져 있다(원본은 접힌 채 시작). 머리 오른쪽에 버튼을 둘 수 있다(actions 슬롯).
-->
<script setup lang="ts">
import { ref } from 'vue'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { faChevronDown } from '@fortawesome/free-solid-svg-icons'
import { text } from '../../../shared/text'

const props = defineProps<{ groupId: string; title: string; count: number; pillClass: string }>()

const STORAGE_KEY = 'pitwall.listGroupCollapsed'

function readCollapsed(): Record<string, boolean> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const value: unknown = raw ? JSON.parse(raw) : {}
    return value && typeof value === 'object' ? (value as Record<string, boolean>) : {}
  } catch {
    return {}
  }
}

const collapsed = ref(readCollapsed()[props.groupId] === true)

function toggle(): void {
  collapsed.value = !collapsed.value
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...readCollapsed(), [props.groupId]: collapsed.value })
    )
  } catch {
    // 저장소를 못 쓰면 이번 실행 동안만 기억한다.
  }
}
</script>

<template>
  <div class="list-group-block">
    <!-- 머리 안에 버튼(actions)을 두므로 링크(a) 대신 버튼 역할의 div 로 둔다(a 안의 button 은 잘못된 HTML). -->
    <div
      class="item group-item"
      role="button"
      tabindex="0"
      :title="text.ui.list.collapse"
      :aria-expanded="!collapsed"
      @click="toggle"
      @keydown.enter.self.prevent="toggle"
      @keydown.space.self.prevent="toggle"
    >
      <div class="row">
        <div class="col-12 small-padding d-flex gap-2 align-items-center">
          <div class="me-1">
            <span class="badge rounded-pill" :class="pillClass">{{ count }}</span>
          </div>
          <div class="d-flex align-items-center gap-2 flex-fill" style="min-width: 0">
            <span class="collapse-padding">
              <FontAwesomeIcon
                :icon="faChevronDown"
                class="collapse-icon animated"
                :class="{ collapsed }"
              />
            </span>
            <div class="name flex-fill text-truncate">{{ title }}</div>
            <div class="actions" @click.stop @keydown.stop>
              <slot name="actions" />
            </div>
          </div>
        </div>
      </div>
    </div>
    <transition name="slide-fade-up">
      <div v-if="!collapsed" class="childs">
        <slot />
      </div>
    </transition>
  </div>
</template>

<style scoped lang="scss">
@import '../styles/vars.scss';

/* Uptime Kuma MonitorListItem.vue */
.small-padding {
  padding-left: 5px !important;
  padding-right: 5px !important;
}

.badge {
  min-width: 62px;
}

.collapsed {
  transform: rotate(-90deg);
}

.animated {
  transition: all 0.2s $easing-in;
}

/* 원본은 하위 항목마다 margin-left: 20px * 깊이 */
.childs {
  margin-left: 20px;
}

.name {
  font-weight: bold;
}

/* Uptime Kuma app.scss 의 slide-fade-up */
.slide-fade-up-enter-active,
.slide-fade-up-leave-active {
  transition: all 0.2s $easing-in;
}

.slide-fade-up-enter-from,
.slide-fade-up-leave-to {
  transform: translateY(-50px);
  opacity: 0;
}
</style>
