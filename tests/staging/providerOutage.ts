import {appendFileSync} from 'node:fs'

// Shared by the staging gate so the billing detector can be unit-tested without importing the gate
// itself, whose module body throws when the staging credentials are absent.
//
// An exhausted provider balance is an environment condition, not a regression in the contract the
// staging gate guards, and it used to block every unrelated deploy: a frontend-only change could
// not reach production because nobody had topped up the AI account. The gate now skips on that one
// condition and blocks on everything else.
//
// The detection deliberately matches the provider's billing wording and NOT the error code.
// `provider_rejected` is also how a structured-output schema rejection arrives -- precisely the
// 2026-07-16 failure class the gate exists to catch -- so keying on the code would blind it to the
// bugs it was written for. If the provider ever rewords these messages the match fails closed: the
// gate blocks again, which is the safe direction.
export const PROVIDER_BILLING_SIGNALS=/credit balance is too low|billing hard limit|insufficient_quota|exceeded your current quota|payment required/i
export const providerBillingExhausted=(message:string|null|undefined):boolean=>Boolean(message&&PROVIDER_BILLING_SIGNALS.test(message))

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
