import type { ReactNode } from 'react'

/* The two-or-three-way "which view am I in" switch, hand-written in five places (pipeline density,
 * Clients list/board, Today my-work/team, referral status filter, candidate add mode) against the
 * shared `.segmented-control` CSS.
 *
 * It is a radiogroup, not a toolbar of buttons: the options are mutually exclusive views of one
 * setting, which is what `role="radio"` + `aria-checked` conveys and what a row of plain buttons does
 * not. Same one-Tab-stop-plus-arrows model as Tabs, for the same reason. */
export function SegmentedControl<T extends string>({options,value,onChange,label,className=''}:{
  options:readonly {id:T;label:ReactNode}[]
  value:T
  onChange:(id:T)=>void
  label:string
  className?:string
}){
  const move=(delta:number)=>{
    const index=options.findIndex((option)=>option.id===value)
    if(index<0)return
    const next=options[(index+delta+options.length)%options.length]
    if(next)onChange(next.id)
  }
  return <div className={['segmented-control',className].filter(Boolean).join(' ')} role="radiogroup" aria-label={label} onKeyDown={(event)=>{
    if(event.key==='ArrowRight'||event.key==='ArrowDown'){event.preventDefault();move(1)}
    else if(event.key==='ArrowLeft'||event.key==='ArrowUp'){event.preventDefault();move(-1)}
  }}>
    {options.map((option)=><button key={option.id} type="button" role="radio" aria-checked={option.id===value}
      tabIndex={option.id===value?0:-1}
      className={option.id===value?'active':''} onClick={()=>onChange(option.id)}>{option.label}</button>)}
  </div>
}
