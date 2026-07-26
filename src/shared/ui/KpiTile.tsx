import type { ReactNode } from 'react'

/* The metric tile, hand-written in four places (Clients, Reports, Scorecard, and the styleguide) with
 * enough drift between them that the styleguide's specimen showed an icon slot no product page used.
 *
 * `.kpi-grid` was pinned to `repeat(6, ...)`, which is why Clients' five tiles leave a hole at wide
 * widths -- KpiGrid below uses auto-fit so any count fills the row. */
export function KpiTile({label,value,tone,definition,icon}:{
  label:string
  value:ReactNode
  /* 'alert' draws the bad-tone border, for a number that is a problem when non-zero (overdue tasks,
   * accounts needing attention). Left undefined for neutral facts. */
  tone?:'alert'
  /* The metric's definition, shown as a native tooltip. Reports and Scorecard already do this from
   * `metricDefinitions` so a consultant and their manager read the same number the same way. */
  definition?:string
  icon?:ReactNode
}){
  return <div className={['kpi',tone==='alert'?'kpi-alert':''].filter(Boolean).join(' ')} title={definition}>
    {icon&&<span aria-hidden="true">{icon}</span>}
    <div><p>{label}</p><strong>{value}</strong></div>
  </div>
}

export function KpiGrid({children}:{children:ReactNode}){return <div className="kpi-grid">{children}</div>}
