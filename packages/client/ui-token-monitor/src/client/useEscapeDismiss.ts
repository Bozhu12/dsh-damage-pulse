import { useEffect, useRef } from 'react'

/**
 * 全局 ESC 关闭：共享弹层栈 + 单个 window 捕获监听。
 *
 * 宿主的 Modal / Menu 原语把 Esc 监听挂在 document 上；因此这里**只**
 * 调用 preventDefault、绝不阻断传播，保证宿主弹层仍能收到同一个按键。
 * 多个弹层同时打开时按打开顺序取最上层（后登记的先关闭），一次 Esc 只
 * 关一层，重复按逐层退出。
 *
 * 供自绘弹层（通知设置、计费规则、详细用量窗口、悬浮卡右键菜单等）补齐
 * 与宿主一致的行为；宿主 Modal / Menu 自身不需要接入。
 * @param active 弹层是否处于打开状态；false 时不登记。
 * @param onEscape 该弹层成为最上层时、用户按下 Esc 执行的动作。
 */
export function useEscapeDismiss(active: boolean, onEscape: () => void): void {
  const handler = useRef(onEscape)
  handler.current = onEscape
  useEffect(() => {
    if (!active) return
    const layer: { onEscape(): void } = { onEscape: () => { handler.current() } }
    layers.push(layer)
    ensureListener()
    return () => {
      const index = layers.indexOf(layer)
      if (index >= 0) layers.splice(index, 1)
      releaseListener()
    }
  }, [active])
}

/** 同时登记的弹层，后 push 的在后打开、位于栈顶。 */
const layers: { onEscape(): void }[] = []
let listening = false

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  const top = layers[layers.length - 1]
  if (!top) return
  // 宿主模态（aria-modal 的对话框，如模块管理的 Modal）盖在插件弹层上时，
  // Esc 归宿主：只关宿主弹层，插件层保持原样，避免一次按键连关两层。
  if (hostModalPresent()) return
  // 只阻止默认行为；传播必须放行，宿主 document 上的 Modal/Menu 监听
  // 依赖同一个事件才能关闭自己的弹层。
  event.preventDefault()
  top.onEscape()
}

/** 宿主模态对话框的稳定特征：插件弹层一律是 aria-modal="false"。 */
function hostModalPresent(): boolean {
  return document.querySelector('[role="dialog"][aria-modal="true"]') !== null
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
