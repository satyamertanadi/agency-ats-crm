import {createContext,useCallback,useContext,useEffect,useMemo,useRef,useState,type ReactNode} from 'react'
import {AlertCircle,CheckCircle2,Info,X} from 'lucide-react'

export type ToastTone='success'|'error'|'info'
export interface ToastAction {label:string;onClick:()=>void}
export interface ToastInput {tone?:ToastTone;message:string;detail?:string;action?:ToastAction;duration?:number}
interface ToastRecord extends Required<Pick<ToastInput,'tone'|'message'>>{id:string;detail?:string;action?:ToastAction;duration:number;seq:number}

/* Errors stay put roughly twice as long as confirmations: a success line only has to be noticed,
 * an error has to be read and often acted on. Both remain dismissible, and an error carrying a
 * recovery action never auto-dismisses -- retracting the only route back out of a failure while
 * the user is still reading it is how a mutation failure turns into silent data loss.
 *
 * A success toast can carry an action too, and when it does it is almost always Undo -- so it gets
 * the error timing rather than the confirmation timing. Four seconds is enough to notice that a card
 * moved; it is not enough to notice, realise it was the wrong card, and reach the button. */
const defaultDuration=(tone:ToastTone,action?:ToastAction)=>action?(tone==='error'?0:8000):(tone==='error'?8000:4000)
const MAX_VISIBLE=4

interface ToastContextValue {
  push:(input:ToastInput)=>string
  success:(message:string,detail?:string,action?:ToastAction)=>string
  error:(error:unknown,detail?:string,action?:ToastAction)=>string
  info:(message:string,detail?:string)=>string
  dismiss:(id:string)=>void
}

const ToastContext=createContext<ToastContextValue|null>(null)

export const toastMessage=(error:unknown)=>error instanceof Error?error.message:typeof error==='string'?error:'Something went wrong.'

export function ToastProvider({children}:{children:ReactNode}){
  const [toasts,setToasts]=useState<ToastRecord[]>([])
  const timers=useRef(new Map<string,ReturnType<typeof setTimeout>>())
  const counter=useRef(0)

  const clearTimer=useCallback((id:string)=>{const timer=timers.current.get(id);if(timer){clearTimeout(timer);timers.current.delete(id)}},[])
  const dismiss=useCallback((id:string)=>{clearTimer(id);setToasts((current)=>current.filter((toast)=>toast.id!==id))},[clearTimer])
  const arm=useCallback((id:string,duration:number)=>{clearTimer(id);if(duration>0)timers.current.set(id,setTimeout(()=>dismiss(id),duration))},[clearTimer,dismiss])

  const push=useCallback((input:ToastInput)=>{
    const tone=input.tone??'success'
    const duration=input.duration??defaultDuration(tone,input.action)
    let id=''
    setToasts((current)=>{
      /* Dedupe by what the user actually reads. Bulk actions fire one mutation per row, so a
       * ten-candidate bulk tag used to stack ten identical lines and push everything else off
       * screen; an identical live toast is refreshed in place instead of duplicated. */
      const existing=current.find((toast)=>toast.tone===tone&&toast.message===input.message&&toast.detail===input.detail)
      if(existing){id=existing.id;arm(existing.id,duration);return current}
      id=`toast-${++counter.current}`
      const record:ToastRecord={id,tone,message:input.message,detail:input.detail,action:input.action,duration,seq:counter.current}
      arm(id,duration)
      // Oldest fall off the top so the newest -- the one describing what just happened -- is never
      // the one hidden by the cap.
      const next=[...current,record]
      return next.length>MAX_VISIBLE?next.slice(next.length-MAX_VISIBLE):next
    })
    return id
  },[arm])

  useEffect(()=>{const pending=timers.current;return()=>{pending.forEach((timer)=>clearTimeout(timer));pending.clear()}},[])

  const value=useMemo<ToastContextValue>(()=>({
    push,
    success:(message,detail,action)=>push({tone:'success',message,detail,action}),
    error:(error,detail,action)=>push({tone:'error',message:toastMessage(error),detail,action}),
    info:(message,detail)=>push({tone:'info',message,detail}),
    dismiss,
  }),[push,dismiss])

  return <ToastContext.Provider value={value}>{children}<ToastViewport toasts={toasts} onDismiss={dismiss}/></ToastContext.Provider>
}

const toneIcon={success:CheckCircle2,error:AlertCircle,info:Info}
const toneLabel={success:'Success',error:'Error',info:'Notice'}

function ToastViewport({toasts,onDismiss}:{toasts:ToastRecord[];onDismiss:(id:string)=>void}){
  return <div className="toast-viewport">
    {/* Successes announce politely; failures interrupt. Two regions rather than one because a
      * single region cannot carry both politeness levels. */}
    <div aria-live="polite" aria-relevant="additions" className="toast-stack">
      {toasts.filter((toast)=>toast.tone!=='error').map((toast)=><ToastRow toast={toast} onDismiss={onDismiss} key={toast.id}/>)}
    </div>
    <div aria-live="assertive" aria-relevant="additions" role="alert" className="toast-stack">
      {toasts.filter((toast)=>toast.tone==='error').map((toast)=><ToastRow toast={toast} onDismiss={onDismiss} key={toast.id}/>)}
    </div>
  </div>
}

function ToastRow({toast,onDismiss}:{toast:ToastRecord;onDismiss:(id:string)=>void}){
  const Icon=toneIcon[toast.tone]
  return <div className={`toast toast-${toast.tone}`}>
    <Icon size={17} aria-hidden="true"/>
    <div className="toast-body">
      <strong><span className="sr-only">{toneLabel[toast.tone]}: </span>{toast.message}</strong>
      {toast.detail&&<p>{toast.detail}</p>}
      {toast.action&&<button type="button" className="toast-action" onClick={()=>{toast.action!.onClick();onDismiss(toast.id)}}>{toast.action.label}</button>}
    </div>
    <button type="button" className="toast-close" onClick={()=>onDismiss(toast.id)} aria-label={`Dismiss: ${toast.message}`}><X size={15}/></button>
  </div>
}

export function useToast(){
  const context=useContext(ToastContext)
  if(!context)throw new Error('useToast must be used inside a ToastProvider.')
  return context
}
