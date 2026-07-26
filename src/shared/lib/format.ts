/* Display formatting for money and dates.
 *
 * Configured once from OrganizationProvider rather than read from a hook, because three callers
 * cannot use a hook: PublicReviewPage renders outside the provider (App.tsx routes /review/:token
 * outside <Protected/>), candidateProfileDocx/Pdf are not React, and the call sites are dense
 * inline JSX where threading an argument through would bloat every one.
 *
 * The axes are split on purpose:
 *   locale   <- navigator.language. The VIEWER's convention decides date order and digit grouping,
 *               so nobody is shown 7/6/2026 and has to guess. There is no organizations.locale
 *               column and inventing one is a migration this pass does not need.
 *   timeZone <- organization.timezone. The WORKSPACE decides which day an instant falls on. This
 *               matters: an interview at 2026-07-16T23:00:00Z is the 17th in Asia/Makassar, and
 *               before this it rendered in whatever zone the viewer's laptop was set to.
 *   currency <- organization.base_currency, overridable per record (a job may quote in its own).
 *   salaryPeriod <- organization.salary_period. The WORKSPACE's market decides whether a quoted
 *               salary means per year or per month. Same axis as currency: an agency quotes
 *               consistently, so it is configured once rather than stored per candidate. Indonesian
 *               salaries are commonly monthly, which is why "IDR 497,500,000" with no period was
 *               unreadable rather than merely untidy.
 */
type SalaryPeriod='annual'|'monthly'
type Config={locale:string;timeZone:string|undefined;currency:string;salaryPeriod:SalaryPeriod}

/* Defaults are only used before the org resolves. en-GB because day/month is unambiguous to the
 * most readers; every page gates its queries on `enabled:Boolean(organization)`, so in practice no
 * money or date paints before configureFormat runs. */
let config:Config={locale:'en-GB',timeZone:undefined,currency:'USD',salaryPeriod:'annual'}
export const configureFormat=(next:Partial<Config>)=>{config={...config,...next}}

export function formatMoney(value:number|null|undefined,currency?:string|null){
  if(value==null)return '—'
  return new Intl.NumberFormat(config.locale,{style:'currency',currency:currency||config.currency,maximumFractionDigits:0}).format(value)
}

/* Money that is a RATE, not an amount. Use this for anything a person earns; use formatMoney for
 * fees, invoices and placement values, which are one-off sums and would read as nonsense with a
 * period attached.
 *
 * `period` overrides the workspace convention for the rare record that genuinely differs, and is how
 * PublicReviewPage passes the agency's setting -- it renders outside OrganizationProvider (see the
 * note above), so configureFormat has not run for it. */
export function formatSalary(value:number|null|undefined,currency?:string|null,period?:SalaryPeriod|null){
  if(value==null)return '—'
  return `${formatMoney(value,currency)} / ${(period||config.salaryPeriod)==='monthly'?'month':'year'}`
}

/* Returns both forms so a caller can show `short` and put `full` in a title/tooltip. A KPI card is
 * ~180px and "IDR 510,000,000" is not going to fit in one no matter how the grid is built, so the
 * card shows "IDR 510M" and the exact figure stays one hover away rather than being truncated. */
export function formatMoneyCompact(value:number|null|undefined,currency?:string|null){
  if(value==null)return {short:'—',full:'—'}
  const resolved=currency||config.currency
  const short=new Intl.NumberFormat(config.locale,{style:'currency',currency:resolved,notation:'compact',maximumFractionDigits:1}).format(value)
  return {short,full:formatMoney(value,resolved)}
}

export function formatDate(value:string|null|undefined){
  if(!value)return '—'
  return new Intl.DateTimeFormat(config.locale,{dateStyle:'medium',timeZone:config.timeZone}).format(new Date(value))
}

export function formatDateTime(value:string|null|undefined){
  if(!value)return '—'
  return new Intl.DateTimeFormat(config.locale,{dateStyle:'medium',timeStyle:'short',timeZone:config.timeZone}).format(new Date(value))
}

/* Time only, for same-day items (Today's "due 16:00" badge) where the date is already implied by
 * which band the item sits in -- formatDateTime's date prefix would be redundant there. */
export function formatTime(value:string|null|undefined){
  if(!value)return '—'
  return new Intl.DateTimeFormat(config.locale,{timeStyle:'short',timeZone:config.timeZone}).format(new Date(value))
}

/* CV dates are date-only strings ('2019-03-01') carrying a precision that says how much of them to
 * trust -- a CV saying "2019" must not render as "1 Jan 2019".
 *
 * timeZone is pinned to UTC and must STAY pinned. These have no instant attached, so applying the
 * org's zone would shift '2019-03-01' into February for anyone west of UTC. Note the default branch
 * deliberately does NOT delegate to formatDate() any more: formatDate now applies the org timezone,
 * which is right for an interview and wrong for this. Only the locale follows the viewer.
 *
 * 'year' stays a string slice rather than Intl: a bare year needs no localizing, and year:'numeric'
 * would re-render it in a non-Gregorian calendar for some locales. */
export function formatCvDate(value:string|null|undefined,precision?:string|null){
  if(!value)return '—'
  if(precision==='year')return value.slice(0,4)
  const date=new Date(`${value.slice(0,10)}T00:00:00Z`)
  if(precision==='month')return new Intl.DateTimeFormat(config.locale,{month:'short',year:'numeric',timeZone:'UTC'}).format(date)
  return new Intl.DateTimeFormat(config.locale,{dateStyle:'medium',timeZone:'UTC'}).format(date)
}

export function initials(value:string){
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'AT'
}
