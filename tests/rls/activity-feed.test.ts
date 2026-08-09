import { createClient } from '@supabase/supabase-js'
import { beforeAll,describe,expect,it } from 'vitest'

const url=process.env.SUPABASE_URL||'http://127.0.0.1:55321'
const anon=process.env.SUPABASE_ANON_KEY
if(!anon)throw new Error('SUPABASE_ANON_KEY is required; these tests must not silently skip.')

const NORTHSTAR='30000000-0000-0000-0000-000000000001'
const RIVAL='30000000-0000-0000-0000-000000000002'
const NORTHSTAR_CONSULTANT_USER='10000000-0000-0000-0000-000000000003'
const JOB_CANDIDATE='81000000-0000-0000-0000-000000000001'
const CANDIDATE='70000000-0000-0000-0000-000000000001'
const JOB='80000000-0000-0000-0000-000000000001'
const JOB_PIPELINE='50000000-0000-0000-0000-000000000003'

const owner=createClient(url,anon,{auth:{persistSession:false}})
const rival=createClient(url,anon,{auth:{persistSession:false}})
const consultant=createClient(url,anon,{auth:{persistSession:false}})
beforeAll(async()=>{
  const results=await Promise.all([
    owner.auth.signInWithPassword({email:'owner@northstar.local',password:'LocalTest!123'}),
    rival.auth.signInWithPassword({email:'owner@rival.local',password:'LocalTest!123'}),
    consultant.auth.signInWithPassword({email:'consultant@northstar.local',password:'LocalTest!123'}),
  ])
  const failure=results.find((result)=>result.error)
  if(failure?.error)throw failure.error
})

const required=<T,>(value:T|null|undefined,what:string):T=>{if(value===null||value===undefined)throw new Error(`Seeded ${what} is required`);return value}

describe('activity feed',()=>{
  it('shows colleague profiles inside the workspace but never across tenants',async()=>{
    const teammate=await owner.from('profiles').select('id,full_name').eq('id',NORTHSTAR_CONSULTANT_USER).single()
    expect(teammate.error).toBeNull()
    expect(teammate.data?.full_name).toBe('Cara Consultant')
    const foreign=await rival.from('profiles').select('id').eq('id',NORTHSTAR_CONSULTANT_USER)
    expect(foreign.error).toBeNull()
    expect(foreign.data).toEqual([])
  })

  it('records one activity per stage move, filed against both the candidate and the vacancy',async()=>{
    const before=await consultant.from('activities').select('id').eq('organization_id',NORTHSTAR)
    expect(before.error).toBeNull()
    const stage=await consultant.from('pipeline_stages').select('id').eq('pipeline_id',JOB_PIPELINE).eq('stage_key','screening').single()
    expect(stage.error).toBeNull()
    const move=await consultant.rpc('move_job_candidate_stage',{p_job_candidate_id:JOB_CANDIDATE,p_stage_id:required(stage.data?.id,'screening stage'),p_note:'Strong commercial fit',p_source:'manual'})
    expect(move.error).toBeNull()

    const after=await consultant.from('activities').select('id,activity_type,summary,actor_name_snapshot').eq('organization_id',NORTHSTAR)
    expect(after.error).toBeNull()
    const existing=new Set((before.data??[]).map((row)=>row.id))
    const created=(after.data??[]).filter((row)=>!existing.has(row.id))
    expect(created).toHaveLength(1)
    expect(created[0].activity_type).toBe('status_change')
    expect(created[0].summary).toBe('Strong commercial fit')
    expect(created[0].actor_name_snapshot).toBe('Cara Consultant')

    // num_nonnulls(...)=1 is per link row, so one activity reaches both feeds via two rows.
    const links=await consultant.from('activity_links').select('candidate_id,job_id').eq('activity_id',created[0].id)
    expect(links.error).toBeNull()
    expect(links.data).toHaveLength(2)
    expect((links.data??[]).map((row)=>row.candidate_id).filter(Boolean)).toEqual([CANDIDATE])
    expect((links.data??[]).map((row)=>row.job_id).filter(Boolean)).toEqual([JOB])
  })

  it('shows the move on the candidate feed the UI reads',async()=>{
    const feed=await consultant.from('activities').select('id,activity_type,activity_links!inner(candidate_id)').eq('organization_id',NORTHSTAR).eq('activity_links.candidate_id',CANDIDATE)
    expect(feed.error).toBeNull()
    expect((feed.data??[]).some((row)=>row.activity_type==='status_change')).toBe(true)
  })

  it('refuses a hand-logged entry that forges a system type',async()=>{
    // status_change, submission, placement and client_feedback must stay provable system output.
    const result=await consultant.rpc('log_manual_activity',{p_organization_id:NORTHSTAR,p_type:'placement',p_summary:'Faked a placement',p_links:[{candidate_id:CANDIDATE}]})
    expect(result.error).not.toBeNull()
    expect(result.error?.message).toContain('invalid_activity_type')
  })

  it('accepts a hand-logged call and files it against the candidate',async()=>{
    const result=await consultant.rpc('log_manual_activity',{p_organization_id:NORTHSTAR,p_type:'call',p_summary:'Discussed notice period.',p_subject:'Intro call',p_direction:'outbound',p_links:[{candidate_id:CANDIDATE}]})
    expect(result.error).toBeNull()
    const links=await consultant.from('activity_links').select('candidate_id').eq('activity_id',required(result.data,'activity id') as string)
    expect(links.data).toEqual([{candidate_id:CANDIDATE}])
  })

  it('refuses an entry that is attached to nothing',async()=>{
    const result=await consultant.rpc('log_manual_activity',{p_organization_id:NORTHSTAR,p_type:'call',p_summary:'Orphan entry',p_links:[]})
    expect(result.error).not.toBeNull()
    expect(result.error?.message).toContain('link_required')
  })

  it('will not write activity into a foreign tenant',async()=>{
    const result=await consultant.rpc('log_manual_activity',{p_organization_id:RIVAL,p_type:'call',p_summary:'Cross tenant attack',p_links:[{candidate_id:CANDIDATE}]})
    expect(result.error).not.toBeNull()
    expect(result.error?.message).toContain('permission_denied')
  })
})
