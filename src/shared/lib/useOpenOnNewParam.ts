import {useEffect} from 'react'
import {useSearchParams} from 'react-router-dom'

/**
 * Opens a page's create form when it is reached with `?new=1`, letting the topbar's quick add and
 * the command palette start an action rather than only navigate to the page the action lives on.
 *
 * The param is cleared once consumed, so reloading or navigating back does not reopen the form.
 */
export function useOpenOnNewParam(setOpen:(open:boolean)=>void){
  const [params,setParams]=useSearchParams()
  useEffect(()=>{
    if(params.get('new')!=='1')return
    setOpen(true)
    const next=new URLSearchParams(params)
    next.delete('new')
    setParams(next,{replace:true})
  },[params,setParams,setOpen])
}
