// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { StrictMode, useState } from 'react'
import { useEscapeDismiss } from '../src/client/useEscapeDismiss.ts'

const flush = async () => { await act(async () => {}) }
// 真实按键派发在 DOM 元素上，事件路径 window → document → body，
// 这样宿主挂在 document 上的监听与插件的 window 捕获监听都能收到。
const esc = () => fireEvent.keyDown(document.body, { key: 'Escape' })

afterEach(() => { cleanup(); vi.restoreAllMocks() })

/** 挂载一个登记弹层的探针组件，记录 onEscape 调用。 */
function Layer({ active, onEscape, zIndex }: { active: boolean; onEscape: () => void; zIndex?: number }) {
  useEscapeDismiss(active, onEscape, { zIndex })
  return null
}

it('forwards Escape to document listeners of the host while handling its own layer', () => {
  // 复现 review 第 1 条：宿主 Modal/Menu 的监听挂在 document 上，
  // 插件弹层打开时同一个 Esc 必须仍能到达那里。
  const hostListener = vi.fn()
  document.addEventListener('keydown', hostListener)
  const onEscape = vi.fn()
  render(<Layer active onEscape={onEscape} />)
  esc()
  expect(onEscape).toHaveBeenCalledTimes(1)
  expect(hostListener).toHaveBeenCalledTimes(1)
  document.removeEventListener('keydown', hostListener)
})

it('closes the top-most layer first and unwinds one layer per Escape', async () => {
  // 复现 review 第 2 条：两个自绘窗口同时打开时，Esc 关的是后打开（最上层）。
  const first = vi.fn(), second = vi.fn()
  function TwoLayers() {
    const [a, setA] = useState(true), [b, setB] = useState(true)
    useEscapeDismiss(a, () => { first(); setA(false) })
    useEscapeDismiss(b, () => { second(); setB(false) })
    return null
  }
  render(<TwoLayers />)
  esc(); await flush()
  expect(second).toHaveBeenCalledTimes(1)
  expect(first).not.toHaveBeenCalled()
  esc(); await flush()
  expect(first).toHaveBeenCalledTimes(1)
  expect(second).toHaveBeenCalledTimes(1)
  esc(); await flush()
  expect(first).toHaveBeenCalledTimes(1)
  expect(second).toHaveBeenCalledTimes(1)
})

it('stops listening after the last layer unmounts, including through StrictMode remounts', async () => {
  const add = vi.spyOn(window, 'addEventListener'), remove = vi.spyOn(window, 'removeEventListener')
  const view = render(<StrictMode><Layer active onEscape={() => {}} /></StrictMode>)
  await flush()
  view.unmount()
  // 严格模式双挂载会成对登记/移除，最后一层卸载后监听必须被移除。
  const adds = add.mock.calls.filter(([type]) => type === 'keydown')
  const removes = remove.mock.calls.filter(([type]) => type === 'keydown')
  expect(adds).toHaveLength(removes.length)
})

it('deactivates a layer without touching the others', () => {
  const first = vi.fn(), second = vi.fn()
  const view = render(<><Layer active onEscape={first} /><Layer active onEscape={second} /></>)
  view.rerender(<><Layer active onEscape={first} /><Layer active={false} onEscape={second} /></>)
  esc()
  expect(first).toHaveBeenCalledTimes(1)
  expect(second).not.toHaveBeenCalled()
})

it('yields Escape to a host modal that is actually above the plugin layer', async () => {
  // 复现 review：宿主 Modal 的层级（1000）低于插件窗口（1300）时不能让位，
  // 否则可见的插件窗口按 Esc 毫无反应；只有宿主确实在上层时才让位。
  const onEscape = vi.fn()
  const hostListener = vi.fn()
  document.addEventListener('keydown', hostListener)
  const view = render(<>
    <Layer active onEscape={onEscape} zIndex={1300} />
    <div role="dialog" aria-modal="true" data-host-modal style={{ position: 'fixed', zIndex: 1000 }} />
  </>)
  // 宿主模态在下面：Esc 归插件层。
  esc(); await flush()
  expect(onEscape).toHaveBeenCalledTimes(1)

  // 宿主模态真的在上面（2000 > 1300）：Esc 归宿主，插件层不动。
  onEscape.mockClear()
  view.rerender(<>
    <Layer active onEscape={onEscape} zIndex={1300} />
    <div role="dialog" aria-modal="true" data-host-modal style={{ position: 'fixed', zIndex: 2000 }} />
  </>)
  esc(); await flush()
  expect(onEscape).not.toHaveBeenCalled()
  expect(hostListener).toHaveBeenCalledTimes(2)
  document.removeEventListener('keydown', hostListener)
})

it('ignores keys other than Escape', () => {
  const onEscape = vi.fn()
  render(<Layer active onEscape={onEscape} />)
  fireEvent.keyDown(document.body, { key: 'Tab' })
  fireEvent.keyDown(document.body, { key: 'Enter' })
  expect(onEscape).not.toHaveBeenCalled()
})

/** 真实组件形态的回归：后挂载的详细用量窗口先被关闭。 */
it('closes the later-mounted usage window first when two are open', async () => {
  const closed: string[] = []
  function Window({ id }: { id: string }) {
    const [open, setOpen] = useState(true)
    useEscapeDismiss(open, () => { closed.push(id); setOpen(false) })
    return open ? <div data-window={id} /> : null
  }
  const view = render(<Window id="first" />)
  view.rerender(<><Window id="first" /><Window id="second" /></>)
  esc(); await flush()
  expect(closed).toEqual(['second'])
  expect(document.querySelector('[data-window="first"]')).toBeTruthy()
  esc(); await flush()
  expect(closed).toEqual(['second', 'first'])
  expect(document.querySelector('[data-window="second"]')).toBeNull()
})
