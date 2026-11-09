<!--
  Uptime Kuma (MIT) src/pages/Settings.vue 의 구성(h1 · 큰 상자 안 왼쪽 메뉴 col-lg-3/col-md-5 + 오른쪽 내용 col-lg-9/col-md-7,
  내용 머리 settings-content-header, 고른 메뉴는 왼쪽 초록 줄)과 src/components/settings/General.vue·Appearance.vue 의
  폼 구성(form-label · btn-group 의 btn-check · form-check form-switch · form-text · 아래 저장 버튼)을 가져옴.
  바꾼 점: 메뉴를 pitwall 설정(일반·기준값·무거운 작업·알림·디스크 정리·Claude 연동·정보)으로, 라우터 대신 화면 안 상태로.
-->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ClaudeHookStatus, UpdateStatus } from '../../../shared/types'
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

const props = defineProps<{
  settings: Settings
  hook: ClaudeHookStatus | null
  hookBusy: boolean
  version: string | null
  /** 저장하고 메인이 고친(범위 안으로) 값을 돌려준다. */
  save: (next: Settings) => Promise<Settings>
  pickFolder: () => Promise<string | null>
  /** 새 버전 확인 상태(설정 > 정보). */
  update?: UpdateStatus | null
}>()
const emit = defineEmits<{
  hook: [action: 'enable' | 'disable']
  updateCheck: []
  updateInstall: []
}>()

type Page = 'general' | 'thresholds' | 'heavy' | 'notifications' | 'disk' | 'claude' | 'about'
const PAGES: Page[] = ['general', 'thresholds', 'heavy', 'notifications', 'disk', 'claude', 'about']
const page = ref<Page>('general')

function clone(s: Settings): Settings {
  return JSON.parse(JSON.stringify(s)) as Settings
}

const draft = ref<Settings>(clone(props.settings))
const heavyText = ref(draft.value.heavyPatterns.join('\n'))
const dirsText = ref(draft.value.dependencyDirs.join('\n'))
// 저장된 값이 바뀌면(저장 후 메인이 고친 값, 다른 곳에서 바뀜) 폼을 그 값으로 맞춘다.
watch(
  () => props.settings,
  (next) => {
    draft.value = clone(next)
    heavyText.value = next.heavyPatterns.join('\n')
    dirsText.value = next.dependencyDirs.join('\n')
  }
)

const lines = (s: string): string[] =>
  s
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

const saving = ref(false)
const notice = ref<{ text: string; failed: boolean } | null>(null)

async function submit(): Promise<void> {
  saving.value = true
  notice.value = null
  try {
    await props.save({
      ...draft.value,
      heavyPatterns: lines(heavyText.value),
      dependencyDirs: lines(dirsText.value)
    })
    notice.value = { text: text.ui.settings.saved, failed: false }
  } catch (e) {
    notice.value = {
      text: text.ui.settings.saveFailed(e instanceof Error ? e.message : String(e)),
      failed: true
    }
  } finally {
    saving.value = false
  }
}

function choose(next: Page): void {
  page.value = next
  notice.value = null
}

