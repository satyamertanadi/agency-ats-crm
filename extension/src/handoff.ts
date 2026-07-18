import {readSupabaseSession} from './session'

// Runs on every ATS app page (content_scripts match in the manifest). When the user is signed in, it
// hands the current session to the background so the extension can act as them. Harmless when the
// background didn't open this tab: it only forwards the tokens; the background closes the tab only if
// it was the one it opened for a connect.
const session=readSupabaseSession()
if(session)chrome.runtime.sendMessage({type:'session',session}).catch(()=>{/* background may be asleep; ignored */})
