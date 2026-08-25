import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../shared/lib/supabase'
import { captureError } from '../shared/lib/observability'

type AuthValue = { user:User|null;session:Session|null;loading:boolean;error:Error|null;signOut:()=>Promise<void> }
const AuthContext=createContext<AuthValue|null>(null)

export function AuthProvider({children}:{children:ReactNode}) {
  const [session,setSession]=useState<Session|null>(null); const [loading,setLoading]=useState(true);const [error,setError]=useState<Error|null>(null)
  const cache=useQueryClient()
  /* Tracks who the cache currently belongs to. AuthProvider sits inside QueryClientProvider (see
   * main.tsx), so the query cache outlives any individual session -- signing out and signing back in
   * does not remount it. */
  const cachedUserId=useRef<string|null>(null)
  useEffect(()=>{void supabase.auth.getSession().then(({data,error:sessionError})=>{if(sessionError){captureError(sessionError,{area:'auth_session'});setError(sessionError)}else{setSession(data.session);setError(null);cachedUserId.current=data.session?.user.id??null}setLoading(false)}); const {data}=supabase.auth.onAuthStateChange((event,next)=>{
    /* Drop every cached row at the session boundary. supabase.auth.signOut() ends the SESSION but
     * leaves the react-query cache exactly as it was, and that cache holds candidate private
     * details, client commercial terms and contact records. Without this, signing out and signing a
     * different user in on the same tab shows the previous user's data from cache for as long as it
     * takes each query to revalidate -- real records, rendered to someone who may have no permission
     * to them and possibly no membership of that workspace at all.
     *
     * Keyed on the user actually changing rather than on the event name alone: TOKEN_REFRESHED and
     * USER_UPDATED both fire with a session in normal use, and clearing on those would throw away a
     * warm cache for the same person several times an hour. */
    const nextUserId=next?.user.id??null
    if(event==='SIGNED_OUT'||nextUserId!==cachedUserId.current)cache.clear()
    cachedUserId.current=nextUserId
    setSession(next);setError(null);setLoading(false);if(event==='SIGNED_IN'&&next?.user)void supabase.from('profiles').update({last_seen_at:new Date().toISOString()}).eq('id',next.user.id)
  }); return()=>data.subscription.unsubscribe()},[cache])
  const value=useMemo<AuthValue>(()=>({user:session?.user??null,session,loading,error,signOut:async()=>{await supabase.auth.signOut()}}),[session,loading,error])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
export function useAuth(){const value=useContext(AuthContext);if(!value)throw new Error('useAuth must be used inside AuthProvider');return value}
