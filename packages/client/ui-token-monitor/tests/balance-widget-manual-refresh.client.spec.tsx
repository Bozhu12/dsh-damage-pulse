// @vitest-environment jsdom
// 手动刷新契约：点击 ↻ 必须发起绕过宿主节流缓存的请求、
// 旋转样式持续到请求完成（含可感知的最短时长）、无作用域时按钮禁用。
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_TOKEN_MONITOR_SETTINGS,
  TOKEN_MONITOR_SETTINGS_SCHEMA_VERSION,
  type TokenMonitorSettings,
} from '@deepseek-ai/dsh-token-monitor-contract'
import { BalanceWidget } from '../src/client/BalanceWidget.tsx'
import moduleCss from '../src/client/module-effects.module.css'

beforeEach(() => { vi.useFakeTimers(); window.localStorage.clear() })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

const flush = async () => { await act(async () => {}) }
const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }

interface Deferred<T> { promise: Promise<T>; resolve: (value: T) => void }
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}

/** 余额响应体；金额用合成非零值核对显示。 */
const balanceBody = { provider: 'deepseek-official', currency: 'CNY', totalBalance: 123.45, updatedAt: Date.now() }

interface Harness {
  view: ReturnType<typeof render>
  balanceUrls: string[]
  pending: Deferred<Response>[]
}

/** 挂载余额挂件；余额请求全部延迟，由用例控制放行时机。
 *  挂载会突发两次（默认 15s 起一轮 + 设置生效后按新周期立即校准一轮），与 poll-settings 契约一致。 */
function mount(scope: { sessionId: string; provider: string; model: string } | undefined, pollSeconds: number): Harness {
  const balanceUrls: string[] = []
  const pending: Deferred<Response>[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.startsWith('/api/token-monitor/settings')) {
      return new Response(JSON.stringify({
        schemaVersion: TOKEN_MONITOR_SETTINGS_SCHEMA_VERSION,
        revision: 1,
        settings: { ...DEFAULT_TOKEN_MONITOR_SETTINGS, balancePollSeconds: pollSeconds },
      }), { status: 200 })
    }
    if (url.startsWith('/api/token-monitor/balance?')) {
      balanceUrls.push(url)
      const gate = deferred<Response>()
      pending.push(gate)
      return gate.promise
    }
    return new Response('', { status: 503 })
  }))
  const props = {
    useSessions: (selector: (state: { current: string }) => unknown) => selector({ current: 'session-1' }),
    loadDisplayScope: vi.fn().mockResolvedValue(scope),
  } as unknown as ComponentProps<typeof BalanceWidget>
  return { view: render(<BalanceWidget {...props} />), balanceUrls, pending }
}

const okBalance = () => new Response(JSON.stringify(balanceBody), { status: 200 })

/** ↻ 图标当前是否处于旋转态。 */
const spinning = (): boolean => {
  const span = screen.getByRole('button', { name: '刷新余额' }).querySelector('span')
  return span?.className === moduleCss.refreshSpin
}

describe('余额挂件手动刷新', () => {
  it('点击刷新余额追加 force=1 且自动轮询不带；数据在旋转结束后更新', async () => {
    const { view, balanceUrls, pending } = mount({ sessionId: 'session-1', provider: 'deepseek-official', model: 'deepseek-chat' }, 60)
    await flush()
    const autoCount = balanceUrls.length
    // 排空挂载突发的自动轮询（不带 force）。
    await act(async () => { pending.slice(0, autoCount).forEach(d => d.resolve(okBalance())) })
    await flush()
    expect(autoCount).toBeGreaterThanOrEqual(1)
    expect(balanceUrls.every(url => !url.includes('force='))).toBe(true)
    expect(screen.getByRole('button', { name: '刷新余额' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '刷新余额' }))
    await flush()
    // 手动请求绕过宿主节流缓存。
    expect(balanceUrls).toHaveLength(autoCount + 1)
    expect(balanceUrls.at(-1)).toContain('force=1')
    expect(spinning()).toBe(true)
    await act(async () => { pending.at(-1)!.resolve(okBalance()) })
    await flush()
    // 最短旋转时长内样式仍在，之后消失并完成显示更新。
    expect(spinning()).toBe(true)
    await advance(700)
    expect(spinning()).toBe(false)
    expect(document.querySelector('[data-token-monitor-display]')?.textContent).toContain('123.45')
    view.unmount()
  })

  it('自动轮询在途时点击刷新：旋转样式保持到新的手动请求完成', async () => {
    const { view, balanceUrls, pending } = mount({ sessionId: 'session-1', provider: 'deepseek-official', model: 'deepseek-chat' }, 60)
    await flush()
    const autoCount = balanceUrls.length
    expect(autoCount).toBeGreaterThanOrEqual(1)
    // 挂载突发的自动请求保持全部在途，点击刷新。
    fireEvent.click(screen.getByRole('button', { name: '刷新余额' }))
    await flush()
    expect(balanceUrls).toHaveLength(autoCount + 1)
    expect(balanceUrls.at(-1)).toContain('force=1')
    // 旧的自动请求此刻才返回：不得提前清掉手动刷新的旋转态。
    await act(async () => { pending.slice(0, autoCount).forEach(d => d.resolve(okBalance())) })
    await flush()
    expect(spinning()).toBe(true)
    await act(async () => { pending.at(-1)!.resolve(okBalance()) })
    await flush()
    await advance(700)
    expect(spinning()).toBe(false)
    view.unmount()
  })

  it('响应即时返回时旋转样式仍保持一个可感知的最短时长', async () => {
    const { view, balanceUrls, pending } = mount({ sessionId: 'session-1', provider: 'deepseek-official', model: 'deepseek-chat' }, 60)
    await flush()
    await act(async () => { pending.forEach(d => d.resolve(okBalance())) })
    await flush()
    fireEvent.click(screen.getByRole('button', { name: '刷新余额' }))
    await flush()
    await act(async () => { pending.at(-1)!.resolve(okBalance()) })
    await flush()
    // 响应已到达，但用户必须看得到“进行中”反馈。
    expect(spinning()).toBe(true)
    await advance(300)
    expect(spinning()).toBe(true)
    await advance(400)
    expect(spinning()).toBe(false)
    expect(balanceUrls.every((url, index) => index < balanceUrls.length - 1 || url.includes('force=1'))).toBe(true)
    view.unmount()
  })

  it('无显示作用域时刷新按钮禁用并提示，点击不发请求', async () => {
    const { view, balanceUrls, pending } = mount(undefined, 60)
    await flush()
    expect(pending).toHaveLength(0)
    const button = screen.getByRole('button', { name: '刷新余额' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.getAttribute('title')).not.toBe('')
    fireEvent.click(button)
    await flush()
    await advance(30_000)
    expect(balanceUrls).toHaveLength(0)
    view.unmount()
  })
})
