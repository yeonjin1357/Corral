<!--
  할 일 띠(G3): 카드 영역과 탭 사이에, 지금 사용자가 처리할 것을 한 줄씩(점 · 이름 · 위치 · 메시지 · 단추 · 닫기).
  줄이 없으면 아무것도 그리지 않는다(높이 0). 처음 3줄만 보이고 넘치면 "외 n개"로 펼친다.
-->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { X } from '@lucide/vue'
import { text } from '../../../shared/text'
import { formatBytes } from '../../../shared/format'
import type { AttentionItem } from '../attention'
import type { RowIcon } from '../rows'
import ItemIcon from './ItemIcon.vue'
import Button from '../ui/Button.vue'

/** 정리 추천 줄 아래에 보이는 항목(서버·남은 프로세스) 하나. */
export interface RecommendChip {
  key: string
  icon: RowIcon | null
  title: string
  where: string
  memoryBytes: number
  commitBytes: number | null
}

const SHOWN = 3
const props = defineProps<{
  items: AttentionItem[]
  busy?: boolean
  /** 지금 처리 중인 서버·프로세스 키(App 의 busyKey). 그 줄의 단추는 잠근다. */
  busyKey?: string | null
  chips?: RecommendChip[]
}>()
const emit = defineEmits<{
  focus: [key: string]
  kill: [key: string]
  killMany: [keys: string[]]
  showHeavy: []
  select: [key: string]
  dismiss: [id: string, state: string]
}>()

const expanded = ref(false)
const shown = computed(() => (expanded.value ? props.items : props.items.slice(0, SHOWN)))
const hidden = computed(() => props.items.length - SHOWN)

function act(item: AttentionItem): void {
  if ((item.kind === 'waiting' || item.kind === 'done') && item.key) emit('focus', item.key)
  else if (item.kind === 'candidate' && item.key) emit('kill', item.key)
  else if (item.kind === 'recommend') emit('killMany', item.keys ?? [])
  else if (item.kind === 'overlap') emit('showHeavy')
}
const label = (item: AttentionItem): string =>
  ({
    waiting: text.ui.quick.focus,
    done: text.ui.quick.focus,
    recommend: text.ui.home.killAll,
    candidate: text.ui.actions.kill,
    overlap: text.ui.cards.showList
  })[item.kind]
</script>

<template>
  <section
    v-if="items.length"
    :aria-label="text.ui.attention.label"
    class="mx-4 mb-4 shrink-0 overflow-hidden rounded-lg border bg-card text-card-foreground"
  >
    <template v-for="item in shown" :key="item.id">
      <div
        data-attention-item
        :data-kind="item.kind"
        :data-tone="item.tone"
        class="flex items-center gap-3 px-3 py-1.5 text-sm [&:not(:first-child)]:border-t"
      >
        <span class="size-2 shrink-0 rounded-full" style="background: var(--pill)" />
        <span class="shrink-0 font-medium">{{ item.name }}</span>
        <span v-if="item.where" class="shrink-0 truncate text-xs text-muted-foreground">{{
          item.where
        }}</span>
        <span class="min-w-0 flex-1 truncate text-xs" style="color: var(--pill)">
          {{ item.message
          }}<span v-if="item.detail" class="text-muted-foreground"> · {{ item.detail }}</span>
        </span>
        <Button
          :variant="item.kind === 'recommend' ? 'destructive' : 'outline'"
          size="sm"
          :data-action="item.kind === 'recommend' ? 'kill-many' : 'act'"
          :disabled="
            (item.kind === 'recommend' && busy) ||
            (item.kind === 'candidate' && item.key != null && item.key === busyKey)
          "
          @click="act(item)"
        >
          <X v-if="item.kind === 'recommend'" />{{ label(item) }}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          :aria-label="text.ui.bar.dismissItem(item.name)"
          :title="text.ui.bar.dismissItem(item.name)"
          data-action="dismiss"
          @click="emit('dismiss', item.id, item.state)"
        >
          <X />
        </Button>
      </div>
      <div
        v-if="item.kind === 'recommend' && chips?.length"
        class="flex flex-wrap gap-1.5 px-3 pb-2 pl-8"
      >
        <Button
          v-for="chip in chips"
          :key="chip.key"
          variant="secondary"
          size="xs"
          class="recommend-item max-w-80 font-normal"
          :title="chip.where"
          @click="emit('select', chip.key)"
        >
          <ItemIcon v-if="chip.icon" :icon="chip.icon" :size="12" />
          <span>{{ chip.title }}</span>
          <span class="truncate text-muted-foreground">{{ chip.where }}</span>
          <span class="tabular-nums">{{
            chip.commitBytes == null
              ? formatBytes(chip.memoryBytes)
              : text.ui.home.chipSize(formatBytes(chip.memoryBytes), formatBytes(chip.commitBytes))
          }}</span>
        </Button>
        <span
          v-if="(item.keys?.length ?? 0) > chips.length"
          class="self-center text-xs text-muted-foreground"
          >{{ text.ui.recommend.more((item.keys?.length ?? 0) - chips.length) }}</span
        >
      </div>
    </template>
    <div v-if="items.length > SHOWN" class="border-t px-3 py-1">
      <Button variant="ghost" size="xs" data-action="toggle-more" @click="expanded = !expanded">
        {{ expanded ? text.ui.attention.less : text.ui.attention.more(hidden) }}
      </Button>
    </div>
  </section>
</template>
