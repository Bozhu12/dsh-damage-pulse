import { useEffect, useRef } from 'react'

/**
 * 全局 ESC 关闭：共享弹层栈 + 单个 window 捕获监听。
 *
 * 宿主的 Modal / Menu 原语把 Esc 监听挂在 document 上。为了既让宿主能收到
 * Esc、又避免一次按键连关两层，这里按「谁真的在最上层」分档处理：
 *
 * - 没有宿主模态打开时：只 `preventDefault()`、不阻断传播，宿主自己的
 *   Esc 处理（window/document 上的全局监听）照常工作。
 * - 宿主模态**确实盖在插件层之上**时：让位——插件层不动，不阻断传播，
 *   由宿主关闭自己的模态。
 * - 插件层确实在最上层、宿主模态在它下面时：插件层响应，并阻断传播，
 *   避免把用户看不见的宿主模态一起关掉。
 *
 * 「谁在上层」用命中测试判断（命中插件层中心点的元素是否属于插件层），
 * 而不是猜 DOM 里谁的 z-index 大——宿主 Modal 的 `role="dialog"` 卡片
 * 自身 z-index 是 1，真正参与叠放的根层在祖先上，按卡片比较会得出相反
 * 的结论。命中测试拿不到结果（未挂载、未实现）时回退到层级比较。
 *
 * 供自绘弹层（通知设置、计费规则、详细用量窗口、悬浮卡右键菜单等）补齐
 * 与宿主一致的行为；宿主 Modal / Menu 自身不需要接入。
 * @param active 弹层是否处于打开状态；false 时不登记。
 * @param onEscape 该弹层成为最上层时、用户按下 Esc 执行的动作。
 * @param options.element 该弹层的根元素，用于命中测试判断它是否在最上层。
 * @param options.zIndex 命中测试不可用时的回退层级（与组件 CSS 保持一致）。
 */
export function useEscapeDismiss(
  active: boolean,
  onEscape: () => void,
  options: { element?: () => HTMLElement | null; zIndex?: number } = {},
): void {
  const handler = useRef(onEscape)
  handler.current = onEscape
  const element = useRef(options.element)
  element.current = options.element
  const zIndex = options.zIndex
  useEffect(() => {
    if (!active) return
    const layer: Layer = {
      zIndex: zIndex ?? 0,
      getElement: () => element.current?.() ?? null,
      onEscape: () => { handler.current() },
    }
    layers.push(layer)
    ensureListener()
    return () => {
      const index = layers.indexOf(layer)
      if (index >= 0) layers.splice(index, 1)
      releaseListener()
    }
  }, [active, zIndex])
}

interface Layer {
  zIndex: number
  getElement(): HTMLElement | null
  onEscape(): void
}

/** 同时登记的弹层，后 push 的在后打开、位于栈顶。 */
const layers: Layer[] = []
let listening = false

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  const top = layers[layers.length - 1]
  if (!top) return
  const hostModal = hostModalPresent()
  if (hostModal && !layerAboveHostModal(top)) {
    // 宿主模态真的盖在插件层上面：Esc 归宿主，插件层保持原样，
    // 也不阻断传播（宿主 Modal 的 document 监听要靠它关闭自己）。
    return
  }
  event.preventDefault()
  if (hostModal) {
    // 插件层在上、宿主模态在下面：只关插件层，阻断传播避免连关看不见的模态。
    event.stopPropagation()
  }
  top.onEscape()
}

/** 页面上是否存在宿主模态：宿主 Modal 渲染 role=dialog 且 aria-modal=true。 */
function hostModalPresent(): boolean {
  return document.querySelector('[role="dialog"][aria-modal="true"]') !== null
}

/**
 * 插件层是否真的在宿主模态之上。
 *
 * 优先在插件层中心点做命中测试：命中的元素属于插件层即说明它没被盖住。
 * 命中测试不可用（未挂载、环境未实现）时回退到计算样式的层级比较。
 * @param layer 栈顶弹层。
 * @returns 插件层在宿主模态之上时为 true。
 */
function layerAboveHostModal(layer: Layer): boolean {
  const element = layer.getElement()
  if (element === null) return layer.zIndex >= hostModalStackingZ()
  const rect = element.getBoundingClientRect()
  const x = rect.left + rect.width / 2
  const y = rect.top + rect.height / 2
  if (rect.width > 0 && rect.height > 0 && Number.isFinite(x) && Number.isFinite(y)) {
    const hit = document.elementFromPoint(x, y)
    if (hit !== null) return element.contains(hit)
  }
  // 命中测试不可用：比较各自参与的叠放层。
  return stackingZIndexOf(element) >= hostModalStackingZ()
}

/**
 * 读取元素实际参与叠放的层级：取自身及祖先中**最外层**明确的 z-index。
 *
 * 宿主 Modal 的 `role="dialog"` 卡片自身是 `z-index: 1`，真正的层级在带
 * `z-index: 1000` 的根层祖先上；只读卡片会得出相反的结论，因此这里一路
 * 向上取最外层（最接近文档根）的明确层级。
 */
function stackingZIndexOf(node: Element): number {
  let stacking = 0
  let current: Element | null = node
  while (current !== null) {
    const value = Number.parseInt(window.getComputedStyle(current).zIndex, 10)
    if (Number.isFinite(value) && value !== 0) stacking = value
    current = current.parentElement
  }
  return stacking
}

/** 宿主模态实际参与叠放的层级（取最高者）。 */
function hostModalStackingZ(): number {
  let highest = 0
  for (const modal of document.querySelectorAll('[role="dialog"][aria-modal="true"]')) {
    highest = Math.max(highest, stackingZIndexOf(modal))
  }
  return highest
}

function ensureListener(): void {
  if (listening) return
  listening = true
  window.addEventListener('keydown', onKeydown, true)
}

function releaseListener(): void {
  if (!listening || layers.length > 0) return
  listening = false
  window.removeEventListener('keydown', onKeydown, true)
}
