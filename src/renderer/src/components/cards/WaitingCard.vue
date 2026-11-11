<!--
  응답 대기 카드(G3): 응답을 기다리는 에이전트 수와 오래 기다린 순서로 세 줄(폴더 · 이유 · 기다린 시간).
  한 줄을 누르면 그 에이전트의 상세 패널. 간단히 단계는 수와 가장 오래 기다린 한 줄(누르면 그 에이전트).
-->
<script setup lang="ts">
import { computed } from 'vue'
import { Hourglass } from '@lucide/vue'
import type { AgentRow } from '../../../../shared/types'
import { formatDuration } from '../../../../shared/format'
import { selectionKey } from '../../../../shared/keys'
import { text } from '../../../../shared/text'
import { folderOf } from '../../rows'
import Card from '../../ui/Card.vue'
import CardContent from '../../ui/CardContent.vue'
import PanelHeader from '../PanelHeader.vue'
import CompactCard from '../CompactCard.vue'

const props = defineProps<{
  agents: AgentRow[]
  /** 기다린 시간의 기준(스냅샷 시각). */
  now: number
  /** 간단히 단계(CompactCard 한 장). */
  compact?: boolean
}>()
const emit = defineEmits<{ select: [key: string] }>()

const T = text.ui.cardsEdit
const ag = text.ui.agent

const waiting = computed(() => props.agents.filter((a) => a.state === 'waiting'))

/** 이유: 세션 파일로 안 대기 이유, 아니면 권한을 기다리는 도구, 둘 다 모르면 그냥 응답 대기. */
function reasonOf(a: AgentRow): string {
  if (a.waitReason) return ag.waitReason[a.waitReason]
  const tool = a.activity?.waiting?.tool
  return tool ? ag.activityWaiting(tool) : ag.states.waiting
}

const SHOWN = 3
/** 오래 기다린 것부터 세 줄(언제부터인지 모르는 것은 뒤로). */
const lines = computed(() =>
  [...waiting.value]
    .sort((a, b) => (a.stateSince ?? Infinity) - (b.stateSince ?? Infinity) || 0)
    .slice(0, SHOWN)
    .map((a) => ({
      key: selectionKey.agent(a),
      folder: folderOf(a.worktree),
      root: a.worktree?.root,
      reason: reasonOf(a),
      waited: a.stateSince != null ? formatDuration(Math.max(0, props.now - a.stateSince)) : null
    }))
)
const first = computed(() => lines.value[0] ?? null)
const color = computed(() => (waiting.value.length ? 'var(--peach)' : null))

function selectFirst(): void {
  if (first.value) emit('select', first.value.key)
}
</script>

<template>
  <CompactCard
    v-if="compact"
    :icon="Hourglass"
    :title="T.title.waiting"
    :color="color"
    :action-label="text.ui.actions.details"
    :value="String(waiting.length)"
    :unit="text.ui.cards.count"
    :disabled="!first"
    @action="selectFirst"
  >
    <template v-if="first">
      <span class="min-w-0 truncate" :title="first.root"
        >{{ first.folder }} · {{ first.reason }}</span
      >
      <span v-if="first.waited" class="shrink-0 tabular-nums">{{ first.waited }}</span>
    </template>
    <span v-else class="min-w-0 truncate">{{ T.waitingNone }}</span>
  </CompactCard>
  <Card v-else size="sm" class="h-60 gap-3">
    <!-- ↗ 가 없어도 이웃 카드와 머리 높이(↗ 단추 24px)를 맞춘다. -->
    <PanelHeader
      class="auto-rows-[1.5rem]"
      :icon="Hourglass"
      :title="T.title.waiting"
      :color="color"
    />
    <CardContent class="min-h-0 flex-1 gap-2">
      <div data-card-value class="text-3xl leading-8 font-semibold tracking-tight tabular-nums">
        {{ waiting.length
        }}<span class="ml-0.5 text-lg font-normal text-muted-foreground">{{
          text.ui.cards.count
        }}</span>
      </div>
      <ul v-if="lines.length" class="mt-auto space-y-1.5 border-t border-border/60 pt-2.5">
        <li v-for="line in lines" :key="line.key" data-waiting>
          <button
            type="button"
            class="flex w-full min-w-0 flex-col rounded-sm text-left outline-none hover:text-primary focus-visible:ring-3 focus-visible:ring-ring/50"
            :title="line.root"
            @click="emit('select', line.key)"
          >
            <span class="flex w-full min-w-0 items-center gap-2 text-xs leading-4">
              <span data-folder class="min-w-0 truncate font-medium">{{ line.folder }}</span>
              <span
                v-if="line.waited"
                data-waited
                class="ml-auto shrink-0 tabular-nums text-muted-foreground"
                >{{ line.waited }}</span
              >
            </span>
            <span
              data-reason
              class="w-full truncate text-[11px] leading-4 text-muted-foreground"
              :title="line.reason"
              >{{ line.reason }}</span
            >
          </button>
        </li>
      </ul>
      <p v-else class="mt-auto text-xs leading-4 text-muted-foreground">{{ T.waitingNone }}</p>
    </CardContent>
  </Card>
</template>
