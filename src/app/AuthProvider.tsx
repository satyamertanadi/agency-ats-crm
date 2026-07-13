import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../shared/lib/supabase'

type AuthValue = { user:User|null;session:Session|null;loading:boolean;signOut:()=>Promise<void> }
const AuthContext=createContext<AuthValue|null>(null)

export function AuthProvider({children}:{children:ReactNode}) {
  const [session,setSession]=useState<Session|null>(null); const [loading,setLoading]=useState(true)
  useEffect(()=>{void supabase.auth.getSession().then(({data})=>{setSession(data.session);setLoading(false)}); const {data}=supabase.auth.onAuthStateChange((_event,next)=>{setSession(next);setLoading(false)}); return()=>data.subscription.unsubscribe()},[])
  const value=useMemo<AuthValue>(()=>({user:session?.user??null,session,loading,signOut:async()=>{await supabase.auth.signOut()}}),[session,loading])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
export function useAuth(){const value=useContext(AuthContext);if(!value)throw new Error('useAuth must be used inside AuthProvider');return value}

