import { useEffect, useRef } from 'react'

/**
 * 全局 ESC 关闭：共享弹层栈 + 单个 window 捕获监听。
 *
 * 宿主的 Modal / Menu 原语把 Esc 监听挂在 document 上；因此这里**只**
 * 调用 preventDefault、绝不阻断传播，保证宿主弹层仍能收到同一个按键。
 * 多个弹层同时打开时按打开顺序取最上层（后登记的先关闭），一次 Esc 只
 * 关一层，重复按逐层退出。
 *
 * 宿主模态（如模块管理的 Modal）**确实盖在插件层之上**时，Esc 归宿主：
 * 判据是比较双方的 z-index，而不是「页面上存在模态」——插件窗口的层级
 * （通知设置 1200 / 详细用量与计费规则 1300）本来就高于宿主 Modal 的
 * 1000，只看存在性会让可见的插件窗口按 Esc 毫无反应。
 *
 * 供自绘弹层（通知设置、计费规则、详细用量窗口、悬浮卡右键菜单等）补齐
 * 与宿主一致的行为；宿主 Modal / Menu 自身不需要接入。
 * @param active 弹层是否处于打开状态；false 时不登记。
 * @param onEscape 该弹层成为最上层时、用户按下 Esc 执行的动作。
 * @param options.zIndex 该弹层的层级，用于判断宿主模态是否真的在它上面；
 *   缺省视为低于任何宿主模态。
 */
export function useEscapeDismiss(active: boolean, onEscape: () => void, options: { zIndex?: number } = {}): void {
  const handler = useRef(onEscape)
  handler.current = onEscape
  const zIndex = options.zIndex
  useEffect(() => {
    if (!active) return
    const layer: Layer = { zIndex: zIndex ?? 0, onEscape: () => { handler.current() } }
    layers.push(layer)
    ensureListener()
    return () => {
      const index = layers.indexOf(layer)
      if (index >= 0) layers.splice(index, 1)
      releaseListener()
    }
  }, [active, zIndex])
}

interface Layer { zIndex: number; onEscape(): void }

/** 同时登记的弹层，后 push 的在后打开、位于栈顶。 */
const layers: Layer[] = []
let listening = false

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  const top = layers[layers.length - 1]
  if (!top) return
  // 宿主模态确实在该层之上时，Esc 归宿主：插件层保持原样，避免可见窗口
  // 毫无反应却把后面看不见的模态关掉。
  if (hostModalAbove(top.zIndex)) return
  // 只阻止默认行为；传播必须放行，宿主 document 上的 Modal/Menu 监听
  // 依赖同一个事件才能关闭自己的弹层。
  event.preventDefault()
  top.onEscape()
}

/** 读取一个元素的层叠顺序；非数值（auto/normal）按 0 处理。 */
function zIndexOf(node: Element): number {
  const value = Number.parseInt(window.getComputedStyle(node).zIndex, 10)
  return Number.isFinite(value) ? value : 0
}

/**
 * 是否存在真正盖在给定层级之上的宿主模态。
 *
 * 宿主 Modal 渲染 `role="dialog" aria-modal="true"`（插件弹层一律
 * `aria-modal="false"`），层级取自计算样式，因此宿主未来调整 z-index
 * 也不需要同步常量。
 * @param layerZIndex 插件栈顶层的层级。
 * @returns 宿主模态的层级不低于该层时为 true。
 */
function hostModalAbove(layerZIndex: number): boolean {
  for (const modal of document.querySelectorAll('[role="dialog"][aria-modal="true"]')) {
    if (zIndexOf(modal) >= layerZIndex) return true
  }
  return false
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
