import {describe,expect,it} from 'vitest'
import {providerBillingExhausted} from '../staging/providerOutage'

/* The staging gate skips on a billing-exhausted provider so an empty AI balance stops CV parsing
 * without also freezing unrelated frontend deploys. That concession is only safe if the detector is
 * narrow, so this pins both directions -- and especially that the failure classes the gate was
 * written for still block. The dangerous bug here is a matcher that grows too broad and turns a
 * real schema regression into a green run. */
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
})
