import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { DEFAULT_TOKEN_MONITOR_SETTINGS, type TokenMonitorSettings } from '@deepseek-ai/dsh-token-monitor-contract'
import type { DetailTranslate } from './detail-locales.ts'
import { createTokenMonitorSettingsApi } from './settingsApi.ts'

/**
 * 插件设置页（Host 设置 → 插件 → 余额监控）的全局监控配置页签。
 * 这里只放「全局监控机制」的开关与周期：扣费动效、余额/额度轮询周期。
 * 模块私有的设置（提醒规则、通知渠道）留在余额卡菜单的面板里，并按模块安装状态显隐。
 */
export function MonitorSettingsTab({ t }: { t: DetailTranslate }): ReactNode {
  const [chargeFxEnabled, setChargeFxEnabled] = useState(DEFAULT_TOKEN_MONITOR_SETTINGS.chargeFxEnabled)
  const [balanceSeconds, setBalanceSeconds] = useState(String(DEFAULT_TOKEN_MONITOR_SETTINGS.balancePollSeconds))
  const [quotaSeconds, setQuotaSeconds] = useState(String(DEFAULT_TOKEN_MONITOR_SETTINGS.planQuotaPollSeconds))
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [error, setError] = useState<string>()
  const serverRef = useRef<{ revision: number; settings: TokenMonitorSettings }>()
  const focusedInputRef = useRef<'balance' | 'quota'>()
  const mountedRef = useRef(true)
  // 同实例持有：settingsApi 的良性冲突自动重试依赖实例内的 observed 缓存。
  const apiRef = useRef<ReturnType<typeof createTokenMonitorSettingsApi>>()
  if (apiRef.current === undefined) apiRef.current = createTokenMonitorSettingsApi()
  const api = apiRef.current

  /** 读取设置；输入框聚焦时不覆盖，避免打断输入。 */
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const snapshot = await api.get(signal)
      if (!mountedRef.current || signal?.aborted) return
      serverRef.current = { revision: snapshot.revision, settings: snapshot.settings }
      setChargeFxEnabled(snapshot.settings.chargeFxEnabled)
      if (focusedInputRef.current !== 'balance') setBalanceSeconds(String(snapshot.settings.balancePollSeconds))
      if (focusedInputRef.current !== 'quota') setQuotaSeconds(String(snapshot.settings.planQuotaPollSeconds))
    } catch { /* 读取失败保留现值；下一次 focus 或重进页签会重试。 */ }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    const controller = new AbortController()
    void refresh(controller.signal)
    const onFocus = () => void refresh()
    window.addEventListener('focus', onFocus)
    return () => {
      mountedRef.current = false
      controller.abort()
      window.removeEventListener('focus', onFocus)
    }
  }, [refresh])

  const commit = useCallback(async (patch: Partial<TokenMonitorSettings>) => {
    const baseline = serverRef.current
    if (baseline === undefined) {
      // 初始快照未回来（或设置路由不可用）：明确提示等待，而不是静默丢弃改动。
      setSaveState('error')
      setError(t('monitorTabLoading'))
      return
    }
    if (Object.keys(patch).length === 0) return
    // 与服务端已确认值一致时跳过，避免失焦即保存造成空 revision 前进。
    const changed = Object.entries(patch).some(([key, value]) => baseline.settings[key as keyof TokenMonitorSettings] !== value)
    if (!changed) return
    setSaveState('saving')
    try {
      const snapshot = await api.patch({ expectedRevision: baseline.revision, patch })
      if (!mountedRef.current) return
      serverRef.current = { revision: snapshot.revision, settings: snapshot.settings }
      setSaveState('saved')
      setError(undefined)
    } catch (cause) {
      if (!mountedRef.current) return
      setSaveState('error')
      // 版本冲突（别处同时保存）时立刻重读最新快照，下一次提交就能正常落盘；
      // 模块未安装的网关拒绝给友好文案，其余透出原始信息。
      if (cause instanceof Error && cause.message.includes('MODULE_NOT_INSTALLED')) setError(t('monitorTabModuleMissing'))
      else setError(cause instanceof Error ? cause.message : t('monitorTabSaveFailed'))
      void refresh()
    }
  }, [t])

  const toggleChargeFx = useCallback(() => {
    // updater 必须保持纯函数（StrictMode 会双调），副作用放在外层。
    const next = !chargeFxEnabled
    setChargeFxEnabled(next)
    void commit({ chargeFxEnabled: next })
  }, [chargeFxEnabled, commit])

  /** 失焦或回车时校验并提交；无效值提示且不落盘（与余额卡面板同一套边界）。 */
  const commitInput = useCallback((field: 'balance' | 'quota', raw: string) => {
    const value = Number(raw.trim())
    const valid = raw.trim() !== '' && Number.isInteger(value)
      && (field === 'balance' ? value === 0 || (value >= 5 && value <= 3600) : value === 0 || (value >= 15 && value <= 86400))
    if (!valid) {
      setSaveState('error')
      setError(t(field === 'balance' ? 'monitorTabBalanceInvalid' : 'monitorTabQuotaInvalid'))
      void refresh()
      return
    }
    void commit(field === 'balance' ? { balancePollSeconds: value } : { planQuotaPollSeconds: value })
  }, [commit, refresh, t])

  const statusText = saveState === 'saving' ? t('monitorTabSaving')
    : saveState === 'saved' ? t('monitorTabSaved')
    : saveState === 'error' ? (error ?? t('monitorTabSaveFailed'))
    : null

  return (
    <div className="token-monitor-monitor-tab" style={{ maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 12, color: 'var(--dsw-alias-label-primary)' }}>
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: 'var(--dsw-alias-label-tertiary)' }}>{t('monitorTabIntro')}</p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <label htmlFor="tm-monitor-charge-fx" style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}>
          <span style={{ display: 'block', fontSize: 14, fontWeight: 650 }}>{t('monitorTabChargeFx')}</span>
          <span style={{ display: 'block', fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' }}>{t('monitorTabChargeFxHint')}</span>
        </label>
        <button
          id="tm-monitor-charge-fx"
          type="button"
          role="switch"
          aria-label={t('monitorTabChargeFx')}
          aria-checked={chargeFxEnabled}
          onClick={toggleChargeFx}
          style={{
            position: 'relative', width: 42, height: 24, flex: '0 0 auto', padding: 0,
            border: '1px solid var(--dsw-alias-monitor-switch-border)', borderRadius: 999,
            background: chargeFxEnabled ? 'var(--dsw-alias-monitor-accent-gradient)' : 'var(--dsw-alias-monitor-switch-off)',
            cursor: 'pointer', transition: 'background 160ms ease',
          }}
        >
          <span aria-hidden="true" style={{
            position: 'absolute', top: 2, left: chargeFxEnabled ? 20 : 2, width: 18, height: 18, borderRadius: '50%',
            background: 'var(--dsw-alias-monitor-thumb)', boxShadow: 'var(--dsw-alias-monitor-thumb-shadow)', transition: 'left 160ms ease',
          }} />
        </button>
      </div>

      {([
        ['balance', t('monitorTabBalance'), t('monitorTabBalanceUnit'), balanceSeconds, setBalanceSeconds, t('monitorTabBalanceHint')],
        ['quota', t('monitorTabQuota'), t('monitorTabQuotaUnit'), quotaSeconds, setQuotaSeconds, t('monitorTabQuotaHint')],
      ] as const).map(([field, label, unit, value, setValue, hint]) => (
        <label key={field} htmlFor={`tm-monitor-${field}`} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 14, fontWeight: 650 }}>{label}</span>
            <span style={{ display: 'block', fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' }}>{hint}</span>
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flex: '0 0 auto' }}>
            <input
              id={`tm-monitor-${field}`}
              inputMode="numeric"
              value={value}
              onFocus={() => { focusedInputRef.current = field }}
              onBlur={() => { focusedInputRef.current = undefined; commitInput(field, value) }}
              onChange={event => { field === 'balance' ? setBalanceSeconds(event.currentTarget.value) : setQuotaSeconds(event.currentTarget.value); setSaveState('idle') }}
              onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commitInput(field, value) } }}
              style={{
                width: 76, padding: '5px 8px', fontSize: 14, fontVariantNumeric: 'tabular-nums',
                color: 'inherit', background: 'var(--dsw-alias-monitor-button, transparent)',
                border: '1px solid var(--dsw-alias-monitor-button-border, var(--dsw-alias-border-l2))', borderRadius: 8,
              }}
            />
            <span style={{ fontSize: 13, color: 'var(--dsw-alias-label-tertiary)' }}>{unit}</span>
          </span>
        </label>
      ))}

      <p role="status" style={{ margin: 0, minHeight: 18, fontSize: 12, lineHeight: 1.5, color: saveState === 'error' ? 'var(--dsw-alias-monitor-error, #e5484d)' : 'var(--dsw-alias-label-tertiary)' }}>
        {statusText ?? ''}
      </p>
    </div>
  )
}

