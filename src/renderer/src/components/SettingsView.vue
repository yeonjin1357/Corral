<!--
  NeoHtop (MIT) SettingsWindow.svelte 의 설정 화면(위 가운데 구역 전환 버튼, 제목 + 설명, 카드로 묶은 항목, 아래 상태 줄).
  바꾼 점: pitwall 의 구역(일반·기준값·무거운 작업·알림·디스크 정리·Claude 연동·정보), 왼쪽 위 "대시보드로" 버튼,
  자동 저장 대신 저장 버튼(여러 값을 한꺼번에 검증해 저장한다).
-->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  ArrowLeft,
  Bell,
  Bot,
  FolderPlus,
  Gauge,
  Hammer,
  HardDrive,
  Info,
  RefreshCw,
  Settings2
} from '@lucide/vue'
import type { ClaudeHookStatus, CodexHookStatus, UpdateStatus } from '../../../shared/types'
import {
  DEFAULT_SETTINGS,
  REFRESH_INTERVALS,
  SETTINGS_LIMITS,
  type RefreshSpeed,
  type Settings,
  type ThemeChoice,
  hiddenLabel
} from '../../../shared/settings'
import { text } from '../../../shared/text'
import { formatDuration } from '../../../shared/format'
import { hookControls } from '../hook'
import { toolIcon } from '../rows'
import ItemIcon from './ItemIcon.vue'
import TabBar, { type TabOption } from '../ui/TabBar.vue'
import Card from '../ui/Card.vue'
import CardHeader from '../ui/CardHeader.vue'
import CardTitle from '../ui/CardTitle.vue'
import CardContent from '../ui/CardContent.vue'
import Button from '../ui/Button.vue'
import Input from '../ui/Input.vue'
import Textarea from '../ui/Textarea.vue'
import NativeSelect from '../ui/NativeSelect.vue'
import Checkbox from '../ui/Checkbox.vue'
import Label from '../ui/Label.vue'

const props = defineProps<{
  settings: Settings
  hook: ClaudeHookStatus | null
  hookBusy: boolean
  /** Codex 연동 상태(F7). */
  codexHook?: CodexHookStatus | null
  codexHookBusy?: boolean
  version: string | null
  /** 저장하고 메인이 고친(범위 안으로) 값을 돌려준다. */
  save: (next: Settings) => Promise<Settings>
  pickFolder: () => Promise<string | null>
  /** 새 버전 확인 상태(설정 > 정보). */
  update?: UpdateStatus | null
}>()
const emit = defineEmits<{
  hook: [action: 'enable' | 'disable']
  codexHook: [action: 'enable' | 'disable']
  updateCheck: []
  updateInstall: []
  /** macOS: 설치 한 줄을 클립보드에 복사한다. */
  updateCopyCommand: []
  back: []
}>()

type Page = 'general' | 'thresholds' | 'heavy' | 'notifications' | 'disk' | 'claude' | 'about'
const page = defineModel<Page>('page', { default: 'general' })
const S = text.ui.settings
const PAGE_ICONS: Record<Page, unknown> = {
  general: Settings2,
  thresholds: Gauge,
  heavy: Hammer,
  notifications: Bell,
  disk: HardDrive,
  claude: Bot,
  about: Info
}
const pageOptions = computed<TabOption[]>(() =>
  (Object.keys(PAGE_ICONS) as Page[]).map((key) => ({
    value: key,
    label: S.menu[key],
    icon: PAGE_ICONS[key] as TabOption['icon']
  }))
)
const pageValue = computed({
  get: () => page.value as string,
  set: (v: string) => {
    page.value = v as Page
    notice.value = null
  }
})

function clone(s: Settings): Settings {
  return JSON.parse(JSON.stringify(s)) as Settings
}

const draft = ref<Settings>(clone(props.settings))
const heavyText = ref(draft.value.heavyPatterns.join('\n'))
const dirsText = ref(draft.value.dependencyDirs.join('\n'))

const lines = (s: string): string[] =>
  s
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
const pending = (): Settings => ({
  ...draft.value,
  heavyPatterns: lines(heavyText.value),
  dependencyDirs: lines(dirsText.value)
})
const dirty = computed(() => JSON.stringify(pending()) !== JSON.stringify(props.settings))

const same = (x: unknown, y: unknown): boolean => JSON.stringify(x) === JSON.stringify(y)

