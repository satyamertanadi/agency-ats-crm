import type { ReactNode } from 'react'
import { Panel } from './Page'

export interface ChartCardProps {title:string;description:string;children:ReactNode;summary:ReactNode;action?:ReactNode}

export function ChartCard({title,description,children,summary,action}:ChartCardProps){
  return <Panel className="chart-card" title={title} subtitle={description} action={action} elevation="raised"><div className="chart-visual" aria-hidden="true">{children}</div><div className="sr-only chart-summary">{summary}</div></Panel>
}

/* Recharts renders its default tooltip with an inline white background and a grey border, which CSS
 * cannot override without !important -- and which reads as a lit panel floating over a dark board in
 * the dark theme. Passing the styling as props keeps it token-driven and themed in both directions.
 *
 * Exported from here so every chart in the product uses one tooltip rather than each remembering. */
export const chartTooltipStyle={
  contentStyle:{
    background:'var(--color-surface)',
    border:'1px solid var(--color-line)',
    borderRadius:'var(--radius-sm)',
    boxShadow:'var(--shadow-sm)',
    color:'var(--color-ink)',
    fontSize:'var(--text-xs)',
  },
  labelStyle:{color:'var(--color-ink)',fontWeight:600},
  itemStyle:{color:'var(--color-ink-soft)'},
  cursor:{fill:'var(--color-canvas-deep)'},
} as const
