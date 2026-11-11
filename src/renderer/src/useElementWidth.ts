import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

/**
 * 요소의 안쪽 너비(clientWidth)를 따라가는 값(추이 그래프·메모리 지도가 SVG·칸을 그 너비로 그린다).
 * 붙을 때 한 번 재고 ResizeObserver 로 바뀔 때마다 다시 잰다. 떨어질 때 지켜보기를 멈춘다. 붙기 전에는 0.
 */
export function useElementWidth(el: Ref<HTMLElement | null>): Ref<number> {
  const width = ref(0)
  let observer: ResizeObserver | null = null
  onMounted(() => {
    if (!el.value) return
    width.value = el.value.clientWidth
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => (width.value = el.value?.clientWidth ?? 0))
      observer.observe(el.value)
    }
  })
  onBeforeUnmount(() => observer?.disconnect())
  return width
}
