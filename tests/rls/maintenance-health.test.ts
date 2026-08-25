import {createClient} from '@supabase/supabase-js'
import {afterAll,beforeAll,describe,expect,it} from 'vitest'

const url=process.env.SUPABASE_URL||'http://127.0.0.1:55321'
const anon=process.env.SUPABASE_ANON_KEY
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY
if(!anon||!serviceKey)throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are required; maintenance health tests must not silently skip.')

const ORGANIZATION='30000000-0000-0000-0000-000000000001'
const JOB_KEY='scheduled-maintenance'
const owner=createClient(url,anon,{auth:{persistSession:false}})
const unauthenticated=createClient(url,anon,{auth:{persistSession:false}})
const admin=createClient(url,serviceKey,{auth:{persistSession:false}})

/* The heartbeat is a single global row, so every test here has to put it back. Captured rather than
 * assumed: a local `db reset` seeds it as never_run, but a developer who has run the worker by hand
 * would otherwise have their state silently overwritten with a fabricated "original". */
let original:Record<string,unknown>|null=null

const readRow=async()=>{
  const {data,error}=await admin.from('maintenance_heartbeats').select('*').eq('job_key',JOB_KEY).single()
  if(error)throw error
  return data
}
const setRow=async(patch:Record<string,unknown>)=>{
  const {error}=await admin.from('maintenance_heartbeats').update(patch).eq('job_key',JOB_KEY)
  if(error)throw error
}
const health=async()=>{
  const {data,error}=await owner.rpc('get_maintenance_health',{p_organization_id:ORGANIZATION})
  expect(error).toBeNull()
  return (data||[]).find((row)=>row.job_key===JOB_KEY)
}
const ago=(hours:number)=>new Date(Date.now()-hours*60*60*1000).toISOString()

beforeAll(async()=>{
  const signedIn=await owner.auth.signInWithPassword({email:'owner@northstar.local',password:'LocalTest!123'})
  if(signedIn.error)throw signedIn.error
  original=await readRow()
})

afterAll(async()=>{
  if(!original)return
  await setRow({
    last_successful_run_at:original.last_successful_run_at,last_run_at:original.last_run_at,
    last_started_at:original.last_started_at,last_finished_at:original.last_finished_at,
    last_attempt_at:original.last_attempt_at,last_status:original.last_status,
    last_error:original.last_error,last_detail:original.last_detail,
    consecutive_failures:original.consecutive_failures,last_request_id:original.last_request_id,
  })
})

