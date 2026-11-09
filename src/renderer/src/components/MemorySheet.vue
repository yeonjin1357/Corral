<!--
  NeoHtop (MIT) stats/ResourceDetails.svelte · ResourceDetailsContent.svelte 의 메모리 패널
  (머리 + 측정 시각, 큰 숫자, 넓은 추이 그래프, 사실 카드, 막대 카드, 설명 상자, 바닥 버튼).
  바꾼 점: 스왑 대신 pitwall 의 메모리 묶음(개발 서버·에이전트·무거운 작업·다른 앱·시스템)과 많이 쓰는 다른 앱 표.
-->
<script setup lang="ts">
import { computed } from 'vue'
import { RefreshCw } from '@lucide/vue'
import type { DashboardSnapshot, ProcessGroup } from '../../../shared/types'
import { formatBytes } from '../../../shared/format'
import { text } from '../../../shared/text'
import type { Point } from '../history'
import Sheet from '../ui/Sheet.vue'
import Card from '../ui/Card.vue'
import CardHeader from '../ui/CardHeader.vue'
import CardTitle from '../ui/CardTitle.vue'
import CardDescription from '../ui/CardDescription.vue'
import CardContent from '../ui/CardContent.vue'
import Button from '../ui/Button.vue'
import Badge from '../ui/Badge.vue'
import Progress from '../ui/Progress.vue'
import { TABLE } from '../ui/variants'
import ResourceTrend from './ResourceTrend.vue'

const props = defineProps<{
  snapshot: DashboardSnapshot
  ramHistory: Point[]
  windowMs: number
  refreshing: boolean
}>()
const emit = defineEmits<{ refresh: [] }>()
const open = defineModel<boolean>('open', { required: true })

const t = text.ui
const m = computed(() => props.snapshot.memory)
const hasMemory = computed(() => m.value.totalBytes > 0)
const percent = computed(() => Math.floor(m.value.usedPercent))
const reading = computed(() =>
  new Date(props.snapshot.takenAt).toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
)

const ORDER: { key: ProcessGroup; color: string }[] = [
  { key: 'devServer', color: 'var(--chart-1)' },
  { key: 'agent', color: 'var(--chart-2)' },
  { key: 'heavy', color: 'var(--chart-3)' },
  { key: 'otherApps', color: 'var(--chart-4)' },
  { key: 'system', color: 'var(--status-idle)' }
]
const groups = computed(() =>
  ORDER.map((g) => {
    const usage = props.snapshot.groups.find((x) => x.group === g.key)
    const bytes = usage?.memoryBytes ?? 0
    return {
      ...g,
      label: t.groups[g.key],
      bytes,
      count: usage?.processCount ?? 0,
      share: hasMemory.value ? (bytes / m.value.totalBytes) * 100 : 0
    }
  })
)
</script>

