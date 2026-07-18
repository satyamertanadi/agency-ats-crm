import type {HandoffSession} from './messages'

// The single point of coupling to how the SPA persists its Supabase session. supabase-js v2 stores the
// session as JSON in localStorage under a key shaped `sb-<projectRef>-auth-token`. We SCAN for that key
// rather than reconstruct the project ref, so a URL/ref change (or a supabase-js storageKey tweak)
// cannot silently break the reader -- it degrades to "not found", which the panel surfaces as "log into
// the ATS first". If supabase-js ever changes the stored shape, this one function is where to fix it.
export function readSupabaseSession():HandoffSession|null{
  try{
    for(let i=0;i<localStorage.length;i++){
      const key=localStorage.key(i)
      if(!key||!/^sb-.*-auth-token$/.test(key))continue
      const raw=localStorage.getItem(key)
      if(!raw)continue
      const parsed=JSON.parse(raw)
      const session=parsed?.access_token?parsed:(parsed?.currentSession??parsed?.session??null)
      if(session?.access_token&&session?.refresh_token)return {access_token:session.access_token,refresh_token:session.refresh_token}
    }
  }catch{/* malformed storage -> treat as not signed in */}
  return null
}