// 저장된 값이 바뀌면(저장 후 메인이 고친 값, 제목줄 테마, 대시보드의 숨기기·작업 공간 이름) 폼을 그 값으로 맞춘다.
// 고치던 중이면 사용자가 고친 항목만 그대로 두고, 고치지 않은 항목은 새 저장값을 따른다
// (그러지 않으면 나중에 저장할 때 대시보드에서 바로 저장한 숨기기·별칭을 예전 값으로 덮어쓴다).
watch(
  () => props.settings,
  (next, prev) => {
    const cur = pending()
    const merged = { ...draft.value } as Record<string, unknown>
    for (const key of Object.keys(next) as (keyof Settings)[])
      if (!prev || same(cur[key], prev[key])) merged[key] = clone(next)[key]
    draft.value = merged as unknown as Settings
    if (!prev || same(lines(heavyText.value), prev.heavyPatterns))
      heavyText.value = next.heavyPatterns.join('\n')
    if (!prev || same(lines(dirsText.value), prev.dependencyDirs))
      dirsText.value = next.dependencyDirs.join('\n')
  }
)

const saving = ref(false)
const notice = ref<{ text: string; failed: boolean } | null>(null)

async function submit(): Promise<void> {
  saving.value = true
  notice.value = null
  try {
    const sent = pending()
    const saved = await props.save(sent)
    // 메인이 켜지 않은 값(무거운 작업 기다리게 하기 — 질문 훅 설치를 취소·실패)은 폼도 되돌리고 그렇게 알린다.
    draft.value.heavyGuard = saved.heavyGuard
    notice.value =
      saved.heavyGuard !== sent.heavyGuard
        ? { text: S.heavyGuardNotChanged, failed: true }
        : { text: S.saved, failed: false }
  } catch (e) {
    notice.value = {
      text: S.saveFailed(e instanceof Error ? e.message : String(e)),
      failed: true
    }
  } finally {
    saving.value = false
  }
}

const REFRESH: RefreshSpeed[] = ['fast', 'normal', 'saver']
const THEMES: ThemeChoice[] = ['light', 'dark', 'auto']
/** 갱신 주기의 두 간격(창 열림·닫힘)을 "2초"·"2분"처럼. */
const refreshTimes = (speed: RefreshSpeed): [string, string] => {
  const i = REFRESH_INTERVALS[speed]
  return [formatDuration(i.openMs), formatDuration(i.closedMs)]
}
const refreshHelp = computed(() => S.refreshHelp(...refreshTimes(draft.value.refresh)))

function resetHeavy(): void {
  heavyText.value = DEFAULT_SETTINGS.heavyPatterns.join('\n')
}

async function addRepo(): Promise<void> {
  const path = await props.pickFolder()
  if (path && !draft.value.extraRepos.includes(path)) draft.value.extraRepos.push(path)
}

function removeRepo(path: string): void {
  draft.value.extraRepos = draft.value.extraRepos.filter((p) => p !== path)
}

function resetDirs(): void {
  dirsText.value = DEFAULT_SETTINGS.dependencyDirs.join('\n')
}

function removeHidden(entry: string): void {
  draft.value.hiddenServers = draft.value.hiddenServers.filter((h) => h !== entry)
}

const controls = computed(() => hookControls(props.hook))
/** 기다리게 하기(G7)를 켰는데 Claude 연동이 켜져 있지 않아 질문 훅이 없다(연동 상태를 아직 모르면 보이지 않는다). */
const guardNeedsHook = computed(
  () => draft.value.heavyGuard && props.hook !== null && props.hook.state !== 'on'
)
const codexControls = computed(() => hookControls(props.codexHook ?? null, text.ui.codexHook))

/** 확인 결과 줄. 아직 확인하지 않았으면 없다(자동 확인 안내만 보인다). */
const updateText = computed((): string | null => {
  const u = props.update
  const t = S.updates
  if (!u) return null
  switch (u.state) {
    case 'disabled':
      return props.settings.updateCheck ? t.disabledDev : t.disabledOff
    case 'idle':
      return null
    case 'checking':
      return t.checking
    case 'none':
      return t.none
    case 'available':
      return t.available(u.version ?? '')
    case 'downloading':
      return t.downloading(u.version ?? '')
    case 'ready':
      return t.ready(u.version ?? '')
    case 'error':
      return t.error(u.error ?? '')
  }
  return null
})
/** 자동 확인 안내: 확인을 껐거나 개발 실행이라 확인하지 않을 때는 뺀다. */
const autoChecks = computed(() => props.settings.updateCheck && props.update?.state !== 'disabled')
const updateBusy = computed(
  () => props.update?.state === 'checking' || props.update?.state === 'downloading'
)
const pageSubtitle = computed(() =>
  page.value === 'about' ? S.currentVersion(props.version ?? '') : S.pageDesc[page.value]
)

