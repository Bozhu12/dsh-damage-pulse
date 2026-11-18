// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_TOKEN_MONITOR_SETTINGS } from '@deepseek-ai/dsh-token-monitor-contract'
import { MonitorSettingsTab } from '../src/client/MonitorSettingsTab.tsx'
import { zh, type DetailTranslate } from '../src/client/detail-locales.ts'

const t: DetailTranslate = (key, values) => Object.entries(values ?? {}).reduce((text, [name, value]) => text.replace('{' + name + '}', String(value)), zh[key] as string)

const snapshot = { schemaVersion: 3, revision: 7, settings: { ...DEFAULT_TOKEN_MONITOR_SETTINGS, chargeFxEnabled: true, balancePollSeconds: 15, planQuotaPollSeconds: 60 } }

let patches: Array<Record<string, unknown>> = []
beforeEach(() => {
  patches = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('settings') && init?.method === 'PATCH') {
      const body = JSON.parse(String(init.body)) as { expectedRevision: number; patch: Record<string, unknown> }
      patches.push(body.patch)
      return new Response(JSON.stringify({ schemaVersion: 3, revision: body.expectedRevision + 1, settings: { ...snapshot.settings, ...body.patch } }), { status: 200 })
    }
    return new Response(JSON.stringify(snapshot), { status: 200 })
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('MonitorSettingsTab（插件设置页的全局监控页签）', () => {
  it('渲染扣费动效开关与两个周期输入，初值来自服务端设置', async () => {
    const view = render(<MonitorSettingsTab t={t} />)
    await act(async () => {})
    expect(view.getByRole('switch', { name: '扣费动效' }).getAttribute('aria-checked')).toBe('true')
    expect((view.getByLabelText(/余额自动刷新/) as HTMLInputElement).value).toBe('15')
    expect((view.getByLabelText(/Plan 额度自动刷新/) as HTMLInputElement).value).toBe('60')
    expect(view.getByText('全局监控机制：扣费动效与余额/套餐额度的自动刷新周期。改动即保存；填 0 = 仅手动刷新（余额卡上的 ↻ 与额度页签的「立即刷新」）。页面隐藏时自动暂停轮询。')).toBeTruthy()
  })

  it('切换扣费动效立即 PATCH，并反馈已保存', async () => {
    const view = render(<MonitorSettingsTab t={t} />)
    await act(async () => {})
    fireEvent.click(view.getByRole('switch', { name: '扣费动效' }))
    await act(async () => {})
    expect(patches).toEqual([{ chargeFxEnabled: false }])
    expect(view.getByRole('switch', { name: '扣费动效' }).getAttribute('aria-checked')).toBe('false')
    expect(view.getByText('已保存')).toBeTruthy()
  })

  it('余额周期改 0 回车提交，非法值不落盘并提示', async () => {
    const view = render(<MonitorSettingsTab t={t} />)
    await act(async () => {})
    const input = view.getByLabelText(/余额自动刷新/) as HTMLInputElement
    fireEvent.change(input, { target: { value: '0' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await act(async () => {})
    expect(patches).toEqual([{ balancePollSeconds: 0 }])
    fireEvent.change(input, { target: { value: '3' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await act(async () => {})
    expect(patches).toHaveLength(1)
    expect(view.getByText('余额刷新周期必须是 0，或 5 到 3600 的整数秒；这项改动没有保存。')).toBeTruthy()
  })
})
