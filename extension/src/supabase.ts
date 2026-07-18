import {createClient} from '@supabase/supabase-js'
import {SUPABASE_ANON_KEY,SUPABASE_URL} from './config'

// A service worker has no localStorage, so back the session with chrome.storage.local. This lets the
// handed-off session survive worker restarts, and supabase-js's autoRefreshToken keeps it valid on its
// own from then on -- the user only re-connects if they fully sign out of the ATS.
const storage={
  getItem:async(key:string)=>((await chrome.storage.local.get(key))[key]??null) as string|null,
  setItem:async(key:string,value:string)=>{await chrome.storage.local.set({[key]:value})},
  removeItem:async(key:string)=>{await chrome.storage.local.remove(key)},
}

export const supabase=createClient(SUPABASE_URL,SUPABASE_ANON_KEY,{
  auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,storage,storageKey:'ats-ext-session'},
})
