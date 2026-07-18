import {useEffect} from 'react'
import {useSearchParams} from 'react-router-dom'

/**
 * Opens a page's create form when it is reached with `?new=1`, letting the topbar's quick add and
 * the command palette start an action rather than only navigate to the page the action lives on.
 *
 * The param is cleared once consumed, so reloading or navigating back does not reopen the form.
 *
 * `prefill` receives the same params and names the extra keys it consumed, so a caller can arrive
 * with context already chosen -- the BD board's "won account, create the first job" step hands over
 * the company rather than making the consultant pick a client they just came from. Consumed keys are
 * cleared alongside `new` so a back-navigation does not silently re-apply them.
 */
export function useOpenOnNewParam(setOpen:(open:boolean)=>void,prefill?:(params:URLSearchParams)=>string[]){
  const [params,setParams]=useSearchParams()
  useEffect(()=>{
    if(params.get('new')!=='1')return
    setOpen(true)
    const consumed=prefill?.(params)??[]
    const next=new URLSearchParams(params)
    next.delete('new')
    for(const key of consumed)next.delete(key)
    setParams(next,{replace:true})
  },[params,setParams,setOpen,prefill])
}
