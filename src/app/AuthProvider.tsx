import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../shared/lib/supabase'
import { captureError } from '../shared/lib/observability'

type AuthValue = { user:User|null;session:Session|null;loading:boolean;error:Error|null;signOut:()=>Promise<void> }
const AuthContext=createContext<AuthValue|null>(null)

export function AuthProvider({children}:{children:ReactNode}) {
  const [session,setSession]=useState<Session|null>(null); const [loading,setLoading]=useState(true);const [error,setError]=useState<Error|null>(null)
  useEffect(()=>{void supabase.auth.getSession().then(({data,error:sessionError})=>{if(sessionError){captureError(sessionError,{area:'auth_session'});setError(sessionError)}else{setSession(data.session);setError(null)}setLoading(false)}); const {data}=supabase.auth.onAuthStateChange((event,next)=>{setSession(next);setError(null);setLoading(false);if(event==='SIGNED_IN'&&next?.user)void supabase.from('profiles').update({last_seen_at:new Date().toISOString()}).eq('id',next.user.id)}); return()=>data.subscription.unsubscribe()},[])
  const value=useMemo<AuthValue>(()=>({user:session?.user??null,session,loading,error,signOut:async()=>{await supabase.auth.signOut()}}),[session,loading,error])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
export function useAuth(){const value=useContext(AuthContext);if(!value)throw new Error('useAuth must be used inside AuthProvider');return value}
