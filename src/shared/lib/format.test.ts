import {afterEach,describe,expect,it} from 'vitest'
import {configureFormat,formatDateRange,formatMoney,formatSalary} from './format'

/* configureFormat writes module-global state (it is called once from OrganizationProvider), so each
 * test restores the documented pre-org defaults rather than leaking a currency into the next one. */
afterEach(()=>configureFormat({locale:'en-GB',timeZone:undefined,currency:'USD',salaryPeriod:'annual'}))

/* Intl.NumberFormat separates a currency code from its digits with U+00A0, not a plain space. It is
 * constructed by code point rather than typed: a pasted NBSP is indistinguishable from a space on
 * screen, so it fails with a diff nobody can read -- and eslint's no-irregular-whitespace bans it. */
const NBSP=String.fromCharCode(160)
const idr=(digits:string)=>`IDR${NBSP}${digits}`

describe('formatSalary',()=>{
  it('labels the period so a bare IDR figure is no longer a guess',()=>{
    configureFormat({locale:'en-GB',currency:'IDR',salaryPeriod:'annual'})
    // The exact figure from the demo dataset that read as a formatting defect.
    expect(formatSalary(497500000)).toBe(`${idr('497,500,000')} / year`)
  })

  it('follows the workspace convention when the market quotes monthly',()=>{
    configureFormat({locale:'en-GB',currency:'IDR',salaryPeriod:'monthly'})
    expect(formatSalary(41000000)).toBe(`${idr('41,000,000')} / month`)
  })

  it('takes an explicit period for callers outside OrganizationProvider',()=>{
    configureFormat({locale:'en-GB',currency:'IDR',salaryPeriod:'annual'})
    // PublicReviewPage renders outside the provider and passes the agency's setting from the payload.
    expect(formatSalary(41000000,'IDR','monthly')).toBe(`${idr('41,000,000')} / month`)
  })

  it('renders an em dash rather than a period for an unrecorded salary',()=>{
    expect(formatSalary(null)).toBe('—')
    expect(formatSalary(undefined)).toBe('—')
  })

  it('leaves formatMoney unlabelled, because a fee is a sum and not a rate',()=>{
    configureFormat({locale:'en-GB',currency:'IDR'})
    expect(formatMoney(497500000)).toBe(idr('497,500,000'))
  })
})

/* The Scorecard's date inputs are native <input type="date">, whose display format is browser shadow
 * DOM and cannot be reformatted -- an en-US viewer sees "08/09/2026" for a date that is 8 September
 * to half the world and 9 August to the other half. formatDateRange is the unambiguous echo beside
 * them, so these assert the one property that matters: the month is never a bare number. */
describe('formatDateRange',()=>{
  it('renders the month as a word, so the range has only one reading',()=>{
    configureFormat({locale:'en-GB',timeZone:'Asia/Makassar'})
    expect(formatDateRange('2025-12-31','2026-08-25')).toBe('31 Dec 2025 – 25 Aug 2026')
  })

  /* The ambiguous case by name. Whatever the viewer's locale does to the ORDER, the month must not
   * come back as a digit -- that is what makes the echo worth rendering at all. */
  it('stays unambiguous under a month-first locale',()=>{
    configureFormat({locale:'en-US',timeZone:'Asia/Makassar'})
    const rendered=formatDateRange('2026-09-08','2026-09-08')
    expect(rendered).toContain('Sep')
    expect(rendered).not.toMatch(/\d+\/\d+/)
  })

  /* Plain calendar dates off a date input, NOT instants. Converting them through the workspace zone
   * would shift the boundary a day for any viewer behind it -- the exact bug this exists to prevent,
   * reintroduced. A far-eastern workspace zone must not move 1 Jan onto 31 Dec. */
  it('does not shift a calendar date through the workspace timezone',()=>{
    configureFormat({locale:'en-GB',timeZone:'Pacific/Kiritimati'})
    expect(formatDateRange('2026-01-01','2026-01-01')).toBe('1 Jan 2026')
  })

  it('collapses an identical start and end to one date',()=>{
    configureFormat({locale:'en-GB',timeZone:'Asia/Makassar'})
    expect(formatDateRange('2026-08-25','2026-08-25')).toBe('25 Aug 2026')
  })

  it('describes an open-ended or empty range without inventing a bound',()=>{
    configureFormat({locale:'en-GB',timeZone:'Asia/Makassar'})
    expect(formatDateRange('2026-08-25',null)).toBe('From 25 Aug 2026')
    expect(formatDateRange(null,'2026-08-25')).toBe('Up to 25 Aug 2026')
    expect(formatDateRange(null,null)).toBe('')
    expect(formatDateRange('not-a-date','2026-08-25')).toBe('Up to 25 Aug 2026')
  })
})