/**
 * 插件详情页（插件面板 → 本插件）的区块壳：宿主把该插槽渲染到每个插件的详情页，
 * 组件按 subject.id 自行过滤，只在本插件页面上出现。
 */
interface DetailSubject {
  kind?: string
  id?: string
  pkg?: string | { name?: string }
  row?: string | { moduleName?: string }
}

/** 宿主三种详情变体的 subject：item/{id}、bundle/{pkg:{name}}、row/{row:{moduleName}}。 */
function subjectIsOurs(subject?: DetailSubject): boolean {
  if (subject === undefined) return false
  const pkgName = typeof subject.pkg === 'string' ? subject.pkg : subject.pkg?.name
  const rowModule = typeof subject.row === 'string' ? subject.row : subject.row?.moduleName
  return subject.id === 'dsh-damage-pulse' || pkgName === 'dsh-damage-pulse' || rowModule === 'dsh-token-monitor'
}

export function MonitorDetailSection({ subject, t }: { subject?: DetailSubject; t: DetailTranslate }): ReactNode {
  if (!subjectIsOurs(subject)) return null
  return (
    <section
      data-token-monitor-monitor-settings=""
      aria-label={t('monitorTabLabel')}
      style={{
        maxWidth: 760, padding: 16, borderRadius: 14,
        border: '1px solid var(--dsw-alias-monitor-border, var(--dsw-alias-border-l2))',
        background: 'var(--dsw-alias-monitor-panel, transparent)',
      }}
    >
      <h4 style={{ margin: '0 0 10px', fontSize: 15, fontWeight: 650, color: 'var(--dsw-alias-label-primary)' }}>{t('monitorTabLabel')}</h4>
      <MonitorSettingsTab t={t} />
    </section>
  )
}
