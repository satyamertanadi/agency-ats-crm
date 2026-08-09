import type {HandoffSession} from './messages'

const EXPIRY_SKEW_SECONDS=30

type SessionStorage=Pick<Storage,'length'|'key'|'getItem'>

function toHandoffSession(value:unknown,nowSeconds:number):HandoffSession|null{
  if(!value||typeof value!=='object')return null
  const candidate=value as {access_token?:unknown;expires_at?:unknown;currentSession?:unknown;session?:unknown}
  const session=candidate.access_token?candidate:(candidate.currentSession??candidate.session)
  if(!session||typeof session!=='object')return null
  const {access_token,expires_at}=session as {access_token?:unknown;expires_at?:unknown}
  if(typeof access_token!=='string'||!access_token||typeof expires_at!=='number'||!Number.isFinite(expires_at))return null
  if(expires_at<=nowSeconds+EXPIRY_SKEW_SECONDS)return null
  return {access_token,expires_at}
}

// The single point of coupling to how the SPA persists its Supabase session. supabase-js v2 stores the
// session as JSON in localStorage under a key shaped `sb-<projectRef>-auth-token`. We SCAN for that key
// rather than reconstruct the project ref, so a URL/ref change (or a supabase-js storageKey tweak)
// cannot silently break the reader -- it degrades to "not found", which the panel surfaces as "log into
// the ATS first". If supabase-js ever changes the stored shape, this one function is where to fix it.
export function readSupabaseSession(storage:SessionStorage=localStorage,nowSeconds=Math.floor(Date.now()/1000)):HandoffSession|null{
  try{
    for(let i=0;i<storage.length;i++){
      const key=storage.key(i)
      if(!key||!/^sb-.*-auth-token$/.test(key))continue
      const raw=storage.getItem(key)
      if(!raw)continue
      const parsed=JSON.parse(raw)
      const session=toHandoffSession(parsed,nowSeconds)
      if(session)return session
    }
  }catch{/* malformed storage -> treat as not signed in */}
  return null
}