const status = computed(() => {
  if (notice.value) return notice.value
  if (saving.value) return { text: S.saving, failed: false }
  return { text: dirty.value ? S.dirty : S.clean, failed: false }
})
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col bg-background">
    <header
      class="flex shrink-0 flex-wrap items-center gap-3 border-b border-border bg-card px-6 py-4"
    >
      <Button variant="ghost" size="sm" class="-ml-2" data-action="back" @click="emit('back')">
        <ArrowLeft />{{ text.ui.bar.back }}
      </Button>
      <div class="flex min-w-0 flex-1 justify-center">
        <TabBar v-model="pageValue" :options="pageOptions" :aria-label="S.title" />
      </div>
      <div class="w-[88px] shrink-0 max-lg:hidden" aria-hidden="true"></div>
    </header>

    <form
      id="settings-form"
      class="min-h-0 flex-1 overflow-y-auto p-6"
      autocomplete="off"
      @submit.prevent="submit"
    >
      <div class="mx-auto w-full max-w-2xl">
        <h1 class="text-lg font-semibold tracking-tight">{{ S.menu[page] }}</h1>
        <p class="mt-1 mb-5 text-sm text-muted-foreground">{{ pageSubtitle }}</p>

        <div v-if="page === 'general'" class="space-y-5">
          <Card size="sm">
            <CardHeader
              ><CardTitle>{{ S.groups.check }}</CardTitle></CardHeader
            >
            <CardContent>
              <div class="flex items-center justify-between gap-6">
                <div>
                  <Label for="refresh">{{ S.refresh }}</Label>
                  <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {{ refreshHelp }}
                  </p>
                </div>
                <NativeSelect id="refresh" v-model="draft.refresh" class="w-48 shrink-0">
                  <option v-for="speed in REFRESH" :key="speed" :value="speed">
                    {{ S.refreshChoice(S.refreshChoices[speed], ...refreshTimes(speed)) }}
                  </option>
                </NativeSelect>
              </div>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardHeader
              ><CardTitle>{{ S.groups.look }}</CardTitle></CardHeader
            >
            <CardContent>
              <div class="flex items-center justify-between gap-6">
                <Label for="theme">{{ S.theme }}</Label>
                <NativeSelect id="theme" v-model="draft.theme" class="w-36 shrink-0">
                  <option v-for="theme in THEMES" :key="theme" :value="theme">
                    {{ S.themeChoices[theme] }}
                  </option>
                </NativeSelect>
              </div>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardHeader
              ><CardTitle>{{ S.groups.startup }}</CardTitle></CardHeader
            >
            <CardContent class="gap-5">
              <div class="flex items-start gap-3">
                <Checkbox id="launch-at-login" v-model="draft.launchAtLogin" class="mt-0.5" />
                <div>
                  <Label for="launch-at-login">{{ S.launchAtLogin }}</Label>
                  <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {{ S.launchAtLoginHelp }}
                  </p>
                </div>
              </div>
              <div class="flex items-start gap-3">
                <Checkbox id="update-check" v-model="draft.updateCheck" class="mt-0.5" />
                <div>
                  <Label for="update-check">{{ S.updateCheck }}</Label>
                  <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {{ S.updateCheckHelp }}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div v-else-if="page === 'thresholds'" class="space-y-5">
          <Card size="sm">
            <CardHeader
              ><CardTitle>{{ S.groups.ram }}</CardTitle></CardHeader
            >
            <CardContent class="gap-5">
              <div class="flex items-center justify-between gap-6">
                <div>
                  <Label for="ram-warn">{{ S.ramWarn }}</Label>
                  <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {{ S.ramWarnHelp }}
                  </p>
                </div>
                <div class="flex shrink-0 items-center gap-2">
                  <Input
                    id="ram-warn"
                    v-model.number="draft.ramWarnPercent"
                    type="number"
                    class="w-20 text-right tabular-nums"
                    :min="SETTINGS_LIMITS.ramWarn.min"
                    :max="SETTINGS_LIMITS.ramWarn.max"
                    required
                  />
                  <span class="w-6 text-sm text-muted-foreground">%</span>
                </div>
              </div>
              <div class="flex items-center justify-between gap-6">
                <div>
                  <Label for="ram-danger">{{ S.ramDanger }}</Label>
                  <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {{ S.ramDangerHelp }}
                  </p>
                </div>
                <div class="flex shrink-0 items-center gap-2">
                  <Input
                    id="ram-danger"
                    v-model.number="draft.ramDangerPercent"
                    type="number"
                    class="w-20 text-right tabular-nums"
                    :min="draft.ramWarnPercent + 1"
                    :max="SETTINGS_LIMITS.ramDangerMax"
                    required
                  />
                  <span class="w-6 text-sm text-muted-foreground">%</span>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardHeader
              ><CardTitle>{{ S.groups.ports }}</CardTitle></CardHeader
            >
            <CardContent class="gap-5">
              <div class="flex items-center justify-between gap-6">
                <div>
                  <Label for="idle-port">{{ S.idlePort }}</Label>
                  <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {{ S.idlePortHelp }}
                  </p>
                </div>
                <div class="flex shrink-0 items-center gap-2">
                  <Input
                    id="idle-port"
                    v-model.number="draft.idlePortMinutes"
                    type="number"
                    class="w-20 text-right tabular-nums"
                    :min="SETTINGS_LIMITS.idlePortMinutes.min"
                    :max="SETTINGS_LIMITS.idlePortMinutes.max"
                    required
                  />
                  <span class="w-6 text-sm text-muted-foreground">{{ S.minutes }}</span>
                </div>
              </div>
              <div class="flex items-center justify-between gap-6">
                <div>
                  <Label for="agent-parked">{{ S.agentParked }}</Label>
                  <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {{ S.agentParkedHelp }}
                  </p>
                </div>
                <div class="flex shrink-0 items-center gap-2">
                  <Input
                    id="agent-parked"
                    v-model.number="draft.agentParkedMinutes"
                    type="number"
                    class="w-20 text-right tabular-nums"
                    :min="SETTINGS_LIMITS.agentParkedMinutes.min"
                    :max="SETTINGS_LIMITS.agentParkedMinutes.max"
                    required
                  />
                  <span class="w-6 text-sm text-muted-foreground">{{ S.minutes }}</span>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardHeader
              ><CardTitle>{{ S.hiddenServers }}</CardTitle></CardHeader
            >
            <CardContent>
              <ul
                v-if="draft.hiddenServers.length"
                class="divide-y divide-border rounded-md border border-border"
              >
                <li
                  v-for="entry in draft.hiddenServers"
                  :key="entry"
                  class="hidden-server flex items-center gap-2 px-3 py-2"
                >
                  <span
                    class="min-w-0 flex-1 break-all font-mono text-xs"
                    :title="entry"
                    data-selectable
                    >{{ hiddenLabel(entry) }}</span
                  >
                  <Button
                    variant="ghost"
                    size="xs"
                    class="text-muted-foreground"
                    data-action="remove-hidden"
                    @click="removeHidden(entry)"
                  >
                    {{ S.unhide }}
                  </Button>
                </li>
              </ul>
              <p v-else class="text-sm text-muted-foreground">{{ S.noHiddenServers }}</p>
              <p class="text-xs leading-relaxed text-muted-foreground">{{ S.hiddenServersHelp }}</p>
            </CardContent>
          </Card>
        </div>

        <div v-else-if="page === 'heavy'" class="space-y-5">
          <Card size="sm">
            <CardHeader
              ><CardTitle>{{ S.groups.heavy }}</CardTitle></CardHeader
            >
            <CardContent>
              <Label for="heavy-patterns" class="sr-only">{{ S.heavyPatterns }}</Label>
              <Textarea
                id="heavy-patterns"
                v-model="heavyText"
                class="min-h-56 font-mono text-xs"
                spellcheck="false"
              />
              <p class="text-xs leading-relaxed text-muted-foreground">{{ S.heavyHelp }}</p>
              <Button variant="outline" size="sm" class="self-start" @click="resetHeavy">
                {{ S.resetDefaults }}
              </Button>
              <div class="flex items-start gap-3">
                <Checkbox id="heavy-guard" v-model="draft.heavyGuard" class="mt-0.5" />
                <div>
                  <Label for="heavy-guard">{{ S.heavyGuard }}</Label>
                  <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {{ S.heavyGuardHelp }}
                  </p>
                  <p
                    v-if="guardNeedsHook"
                    class="heavy-guard-hint mt-1 text-xs leading-relaxed"
                    :style="{ color: 'var(--status-waiting)' }"
                  >
                    {{ S.heavyGuardNeedsHook }}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div v-else-if="page === 'notifications'" class="space-y-5">
          <Card size="sm">
            <CardHeader
              ><CardTitle>{{ S.groups.notify }}</CardTitle></CardHeader
            >
            <CardContent class="gap-5">
              <div
                v-for="item in [
                  {
                    id: 'notify-ram',
                    key: 'ramLow' as const,
                    label: S.notifyRamLow,
                    help: S.notifyRamLowHelp
                  },
                  {
                    id: 'notify-claude',
                    key: 'claudeWaiting' as const,
                    label: S.notifyClaudeWaiting,
                    help: S.notifyClaudeWaitingHelp
                  },
                  {
                    id: 'notify-done',
                    key: 'agentDone' as const,
                    label: S.notifyAgentDone,
                    help: S.notifyAgentDoneHelp
                  },
                  {
                    id: 'notify-quiet',
                    key: 'agentQuiet' as const,
                    label: S.notifyAgentQuiet,
                    help: S.notifyAgentQuietHelp
                  },
                  {
                    id: 'notify-gone',
                    key: 'agentGone' as const,
                    label: S.notifyAgentGone,
                    help: S.notifyAgentGoneHelp
                  },
                  {
                    id: 'notify-heavy',
                    key: 'heavyOverlap' as const,
                    label: S.notifyHeavy,
                    help: S.notifyHeavyHelp
                  }
                ]"
                :key="item.id"
                class="flex items-start gap-3"
              >
                <Checkbox :id="item.id" v-model="draft.notify[item.key]" class="mt-0.5" />
                <div>
                  <Label :for="item.id">{{ item.label }}</Label>
                  <p class="mt-1 text-xs leading-relaxed text-muted-foreground">{{ item.help }}</p>
                </div>
              </div>
              <div class="flex items-start gap-3">
                <Checkbox id="notify-click-focus" v-model="draft.notifyClickFocus" class="mt-0.5" />
                <div>
                  <Label for="notify-click-focus">{{ S.notifyClickFocus }}</Label>
                  <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {{ S.notifyClickFocusHelp }}
                  </p>
                </div>
              </div>
              <div class="flex items-center justify-between gap-6">
                <div>
                  <Label for="waiting-reminder">{{ S.waitingReminder }}</Label>
                  <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {{ S.waitingReminderHelp }}
                  </p>
                </div>
                <div class="flex shrink-0 items-center gap-2">
                  <Input
                    id="waiting-reminder"
                    v-model.number="draft.waitingReminderMinutes"
                    type="number"
                    class="w-20 text-right tabular-nums"
                    :min="SETTINGS_LIMITS.waitingReminderMinutes.min"
                    :max="SETTINGS_LIMITS.waitingReminderMinutes.max"
                    required
                  />
                  <span class="w-6 text-sm text-muted-foreground">{{ S.minutes }}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div v-else-if="page === 'disk'" class="space-y-5">
          <Card size="sm">
            <CardHeader
              ><CardTitle>{{ S.groups.dirs }}</CardTitle></CardHeader
            >
            <CardContent>
              <Label for="dependency-dirs" class="sr-only">{{ S.dependencyDirs }}</Label>
              <Textarea
                id="dependency-dirs"
                v-model="dirsText"
                class="min-h-20 font-mono text-xs"
                spellcheck="false"
              />
              <p class="text-xs leading-relaxed text-muted-foreground">
                {{ S.dependencyDirsHelp }}
              </p>
              <Button variant="outline" size="sm" class="self-start" @click="resetDirs">
                {{ S.resetDefaults }}
              </Button>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardHeader
              ><CardTitle>{{ S.groups.stale }}</CardTitle></CardHeader
            >
            <CardContent>
              <div class="flex items-center justify-between gap-6">
                <div>
                  <Label for="stale-worktree-days">{{ S.staleWorktreeDays }}</Label>
                  <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {{ S.staleWorktreeDaysHelp }}
                  </p>
                </div>
                <div class="flex shrink-0 items-center gap-2">
                  <Input
                    id="stale-worktree-days"
                    v-model.number="draft.staleWorktreeDays"
                    type="number"
                    class="w-20 text-right tabular-nums"
                    :min="SETTINGS_LIMITS.staleWorktreeDays.min"
                    :max="SETTINGS_LIMITS.staleWorktreeDays.max"
                    required
                  />
                  <span class="w-6 text-sm text-muted-foreground">{{ S.days }}</span>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardHeader
              ><CardTitle>{{ S.groups.repos }}</CardTitle></CardHeader
            >
            <CardContent>
              <ul
                v-if="draft.extraRepos.length"
                class="divide-y divide-border rounded-md border border-border"
              >
                <li
                  v-for="repo in draft.extraRepos"
                  :key="repo"
                  class="repo flex items-center gap-2 px-3 py-2"
                >
                  <span class="min-w-0 flex-1 break-all font-mono text-xs" data-selectable>{{
                    repo
                  }}</span>
                  <Button
                    variant="ghost"
                    size="xs"
                    class="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    data-action="remove-repo"
                    @click="removeRepo(repo)"
                  >
                    {{ S.removeRepo }}
                  </Button>
                </li>
              </ul>
              <p v-else class="text-sm text-muted-foreground">{{ S.noRepos }}</p>
              <Button
                variant="outline"
                size="sm"
                class="self-start"
                data-action="add-repo"
                @click="addRepo"
              >
                <FolderPlus />{{ S.addRepo }}
              </Button>
              <p class="text-xs leading-relaxed text-muted-foreground">{{ S.extraReposHelp }}</p>
            </CardContent>
          </Card>
        </div>

        <div v-else-if="page === 'claude'" class="space-y-5">
          <Card size="sm">
            <CardHeader
              ><CardTitle class="flex items-center gap-2" data-integration-title="claude"
                ><ItemIcon :icon="toolIcon('claude')" :size="16" />{{
                  text.ui.hook.title
                }}</CardTitle
              ></CardHeader
            >
            <CardContent>
              <p
                class="hook-state text-sm leading-relaxed"
                :class="{ 'text-destructive': hook?.state === 'error' }"
              >
                {{ hook ? controls.text : text.ui.loading }}
              </p>
              <p
                v-if="hook?.allHooksDisabled"
                class="text-xs leading-relaxed"
                :style="{ color: 'var(--status-waiting)' }"
              >
                {{ text.ui.hook.allHooksDisabled }}
              </p>
              <p
                v-if="hook?.settingsPath"
                class="break-all font-mono text-xs text-muted-foreground"
                data-selectable
              >
                {{ S.settingsFile(hook.settingsPath) }}
              </p>
              <div class="flex flex-wrap gap-2">
                <Button
                  v-if="controls.button"
                  variant="outline"
                  size="sm"
                  data-action="hook"
                  :disabled="hookBusy"
                  @click="emit('hook', controls.button.action)"
                >
                  {{ controls.button.label }}
                </Button>
                <Button
                  v-if="controls.canAlsoDisable"
                  variant="ghost"
                  size="sm"
                  data-action="hook-off"
                  :disabled="hookBusy"
                  @click="emit('hook', 'disable')"
                >
                  {{ text.ui.hook.disable }}
                </Button>
              </div>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardHeader
              ><CardTitle class="flex items-center gap-2" data-integration-title="codex"
                ><ItemIcon :icon="toolIcon('codex')" :size="16" />{{
                  text.ui.codexHook.title
                }}</CardTitle
              ></CardHeader
            >
            <CardContent>
              <p
                class="codex-hook-state text-sm leading-relaxed"
                :class="{ 'text-destructive': codexHook?.state === 'error' }"
              >
                {{ codexHook ? codexControls.text : text.ui.loading }}
              </p>
              <p
                v-if="codexHook?.path"
                class="break-all font-mono text-xs text-muted-foreground"
                data-selectable
              >
                {{ text.ui.codexHook.file(codexHook.path) }}
              </p>
              <div class="flex flex-wrap gap-2">
                <Button
                  v-if="codexControls.button"
                  variant="outline"
                  size="sm"
                  data-action="codex-hook"
                  :disabled="codexHookBusy"
                  @click="emit('codexHook', codexControls.button.action)"
                >
                  {{ codexControls.button.label }}
                </Button>
                <Button
                  v-if="codexControls.canAlsoDisable"
                  variant="ghost"
                  size="sm"
                  data-action="codex-hook-off"
                  :disabled="codexHookBusy"
                  @click="emit('codexHook', 'disable')"
                >
                  {{ text.ui.codexHook.disable }}
                </Button>
              </div>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardHeader
              ><CardTitle>{{ S.groups.look }}</CardTitle></CardHeader
            >
            <CardContent>
              <div class="flex items-start gap-3">
                <Checkbox
                  id="show-agent-activity"
                  v-model="draft.showAgentActivity"
                  class="mt-0.5"
                />
                <div>
                  <Label for="show-agent-activity">{{ S.showAgentActivity }}</Label>
                  <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {{ S.showAgentActivityHelp }}
                  </p>
                </div>
              </div>
              <div class="flex items-start gap-3">
                <Checkbox id="read-usage" v-model="draft.readUsage" class="mt-0.5" />
                <div>
                  <Label for="read-usage">{{ S.readUsage }}</Label>
                  <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {{ S.readUsageHelp }}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div v-else-if="page === 'about'" class="space-y-5">
          <Card size="sm">
            <CardContent>
              <div class="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  data-action="update-check"
                  :disabled="updateBusy"
                  @click="emit('updateCheck')"
                >
                  <RefreshCw :class="{ 'animate-spin': updateBusy }" />{{ S.updates.check }}
                </Button>
                <Button
                  v-if="update?.state === 'ready'"
                  size="sm"
                  data-action="update-install"
                  @click="emit('updateInstall')"
                >
                  {{ S.updates.install }}
                </Button>
                <!-- macOS 설치본: 앱 안에서 내려받아 바꿔 넣는다. 못 하면 아래에 설치 한 줄과 내려받기 페이지. -->
                <Button
                  v-if="update?.state === 'available' && update.selfInstall"
                  size="sm"
                  data-action="update-self-install"
                  @click="emit('updateInstall')"
                >
                  {{ S.updates.selfInstall }}
                </Button>
                <Button
                  v-else-if="update?.state === 'available' && update.url"
                  size="sm"
                  :variant="update.installCommand ? 'outline' : 'default'"
                  :href="update.url"
                >
                  {{ S.updates.download }}
                </Button>
              </div>
              <p
                v-if="updateText"
                class="update-state text-sm"
                :class="{ 'text-destructive': update?.state === 'error' }"
              >
                {{ updateText }}
              </p>
              <p
                v-if="update?.state === 'available' && update.selfInstall"
                class="text-xs text-muted-foreground"
              >
                {{ S.updates.selfInstallHelp }}
              </p>
              <template
                v-if="update?.state === 'available' && !update.selfInstall && update.installCommand"
              >
                <p v-if="update.error" class="update-problem text-sm text-destructive">
                  {{ update.error }}
                </p>
                <p class="text-xs text-muted-foreground">{{ S.updates.manual }}</p>
                <div class="flex items-center gap-2">
                  <code
                    data-update-command
                    data-selectable
                    class="min-w-0 flex-1 overflow-x-auto rounded-md border border-border bg-muted px-2 py-1.5 font-mono text-xs whitespace-nowrap"
                    >{{ update.installCommand }}</code
                  >
                  <Button
                    variant="outline"
                    size="sm"
                    class="shrink-0"
                    data-action="update-copy-command"
                    @click="emit('updateCopyCommand')"
                  >
                    {{ S.updates.copyCommand }}
                  </Button>
                </div>
              </template>
              <p v-if="autoChecks" class="update-auto text-xs text-muted-foreground">
                {{ S.updates.auto }}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </form>

    <footer
      class="flex shrink-0 items-center justify-between gap-3 border-t border-border bg-card px-6 py-3"
    >
      <p
        role="status"
        class="save-notice text-xs"
        :class="status.failed ? 'text-destructive' : 'text-muted-foreground'"
      >
        {{ status.text }}
      </p>
      <!-- 폼 밖이지만 form 으로 이어 브라우저 입력 검사(범위·필수)를 거친 뒤 저장한다. -->
      <Button
        type="submit"
        form="settings-form"
        size="sm"
        data-action="save"
        :disabled="saving || !dirty"
      >
        {{ S.save }}
      </Button>
    </footer>
  </div>
</template>
