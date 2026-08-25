import type { ReactNode } from 'react'
import { AlertCircle, Inbox, LoaderCircle } from 'lucide-react'
import { Button } from './Button'

export function LoadingState({ label='Loading…' }: {label?:string}) { return <div className="state"><LoaderCircle className="spin"/><p>{label}</p></div> }
export function EmptyState({ title, description, action }: {title:string;description:string;action?:ReactNode}) { return <div className="state"><Inbox/><h3>{title}</h3><p>{description}</p>{action}</div> }
export function ErrorState({ error, retry }: {error:unknown;retry?:()=>void}) { const message=error instanceof Error?error.message:'Something went wrong.'; return <div className="state state-error"><AlertCircle/><h3>Could not load this view</h3><p>{message}</p>{retry&&<Button onClick={retry}>Try again</Button>}</div> }

/* Skeletons exist to hold the shape of the content that is coming, so the page does not jump when
 * it lands. They take the same row/column counts the real view will render -- a skeleton that
 * guesses a different size is a layout shift with extra steps, which is what the centred spinner
 * these replace already did.
 *
 * Every skeleton is aria-hidden and paired with a visually-hidden live message: a screen reader
 * should hear "Loading candidates" once, not read out a wall of decorative placeholder boxes. */
export function Skeleton({width='100%',height=12,radius}:{width?:string|number;height?:string|number;radius?:string}) {
  return <span className="skeleton" style={{width,height,borderRadius:radius}} aria-hidden="true"/>
}

export function TableSkeleton({rows=6,columns=4,label='Loading…'}:{rows?:number;columns?:number;label?:string}) {
  // First column is the record name and reads widest; the rest share what is left evenly, which
  // matches how the real tables in this app are weighted.
  const template=`minmax(0, 2.2fr) ${Array.from({length:Math.max(columns-1,0)},()=>'minmax(0, 1fr)').join(' ')}`
  return <div className="skeleton-table" role="status" aria-busy="true">
    <span className="sr-only">{label}</span>
    {Array.from({length:rows},(_unused,row)=>(
      <div className="skeleton-row" style={{gridTemplateColumns:template}} key={row}>
        {Array.from({length:columns},(_cell,column)=>(
          <Skeleton height={column===0?14:11} width={column===0?'70%':`${55+((row+column)%3)*12}%`} key={column}/>
        ))}
      </div>
    ))}
  </div>
}

export function BoardSkeleton({columns=5,cards=3,label='Loading pipeline…'}:{columns?:number;cards?:number;label?:string}) {
  return <div className="skeleton-board" role="status" aria-busy="true">
    <span className="sr-only">{label}</span>
    {Array.from({length:columns},(_unused,column)=>(
      <div className="skeleton-board-column" key={column}>
        <Skeleton height={12} width="55%"/>
        <div className="skeleton-cards">
          {/* Columns taper the way a real funnel does, so the placeholder does not imply an
            * evenly-loaded pipeline that is about to redraw as anything but. */}
          {Array.from({length:Math.max(cards-column,1)},(_card,card)=><Skeleton height={54} radius="var(--radius-sm)" key={card}/>)}
        </div>
      </div>
    ))}
  </div>
}

/* The shape of a record page while its primary query is in flight: summary strip, then the section
 * stack. Paired with the real <Page> header (title, breadcrumbs, tabs), which the detail routes now
 * render immediately rather than withholding behind the spinner -- so what arrives is the body
 * filling in, not the whole workspace appearing at once.
 *
 * `sections` should match what the route actually renders below the strip. Getting it wrong is a
 * layout shift with extra steps, which is exactly what the centred spinner this replaces already
 * did. */
export function DetailSkeleton({sections=3,label='Loading record…'}:{sections?:number;label?:string}) {
  return <div className="skeleton-detail" role="status" aria-busy="true">
    <span className="sr-only">{label}</span>
    <div className="skeleton-detail-summary">
      <Skeleton height={44} width={44} radius="var(--radius-circle)"/>
      <div className="skeleton-detail-summary-text">
        <Skeleton height={15} width="38%"/>
        <Skeleton height={12} width="56%"/>
      </div>
    </div>
    {Array.from({length:sections},(_unused,section)=>(
      <div className="skeleton-detail-section" key={section}>
        <Skeleton height={13} width="24%"/>
        <Skeleton height={11} width={`${78-section*9}%`}/>
        <Skeleton height={11} width={`${64-section*7}%`}/>
      </div>
    ))}
  </div>
}
