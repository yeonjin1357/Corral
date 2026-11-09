/*
  NeoHtop (MIT) src/lib/components/ui/{button,badge,toggle}/*.svelte 의 tailwind-variants 클래스를 그대로 옮겼다.
*/

const BUTTON_BASE =
  "focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 rounded-md border border-transparent bg-clip-padding text-sm font-medium focus-visible:ring-3 aria-invalid:ring-3 active:not-aria-[haspopup]:translate-y-px [&_svg:not([class*='size-'])]:size-4 group/button inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-all outline-none select-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0"

const BUTTON_VARIANT = {
  default: 'bg-primary text-primary-foreground hover:bg-primary/80',
  outline:
    'border-border bg-background hover:bg-muted hover:text-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50 aria-expanded:bg-muted aria-expanded:text-foreground shadow-xs',
  secondary:
    'bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground',
  ghost:
    'hover:bg-muted hover:text-foreground dark:hover:bg-muted/50 aria-expanded:bg-muted aria-expanded:text-foreground',
  destructive:
    'bg-destructive/10 hover:bg-destructive/20 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/20 text-destructive focus-visible:border-destructive/40 dark:hover:bg-destructive/30',
  link: 'text-primary underline-offset-4 hover:underline'
} as const

const BUTTON_SIZE = {
  default: 'h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
  xs: "h-6 gap-1 rounded-[min(var(--radius-md),8px)] px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
  sm: 'h-8 gap-1 rounded-[min(var(--radius-md),10px)] px-2.5 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5',
  lg: 'h-10 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
  icon: 'size-9',
  'icon-xs': "size-6 rounded-[min(var(--radius-md),8px)] [&_svg:not([class*='size-'])]:size-3",
  'icon-sm': 'size-8 rounded-[min(var(--radius-md),10px)]',
  'icon-lg': 'size-10'
} as const

export type ButtonVariant = keyof typeof BUTTON_VARIANT
export type ButtonSize = keyof typeof BUTTON_SIZE

export function buttonClass(
  variant: ButtonVariant = 'default',
  size: ButtonSize = 'default'
): string {
  return `${BUTTON_BASE} ${BUTTON_VARIANT[variant]} ${BUTTON_SIZE[size]}`
}

const BADGE_BASE =
  'h-5 gap-1 rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium transition-all has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&>svg]:size-3! group/badge inline-flex w-fit shrink-0 items-center justify-center overflow-hidden whitespace-nowrap focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 [&>svg]:pointer-events-none'

const BADGE_VARIANT = {
  default: 'bg-primary text-primary-foreground',
  secondary: 'bg-secondary text-secondary-foreground',
  destructive: 'bg-destructive/10 text-destructive dark:bg-destructive/20',
  outline: 'border-border text-foreground',
  ghost: 'hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50',
  link: 'text-primary underline-offset-4 hover:underline'
} as const

export type BadgeVariant = keyof typeof BADGE_VARIANT

export function badgeClass(variant: BadgeVariant = 'default'): string {
  return `${BADGE_BASE} ${BADGE_VARIANT[variant]}`
}

const TOGGLE_BASE =
  "hover:text-foreground aria-pressed:bg-muted focus-visible:border-ring focus-visible:ring-ring/50 gap-1 rounded-md text-sm font-medium transition-[color,box-shadow] [&_svg:not([class*='size-'])]:size-4 group/toggle inline-flex items-center justify-center whitespace-nowrap outline-none hover:bg-muted focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0"

const TOGGLE_VARIANT = {
  default: 'bg-transparent',
  outline: 'border-input hover:bg-muted border bg-transparent shadow-xs'
} as const

const TOGGLE_SIZE = {
  default: 'h-9 min-w-9 px-2.5',
  sm: 'h-8 min-w-8 px-2.5',
  lg: 'h-10 min-w-10 px-2.5'
} as const

export type ToggleVariant = keyof typeof TOGGLE_VARIANT
export type ToggleSize = keyof typeof TOGGLE_SIZE

export function toggleClass(
  variant: ToggleVariant = 'default',
  size: ToggleSize = 'default'
): string {
  return `${TOGGLE_BASE} ${TOGGLE_VARIANT[variant]} ${TOGGLE_SIZE[size]}`
}

