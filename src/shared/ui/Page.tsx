import type { ReactNode } from 'react'
import { lookup, type StatusMeta, type Tone } from '../lib/status'

export type { Tone }

export interface PageProps {title:string;eyebrow?:string;description?:string;breadcrumbs?:ReactNode;metadata?:ReactNode;actions?:ReactNode;tabs?:ReactNode;children:ReactNode;className?:string}
export function Page({ title, eyebrow, description, breadcrumbs, metadata, actions, tabs, children, className='' }: PageProps) {
  return <main className={`page ${className}`.trim()}>
    {breadcrumbs&&<div className="breadcrumbs">{breadcrumbs}</div>}
    <header className="page-header"><div className="page-heading">{eyebrow&&<p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1>{description&&<p className="page-description">{description}</p>}{metadata&&<div className="page-metadata">{metadata}</div>}</div>{actions&&<div className="page-actions">{actions}</div>}</header>
    {tabs&&<div className="page-tabs">{tabs}</div>}
    <div className="page-content">{children}</div>
  </main>
}
export interface PanelProps {title?:string;subtitle?:string;action?:ReactNode;children:ReactNode;className?:string;elevation?:'flat'|'raised';tone?:'default'|'soft'|'dark';density?:'compact'|'comfortable';padding?:'none'|'sm'|'md'|'lg'}
export function Panel({ title, subtitle, action, children, className='', elevation='flat', tone='default', density='comfortable', padding='none' }: PanelProps) { return <section className={`panel panel-${elevation} panel-${tone} panel-${density} panel-padding-${padding} ${className}`.trim()}>{(title||subtitle||action)&&<header className="panel-header"><div>{title&&<h2>{title}</h2>}{subtitle&&<p>{subtitle}</p>}</div>{action}</header>}<div className="panel-body">{children}</div></section> }
export function Badge({ children, tone='neutral' }: {children:ReactNode;tone?:Tone}) { return <span className={`badge badge-${tone}`}>{children}</span> }

/* Renders an already-resolved StatusMeta. Derived statuses use this directly -- an invitation's
 * state comes from precedence across three columns, and a pilot indicator from a nullable helper,
 * so neither has a map to key into. */
export function MetaBadge({ meta }: {meta:StatusMeta}) { return <Badge tone={meta.tone}>{meta.label}</Badge> }

/* Renders a domain status through its map in status.ts, so a status's tone and wording are decided
 * in one place instead of by a ternary at each call site. Takes a map rather than a bare status
 * because the same value ('cancelled', 'failed', 'active') means different things on different
 * entities. Both of these reuse Badge -- they are lookups, not new components. */
export function StatusBadge({ map, value }: {map:Partial<Record<string,StatusMeta>>;value:string|null|undefined}) { return <MetaBadge meta={lookup(map,value)}/> }
