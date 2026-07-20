// An exhausted provider balance is an environment condition, not a defect. It used to fail the
// staging gate and block every unrelated deploy; it now also degrades profile generation instead of
// failing it. Both callers need the same judgement, so the rule lives here.
//
// The detection deliberately matches the provider's billing wording and NOT the error code.
// `provider_rejected` is also how a structured-output schema rejection arrives -- precisely the
// 2026-07-16 failure class the staging gate exists to catch -- so keying on the code would blind it
// to the bugs it was written for. If the provider ever rewords these messages the match fails
// closed: the gate blocks and generation errors again, which is the safe direction.
//
// The Deno edge runtime cannot import from src/, so supabase/functions/_shared/provider-outage.ts
// carries a copy. providerOutage.test.ts asserts the two regexes stay byte-identical.
export const PROVIDER_BILLING_SIGNALS=/credit balance is too low|billing hard limit|insufficient_quota|exceeded your current quota|payment required/i
export const providerBillingExhausted=(message:string|null|undefined):boolean=>Boolean(message&&PROVIDER_BILLING_SIGNALS.test(message))
