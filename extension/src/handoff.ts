import {readSupabaseSession} from './session'
import {DEBUG} from './config'

// Runs on every ATS app page (content_scripts match in the manifest). When the user is signed in, it
// hands the current session to the background so the extension can act as them. Harmless when the
// background didn't open this tab: the background no-ops if it already holds this exact session, and
// closes the tab only if it was the one it opened for a connect.
const trace=(...args:unknown[])=>{if(DEBUG)console.log('[ATS ext]',...args)}

const session=readSupabaseSession()
trace('handoff running on',location.pathname,'session found?',Boolean(session))
if(session){
  chrome.runtime.sendMessage({type:'session',session})
    .then((response)=>trace('handoff: background acknowledged',response))
    .catch((err)=>trace('handoff: sendMessage failed (background asleep or extension reloaded -- refresh this tab)',err))
}
