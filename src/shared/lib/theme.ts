export type ThemePreference='light'|'dark'|'system'
export type ResolvedTheme='light'|'dark'

const STORAGE_KEY='ats-theme'

/** What a stored value means, tolerating anything a previous version or a hand-edited value left. */
export const parsePreference=(value:unknown):ThemePreference=>
  value==='light'||value==='dark'?value:'system'

/** The theme actually applied, given the user's choice and what the OS reports. */
export const resolveTheme=(preference:ThemePreference,prefersDark:boolean):ResolvedTheme=>
  preference==='system'?(prefersDark?'dark':'light'):preference

export function readPreference():ThemePreference{
  try{return parsePreference(localStorage.getItem(STORAGE_KEY))}
  // Private-mode Safari and hardened browser configs throw on localStorage access rather than
  // returning null. A theme preference is not worth taking the app down for.
  catch{return 'system'}
}

export function writePreference(preference:ThemePreference){
  try{
    if(preference==='system')localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY,preference)
  }catch{/* see readPreference */}
}

const systemPrefersDark=()=>window.matchMedia?.('(prefers-color-scheme: dark)').matches??false

/* The palette is keyed on a `data-theme` attribute rather than a `prefers-color-scheme` media query,
 * so the dark values exist in exactly one place in tokens.css instead of being duplicated for the
 * media query and the manual override -- the same drift the token file was created to end.
 *
 * The usual cost of that choice is a flash of light before the script runs, normally avoided with a
 * tiny inline <script>. This app's CSP is `script-src 'self'` with no 'unsafe-inline', so an inline
 * script would simply be blocked; applying it from the bundled entry is the available option, and
 * costs nothing visible because the SPA renders an empty #root until JS boots anyway. */
export function applyTheme(preference:ThemePreference){
  const resolved=resolveTheme(preference,systemPrefersDark())
  document.documentElement.dataset.theme=resolved
  // Tells the browser to render form controls, scrollbars, and the canvas in the matching scheme.
  // Without it, native selects and scrollbars stay light against a dark page.
  document.documentElement.style.colorScheme=resolved
  return resolved
}

/** Applies the stored preference and keeps it in step with the OS while set to `system`. */
export function initializeTheme(){
  applyTheme(readPreference())
  const query=window.matchMedia?.('(prefers-color-scheme: dark)')
  query?.addEventListener?.('change',()=>{if(readPreference()==='system')applyTheme('system')})
}
