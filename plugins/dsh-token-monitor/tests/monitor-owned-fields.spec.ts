import { describe, expect, it } from 'vitest'
import { TOKEN_MONITOR_OWNED_FIELDS, TOKEN_MONITOR_VOLATILE_FIELDS } from '../src/config-base.ts'

// 全局监控配置独立成组（monitor）：写入不挂模块安装态，模块级擦除不触及。
// 这两条消费语义都在 runtime-core（allowed 门控与 eraseData 分组），本文件锁定分组形状。
describe('global monitoring settings own their own field group', () => {
  const monitorKeys = ['chargeFxEnabled', 'balancePollSeconds', 'planQuotaPollSeconds']

  it('monitor 组持有全部三个全局键，且不出现在任何模块组里', () => {
    expect([...TOKEN_MONITOR_OWNED_FIELDS.monitor]).toEqual(monitorKeys)
    for (const [id, keys] of Object.entries(TOKEN_MONITOR_OWNED_FIELDS)) {
      if (id === 'monitor') continue
      for (const key of monitorKeys) expect(keys).not.toContain(key)
    }
  })

  it('plugin 级擦除的全量字段清单仍然覆盖三个全局键', () => {
    for (const key of monitorKeys) expect(TOKEN_MONITOR_VOLATILE_FIELDS).toContain(key)
  })
})
