import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from './Button'

/* Page numbers, not just Previous/Next.
 *
 * The list pages shipped prev/next only, so reaching page 26 of a 30-page result took 25 clicks and
 * there was no way to tell how far through a result set you were beyond reading "Page 4 of 30". Direct
 * page buttons make the common jumps (back to the start, on to the end) one click.
 *
 * Windowing keeps the control a fixed width regardless of page count: first and last are always
 * offered, a window of neighbours around the current page, and ellipses standing in for the gaps. */
export function Pagination({page,pages,onPage,busy=false,label='Pagination'}:{
  /* Zero-based, matching the `page` URL param and the RPC offset arithmetic the callers already do. */
  page:number
  pages:number
  onPage:(page:number)=>void
  /* Disables everything mid-fetch so a double click cannot queue two page changes. */
  busy?:boolean
  label?:string
}){
  if(pages<=1)return null
  return <nav className="pagination" aria-label={label}>
    <Button variant="secondary" size="sm" disabled={page===0||busy} leadingIcon={<ChevronLeft size={14}/>} onClick={()=>onPage(page-1)}>Previous</Button>
    <span className="pagination-pages">
      {pageWindow(page,pages).map((entry,index)=>entry==='gap'
        ?<span key={`gap-${index}`} className="pagination-gap" aria-hidden="true">…</span>
        :<button key={entry} type="button" className={entry===page?'pagination-page active':'pagination-page'} disabled={busy}
          aria-label={`Page ${entry+1}`} aria-current={entry===page?'page':undefined} onClick={()=>onPage(entry)}>{entry+1}</button>)}
    </span>
    <Button variant="secondary" size="sm" disabled={page+1>=pages||busy} trailingIcon={<ChevronRight size={14}/>} onClick={()=>onPage(page+1)}>Next</Button>
  </nav>
}

/* Exported for its own unit test: the windowing is the only logic here worth asserting, and asserting
 * it through rendered buttons would test React more than the arithmetic. */
export function pageWindow(page:number,pages:number,span=1):(number|'gap')[]{
  const wanted=new Set<number>([0,pages-1])
  for(let offset=-span;offset<=span;offset+=1){const candidate=page+offset;if(candidate>=0&&candidate<pages)wanted.add(candidate)}
  const ordered=[...wanted].sort((a,b)=>a-b)
  const out:(number|'gap')[]=[]
  ordered.forEach((value,index)=>{
    // A single skipped page renders as itself rather than an ellipsis -- an "…" standing in for one
    // number is both wider and less useful than the number.
    const previous=index>0?ordered[index-1]:undefined
    if(previous!==undefined){if(value-previous===2)out.push(value-1);else if(value-previous>2)out.push('gap')}
    out.push(value)
  })
  return out
}
