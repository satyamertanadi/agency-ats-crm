import type { ReactNode } from 'react'
import { Panel } from './Page'

export interface ChartCardProps {title:string;description:string;children:ReactNode;summary:ReactNode;action?:ReactNode}

export function ChartCard({title,description,children,summary,action}:ChartCardProps){
  return <Panel className="chart-card" title={title} subtitle={description} action={action} elevation="raised"><div className="chart-visual" aria-hidden="true">{children}</div><div className="sr-only chart-summary">{summary}</div></Panel>
}