/** NeoHtop ui/toggle-group/toggle-group-item.svelte(간격 0, 가로) 의 붙은 버튼 모양. */
export const TOGGLE_GROUP_ITEM =
  'data-[state=on]:bg-muted rounded-none px-2 shadow-none first:rounded-l-md last:rounded-r-md shrink-0 focus:z-10 focus-visible:z-10 data-[variant=outline]:border-l-0 data-[variant=outline]:first:border-l'

/** NeoHtop ui/input/input.svelte */
export const INPUT_CLASS =
  'dark:bg-input/30 border-input focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 h-9 rounded-md border bg-transparent px-2.5 py-1 text-sm shadow-xs transition-[color,box-shadow] focus-visible:ring-3 aria-invalid:ring-3 w-full min-w-0 outline-none placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50'

/** shadcn textarea(입력칸과 같은 테두리·초점 규칙). */
export const TEXTAREA_CLASS =
  'dark:bg-input/30 border-input focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 aria-invalid:border-destructive flex field-sizing-content min-h-16 w-full rounded-md border bg-transparent px-2.5 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-3 placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50'

/** NeoHtop ui/native-select/native-select.svelte */
export const SELECT_CLASS =
  'border-input placeholder:text-muted-foreground dark:bg-input/30 dark:hover:bg-input/50 focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full min-w-0 appearance-none rounded-md border bg-transparent py-1 pr-8 pl-2.5 text-sm shadow-xs transition-[color,box-shadow] select-none focus-visible:ring-3 data-[size=sm]:h-8 outline-none disabled:pointer-events-none disabled:cursor-not-allowed'

/** NeoHtop ui/checkbox/checkbox.svelte */
export const CHECKBOX_CLASS =
  'border-input dark:bg-input/30 data-checked:bg-primary data-checked:text-primary-foreground dark:data-checked:bg-primary data-checked:border-primary focus-visible:border-ring focus-visible:ring-ring/50 flex size-4 items-center justify-center rounded-[4px] border shadow-xs transition-shadow focus-visible:ring-3 peer relative shrink-0 outline-none after:absolute after:-inset-x-3 after:-inset-y-2 disabled:cursor-not-allowed disabled:opacity-50'

/** NeoHtop ui/label/label.svelte */
export const LABEL_CLASS =
  'gap-2 text-sm leading-none font-medium peer-disabled:opacity-50 flex items-center select-none peer-disabled:cursor-not-allowed'

/** NeoHtop ui/table/*.svelte */
export const TABLE = {
  container: 'relative w-full overflow-x-auto',
  table: 'w-full caption-bottom text-sm',
  header: '[&_tr]:border-b',
  body: '[&_tr:last-child]:border-0',
  row: 'hover:bg-muted/50 data-[state=selected]:bg-muted border-b transition-colors',
  head: 'text-foreground h-10 px-2 text-left align-middle font-medium whitespace-nowrap',
  cell: 'p-2 align-middle whitespace-nowrap'
} as const

/** NeoHtop ui/popover/popover-content.svelte, ui/dropdown-menu/*.svelte */
export const POPOVER_CLASS =
  'bg-popover text-popover-foreground animate-in fade-in-0 zoom-in-95 slide-in-from-top-2 ring-border flex flex-col gap-4 rounded-md p-4 text-sm shadow-md ring-1 duration-100 z-50 w-72 outline-hidden'
export const MENU_CLASS =
  'animate-in fade-in-0 zoom-in-95 slide-in-from-top-2 ring-border bg-popover text-popover-foreground min-w-32 rounded-md p-1 shadow-md ring-1 duration-100 z-50 overflow-x-hidden overflow-y-auto'
export const MENU_ITEM_CLASS =
  "hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground gap-2 rounded-sm px-2 py-1.5 text-sm [&_svg:not([class*='size-'])]:size-4 relative flex w-full cursor-default items-center outline-hidden select-none text-left disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0"
export const MENU_SEPARATOR_CLASS = 'bg-border -mx-1 my-1 h-px'
export const MENU_SHORTCUT_CLASS = 'text-muted-foreground ml-auto text-xs tracking-widest'
