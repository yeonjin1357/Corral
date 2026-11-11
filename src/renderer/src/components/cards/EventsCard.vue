<!--
  최근 기록 카드(G3): 기록 탭의 가장 새 세 줄(종류·시각, 아래에 대상·내용). 한 줄이나 ↗ 를 누르면 기록 탭.
  간단히 단계는 가장 새 기록의 시각과 한 줄.
-->
<script setup lang="ts">
import { computed } from 'vue'
import { History } from '@lucide/vue'
import type { PitEvent } from '../../../../shared/events'
import { text } from '../../../../shared/text'
import { eventText, timeText } from '../../events'
import Card from '../../ui/Card.vue'
import CardContent from '../../ui/CardContent.vue'
import PanelHeader from '../PanelHeader.vue'
import CompactCard from '../CompactCard.vue'

const props = defineProps<{
  events: PitEvent[]
  /** 오늘인지 가르는 기준(스냅샷 시각). */
  now: number
  /** 간단히 단계(CompactCard 한 장). */
  compact?: boolean
}>()
const emit = defineEmits<{ tab: [key: 'events'] }>()

const T = text.ui.cardsEdit

const SHOWN = 3
/** 새 것부터 세 줄. 둘째 줄은 대상·내용(기록 탭의 두 칸, 같은 글이면 한 번). */
const recent = computed(() =>
  [...props.events]
    .sort((a, b) => b.t - a.t || b.id - a.id)
    .slice(0, SHOWN)
    .map((e) => {
      const { kind, detail } = eventText(e)
      const parts = [e.where ?? e.label ?? '', detail].filter(Boolean)
      return {
        id: e.id,
        kind,
        time: timeText(e.t, props.now),
        detail: [...new Set(parts)].join(' · ')
      }
    })
)
const latest = computed(() => recent.value[0] ?? null)
</script>

<template>
  <CompactCard
    v-if="compact"
    :icon="History"
    :title="T.title.events"
    :action-label="text.ui.cards.showList"
    :value="latest ? latest.time : text.ui.none"
    @action="emit('tab', 'events')"
  >
    <span v-if="latest" class="min-w-0 truncate" :title="latest.detail || undefined">{{
      latest.detail ? `${latest.kind} · ${latest.detail}` : latest.kind
    }}</span>
    <span v-else class="min-w-0 truncate">{{ T.eventsNone }}</span>
  </CompactCard>
  <Card v-else size="sm" class="h-60 gap-3">
    <PanelHeader
      :icon="History"
      :title="T.title.events"
      :action-label="text.ui.cards.showList"
      @action="emit('tab', 'events')"
    />
    <CardContent class="min-h-0 flex-1 gap-2">
      <ul v-if="recent.length" class="space-y-2">
        <li v-for="e in recent" :key="e.id" data-event>
          <button
            type="button"
            class="flex w-full min-w-0 flex-col rounded-sm text-left outline-none hover:text-primary focus-visible:ring-3 focus-visible:ring-ring/50"
            @click="emit('tab', 'events')"
          >
            <span class="flex w-full min-w-0 items-center gap-2 text-xs leading-4">
              <span data-event-kind class="min-w-0 truncate font-medium">{{ e.kind }}</span>
              <span data-event-time class="ml-auto shrink-0 tabular-nums text-muted-foreground">{{
                e.time
              }}</span>
            </span>
            <span
              v-if="e.detail"
              data-event-detail
              class="w-full truncate text-[11px] leading-4 text-muted-foreground"
              :title="e.detail"
              >{{ e.detail }}</span
            >
          </button>
        </li>
      </ul>
      <p v-else class="text-xs leading-4 text-muted-foreground">{{ T.eventsNone }}</p>
    </CardContent>
  </Card>
</template>
