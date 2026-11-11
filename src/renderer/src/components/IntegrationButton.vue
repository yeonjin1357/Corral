<!--
  에이전트 탭 도구줄의 연동 자리. 연동을 켜고 끄는 것(설정 파일을 바꾸고 확인 창이 뜨는 일)은 설정 > 에이전트 연동에서
  하고, 여기서는 두 도구의 연동 상태를 점으로 보이며 설정으로 데려간다. ⓘ 를 누르면 연동이 무엇을 더하는지 보인다.
-->
<script setup lang="ts">
import { computed } from 'vue'
import { Info } from '@lucide/vue'
import type { ClaudeHookStatus, CodexHookStatus } from '../../../shared/types'
import { text } from '../../../shared/text'
import { integrationStatus } from '../hook'
import { TONE_COLOR, toolIcon } from '../rows'
import Button from '../ui/Button.vue'
import Popover from '../ui/Popover.vue'
import ItemIcon from './ItemIcon.vue'

const props = defineProps<{
  claude: ClaudeHookStatus | null
  codex: CodexHookStatus | null
}>()
const emit = defineEmits<{ open: [] }>()

const I = text.ui.integration
const names = text.ui.agent.toolNames
const items = computed(() => integrationStatus(props.claude, props.codex))
const tip = computed(() => items.value.map((i) => I.stateLine(names[i.tool], i.label)).join('\n'))
</script>

<template>
  <div class="flex items-center gap-1" data-integrations>
    <Popover class="w-80">
      <template #trigger="{ toggle, open }">
        <Button
          variant="ghost"
          size="icon-sm"
          data-action="integration-help"
          :aria-label="I.help"
          :title="I.help"
          :aria-expanded="open"
          @click="toggle"
        >
          <Info />
        </Button>
      </template>
      <template #default="{ close }">
        <h2 class="text-sm font-medium">{{ I.helpTitle }}</h2>
        <div class="-mt-2 grid gap-2">
          <p
            v-for="line in I.helpBody"
            :key="line"
            class="text-xs leading-relaxed text-muted-foreground"
          >
            {{ line }}
          </p>
        </div>
        <ul class="grid gap-1.5 text-xs">
          <li
            v-for="i in items"
            :key="i.tool"
            class="flex items-center gap-2"
            :data-integration="i.tool"
          >
            <ItemIcon :icon="toolIcon(i.tool)" :size="14" />
            <span>{{ names[i.tool] }}</span>
            <span class="ml-auto flex items-center gap-1.5 text-muted-foreground">
              <span
                class="size-1.5 rounded-full"
                :style="{ background: TONE_COLOR[i.tone] }"
              ></span>
              {{ i.label }}
            </span>
          </li>
        </ul>
        <Button
          variant="outline"
          size="sm"
          data-action="integration-help-settings"
          @click="(emit('open'), close())"
        >
          {{ I.settings }}
        </Button>
      </template>
    </Popover>
    <Button
      variant="outline"
      size="sm"
      data-action="integration-settings"
      :title="tip"
      @click="emit('open')"
    >
      <span
        v-for="i in items"
        :key="i.tool"
        class="relative inline-flex"
        :data-integration-dot="i.state ?? 'unknown'"
        aria-hidden="true"
      >
        <ItemIcon :icon="toolIcon(i.tool)" :size="14" />
        <span
          class="absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full ring-1 ring-background"
          :style="{ background: TONE_COLOR[i.tone] }"
        ></span>
      </span>
      <span>{{ I.settings }}</span>
    </Button>
  </div>
</template>
