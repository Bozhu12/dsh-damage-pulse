import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TOKEN_MONITOR_SETTINGS,
  parseTokenMonitorSettings,
  parseTokenMonitorSettingsPatchRequest,
  parseTokenMonitorSettingsSnapshot,
} from '../src/index.ts'

/** 全默认快照（旧 v3 落盘数据缺新键时的形态）。 */
function legacySnapshot(): Record<string, unknown> {
  const settings = Object.fromEntries(Object.entries(DEFAULT_TOKEN_MONITOR_SETTINGS)
    .filter(([key]) => !['chargeFxEnabled', 'balancePollSeconds', 'planQuotaPollSeconds'].includes(key)))
  return { schemaVersion: 3, revision: 4, settings }
}

describe('polling preference settings (contract)', () => {
  it('defaults: chargeFxEnabled on, balance 15s, plan quota 60s', () => {
    expect(DEFAULT_TOKEN_MONITOR_SETTINGS.chargeFxEnabled).toBe(true)
    expect(DEFAULT_TOKEN_MONITOR_SETTINGS.balancePollSeconds).toBe(15)
    expect(DEFAULT_TOKEN_MONITOR_SETTINGS.planQuotaPollSeconds).toBe(60)
  })

  it('balancePollSeconds accepts 0 (manual-only) and the 5..3600 range', () => {
    expect(parseTokenMonitorSettings({ ...DEFAULT_TOKEN_MONITOR_SETTINGS, balancePollSeconds: 0 }).ok).toBe(true)
    expect(parseTokenMonitorSettings({ ...DEFAULT_TOKEN_MONITOR_SETTINGS, balancePollSeconds: 5 }).ok).toBe(true)
    expect(parseTokenMonitorSettings({ ...DEFAULT_TOKEN_MONITOR_SETTINGS, balancePollSeconds: 3600 }).ok).toBe(true)
    for (const bad of [-1, 1, 4, 3601, 7.5, Number.NaN]) {
      expect(parseTokenMonitorSettings({ ...DEFAULT_TOKEN_MONITOR_SETTINGS, balancePollSeconds: bad }).ok).toBe(false)
    }
  })

  it('planQuotaPollSeconds accepts 0 (manual-only) and the 15..86400 range', () => {
    expect(parseTokenMonitorSettings({ ...DEFAULT_TOKEN_MONITOR_SETTINGS, planQuotaPollSeconds: 0 }).ok).toBe(true)
    expect(parseTokenMonitorSettings({ ...DEFAULT_TOKEN_MONITOR_SETTINGS, planQuotaPollSeconds: 15 }).ok).toBe(true)
    expect(parseTokenMonitorSettings({ ...DEFAULT_TOKEN_MONITOR_SETTINGS, planQuotaPollSeconds: 86400 }).ok).toBe(true)
    for (const bad of [1, 14, 86401, 60.5, '60']) {
      expect(parseTokenMonitorSettings({ ...DEFAULT_TOKEN_MONITOR_SETTINGS, planQuotaPollSeconds: bad }).ok).toBe(false)
    }
  })

  it('chargeFxEnabled is a boolean-typed key', () => {
    expect(parseTokenMonitorSettings({ ...DEFAULT_TOKEN_MONITOR_SETTINGS, chargeFxEnabled: false }).ok).toBe(true)
    expect(parseTokenMonitorSettings({ ...DEFAULT_TOKEN_MONITOR_SETTINGS, chargeFxEnabled: 'off' }).ok).toBe(false)
  })

  it('legacy v3 snapshots missing the three keys parse with additive defaults', () => {
    const parsed = parseTokenMonitorSettingsSnapshot(legacySnapshot())
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.settings.chargeFxEnabled).toBe(DEFAULT_TOKEN_MONITOR_SETTINGS.chargeFxEnabled)
    expect(parsed.value.settings.balancePollSeconds).toBe(DEFAULT_TOKEN_MONITOR_SETTINGS.balancePollSeconds)
    expect(parsed.value.settings.planQuotaPollSeconds).toBe(DEFAULT_TOKEN_MONITOR_SETTINGS.planQuotaPollSeconds)
  })

  it('a partial patch may set exactly one polling key', () => {
    // patch 解析走 parseSettingsObject(partial=true)，单键补丁必须合法
    const result = parseTokenMonitorSettingsPatchRequest({ expectedRevision: 1, patch: { balancePollSeconds: 0 } })
    expect(result.ok).toBe(true)
  })
})
