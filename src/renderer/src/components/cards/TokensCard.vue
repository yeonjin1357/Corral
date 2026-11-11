<!--
  토큰·한도 카드(G3): 컨텍스트가 가장 큰 에이전트의 값·폴더와 Codex 한도 두 창(5시간·주간, codexLimitView).
  누르면(↗) 에이전트 탭. 간단히 단계는 컨텍스트 값과 한 줄(폴더 · 가장 높은 한도 창). 둘 다 모르면 안내 문구.
-->
<script setup lang="ts">
import { computed } from 'vue'
import { Gauge } from '@lucide/vue'
import type { AgentRow, CodexLimits } from '../../../../shared/types'
import { codexLimitView, formatContext, formatTokens } from '../../../../shared/format'
import { text } from '../../../../shared/text'
import { folderOf } from '../../rows'
import Card from '../../ui/Card.vue'
import CardContent from '../../ui/CardContent.vue'
import PanelHeader from '../PanelHeader.vue'
import CompactCard from '../CompactCard.vue'

const props = defineProps<{
  agents: AgentRow[]
  limits: CodexLimits | null
  /** 한도 창이 이미 초기화됐는지·읽은 때의 기준(스냅샷 시각). */
  now: number
  /** 간단히 단계(CompactCard 한 장). */
  compact?: boolean
}>()
const emit = defineEmits<{ tab: [key: 'agents'] }>()

const T = text.ui.cardsEdit
const COLOR = 'var(--chart-5)'

/** 컨텍스트가 가장 큰 에이전트와 그 값(아무도 모르면 null). */
const top = computed(() => {
  let best: { agent: AgentRow; tokens: number; window: number | null } | null = null
  for (const a of props.agents) {
    const tokens = a.usage?.contextTokens
    if (tokens == null || !Number.isFinite(tokens)) continue
    if (!best || tokens > best.tokens)
      best = { agent: a, tokens, window: a.usage?.contextWindow ?? null }
  }
  return best
})
const limit = computed(() => codexLimitView(props.limits, props.now))
const empty = computed(() => !top.value && !limit.value)
</script>

<template>
  <CompactCard
    v-if="compact"
    :icon="Gauge"
    :title="T.title.tokens"
    :color="COLOR"
    :action-label="text.ui.cards.showList"
    :value="top ? formatTokens(top.tokens) : text.ui.none"
    @action="emit('tab', 'agents')"
  >
    <span v-if="empty" class="min-w-0 truncate">{{ T.tokensNone }}</span>
    <span v-else class="min-w-0 truncate" :title="top?.agent.worktree?.root">{{
      top ? folderOf(top.agent.worktree) : ''
    }}</span>
    <span v-if="limit" class="shrink-0 tabular-nums" :title="limit.tip">{{ limit.caption }}</span>
  </CompactCard>
  <Card v-else size="sm" class="h-60 gap-3">
    <PanelHeader
      :icon="Gauge"
      :title="T.title.tokens"
      :color="COLOR"
      :action-label="text.ui.cards.showList"
      @action="emit('tab', 'agents')"
    />
    <CardContent class="min-h-0 flex-1 gap-2">
      <div v-if="top">
        <div data-card-value class="text-2xl leading-8 font-semibold tracking-tight tabular-nums">
          {{ formatContext(top.tokens, top.window) }}
        </div>
        <p
          data-context-of
          class="truncate text-xs leading-4 text-muted-foreground"
          :title="top.agent.worktree?.root"
        >
          {{ text.ui.columns.context }} · {{ folderOf(top.agent.worktree) }}
        </p>
      </div>
      <div
        v-if="limit"
        data-limits
        class="space-y-1.5"
        :class="top ? 'mt-auto border-t border-border/60 pt-2.5' : ''"
        :title="limit.tip"
      >
        <p class="text-[11px] leading-4 text-muted-foreground">
          {{ text.ui.agent.tools.codex }} {{ text.ui.agent.limitsCard }}
        </p>
        <div
          v-for="w in limit.windows"
          :key="w.minutes"
          data-limit
          class="flex items-center gap-2 text-xs leading-4"
        >
          <span data-limit-label class="w-10 shrink-0 text-muted-foreground">{{ w.label }}</span>
          <span
            class="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted"
            aria-hidden="true"
          >
            <span
              data-limit-bar
              class="block h-full rounded-full"
              :style="{ width: `${w.percent}%`, backgroundColor: COLOR }"
            ></span>
          </span>
          <span data-limit-percent class="w-9 shrink-0 text-right tabular-nums"
            >{{ w.percent }}%</span
          >
        </div>
      </div>
      <p v-if="empty" class="text-xs leading-4 text-muted-foreground">{{ T.tokensNone }}</p>
    </CardContent>
  </Card>
</template>
