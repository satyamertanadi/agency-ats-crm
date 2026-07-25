import { createClient } from '@supabase/supabase-js'
import { afterAll,beforeAll,describe,expect,it } from 'vitest'

const url=process.env.SUPABASE_URL||'http://127.0.0.1:55321'
const anon=process.env.SUPABASE_ANON_KEY
if(!anon)throw new Error('SUPABASE_ANON_KEY is required; these tests must not silently skip.')

const NORTHSTAR='30000000-0000-0000-0000-000000000001'
const JOB='80000000-0000-0000-0000-000000000001' // seeded 'Regional Commercial Director', placement_fee_percentage=20

const owner=createClient(url,anon,{auth:{persistSession:false}})

let originalSalaryPeriod:'annual'|'monthly'='monthly'
let originalSalaryMax:number|null=null

beforeAll(async()=>{
  const signIn=await owner.auth.signInWithPassword({email:'owner@northstar.local',password:'LocalTest!123'})
  if(signIn.error)throw signIn.error

  const org=await owner.from('organizations').select('salary_period').eq('id',NORTHSTAR).single()
  expect(org.error).toBeNull()
  originalSalaryPeriod=(org.data?.salary_period as 'annual'|'monthly')||'monthly'

  const job=await owner.from('jobs').select('salary_max').eq('id',JOB).single()
  expect(job.error).toBeNull()
  originalSalaryMax=(job.data?.salary_max as number|null)??null

  const setSalary=await owner.from('jobs').update({salary_max:45_000_000}).eq('id',JOB)
  expect(setSalary.error).toBeNull()
})

afterAll(async()=>{
  await owner.from('jobs').update({salary_max:originalSalaryMax}).eq('id',JOB)
  await owner.rpc('update_organization_salary_period',{p_organization_id:NORTHSTAR,p_salary_period:originalSalaryPeriod})
})

// Regression test for the F1 audit finding: 20260721000000_candidate_salary_monthly.sql multiplies
// salary_max by 12 when salary_period='monthly' before applying the fee percentage, on the premise
// that a monthly figure must be restated at its annual equivalent first. This proves that formula
// against a known salary and fee, in both directions, so a future change to either the multiplier or
// the default cannot silently regress every quoted fee back to 1/12 of its real value.
describe('list_job_health expected_fee respects organization.salary_period',()=>{
  it('multiplies by 12 for a monthly-period organization',async()=>{
    const setPeriod=await owner.rpc('update_organization_salary_period',{p_organization_id:NORTHSTAR,p_salary_period:'monthly'})
    expect(setPeriod.error).toBeNull()

    const result=await owner.rpc('list_job_health',{p_organization_id:NORTHSTAR})
    expect(result.error).toBeNull()
    const row=(result.data as {id:string;expected_fee:number}[]|null)?.find((item)=>item.id===JOB)
    expect(row?.expected_fee).toBe(108_000_000) // 45,000,000 * 12 * 20%
  })

  it('does not multiply for an annual-period organization',async()=>{
    const setPeriod=await owner.rpc('update_organization_salary_period',{p_organization_id:NORTHSTAR,p_salary_period:'annual'})
    expect(setPeriod.error).toBeNull()

    const result=await owner.rpc('list_job_health',{p_organization_id:NORTHSTAR})
    expect(result.error).toBeNull()
    const row=(result.data as {id:string;expected_fee:number}[]|null)?.find((item)=>item.id===JOB)
    expect(row?.expected_fee).toBe(9_000_000) // 45,000,000 * 1 * 20%
  })
})

describe('update_organization_salary_period',()=>{
  it('rejects an invalid period',async()=>{
    const result=await owner.rpc('update_organization_salary_period',{p_organization_id:NORTHSTAR,p_salary_period:'weekly'})
    expect(result.error).not.toBeNull()
  })
})
