import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {describe,expect,it} from 'vitest'
import {PROVIDER_BILLING_SIGNALS,providerBillingExhausted} from './providerOutage'

/* Two things depend on this detector being narrow: the staging gate skips instead of blocking, and
 * profile generation degrades instead of failing. Both concessions are only safe if the failure
 * classes they were built to catch still come through. The dangerous bug is a matcher that grows
 * too broad and turns a real schema regression into a green run and an empty document. */
describe('provider billing detection',()=>{
  it('recognises the provider refusing on an exhausted balance',()=>{
    // The verbatim message that blocked production promotion on 2026-07-19.
    expect(providerBillingExhausted('invalid_request_error: Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.')).toBe(true)
    expect(providerBillingExhausted('Billing hard limit reached')).toBe(true)
    expect(providerBillingExhausted('insufficient_quota')).toBe(true)
    expect(providerBillingExhausted('You exceeded your current quota')).toBe(true)
    expect(providerBillingExhausted('402 Payment Required')).toBe(true)
  })

  it('still blocks on the structured-output schema rejections the gate exists to catch',()=>{
    // These arrive under the SAME provider_rejected error code as the billing failure, which is why
    // the detector reads the message and never the code. If any of these ever returns true, a
    // schema regression can reach production unnoticed -- the exact 2026-07-16 incident.
    expect(providerBillingExhausted('provider_rejected: input_schema does not support keyword "minLength"')).toBe(false)
    expect(providerBillingExhausted('provider_rejected: too many union types in tool input_schema')).toBe(false)
    expect(providerBillingExhausted('provider_rejected: optional parameter limit exceeded')).toBe(false)
    expect(providerBillingExhausted('column reference "candidate_id" is ambiguous')).toBe(false)
  })

  it('blocks on transport and auth failures, which are not billing problems',()=>{
    expect(providerBillingExhausted('401 Unauthorized: invalid x-api-key')).toBe(false)
    expect(providerBillingExhausted('429 rate_limit_error: too many requests')).toBe(false)
    expect(providerBillingExhausted('overloaded_error')).toBe(false)
    expect(providerBillingExhausted('fetch failed: ECONNRESET')).toBe(false)
  })

  it('treats an absent message as blocking rather than as an outage',()=>{
    // Fail closed: no evidence of a billing problem means the gate keeps its teeth.
    expect(providerBillingExhausted(null)).toBe(false)
    expect(providerBillingExhausted(undefined)).toBe(false)
    expect(providerBillingExhausted('')).toBe(false)
  })

  /* The Deno edge runtime cannot import from src/, so the edge function carries a second copy of the
   * regex. Nothing but this test stops the two from drifting apart, which would mean the gate and
   * the generator disagreeing about what an outage even is. */
  it('keeps the edge-function copy byte-identical',()=>{
    const source=readFileSync(resolve(__dirname,'../../../supabase/functions/_shared/provider-outage.ts'),'utf8')
    const literal=source.match(/export const PROVIDER_BILLING_SIGNALS=(\/.*\/i)$/m)?.[1]
    expect(literal,'edge copy must declare PROVIDER_BILLING_SIGNALS as a regex literal').toBeDefined()
    expect(literal).toBe(`/${PROVIDER_BILLING_SIGNALS.source}/i`)
  })
})