describe('scheduled maintenance health reporting',()=>{
  /* The state this shipped in, and the one the fix has to keep reporting as broken. A job that has
   * never succeeded is stale by definition -- "no successful run on record" is exactly what a
   * silently-disabled schedule leaves behind and must never read as healthy. */
  it('reports a job that has never run as stale, and blames the scheduler',async()=>{
    await setRow({last_successful_run_at:null,last_run_at:null,last_started_at:null,last_finished_at:null,last_attempt_at:null,last_status:'never_run',last_error:null,consecutive_failures:0})
    const row=await health()
    expect(row?.is_stale).toBe(true)
    expect(row?.fault_stage).toBe('scheduler')
  })

  /* The failure that used to be invisible. The cron fires (last_attempt_at is written from inside
   * the database, before the request leaves) but the worker never starts -- a rejected credential or
   * a transport failure. Previously indistinguishable from "never scheduled". */
  it('blames delivery when the schedule fired but the worker never started',async()=>{
    await setRow({last_successful_run_at:null,last_run_at:null,last_started_at:null,last_finished_at:null,last_attempt_at:ago(0.1),last_status:'never_run',last_error:null})
    const row=await health()
    expect(row?.is_stale).toBe(true)
    expect(row?.fault_stage).toBe('delivery')
  })

  /* A run cut off partway -- what a pg_net timeout against a real backlog produces every hour. The
   * pre-fix schema could not express this at all: with only one timestamp there was no way to say
   * "started but never finished". */
  it('blames execution when the worker started but never finished',async()=>{
    await setRow({last_successful_run_at:null,last_run_at:ago(0.2),last_started_at:ago(0.2),last_finished_at:null,last_attempt_at:ago(0.25),last_status:'running',last_error:null})
    const row=await health()
    expect(row?.is_stale).toBe(true)
    expect(row?.fault_stage).toBe('execution')
  })

  it('blames the run itself when it finished and reported failure',async()=>{
    await setRow({last_successful_run_at:null,last_run_at:ago(0.5),last_started_at:ago(0.5),last_finished_at:ago(0.4),last_attempt_at:ago(0.6),last_status:'failed',last_error:'3 candidate(s) could not be anonymized.'})
    const row=await health()
    expect(row?.is_stale).toBe(true)
    expect(row?.fault_stage).toBe('run_failed')
    expect(row?.last_error).toContain('could not be anonymized')
  })

  /* Recovery: the banner must clear only because the condition genuinely cleared. */
  it('reports healthy once a recent run has completed successfully',async()=>{
    await setRow({last_successful_run_at:ago(0.5),last_run_at:ago(0.5),last_started_at:ago(0.5),last_finished_at:ago(0.4),last_attempt_at:ago(0.6),last_status:'succeeded',last_error:null,consecutive_failures:0})
    const row=await health()
    expect(row?.is_stale).toBe(false)
    expect(row?.fault_stage).toBe('healthy')
  })

  /* A success old enough to fall outside the staleness window is stale again -- a job that ran once
   * and stopped must not stay green on the strength of that one run. */
  it('goes stale again once the last success falls outside the window',async()=>{
    const row0=await readRow()
    await setRow({last_successful_run_at:ago(Number(row0.stale_after_hours)+1),last_run_at:ago(Number(row0.stale_after_hours)+1),last_status:'succeeded',last_error:null})
    const row=await health()
    expect(row?.is_stale).toBe(true)
    expect(row?.fault_stage).not.toBe('healthy')
  })
})

describe('scheduled maintenance privilege boundaries',()=>{
  it('refuses the heartbeat table to an unauthenticated client',async()=>{
    /* Default-deny: RLS on, zero policies. Anon must get nothing back -- not an error page, not a
     * row. Both shapes are accepted because PostgREST reports a blocked read as either. */
    const {data,error}=await unauthenticated.from('maintenance_heartbeats').select('*')
    expect(error?Boolean(error):(data||[]).length===0).toBe(true)
  })

  it('refuses health and diagnostics to an unauthenticated client',async()=>{
    const denied=await unauthenticated.rpc('get_maintenance_health',{p_organization_id:ORGANIZATION})
    expect(denied.error).not.toBeNull()
    const diagnostics=await unauthenticated.rpc('get_maintenance_diagnostics',{p_organization_id:ORGANIZATION})
    expect(diagnostics.error).not.toBeNull()
  })

  /* The trusted-setup primitives. Either being reachable from a browser session is an SSRF plus a
   * persistent arbitrary-cron primitive -- the exact finding 20260814120000 exists to close, now
   * covering the wrapper the cron actually calls as well. */
  it('refuses both cron primitives to authenticated and anonymous callers',async()=>{
    const HOOK='https://example.test/hook'
    for(const client of [owner,unauthenticated]){
      const scheduled=await client.rpc('schedule_maintenance_cron',{p_function_url:HOOK,p_worker_secret:'x'})
      expect(scheduled.error).not.toBeNull()
      const ran=await client.rpc('run_scheduled_maintenance',{p_function_url:HOOK,p_worker_secret:'x'})
      expect(ran.error).not.toBeNull()
    }
  })

  it('exposes diagnostics to an owner without leaking the worker secret',async()=>{
    const {data,error}=await owner.rpc('get_maintenance_diagnostics',{p_organization_id:ORGANIZATION})
    expect(error).toBeNull()
    /* The pg_net response BODY is deliberately never returned: it can echo the request headers, and
     * those carry the worker secret. Assert on the shape rather than on values, since whether a cron
     * row exists depends on whether the local stack has pg_cron installed. */
    const row=(data||[])[0]
    if(row){
      expect(Object.keys(row).sort()).toEqual(['cron_last_error','cron_last_run_at','cron_last_status','cron_registered','cron_schedule','transport_completed_at','transport_error','transport_status_code'])
      expect(JSON.stringify(row)).not.toContain('x-worker-secret')
    }
  })
})
