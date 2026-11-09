<!--
  NeoHtop (MIT) toolbar/ToolBar.svelte · SearchBox.svelte.
  바꾼 점: "Processes 609" 제목과 목록/트리 전환 자리에 pitwall 의 보기 탭(개발 서버·에이전트·…)을 둔다.
  오른쪽 칸은 탭마다 다른 버튼(디스크 다시 찾기·Claude 연동 켜기)을 받는다.
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Search, X } from '@lucide/vue'
import { text } from '../../../shared/text'
import type { TabKey } from '../rows'
import ToggleGroup, { type ToggleOption } from '../ui/ToggleGroup.vue'
import Input from '../ui/Input.vue'
import Button from '../ui/Button.vue'
import Badge from '../ui/Badge.vue'

const props = defineProps<{
  counts: Record<TabKey, number>
  /** 검색에 맞는 행 수. */
  matching: number
}>()
const tab = defineModel<TabKey>('tab', { required: true })
const query = defineModel<string>('query', { required: true })

const options = computed<ToggleOption[]>(() =>
  (['ports', 'agents', 'leftovers', 'heavy', 'disk', 'apps'] as TabKey[]).map((key) => ({
    value: key,
    label: text.ui.tabs[key],
    count: props.counts[key]
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
        <slot name="actions" />
      </div>
    </div>
    <div
      v-if="query.trim()"
      class="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
    >
      <span>{{ text.ui.search.matches(matching, counts[tab]) }}</span>
      <Badge variant="secondary" class="max-w-64 font-normal">
        <span class="truncate" :title="query">{{ text.ui.search.chip(query.trim()) }}</span>
      </Badge>
      <Button variant="ghost" size="sm" class="h-6 px-2 text-xs" @click="query = ''">
        <X class="size-3" />{{ text.ui.search.clearAll }}
      </Button>
    </div>
  </div>
</template>
