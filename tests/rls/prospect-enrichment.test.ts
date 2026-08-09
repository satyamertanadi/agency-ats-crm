import { createClient } from '@supabase/supabase-js'
import { beforeAll,describe,expect,it } from 'vitest'

const url=process.env.SUPABASE_URL||'http://127.0.0.1:55321'
const anon=process.env.SUPABASE_ANON_KEY
if(!anon)throw new Error('SUPABASE_ANON_KEY is required; these tests must not silently skip.')

const NORTHSTAR='30000000-0000-0000-0000-000000000001'
const JOB='80000000-0000-0000-0000-000000000001'

const owner=createClient(url,anon,{auth:{persistSession:false}})
const rival=createClient(url,anon,{auth:{persistSession:false}})
beforeAll(async()=>{
  const results=await Promise.all([
    owner.auth.signInWithPassword({email:'owner@northstar.local',password:'LocalTest!123'}),
    rival.auth.signInWithPassword({email:'owner@rival.local',password:'LocalTest!123'}),
  ])
  const failure=results.find((result)=>result.error)
  if(failure?.error)throw failure.error
})

const uniqueLinkedin=(tag:string)=>`https://www.linkedin.com/in/enrich-${tag}-${Date.now()}`

describe('capture_prospect rich payload',()=>{
  it('ingests employment, skills, tags, note, owner and status in one call',async()=>{
    const capture=await owner.rpc('capture_prospect',{p_organization_id:NORTHSTAR,p_kind:'candidate',p_payload:{
      full_name:'Enrich Rich',linkedin_url:uniqueLinkedin('rich'),source:'LinkedIn',
      private:{email:`enrich-${Date.now()}@example.com`,phone:'+62811',expected_salary:400000000,salary_currency:'idr'},
      employment:[{company_name:'Acme',title:'CTO',is_current:true,sort_order:0},{company_name:'Globex',title:'VP Eng',started_on:'2019-01-01',ended_on:'2022-01-01',sort_order:1}],
      skills:[{name:'TypeScript',proficiency:'expert'},{name:'Leadership'}],
      languages:[{language:'English',proficiency:'native'}],
      note:'Strong fit, sourced from LinkedIn.',tags:['Hot','Tech Leadership'],status:'passive',
    }})
    expect(capture.error).toBeNull()
    const candidateId=(capture.data as {id:string}).id

    const candidate=await owner.from('candidates').select('status,source').eq('id',candidateId).single()
    expect(candidate.data?.status).toBe('passive')
    const [employment,skills,tags,notes,priv]=await Promise.all([
      owner.from('candidate_employment').select('id').eq('candidate_id',candidateId),
      owner.from('candidate_skills').select('skill_id').eq('candidate_id',candidateId),
      owner.from('candidate_tags').select('tag_id').eq('candidate_id',candidateId),
      /* The capture note used to land in notes/note_links, which no screen ever read. It is now an
       * activity of type 'note', which ActivityFeed renders on the candidate record -- this asserts
       * the note is reachable, not merely stored. */
      owner.from('activity_links').select('id,activities!inner(activity_type)').eq('candidate_id',candidateId).eq('activities.activity_type','note'),
      owner.from('candidate_private_details').select('expected_salary,salary_currency').eq('candidate_id',candidateId).single(),
    ])
    expect(employment.data?.length).toBe(2)
    expect(skills.data?.length).toBe(2)
    expect(tags.data?.length).toBe(2)
    expect(notes.data?.length).toBe(1)
    expect(priv.data?.expected_salary).toBe(400000000)
    expect(priv.data?.salary_currency).toBe('IDR')
  })
})

describe('lookup_prospects_by_linkedin',()=>{
  it('reports who is already in the ATS with their live pipeline stage, case-insensitively',async()=>{
    const linkedin=uniqueLinkedin('radar')
    const capture=await owner.rpc('capture_prospect',{p_organization_id:NORTHSTAR,p_kind:'candidate',p_payload:{full_name:'Radar Person',linkedin_url:linkedin,source:'LinkedIn'},p_job_id:JOB})
    expect(capture.error).toBeNull()

    const lookup=await owner.rpc('lookup_prospects_by_linkedin',{p_organization_id:NORTHSTAR,p_linkedin_urls:[linkedin.toUpperCase(),'https://linkedin.com/in/definitely-nobody']})
    expect(lookup.error).toBeNull()
    const rows=lookup.data as {linkedin_url:string;candidate:{full_name:string;stages:{job:string;stage:string}[]}|null}[]
    const hit=rows.find((r)=>r.linkedin_url===linkedin.toUpperCase())
    expect(hit?.candidate?.full_name).toBe('Radar Person')
    expect(hit?.candidate?.stages.length).toBeGreaterThan(0)
    const miss=rows.find((r)=>r.linkedin_url==='https://linkedin.com/in/definitely-nobody')
    expect(miss?.candidate).toBeNull()
  })

  it('refuses a cross-tenant lookup',async()=>{
    const attack=await rival.rpc('lookup_prospects_by_linkedin',{p_organization_id:NORTHSTAR,p_linkedin_urls:['https://linkedin.com/in/x']})
    expect(attack.error).not.toBeNull()
  })
})

describe('capture_prospects_bulk',()=>{
  it('captures multiple people into a job and reports per-item results',async()=>{
    const bulk=await owner.rpc('capture_prospects_bulk',{p_organization_id:NORTHSTAR,p_kind:'candidate',p_items:[
      {full_name:'Bulk Alpha',linkedin_url:uniqueLinkedin('a'),source:'LinkedIn'},
      {full_name:'Bulk Beta',linkedin_url:uniqueLinkedin('b'),source:'LinkedIn'},
    ],p_job_id:JOB})
    expect(bulk.error).toBeNull()
    const rows=bulk.data as {ok:boolean;result?:{job_linked:boolean}}[]
    expect(rows.length).toBe(2)
    expect(rows.every((r)=>r.ok&&r.result?.job_linked)).toBe(true)
  })

  it('refuses a cross-tenant bulk capture',async()=>{
    const attack=await rival.rpc('capture_prospects_bulk',{p_organization_id:NORTHSTAR,p_kind:'candidate',p_items:[{full_name:'X',linkedin_url:'https://linkedin.com/in/x'}]})
    expect(attack.error).not.toBeNull()
  })
})
