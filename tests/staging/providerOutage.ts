import {appendFileSync} from 'node:fs'

// The detector itself lives in src/shared/lib/providerOutage.ts, because the app degrades profile
// generation on the same condition this gate skips on. Only the reporting helpers stay here -- they
// import node:fs, which must never reach the browser bundle.
export {PROVIDER_BILLING_SIGNALS,providerBillingExhausted} from '../../src/shared/lib/providerOutage'

// Skipping must never be quiet -- a degraded run has to be distinguishable from a green one at a
// glance, or this becomes the silent skip the gate was explicitly written to prevent.
export function formatOutageNotice(what:string,message:string|null|undefined):string{
  return `${what} could not be verified: the AI provider rejected the request for billing reasons, so the CV-parse and profile contracts went UNTESTED in this run. This is an environment problem, not a code regression. Top up the provider balance and re-run to restore the gate. Provider said: ${message||'(no message)'}`
}

export function announceProviderOutage(what:string,message:string|null|undefined):void{
  const detail=formatOutageNotice(what,message)
  console.error(`\n\n*** STAGING GATE DEGRADED — CONTRACT UNVERIFIED ***\n${detail}\n\n`)
  if(process.env.GITHUB_ACTIONS){
    console.log(`::warning title=Staging gate degraded — AI contract unverified::${detail}`)
    if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,`\n> [!WARNING]\n> **Staging gate degraded — AI contract unverified.** ${detail}\n`)
  }
}
