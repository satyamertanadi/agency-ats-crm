import {afterEach,describe,expect,it} from 'vitest'
import {configureFormat,formatMoney,formatSalary} from './format'

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
