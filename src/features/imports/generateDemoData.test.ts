import {describe,expect,it} from 'vitest'
import {EXPECTED_COUNTS,IMPORT_ORDER,ROLLBACK_ORDER,generateDemoData,validateDemoData} from '../../../scripts/generate-demo-data.mjs'

const owners=['one@agency.local','two@agency.local','three@agency.local','four@agency.local','five@agency.local','six@agency.local']

describe('Indonesian demo data',()=>{
  it('generates the complete deterministic dataset',()=>{
    const first=generateDemoData({anchorDate:'2026-07-15',owners:[...owners]})
    const second=generateDemoData({anchorDate:'2026-07-15',owners:[...owners]})
    expect(first).toEqual(second)
    expect(Object.fromEntries((Object.entries(first) as Array<[string,Array<unknown>]>).map(([entity,rows])=>[entity,rows.length]))).toEqual(EXPECTED_COUNTS)
    expect(ROLLBACK_ORDER).toEqual([...IMPORT_ORDER].reverse())
    expect(validateDemoData(first,[...owners])).toBe(true)
  })

  it('keeps identities safe and assigns work to every consultant',()=>{
    const data=generateDemoData({anchorDate:'2026-07-15',owners:[...owners]})
    expect(data.contacts.every((row)=>String(row.email).endsWith('.example')&&row.phone==='')).toBe(true)
    expect(data.candidates.every((row)=>String(row.email).endsWith('.example')&&row.phone===''&&row.salary_currency==='IDR')).toBe(true)
    expect(new Set(data.candidates.map((row)=>row.owner_email))).toEqual(new Set(owners))
    expect(data.interviews.every((row)=>row.meeting_url==='')).toBe(true)
  })

  it('rejects a team that is not exactly six unique active members',()=>{
    expect(()=>generateDemoData({anchorDate:'2026-07-15',owners:owners.slice(0,5)})).toThrow(/Exactly six/)
    expect(()=>generateDemoData({anchorDate:'2026-07-15',owners:[...owners.slice(0,5),owners[0]!]})).toThrow(/unique/)
  })
})
