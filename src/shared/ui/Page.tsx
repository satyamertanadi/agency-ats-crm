import type { ReactNode } from 'react'

export function Page({ title, eyebrow, description, actions, children }: {title:string;eyebrow?:string;description?:string;actions?:ReactNode;children:ReactNode}) {
  return <main className="page"><header className="page-header"><div>{eyebrow&&<p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1>{description&&<p className="page-description">{description}</p>}</div><div className="page-actions">{actions}</div></header>{children}</main>
}
export function Panel({ title, action, children, className='' }: {title?:string;action?:ReactNode;children:ReactNode;className?:string}) { return <section className={`panel ${className}`}>{(title||action)&&<header className="panel-header"><h2>{title}</h2>{action}</header>}<div className="panel-body">{children}</div></section> }
export function Badge({ children, tone='neutral' }: {children:ReactNode;tone?:'neutral'|'good'|'warn'|'bad'|'info'}) { return <span className={`badge badge-${tone}`}>{children}</span> }

