import {readSupabaseSession} from './session'

// Runs on every ATS app page (content_scripts match in the manifest). When the user is signed in, it
// hands the current session to the background so the extension can act as them. Harmless when the
// background didn't open this tab: it only forwards the tokens; the background closes the tab only if
// it was the one it opened for a connect.
const session=readSupabaseSession()
console.log('[ATS ext] handoff running on',location.href,'session found?',Boolean(session))
if(session){
  chrome.runtime.sendMessage({type:'session',session})
    .then((response)=>console.log('[ATS ext] handoff: background acknowledged',response))
    .catch((err)=>console.log('[ATS ext] handoff: sendMessage failed (background may be asleep or extension reloaded -- refresh this tab)',err))
}
