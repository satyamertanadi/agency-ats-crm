import {describe,expect,it} from 'vitest'
import {canonicalCompanyUrl,isCompanyPage,looksLikeFollowerCount,parseCompanySize} from './company'

/* Client capture reads a company page. These are the two decisions that must not be guessed: which
 * company a URL refers to, and which of the near-identical numbers on the page is a headcount. */

describe('canonicalCompanyUrl',()=>{
  it('reduces every form LinkedIn serves the same company under',()=>{
    /* /about/, /life/, /jobs/ and tracking parameters all describe one company. Without reducing
     * them, two captures from different tabs create two client records. */
    const expected='https://www.linkedin.com/company/swiss-belhotel-international/'
    expect(canonicalCompanyUrl('https://www.linkedin.com/company/swiss-belhotel-international/')).toBe(expected)
    expect(canonicalCompanyUrl('https://www.linkedin.com/company/swiss-belhotel-international/about/')).toBe(expected)
    expect(canonicalCompanyUrl('https://www.linkedin.com/company/swiss-belhotel-international/jobs/?trk=abc')).toBe(expected)
  })

  it('lowercases the slug, because the dedup key is compared case-insensitively',()=>{
    expect(canonicalCompanyUrl('https://www.linkedin.com/company/Swiss-BelHotel/'))
      .toBe('https://www.linkedin.com/company/swiss-belhotel/')
  })

  it('returns null for anything that is not a company page',()=>{
    // A person's profile must never be captured as a client.
    expect(canonicalCompanyUrl('https://www.linkedin.com/in/stevanus-budianto-2418b93b5/')).toBeNull()
    expect(canonicalCompanyUrl('https://www.linkedin.com/feed/')).toBeNull()
    expect(isCompanyPage('https://www.linkedin.com/in/someone/')).toBe(false)
    expect(isCompanyPage('https://www.linkedin.com/company/acme/')).toBe(true)
  })
})

describe('parseCompanySize',()=>{
  it('reads the ranges LinkedIn actually prints',()=>{
    expect(parseCompanySize('1,001-5,000 employees')).toBe('1,001-5,000 employees')
    expect(parseCompanySize('11-50 employees')).toBe('11-50 employees')
    expect(parseCompanySize('10,001+ employees')).toBe('10,001+ employees')
  })

  it('returns nothing rather than guessing at an unfamiliar string',()=>{
    /* An empty field the user fills is recoverable. A wrong headcount on a client record is quoted
     * back to that client. */
    expect(parseCompanySize('Hospitality')).toBe('')
    expect(parseCompanySize('Bali, Indonesia')).toBe('')
    expect(parseCompanySize('')).toBe('')
  })

  it('does not read a follower count as a headcount',()=>{
    /* These sit next to each other on the page and read almost identically -- "274 followers" beside
     * "51-200 employees". */
    expect(looksLikeFollowerCount('274 followers')).toBe(true)
    expect(looksLikeFollowerCount('12,486 followers')).toBe(true)
    expect(looksLikeFollowerCount('51-200 employees')).toBe(false)
  })
})
