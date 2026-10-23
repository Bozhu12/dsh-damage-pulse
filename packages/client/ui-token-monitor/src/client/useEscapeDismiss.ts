import { useEffect, useRef } from 'react'

/**
 * 全局 ESC 关闭：监听挂在 window 捕获阶段，焦点不在弹层内也能生效。
 *
 * 宿主的 Modal / Menu 原语已自带 document 级 ESC；本 hook 供自绘弹层
 * （通知设置、计费规则、详细用量窗口、悬浮卡右键菜单等）补齐同一行为。
 * 通过 defaultPrevented 协调多个同时打开的弹层：每次 ESC 只关一个
 * （按挂载顺序），重复按 ESC 逐层关闭；阻断传播避免同一按键再触发
 * 内部元素或宿主监听的旧处理。
 * @param active 弹层是否处于打开状态；false 时不监听。
 * @param onEscape 用户按下 ESC 时执行的动作（优先关内层确认/菜单，再关弹层）。
 */
export function useEscapeDismiss(active: boolean, onEscape: () => void): void {
  const handler = useRef(onEscape)
  handler.current = onEscape
  useEffect(() => {
    if (!active) return
    const dismiss = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      event.stopPropagation()
      handler.current()
    }
    window.addEventListener('keydown', dismiss, true)
    return () => { window.removeEventListener('keydown', dismiss, true) }
  }, [active])
}
