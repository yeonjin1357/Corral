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
  Settings2
} from '@lucide/vue'
import type { ClaudeHookStatus, CodexHookStatus, UpdateStatus } from '../../../shared/types'
import {
  DEFAULT_SETTINGS,
  REFRESH_INTERVALS,
  SETTINGS_LIMITS,
  type RefreshSpeed,
  type Settings,
  type ThemeChoice
} from '../../../shared/settings'
import { text } from '../../../shared/text'
import { hookControls } from '../hook'
import ToggleGroup, { type ToggleOption } from '../ui/ToggleGroup.vue'
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
const pageOptions = computed<ToggleOption[]>(() =>
  (Object.keys(PAGE_ICONS) as Page[]).map((key) => ({
    value: key,
    label: S.menu[key],
    icon: PAGE_ICONS[key] as ToggleOption['icon']
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

// 저장된 값이 바뀌면(저장 후 메인이 고친 값, 제목줄에서 테마를 바꿈) 폼을 그 값으로 맞춘다.
// 고치던 중이면 다른 칸은 그대로 두고 테마만 맞춘다(제목줄 테마는 바로 저장되기 때문).
watch(
  () => props.settings,
  (next, prev) => {
    const editing = prev && JSON.stringify(pending()) !== JSON.stringify(prev)
    if (editing) {
      draft.value.theme = next.theme
      return
    }
    draft.value = clone(next)
    heavyText.value = next.heavyPatterns.join('\n')
    dirsText.value = next.dependencyDirs.join('\n')
  }
)

const saving = ref(false)
const notice = ref<{ text: string; failed: boolean } | null>(null)

async function submit(): Promise<void> {
  saving.value = true
  notice.value = null
  try {
    await props.save(pending())
    notice.value = { text: S.saved, failed: false }
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
const refreshHelp = computed(() => {
  const i = REFRESH_INTERVALS[draft.value.refresh]
  return S.refreshHelp(i.openMs / 1000, i.closedMs / 1000)
})

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
const codexControls = computed(() => hookControls(props.codexHook ?? null, text.ui.codexHook))

const updateText = computed(() => {
  const u = props.update
  const t = S.updates
  if (!u) return t.idle
  switch (u.state) {
    case 'disabled':
      return props.settings.updateCheck ? t.disabledDev : t.disabledOff
    case 'idle':
      return t.idle
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
  return t.idle
})

const status = computed(() => {
  if (notice.value) return notice.value
  if (saving.value) return { text: S.saving, failed: false }
  return { text: dirty.value ? S.dirty : S.clean, failed: false }
})

const REPO_URL = 'https://github.com/yeonjin1357/pitwall'
const NOTICES_URL = `${REPO_URL}/blob/main/THIRD_PARTY_NOTICES.md`
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
        <ToggleGroup
          v-model="pageValue"
          :options="pageOptions"
          size="default"
          item-class="px-3"
          :aria-label="S.title"
        />
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
        <p class="mt-1 mb-5 text-sm text-muted-foreground">{{ S.pageDesc[page] }}</p>

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
                <NativeSelect id="refresh" v-model="draft.refresh" class="w-28 shrink-0">
                  <option v-for="speed in REFRESH" :key="speed" :value="speed">
                    {{ S.refreshChoices[speed] }}
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
            <CardContent>
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
                  <span class="min-w-0 flex-1 break-all font-mono text-xs" data-selectable>{{
                    entry
                  }}</span>
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
              ><CardTitle>{{ text.ui.hook.title }}</CardTitle></CardHeader
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
                :style="{ color: 'var(--peach)' }"
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
              ><CardTitle>{{ text.ui.codexHook.title }}</CardTitle></CardHeader
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
        </div>

        <div v-else-if="page === 'about'" class="space-y-5">
          <Card size="sm">
            <CardHeader
              ><CardTitle>{{ S.version(version ?? '') }}</CardTitle></CardHeader
            >
            <CardContent>
              <p class="text-sm leading-relaxed text-muted-foreground">{{ S.description }}</p>
              <div class="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" :href="REPO_URL">{{ S.repo }}</Button>
                <Button variant="outline" size="sm" :href="NOTICES_URL">{{ S.notices }}</Button>
              </div>
              <p class="text-xs text-muted-foreground">{{ S.license }}</p>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardHeader
              ><CardTitle>{{ S.updates.title }}</CardTitle></CardHeader
            >
            <CardContent>
              <p
                class="update-state text-sm"
                :class="{ 'text-destructive': update?.state === 'error' }"
              >
                {{ updateText }}
              </p>
              <div class="flex flex-wrap gap-2">
                <Button
                  v-if="update?.state === 'ready'"
                  size="sm"
                  data-action="update-install"
                  @click="emit('updateInstall')"
                >
                  {{ S.updates.install }}
                </Button>
                <Button
                  v-if="update?.state === 'available' && update.url"
                  size="sm"
                  :href="update.url"
                >
                  {{ S.updates.download }}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  data-action="update-check"
                  :disabled="update?.state === 'checking' || update?.state === 'downloading'"
                  @click="emit('updateCheck')"
                >
                  {{ S.updates.check }}
                </Button>
              </div>
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
