<!--
  NeoHtop (MIT) toolbar/ToolBar.svelte · SearchBox.svelte.
  바꾼 점: "Processes 609" 제목과 목록/트리 전환 자리에 pitwall 의 보기 탭(작업 공간·개발 서버·에이전트·…)을 둔다.
  오른쪽 칸은 탭마다 다른 버튼(디스크 다시 찾기·연동 설정)을 받는다.
  개발 서버 탭에는 NeoHtop 의 "List / Tree" 전환을 "목록 / 묶음"(작업 공간)으로 둔다.
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { FolderTree, List, Search, X } from '@lucide/vue'
import { text } from '../../../shared/text'
import type { TabKey } from '../rows'
import type { ServerView } from '../viewState'
import ToggleGroup, { type ToggleOption } from '../ui/ToggleGroup.vue'
import Input from '../ui/Input.vue'
import Button from '../ui/Button.vue'
import Badge from '../ui/Badge.vue'

const props = defineProps<{
  counts: Record<TabKey, number>
  /** 검색에 맞는 행 수. */
  matching: number
  /** 검색 결과 줄의 전체 수: 지금 보이는 표의 수(다른 포트·숨긴 서버 보기). 없으면 탭의 수. */
  total?: number
}>()
const tab = defineModel<TabKey>('tab', { required: true })
const query = defineModel<string>('query', { required: true })
/** 개발 서버 보기(목록 / 작업 공간 묶음). */
const view = defineModel<ServerView>('view', { default: 'group' })
const viewOptions: ToggleOption[] = [
  { value: 'list', label: text.ui.group.list, icon: List },
  { value: 'group', label: text.ui.group.grouped, icon: FolderTree }
]
const viewValue = computed({
  get: () => view.value as string,
  set: (v: string) => (view.value = v === 'list' ? 'list' : 'group')
})

const ORDER: TabKey[] = [
  'workspaces',
  'ports',
  'agents',
  'leftovers',
  'heavy',
  'disk',
  'apps',
  'events'
]
/** 숫자를 달지 않는 탭: 수가 늘 크고(앱 수백 개·기록 수백 줄) 손댈 일의 양을 뜻하지 않아 눈에 거슬리기만 한다. */
const UNCOUNTED: ReadonlySet<TabKey> = new Set(['apps', 'events'])
const options = computed<ToggleOption[]>(() =>
  ORDER.map((key) => ({
    value: key,
    label: text.ui.tabs[key],
    count: UNCOUNTED.has(key) ? null : props.counts[key]
  }))
)
const tabValue = computed({
  get: () => tab.value as string,
  set: (v: string) => (tab.value = v as TabKey)
})

const input = ref<InstanceType<typeof Input> | null>(null)
function focusSearch(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
    event.preventDefault()
    ;(input.value?.$el as HTMLInputElement | undefined)?.focus()
  }
}
onMounted(() => window.addEventListener('keydown', focusSearch))
onBeforeUnmount(() => window.removeEventListener('keydown', focusSearch))
</script>

<template>
  <div class="toolbar shrink-0 border-y border-border bg-card px-4 py-3">
    <div class="flex flex-wrap items-center gap-3">
      <ToggleGroup v-model="tabValue" :options="options" :aria-label="text.ui.tabs.label" />
      <div class="flex min-w-56 max-w-md flex-1 items-center gap-1">
        <div class="relative min-w-0 flex-1">
          <Search
            class="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground"
          />
          <Input
            ref="input"
            v-model="query"
            :aria-label="text.ui.search.placeholder"
            :placeholder="text.ui.search.placeholder"
            class="h-9 pl-9 pr-9"
            @keydown.esc.prevent="query = ''"
          />
          <Button
            v-if="query"
            variant="ghost"
            size="icon-xs"
            class="absolute right-1.5 top-1.5 text-muted-foreground"
            :aria-label="text.ui.search.clear"
            :title="text.ui.search.clear"
            @click="query = ''"
          >
            <X />
          </Button>
        </div>
      </div>
      <div class="ml-auto flex shrink-0 items-center gap-2">
        <ToggleGroup
          v-if="tab === 'ports'"
          v-model="viewValue"
          :options="viewOptions"
          :aria-label="text.ui.group.viewLabel"
        />
        <slot name="actions" />
      </div>
    </div>
    <div
      v-if="query.trim()"
      class="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
    >
      <span>{{ text.ui.search.matches(matching, total ?? counts[tab]) }}</span>
      <Badge variant="secondary" class="max-w-64 font-normal">
        <span class="truncate" :title="query">{{ text.ui.search.chip(query.trim()) }}</span>
      </Badge>
      <Button variant="ghost" size="sm" class="h-6 px-2 text-xs" @click="query = ''">
        <X class="size-3" />{{ text.ui.search.clearAll }}
      </Button>
    </div>
  </div>
</template>