<template>
  <Sheet
    v-model:open="open"
    :close-label="t.sheet.done"
    :aria-label="t.sheet.memoryTitle"
    class="sm:max-w-md"
  >
    <div
      data-slot="sheet-header"
      class="flex flex-col gap-1.5 border-b border-border p-4 pb-4 pr-12"
    >
      <h2 data-slot="sheet-title" class="font-medium text-foreground">{{ t.sheet.memoryTitle }}</h2>
      <p data-slot="sheet-description" class="text-sm text-muted-foreground">
        {{ t.sheet.memoryDesc }}
      </p>
      <div class="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
        <Badge v-if="snapshot.stale" variant="secondary">{{ t.stale }}</Badge>
        <span
          v-else
          class="size-1.5 rounded-full bg-[var(--status-running)]"
          aria-hidden="true"
        ></span>
        <span>{{ t.sheet.reading(reading) }}</span>
      </div>
    </div>

    <div class="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-5">
      <div>
        <p class="text-3xl font-semibold tracking-tight tabular-nums">
          {{ hasMemory ? formatBytes(m.usedBytes) : t.none }}
        </p>
        <p class="mt-1 text-sm text-muted-foreground">
          {{ hasMemory ? `${percent}% · ${formatBytes(m.totalBytes)}` : t.loading }}
        </p>
      </div>
      <section class="space-y-2">
        <h3 class="text-sm font-medium">{{ t.sheet.trendTitle }}</h3>
        <ResourceTrend
          :points="ramHistory"
          :window-ms="windowMs"
          :max="100"
          color="var(--chart-3)"
          expanded
          :label="t.cards.memory"
          :format="(v) => `${Math.floor(v)}%`"
          range="0–100%"
        />
      </section>
      <Card size="sm">
        <CardContent class="gap-0 divide-y divide-border">
          <div
            v-for="[label, value] in [
              [t.sheet.facts.total, formatBytes(m.totalBytes)],
              [t.sheet.facts.used, formatBytes(m.usedBytes)],
              [t.sheet.facts.free, formatBytes(Math.max(0, m.totalBytes - m.usedBytes))]
            ]"
            :key="label"
            class="flex justify-between gap-4 py-3 first:pt-0 last:pb-0"
          >
            <span class="text-sm text-muted-foreground">{{ label }}</span
            ><span class="min-w-0 max-w-[65%] text-right text-sm font-medium tabular-nums">{{
              value
            }}</span>
          </div>
        </CardContent>
      </Card>
      <Card size="sm">
        <CardHeader>
          <CardTitle class="text-sm">{{ t.sheet.groupsTitle }}</CardTitle>
          <CardDescription>{{ t.sheet.groupsDesc }}</CardDescription>
        </CardHeader>
        <CardContent class="gap-4">
          <div v-for="g in groups" :key="g.key" class="min-w-0 space-y-1.5">
            <div class="flex justify-between gap-2 text-xs">
              <span class="text-muted-foreground"
                >{{ g.label
                }}<span v-if="g.key !== 'system'" class="ml-1 tabular-nums"
                  >· {{ t.groups.processes(g.count) }}</span
                ></span
              ><span class="tabular-nums">{{ formatBytes(g.bytes) }}</span>
            </div>
            <Progress :value="g.share" :style="{ '--primary': g.color }" />
          </div>
        </CardContent>
      </Card>
      <p
        class="rounded-lg border border-border bg-muted/40 p-4 text-sm leading-relaxed text-muted-foreground"
      >
        {{ t.groups.systemNote }}
      </p>
      <Card v-if="snapshot.topApps.length" size="sm">
        <CardHeader
          ><CardTitle class="text-sm">{{ t.sheet.topApps }}</CardTitle></CardHeader
        >
        <CardContent>
          <table :class="TABLE.table">
            <tbody :class="TABLE.body">
              <tr v-for="app in snapshot.topApps" :key="app.name" :class="TABLE.row">
                <td :class="[TABLE.cell, 'pl-0 text-[13px]']">{{ app.name }}</td>
                <td :class="[TABLE.cell, 'text-right text-xs text-muted-foreground']">
                  {{ t.groups.processes(app.processCount) }}
                </td>
                <td :class="[TABLE.cell, 'pr-0 text-right font-mono text-xs']">
                  {{ formatBytes(app.memoryBytes) }}
                </td>
              </tr>
            </tbody>
          </table>
        </CardContent>
      </Card>
      <p v-if="snapshot.collectMode" class="text-xs text-muted-foreground">
        {{ t.home.collectMode(t.home.collectModes[snapshot.collectMode]) }}
      </p>
    </div>

    <div
      data-slot="sheet-footer"
      class="mt-auto flex shrink-0 flex-row items-center justify-between gap-2 border-t border-border px-4 py-3"
    >
      <Button variant="outline" size="sm" :disabled="refreshing" @click="emit('refresh')">
        <RefreshCw :class="{ 'animate-spin': refreshing }" />{{ t.bar.refresh }}
      </Button>
      <Button variant="secondary" size="sm" @click="open = false">{{ t.sheet.done }}</Button>
    </div>
  </Sheet>
</template>
