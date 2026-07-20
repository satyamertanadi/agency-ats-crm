// Deno cannot import from src/, so this mirrors src/shared/lib/providerOutage.ts. The regex literal
// below must stay byte-identical to the one there; src/shared/lib/providerOutage.test.ts reads this
// file from disk and asserts exactly that, because two copies drifting silently is the whole risk.
//
// The detection matches the provider's billing wording and NOT the error code: `provider_rejected`
// is also how a structured-output schema rejection arrives, so keying on the code would treat a
// real schema regression as a billing outage and degrade instead of failing.
export const PROVIDER_BILLING_SIGNALS=/credit balance is too low|billing hard limit|insufficient_quota|exceeded your current quota|payment required/i
export const providerBillingExhausted=(message:string|null|undefined):boolean=>Boolean(message&&PROVIDER_BILLING_SIGNALS.test(message))
