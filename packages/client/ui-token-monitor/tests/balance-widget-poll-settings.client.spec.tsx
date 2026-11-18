// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_TOKEN_MONITOR_SETTINGS,
  TOKEN_MONITOR_SETTINGS_SCHEMA_VERSION,
  type TokenMonitorSettings,
} from '@deepseek-ai/dsh-token-monitor-contract'
import { BalanceWidget } from '../src/client/BalanceWidget.tsx'

beforeEach(() => { vi.useFakeTimers(); window.localStorage.clear() })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

/** 组装一份通过契约校验的设置快照；overrides 覆盖轮询偏好字段。 */
function settingsSnapshot(overrides: Partial<TokenMonitorSettings>, revision = 1) {
  return {
    schemaVersion: TOKEN_MONITOR_SETTINGS_SCHEMA_VERSION,
    revision,
    settings: { ...DEFAULT_TOKEN_MONITOR_SETTINGS, ...overrides },
  }
}

function mount(overrides: Partial<TokenMonitorSettings>) {
  const balanceStarts: number[] = []
  const chargeCalls: string[] = []
  const origin = Date.now()
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    if (url.startsWith('/api/token-monitor/settings')) {
      return new Response(JSON.stringify(settingsSnapshot(overrides)), { status: 200 })
    }
    if (url.startsWith('/api/token-monitor/charge-events')) {
      chargeCalls.push(url)
      return new Response(JSON.stringify({ streamId: 's1', seq: 0, events: [] }), { status: 200 })
    }
    if (url.startsWith('/api/token-monitor/balance?')) {
      balanceStarts.push(Date.now() - origin)
      void init
      return new Response(JSON.stringify({ provider: 'deepseek-official', currency: 'CNY', totalBalance: 123.45, updatedAt: Date.now() }), { status: 200 })
    }
    return new Response('', { status: 503 })
  })
  const props = {
    useSessions: (selector: (state: { current: string }) => unknown) => selector({ current: 'session-1' }),
    loadDisplayScope: vi.fn().mockResolvedValue({ sessionId: 'session-1', provider: 'deepseek-official', model: 'deepseek-chat' }),
  } as unknown as ComponentProps<typeof BalanceWidget>
  return { view: render(<BalanceWidget {...props} />), balanceStarts, chargeCalls }
}

const flush = async () => { await act(async () => {}) }
const tick = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }

describe('polling preference settings', () => {
  it('balancePollSeconds=60 时余额按 60 秒周期轮询，不再固定 15 秒', async () => {
    const { view, balanceStarts } = mount({ balancePollSeconds: 60 })
    await flush()
    // mount 突发两次（默认 15s 起一轮 + 设置生效后按新周期立即校准一轮），此后按 60s 周期。
    expect(balanceStarts).toHaveLength(2)
    await tick(55_000)
    expect(balanceStarts).toHaveLength(2)
    await tick(6_000)
    expect(balanceStarts).toHaveLength(3)
    await tick(60_000)
    expect(balanceStarts).toHaveLength(4)
    view.unmount()
  })

  it('balancePollSeconds=0 时设置加载后不再自动轮询，按钮手动补拉', async () => {
    const { view, balanceStarts } = mount({ balancePollSeconds: 0 })
    await flush()
    await tick(30_000)
    expect(balanceStarts).toEqual([0, 0])
    const refresh = view.getByRole('button', { name: '刷新余额' })
    fireEvent.click(refresh)
    await flush()
    expect(balanceStarts).toHaveLength(3)
    await tick(30_000)
    expect(balanceStarts).toHaveLength(3)
    view.unmount()
  })

  it('chargeFxEnabled=false 时设置生效后停止 1 秒扣费事件轮询', async () => {
    const { view, chargeCalls } = mount({ chargeFxEnabled: false })
    await flush()
    // 设置生效前有一次种子调用；生效后不再有任何轮询。
    const seeded = chargeCalls.length
    await tick(5_000)
    expect(chargeCalls.length).toBe(seeded)
    view.unmount()
  })

  it('chargeFxEnabled 默认开启时按秒增量拉取扣费事件', async () => {
    const { view, chargeCalls } = mount({})
    await flush()
    await tick(3_500)
    expect(chargeCalls.length).toBeGreaterThanOrEqual(4)
    expect(chargeCalls[0]).toContain('/api/token-monitor/charge-events?since=0')
    view.unmount()
  })

  it('页面隐藏时暂停扣费与余额轮询，回到前台立刻补拉', async () => {
    const { view, balanceStarts, chargeCalls } = mount({ balancePollSeconds: 15 })
    await flush()
    const preHiddenBalance = balanceStarts.length
    const preHiddenCharge = chargeCalls.length
    const visibility = Object.getOwnPropertyDescriptor(document, 'visibilityState')
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    await tick(20_000)
    expect(balanceStarts.length).toBe(preHiddenBalance)
    expect(chargeCalls.length).toBe(preHiddenCharge)
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    await flush()
    // 回到前台：扣费与余额各自立刻补拉一次。
    expect(chargeCalls.length).toBeGreaterThan(preHiddenCharge)
    expect(balanceStarts.length).toBe(preHiddenBalance + 1)
    view.unmount()
    if (visibility) Object.defineProperty(document, 'visibilityState', visibility)
  })
})
