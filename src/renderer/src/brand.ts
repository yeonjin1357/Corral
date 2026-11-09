/**
 * 표의 행 아이콘으로 쓸 브랜드 로고 고르기(NeoHtop 이 프로세스마다 앱 아이콘을 보이는 것처럼, 무엇이 도는지 한눈에).
 * 로고 모양은 simple-icons(CC0, NeoHtop 도 쓴다). 명령줄은 소문자·슬래시로 바꿔 비교하고,
 * 폴더 이름(go-shop, next-admin 등)에 속지 않게 실행 파일·패키지 경로·명령 자리만 본다.
 */
import {
  siAngular,
  siApachemaven,
  siAstro,
  siBrave,
  siBun,
  siCursor,
  siDatagrip,
  siDeno,
  siDiscord,
  siDjango,
  siDocker,
  siDotnet,
  siElectron,
  siEsbuild,
  siFastapi,
  siFigma,
  siFirefoxbrowser,
  siFlask,
  siGo,
  siGooglechrome,
  siGradle,
  siIntellijidea,
  siJest,
  siKakaotalk,
  siKotlin,
  siLaravel,
  siMysql,
  siNextdotjs,
  siNodedotjs,
  siNotion,
  siNuxt,
  siObsidian,
  siOpenjdk,
  siPhp,
  siPostgresql,
  siPostman,
  siPython,
  siRedis,
  siRemix,
  siRubyonrails,
  siRust,
  siSpotify,
  siSpringboot,
  siStorybook,
  siSvelte,
  siTypescript,
  siVite,
  siVitest,
  siWebpack,
  siWebstorm,
  siZoom,
  type SimpleIcon
} from 'simple-icons'

export interface Brand {
  title: string
  /** 24×24 SVG path. */
  path: string
  hex: string
}

const brand = (i: SimpleIcon): Brand => ({ title: i.title, path: i.path, hex: i.hex })
/** 실행 파일·명령 이름이 낱말로 올 때(앞: 시작·슬래시·공백·따옴표, 뒤: .exe·따옴표·공백·끝). */
const bin = (name: string): RegExp => new RegExp(`(^|[/\\s"])${name}(\\.exe|\\.cmd)?("|\\s|$)`)

/** 개발 도구 자체(테스트·번들러·타입 검사). 개발 서버 규칙보다 먼저 본다(vitest 를 vite 로 보지 않게). */
const TOOL_RULES: [RegExp, SimpleIcon][] = [
  [/vitest/, siVitest],
  [/jest-worker|(^|[/\s"])jest(\.js)?("|\s|$)/, siJest],
  [/esbuild/, siEsbuild],
  [/(^|[/\s"])(vue-)?tsc(\.js|\.cmd)?("|\s|$)|tsserver|typescript\/lib\/tsc/, siTypescript]
]

const SERVER_RULES: [RegExp, SimpleIcon][] = [
  [/storybook/, siStorybook],
  [/node_modules\/next\/|(^|\s)next\s+(dev|start)\b/, siNextdotjs],
  [/node_modules\/(nuxi|nuxt)\/|(^|\s)(nuxi|nuxt)\s+(dev|start)\b/, siNuxt],
  [/node_modules\/astro\/|(^|\s)astro\s+dev\b/, siAstro],
  [/@remix-run\/|(^|\s)remix\s+dev\b/, siRemix],
  [/@sveltejs\/kit|svelte-kit\s/, siSvelte],
  [/@angular\/cli|(^|\s)ng\s+serve\b/, siAngular],
  [/webpack-dev-server|node_modules\/webpack\/|(^|\s)webpack(\s|$)/, siWebpack],
  [/node_modules\/vite\/|\/vite\/bin\/vite|(^|\s)vite(\s|$)/, siVite],
  [/node_modules\/electron\/dist\/electron/, siElectron],
  [/spring|bootrun/, siSpringboot],
  [/gradle/, siGradle],
  [/(^|[/\s"])mvnw?(\.cmd)?("|\s|$)|maven/, siApachemaven],
  [/kotlin/, siKotlin],
  [bin('javaw?'), siOpenjdk],
  [/manage\.py\s+runserver|django/, siDjango],
  [/uvicorn|fastapi/, siFastapi],
  [/flask/, siFlask],
  [bin('python[\\d.]*w?'), siPython],
  [bin('deno'), siDeno],
  [bin('bun'), siBun],
  [/(^|[/\s"])go(\.exe)?\s+run\b|\/go-build\d*\//, siGo],
  [bin('cargo'), siRust],
  [bin('dotnet'), siDotnet],
  [/artisan\s+serve/, siLaravel],
  [bin('php'), siPhp],
  [/(^|\s)rails\s+s(erver)?\b|puma/, siRubyonrails],
  [/com\.docker|docker-proxy|dockerd/, siDocker],
  [/postgres/, siPostgresql],
  [/mysqld/, siMysql],
  [/redis-server/, siRedis],
  [bin('node'), siNodedotjs]
]

const norm = (s: string): string => s.toLowerCase().replace(/\\/g, '/')
const pick = (rules: [RegExp, SimpleIcon][], s: string): Brand | null => {
  const hit = rules.find(([re]) => re.test(s))
  return hit ? brand(hit[1]) : null
}

/** 개발 서버(포트를 연 프로세스) 명령줄 → 프레임워크·런타임. */
export function devServerBrand(commandLine: string): Brand | null {
  const s = norm(commandLine)
  return s ? pick(SERVER_RULES, s) : null
}

/** 무거운 작업(설정의 명령 패턴) → 그 도구. */
export function heavyBrand(label: string, commandLine: string): Brand | null {
  const s = norm(`${label} ${commandLine}`)
  return pick(TOOL_RULES, s) ?? pick(SERVER_RULES, s)
}

/** 남은 프로세스(이름표 + 명령줄) → 그 도구. 브라우저는 OS 아이콘에 맡긴다. */
export function leftoverBrand(label: string, commandLine: string): Brand | null {
  const s = norm(`${label} ${commandLine}`)
  return pick(TOOL_RULES, s) ?? pick(SERVER_RULES, s)
}

const APP_RULES: [RegExp, SimpleIcon][] = [
  [/chrome/, siGooglechrome],
  [/figma/, siFigma],
  [/cursor/, siCursor],
  [/firefox/, siFirefoxbrowser],
  [/brave/, siBrave],
  [/discord/, siDiscord],
  [/notion/, siNotion],
  [/spotify/, siSpotify],
  [/zoom/, siZoom],
  [/kakaotalk/, siKakaotalk],
  [/postman/, siPostman],
  [/obsidian/, siObsidian],
  [/idea/, siIntellijidea],
  [/webstorm/, siWebstorm],
  [/datagrip/, siDatagrip],
  [/docker/, siDocker],
  [/^node(\.exe)?$/, siNodedotjs],
  [/^javaw?(\.exe)?$/, siOpenjdk],
  [/^python/, siPython]
]

/** 다른 앱(프로세스 이름) → 브랜드. OS 앱 아이콘을 못 얻었을 때만 쓴다. */
export function appBrand(name: string): Brand | null {
  return pick(APP_RULES, name.toLowerCase())
}

/** 검은색에 가까운 로고는 글자색(currentColor)을 따라 어두운 테마에서도 보이게 한다. */
export function brandColor(hex: string): string {
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.035 ? 'currentColor' : `#${hex}`
}
