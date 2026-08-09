import {createClient} from '@supabase/supabase-js'
import {SUPABASE_ANON_KEY,SUPABASE_URL} from './config'

// Keep the borrowed access credential in Chrome's memory-backed browser-session storage. It survives
// service-worker suspension but is cleared when the browser exits. The ATS never hands the extension
// a refresh token, so the extension cannot silently extend its own access; users reconnect after the
// short-lived access token expires.
const storage={
  getItem:async(key:string)=>((await chrome.storage.session.get(key))[key]??null) as string|null,
  setItem:async(key:string,value:string)=>{await chrome.storage.session.set({[key]:value})},
  removeItem:async(key:string)=>{await chrome.storage.session.remove(key)},
}

export const supabase=createClient(SUPABASE_URL,SUPABASE_ANON_KEY,{
  auth:{persistSession:true,autoRefreshToken:false,detectSessionInUrl:false,storage,storageKey:'ats-ext-session'},
})
