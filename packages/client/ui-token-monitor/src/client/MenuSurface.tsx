/** Menu material: the bundled public primitives build does not export MenuSurface,
 * so the styled fallback div below is the path that runs today. Importing the
 * primitives barrel here would pull in the whole markdown/shiki stack (~2.5MB) for nothing. */
import { forwardRef, type ComponentPropsWithoutRef } from 'react'
import css from './MenuSurface.module.css'

export const MenuSurface = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<'div'>>(function MenuSurface(props, ref) {
  return <div {...props} ref={ref} data-menu-material="translucent" className={[css.surface, props.className].filter(Boolean).join(' ')} />
})