const REFRESH: RefreshSpeed[] = ['fast', 'normal', 'saver']
const THEMES: ThemeChoice[] = ['light', 'dark', 'auto']
const refreshHelp = computed(() => {
  const i = REFRESH_INTERVALS[draft.value.refresh]
  return text.ui.settings.refreshHelp(i.openMs / 1000, i.closedMs / 1000)
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

const controls = computed(() => hookControls(props.hook))

const updateText = computed(() => {
  const u = props.update
  const t = text.ui.settings.updates
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

const REPO_URL = 'https://github.com/yeonjin1357/pitwall'
const NOTICES_URL = `${REPO_URL}/blob/main/THIRD_PARTY_NOTICES.md`
</script>

<template>
  <div class="settings-page">
    <h1 class="mb-3">{{ text.ui.settings.title }}</h1>

    <div class="shadow-box shadow-box-settings">
      <div class="row">
        <div class="settings-menu col-lg-3 col-md-5">
          <a
            v-for="key in PAGES"
            :key="key"
            href="#"
            :class="{ active: page === key }"
            @click.prevent="choose(key)"
          >
            <div class="menu-item">{{ text.ui.settings.menu[key] }}</div>
          </a>
        </div>
        <div class="settings-content col-lg-9 col-md-7">
          <div class="settings-content-header">{{ text.ui.settings.menu[page] }}</div>
          <div class="mx-3">
            <form class="my-4" autocomplete="off" @submit.prevent="submit">
              <template v-if="page === 'general'">
                <div class="mb-4">
                  <label class="form-label">{{ text.ui.settings.refresh }}</label>
                  <div>
                    <div class="btn-group" role="group">
                      <template v-for="speed in REFRESH" :key="speed">
                        <input
                          :id="`refresh-${speed}`"
                          v-model="draft.refresh"
                          type="radio"
                          class="btn-check"
                          name="refresh"
                          :value="speed"
                        />
                        <label class="btn btn-outline-primary" :for="`refresh-${speed}`">
                          {{ text.ui.settings.refreshChoices[speed] }}
                        </label>
                      </template>
                    </div>
                  </div>
                  <div class="form-text">{{ refreshHelp }}</div>
                </div>
                <div class="mb-4">
                  <label class="form-label">{{ text.ui.settings.theme }}</label>
                  <div>
                    <div class="btn-group" role="group">
                      <template v-for="theme in THEMES" :key="theme">
                        <input
                          :id="`theme-${theme}`"
                          v-model="draft.theme"
                          type="radio"
                          class="btn-check"
                          name="theme"
                          :value="theme"
                        />
                        <label class="btn btn-outline-primary" :for="`theme-${theme}`">
                          {{ text.ui.settings.themeChoices[theme] }}
                        </label>
                      </template>
                    </div>
                  </div>
                </div>
                <div class="mb-4">
                  <div class="form-check form-switch">
                    <input
                      id="launch-at-login"
                      v-model="draft.launchAtLogin"
                      class="form-check-input"
                      type="checkbox"
                    />
                    <label class="form-check-label" for="launch-at-login">
                      {{ text.ui.settings.launchAtLogin }}
                    </label>
                  </div>
                  <div class="form-text">{{ text.ui.settings.launchAtLoginHelp }}</div>
                </div>
                <div class="mb-4">
                  <div class="form-check form-switch">
                    <input
                      id="update-check"
                      v-model="draft.updateCheck"
                      class="form-check-input"
                      type="checkbox"
                    />
                    <label class="form-check-label" for="update-check">
                      {{ text.ui.settings.updateCheck }}
                    </label>
                  </div>
                  <div class="form-text">{{ text.ui.settings.updateCheckHelp }}</div>
                </div>
              </template>

              <template v-else-if="page === 'thresholds'">
                <div class="mb-4">
                  <label for="ram-warn" class="form-label">{{ text.ui.settings.ramWarn }}</label>
                  <div class="input-group">
                    <input
                      id="ram-warn"
                      v-model.number="draft.ramWarnPercent"
                      type="number"
                      class="form-control"
                      :min="SETTINGS_LIMITS.ramWarn.min"
                      :max="SETTINGS_LIMITS.ramWarn.max"
                      required
                    />
                    <span class="input-group-text">%</span>
                  </div>
                  <div class="form-text">{{ text.ui.settings.ramWarnHelp }}</div>
                </div>
                <div class="mb-4">
                  <label for="ram-danger" class="form-label">{{
                    text.ui.settings.ramDanger
                  }}</label>
                  <div class="input-group">
                    <input
                      id="ram-danger"
                      v-model.number="draft.ramDangerPercent"
                      type="number"
                      class="form-control"
                      :min="draft.ramWarnPercent + 1"
                      :max="SETTINGS_LIMITS.ramDangerMax"
                      required
                    />
                    <span class="input-group-text">%</span>
                  </div>
                  <div class="form-text">{{ text.ui.settings.ramDangerHelp }}</div>
                </div>
                <div class="mb-4">
                  <label for="idle-port" class="form-label">{{ text.ui.settings.idlePort }}</label>
                  <div class="input-group">
                    <input
                      id="idle-port"
                      v-model.number="draft.idlePortMinutes"
                      type="number"
                      class="form-control"
                      :min="SETTINGS_LIMITS.idlePortMinutes.min"
                      :max="SETTINGS_LIMITS.idlePortMinutes.max"
                      required
                    />
                    <span class="input-group-text">{{ text.ui.settings.minutes }}</span>
                  </div>
                  <div class="form-text">{{ text.ui.settings.idlePortHelp }}</div>
                </div>
              </template>

              <template v-else-if="page === 'heavy'">
                <div class="mb-4">
                  <label for="heavy-patterns" class="form-label">
                    {{ text.ui.settings.heavyPatterns }}
                  </label>
                  <textarea
                    id="heavy-patterns"
                    v-model="heavyText"
                    class="form-control"
                    rows="10"
                    spellcheck="false"
                  />
                  <div class="form-text">{{ text.ui.settings.heavyHelp }}</div>
                  <button
                    type="button"
                    class="btn btn-outline-primary btn-sm mt-2"
                    @click="resetHeavy"
                  >
                    {{ text.ui.settings.resetDefaults }}
                  </button>
                </div>
              </template>

              <template v-else-if="page === 'notifications'">
                <div
                  v-for="item in [
                    {
                      id: 'notify-ram',
                      key: 'ramLow' as const,
                      label: text.ui.settings.notifyRamLow,
                      help: text.ui.settings.notifyRamLowHelp
                    },
                    {
                      id: 'notify-claude',
                      key: 'claudeWaiting' as const,
                      label: text.ui.settings.notifyClaudeWaiting,
                      help: text.ui.settings.notifyClaudeWaitingHelp
                    },
                    {
                      id: 'notify-heavy',
                      key: 'heavyOverlap' as const,
                      label: text.ui.settings.notifyHeavy,
                      help: text.ui.settings.notifyHeavyHelp
                    }
                  ]"
                  :key="item.id"
                  class="mb-4"
                >
                  <div class="form-check form-switch">
                    <input
                      :id="item.id"
                      v-model="draft.notify[item.key]"
                      class="form-check-input"
                      type="checkbox"
                    />
                    <label class="form-check-label" :for="item.id">{{ item.label }}</label>
                  </div>
                  <div class="form-text">{{ item.help }}</div>
                </div>
              </template>

              <template v-else-if="page === 'disk'">
                <div class="mb-4">
                  <label for="dependency-dirs" class="form-label">
                    {{ text.ui.settings.dependencyDirs }}
                  </label>
                  <textarea
                    id="dependency-dirs"
                    v-model="dirsText"
                    class="form-control"
                    rows="3"
                    spellcheck="false"
                  />
                  <div class="form-text">{{ text.ui.settings.dependencyDirsHelp }}</div>
                </div>
                <div class="mb-4">
                  <label class="form-label">{{ text.ui.settings.extraRepos }}</label>
                  <ul v-if="draft.extraRepos.length" class="list-group mb-2">
                    <li
                      v-for="repo in draft.extraRepos"
                      :key="repo"
                      class="list-group-item d-flex align-items-center gap-2 repo"
                    >
                      <span class="flex-fill text-break">{{ repo }}</span>
                      <button
                        type="button"
                        class="btn btn-outline-danger btn-sm btn-remove-repo"
                        @click="removeRepo(repo)"
                      >
                        {{ text.ui.settings.removeRepo }}
                      </button>
                    </li>
                  </ul>
                  <p v-else class="text-secondary small mb-2">{{ text.ui.settings.noRepos }}</p>
                  <button
                    type="button"
                    class="btn btn-outline-primary btn-sm btn-add-repo"
                    @click="addRepo"
                  >
                    {{ text.ui.settings.addRepo }}
                  </button>
                  <div class="form-text">{{ text.ui.settings.extraReposHelp }}</div>
                </div>
              </template>

              <template v-else-if="page === 'claude'">
                <div class="mb-4">
                  <p class="hook-state mb-2" :class="{ 'text-danger': hook?.state === 'error' }">
                    {{ hook ? controls.text : text.ui.loading }}
                  </p>
                  <p v-if="hook?.allHooksDisabled" class="text-warning small mb-2">
                    {{ text.ui.hook.allHooksDisabled }}
                  </p>
                  <p v-if="hook?.settingsPath" class="form-text">
                    {{ text.ui.settings.settingsFile(hook.settingsPath) }}
                  </p>
                  <div class="d-flex gap-2">
                    <button
                      v-if="controls.button"
                      type="button"
                      class="btn btn-normal btn-hook"
                      :disabled="hookBusy"
                      @click="emit('hook', controls.button.action)"
                    >
                      {{ controls.button.label }}
                    </button>
                    <button
                      v-if="controls.canAlsoDisable"
                      type="button"
                      class="btn btn-normal btn-hook-off"
                      :disabled="hookBusy"
                      @click="emit('hook', 'disable')"
                    >
                      {{ text.ui.hook.disable }}
                    </button>
                  </div>
                </div>
              </template>

              <template v-else-if="page === 'about'">
                <div class="mb-4 about">
                  <p class="fs-4 mb-1">{{ text.ui.settings.version(version ?? '') }}</p>
                  <p class="mb-3">{{ text.ui.settings.description }}</p>
                  <p class="mb-1">
                    <a :href="REPO_URL" target="_blank" rel="noopener">{{
                      text.ui.settings.repo
                    }}</a>
                  </p>
                  <p class="mb-1">{{ text.ui.settings.license }}</p>
                  <p class="mb-1">
                    <a :href="NOTICES_URL" target="_blank" rel="noopener">{{
                      text.ui.settings.notices
                    }}</a>
                  </p>
                </div>
                <div class="mb-4">
                  <label class="form-label">{{ text.ui.settings.updates.title }}</label>
                  <p
                    class="update-state mb-2"
                    :class="{ 'text-danger': update?.state === 'error' }"
                  >
                    {{ updateText }}
                  </p>
                  <div class="d-flex gap-2 flex-wrap">
                    <button
                      v-if="update?.state === 'ready'"
                      type="button"
                      class="btn btn-primary btn-update-install"
                      @click="emit('updateInstall')"
                    >
                      {{ text.ui.settings.updates.install }}
                    </button>
                    <a
                      v-if="update?.state === 'available' && update.url"
                      class="btn btn-primary update-download"
                      :href="update.url"
                      target="_blank"
                      rel="noopener"
                    >
                      {{ text.ui.settings.updates.download }}
                    </a>
                    <button
                      type="button"
                      class="btn btn-normal btn-update-check"
                      :disabled="update?.state === 'checking' || update?.state === 'downloading'"
                      @click="emit('updateCheck')"
                    >
                      {{ text.ui.settings.updates.check }}
                    </button>
                  </div>
                </div>
              </template>

              <div
                v-if="page !== 'claude' && page !== 'about'"
                class="d-flex align-items-center gap-3"
              >
                <button type="submit" class="btn btn-primary btn-save" :disabled="saving">
                  {{ text.ui.settings.save }}
                </button>
                <span
                  v-if="notice"
                  class="small save-notice"
                  :class="notice.failed ? 'text-danger' : 'text-success'"
                >
                  {{ notice.text }}
                </span>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
@import '../styles/vars.scss';

/* Uptime Kuma Settings.vue */
.shadow-box-settings {
  padding: 20px;
  min-height: calc(100vh - 155px);
}

.settings-menu {
  a {
    text-decoration: none !important;
    color: inherit;
  }

  .menu-item {
    border-radius: 10px;
    margin: 0.5em;
    padding: 0.7em 1em;
    cursor: pointer;
    border-left-width: 0;
    transition: all ease-in-out 0.1s;
  }

  .menu-item:hover {
    background: $highlight-white;

    .dark & {
      background: $dark-header-bg;
    }
  }

  .active .menu-item {
    background: $highlight-white;
    border-left: 4px solid $primary;
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;

    .dark & {
      background: $dark-header-bg;
    }
  }
}

.settings-content {
  .settings-content-header {
    width: calc(100% + 20px);
    border-bottom: 1px solid #dee2e6;
    border-radius: 0 10px 0 0;
    margin-top: -20px;
    margin-right: -20px;
    padding: 12.5px 1em;
    font-size: 26px;

    .dark & {
      background: $dark-header-bg;
      border-bottom: 0;
    }
  }
}
</style>
