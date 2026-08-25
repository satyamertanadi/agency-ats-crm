import {createClient} from '@supabase/supabase-js'
import {afterAll,beforeAll,describe,expect,it} from 'vitest'

/* The Delivery Workbench, from the database's side.
 *
 * Three things are asserted here and nowhere else, because nowhere else can:
 *
 * 1. THE LADDER. public.submission_delivery_state is the single source of truth for what a delivery
 *    is doing, and the UI deliberately holds no second copy of it. Every arm and the exact
 *    three-calendar-day boundary are exercised by calling the function directly, which is far more
 *    honest than building seven fixtures and hoping each lands in the intended state.
 * 2. TENANT AND PERMISSION BOUNDARIES. list_delivery_workbench is security invoker; the handled RPC
 *    is security definer and therefore carries its own check. Both are asserted from a rival tenant
 *    and from a member without the permission.
 * 3. THE NEW email_deliveries READ POLICY. It is the one widening in this change, and the point of
 *    the tests below is that it widened exactly as far as intended -- client submissions, and not
 *    invitations.
 */

const url=process.env.SUPABASE_URL||'http://127.0.0.1:55321'
const anon=process.env.SUPABASE_ANON_KEY
if(!anon)throw new Error('SUPABASE_ANON_KEY is required; RLS tests must not silently skip.')

const owner=createClient(url,anon,{auth:{persistSession:false}})
const consultant=createClient(url,anon,{auth:{persistSession:false}})
const rival=createClient(url,anon,{auth:{persistSession:false}})
const readOnly=createClient(url,anon,{auth:{persistSession:false}})

const NORTHSTAR='30000000-0000-0000-0000-000000000001'
const RIVAL='30000000-0000-0000-0000-000000000002'
const JOB='80000000-0000-0000-0000-000000000001'
const SHORTLISTED='81000000-0000-0000-0000-000000000001'
const SCREENING='81000000-0000-0000-0000-000000000002'
/* The seeded owners of those two pipeline rows: Cara Consultant owns the first, Sam Sourcer the
 * second. The owner filter is asserted against them below. */
const CARA='40000000-0000-0000-0000-000000000003'

const required=<T,>(value:T|null|undefined,what:string):T=>{
  if(value===null||value===undefined)throw new Error(`${what} is required`)
  return value
}

interface CreatedDelivery{packageId:string;deliveryId:string}
const created:CreatedDelivery[]=[]

async function sendSubmission(jobCandidateId:string,title:string):Promise<CreatedDelivery>{
  const result=await owner.rpc('create_submission_delivery',{
    p_organization_id:NORTHSTAR,p_job_id:JOB,p_title:title,
    p_items:[{job_candidate_id:jobCandidateId,candidate_summary:'Strong commercial track record.'}],
    p_request_key:crypto.randomUUID(),
    p_recipient_name:'Atlas Hiring',p_recipient_email:`atlas+${Date.now()}${created.length}@example.test`,
  })
  expect(result.error).toBeNull()
  const payload=required(result.data as {package_id:string;delivery_id:string}|null,'submission delivery')
  const entry={packageId:payload.package_id,deliveryId:payload.delivery_id}
  created.push(entry)
  return entry
}

/* The workbench's grain is one candidate_submission, so tests read rows by that id rather than by
 * package. `p_state:'all'` because most assertions are about which row appears at all, not about
 * whether the default view happens to include it. */
async function workbench(client:typeof owner,args:Record<string,unknown>={}){
  const result=await client.rpc('list_delivery_workbench',{p_organization_id:NORTHSTAR,p_state:'all',...args})
  return result
}

let waitingPackage:CreatedDelivery
let revokedPackage:CreatedDelivery
let feedbackId:string
let invitationEmail:string

beforeAll(async()=>{
  const sessions=await Promise.all([
    owner.auth.signInWithPassword({email:'owner@northstar.local',password:'LocalTest!123'}),
    consultant.auth.signInWithPassword({email:'consultant@northstar.local',password:'LocalTest!123'}),
    rival.auth.signInWithPassword({email:'owner@rival.local',password:'LocalTest!123'}),
    readOnly.auth.signInWithPassword({email:'readonly@northstar.local',password:'LocalTest!123'}),
  ])
  for(const session of sessions)if(session.error)throw session.error

  waitingPackage=await sendSubmission(SHORTLISTED,'Delivery test — waiting')
  revokedPackage=await sendSubmission(SCREENING,'Delivery test — revoked')

  // Kill the second one's link, which is the 'link_unavailable' arm without waiting for an expiry.
  const link=await owner.from('public_submission_links').select('id').eq('package_id',revokedPackage.packageId).single()
  expect(link.error).toBeNull()
  const revoke=await owner.rpc('revoke_submission_link',{p_link_id:required(link.data?.id,'review link')})
  expect(revoke.error).toBeNull()

  /* Client feedback, written directly rather than through submit_submission_feedback: that function
   * is service_role-only by design (see 20260726010000) and the RLS suite has no service key. The
   * row it produces is the same shape, which is all the ladder reads. */
  const submission=await owner.from('candidate_submissions').select('id').eq('package_id',waitingPackage.packageId).single()
  expect(submission.error).toBeNull()
  const waitingLink=await owner.from('public_submission_links').select('id').eq('package_id',waitingPackage.packageId).single()
  expect(waitingLink.error).toBeNull()
  const feedback=await owner.from('submission_feedback').insert({
    organization_id:NORTHSTAR,link_id:required(waitingLink.data?.id,'link'),
    candidate_submission_id:required(submission.data?.id,'candidate submission'),
    decision:'interview',comments:'Happy to meet next week.',reviewer_name:'Atlas Hiring',
  }).select('id').single()
  expect(feedback.error).toBeNull()
  feedbackId=required(feedback.data?.id,'submission feedback')

  /* An invitation delivery, so the "did not widen" assertion below is testing something. Without a
   * non-submission row in the table, a consultant seeing nothing outside client_submission would be
   * true of an empty table too. */
  const role=await owner.from('roles').select('id').eq('organization_id',NORTHSTAR).eq('role_key','readonly').single()
  expect(role.error).toBeNull()
  invitationEmail=`delivery-policy-${Date.now()}@example.test`
  const invitation=await owner.rpc('create_invitation_delivery',{
    p_organization_id:NORTHSTAR,p_email:invitationEmail,
    p_role_id:required(role.data?.id,'readonly role'),p_request_key:crypto.randomUUID(),
  })
  expect(invitation.error).toBeNull()
})

afterAll(async()=>{
  /* submission_feedback references candidate_submissions WITHOUT on delete cascade, so it has to go
   * first or the package delete is refused. email_deliveries rows are deliberately left behind:
   * authenticated has no DELETE policy on that table, which is correct, and a handful of orphaned
   * local delivery rows harm nothing. */
  if(feedbackId)await owner.from('submission_feedback').delete().eq('id',feedbackId)
  for(const entry of created)await owner.from('submission_packages').delete().eq('id',entry.packageId)
  if(invitationEmail)await owner.from('organization_invitations').delete().eq('email',invitationEmail)
})

describe('the delivery state ladder',()=>{
  const NOW='2026-08-25T12:00:00Z'
  const day=(offset:number)=>new Date(Date.parse(NOW)+offset*86_400_000).toISOString()

  const state=async(overrides:Record<string,unknown>={})=>{
    const result=await owner.rpc('submission_delivery_state',{
      p_email_status:'sent',p_link_revoked_at:null,p_link_expires_at:day(7),p_link_opened_at:null,
      p_sent_at:NOW,p_feedback_at:null,p_handled_at:null,p_package_status:'shared',p_now:NOW,
      ...overrides,
    })
    expect(result.error).toBeNull()
    return result.data as string
  }

  it('agrees with the priority map on every arm it can return',async()=>{
    const expected={failed:1,link_unavailable:2,feedback_received:3,awaiting_feedback:4,not_opened:5,waiting:6,handled:7}
    for(const [name,rank] of Object.entries(expected)){
      const result=await owner.rpc('submission_delivery_priority',{p_state:name})
      expect(result.error).toBeNull()
      expect(result.data,`${name} ranks wrong`).toBe(rank)
    }
    /* An arm added to the ladder and forgotten in the map sinks quietly rather than claiming the top
     * of every consultant's queue. */
    const unknown=await owner.rpc('submission_delivery_priority',{p_state:'escalated'})
    expect(unknown.data).toBe(99)
  })

  it('reports a nothing-wrong-yet delivery as waiting',async()=>{
    expect(await state()).toBe('waiting')
  })

  /* The worst state there is: the client never received it, so nothing downstream of it means
   * anything. All three provider outcomes read the same to the consultant. */
  it('reports every unsuccessful provider outcome as failed',async()=>{
    for(const status of ['failed','bounced','suppressed']){
      expect(await state({p_email_status:status}),status).toBe('failed')
    }
    // 'pending' is not a failure -- the send simply has not happened yet.
    expect(await state({p_email_status:'pending'})).toBe('waiting')
  })

  it('reports a revoked or expired link as unavailable',async()=>{
    expect(await state({p_link_revoked_at:day(-1)})).toBe('link_unavailable')
    expect(await state({p_link_expires_at:day(-1)})).toBe('link_unavailable')
    // Exactly at the expiry instant counts as expired: a link that cannot be opened is unavailable.
    expect(await state({p_link_expires_at:NOW})).toBe('link_unavailable')
  })

  it('reports an answer nobody has acted on as feedback received',async()=>{
    expect(await state({p_feedback_at:day(-1)})).toBe('feedback_received')
  })

  /* Handled beats a dead link on purpose. Priority orders 'handled' last, but the LADDER checks it
   * early: a finished thread that reappeared under Needs attention because its link later expired
   * would make the queue impossible to clear, and a queue people cannot clear is one they stop
   * reading. */
  it('reports a handled answer as handled, even once the link has died',async()=>{
    expect(await state({p_feedback_at:day(-2),p_handled_at:day(-1)})).toBe('handled')
    expect(await state({p_feedback_at:day(-2),p_handled_at:day(-1),p_link_expires_at:day(-1)})).toBe('handled')
    expect(await state({p_package_status:'closed',p_link_revoked_at:day(-1)})).toBe('handled')
    expect(await state({p_package_status:'closed',p_email_status:'bounced'})).toBe('handled')
  })

  /* THE BOUNDARY. Three calendar days, and the fixtures sit at noon on both ends so the calendar-day
   * difference is the same in any session timezone -- a fixture at 23:00 would flip depending on the
   * server's TimeZone setting and make this test a coin toss. */
  describe('the three-day threshold',()=>{
    it('is still waiting at two days, in both the opened and unopened arms',async()=>{
      expect(await state({p_sent_at:day(-2)})).toBe('waiting')
      expect(await state({p_sent_at:day(-4),p_link_opened_at:day(-2)})).toBe('waiting')
    })

    it('turns at exactly three days',async()=>{
      expect(await state({p_sent_at:day(-3)})).toBe('not_opened')
      expect(await state({p_sent_at:day(-6),p_link_opened_at:day(-3)})).toBe('awaiting_feedback')
    })

    it('stays turned beyond it',async()=>{
      expect(await state({p_sent_at:day(-30)})).toBe('not_opened')
      expect(await state({p_sent_at:day(-40),p_link_opened_at:day(-30)})).toBe('awaiting_feedback')
    })

    /* Opened outranks never-opened: a client who looked and said nothing is a different conversation
     * from one who never received it, and the first is the more chaseable of the two. */
    it('prefers the opened arm when both would qualify',async()=>{
      expect(await state({p_sent_at:day(-10),p_link_opened_at:day(-9)})).toBe('awaiting_feedback')
    })

    it('names the same threshold the UI copy does',async()=>{
      const result=await owner.rpc('submission_delivery_waiting_days')
      expect(result.error).toBeNull()
      expect(result.data).toBe(3)
    })
  })
})

describe('the delivery list',()=>{
  it('returns one row per candidate submission, not per package',async()=>{
    const result=await workbench(owner)
    expect(result.error).toBeNull()
    const rows=(result.data||[]) as {package_id:string;candidate_submission_id:string}[]
    const ours=rows.filter((row)=>created.some((entry)=>entry.packageId===row.package_id))
    expect(ours).toHaveLength(2)
    expect(new Set(ours.map((row)=>row.candidate_submission_id)).size).toBe(2)
  })

  /* The same candidate sent to two clients owes two replies. This is the property a package-grained
   * row could not express, and it is why the grain is what it is. */
  it('reports one candidate sent twice as two truthful rows',async()=>{
    const second=await sendSubmission(SHORTLISTED,'Delivery test — second send')
    const result=await workbench(owner)
    const rows=(result.data||[]) as {package_id:string;job_candidate_id:string}[]
    const forCandidate=rows.filter((row)=>row.job_candidate_id===SHORTLISTED)
    expect(forCandidate.length).toBeGreaterThanOrEqual(2)
    expect(forCandidate.some((row)=>row.package_id===second.packageId)).toBe(true)
    expect(forCandidate.some((row)=>row.package_id===waitingPackage.packageId)).toBe(true)
  })

  it('derives the state and its urgency on every read',async()=>{
    const result=await workbench(owner)
    const rows=(result.data||[]) as {package_id:string;delivery_state:string;delivery_priority:number}[]
    const revoked=rows.find((row)=>row.package_id===revokedPackage.packageId)
    expect(revoked?.delivery_state).toBe('link_unavailable')
    expect(revoked?.delivery_priority).toBe(2)
    const answered=rows.find((row)=>row.package_id===waitingPackage.packageId)
    expect(answered?.delivery_state).toBe('feedback_received')
    expect(answered?.delivery_priority).toBe(3)
  })

  it('orders by urgency before recency',async()=>{
    const result=await workbench(owner)
    const rows=(result.data||[]) as {delivery_priority:number}[]
    const priorities=rows.map((row)=>row.delivery_priority)
    expect([...priorities].sort((a,b)=>a-b)).toEqual(priorities)
  })

  it('filters to the quick view on the server', async()=>{
    const handledOnly=await workbench(owner,{p_state:'handled'})
    expect(handledOnly.error).toBeNull()
    const states=((handledOnly.data||[]) as {delivery_state:string}[]).map((row)=>row.delivery_state)
    expect(states.every((state)=>state==='handled')).toBe(true)

    const attention=await workbench(owner,{p_state:'needs_attention'})
    const attentionStates=((attention.data||[]) as {delivery_state:string}[]).map((row)=>row.delivery_state)
    expect(attentionStates).toContain('link_unavailable')
    expect(attentionStates).not.toContain('waiting')
    expect(attentionStates).not.toContain('handled')
  })

  /* An unrecognised state falls through to "everything" rather than to nothing. A typo'd URL should
   * show a consultant too much, never silently hide their work. */
  it('treats an unknown quick view as all',async()=>{
    const all=await workbench(owner,{p_state:'all'})
    const nonsense=await workbench(owner,{p_state:'urgent'})
    expect((nonsense.data||[]).length).toBe((all.data||[]).length)
  })

  it('filters by owner, falling back to the job owner',async()=>{
    const result=await workbench(owner,{p_owner_member_id:CARA})
    expect(result.error).toBeNull()
    const rows=(result.data||[]) as {owner_member_id:string;job_candidate_id:string}[]
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((row)=>row.owner_member_id===CARA)).toBe(true)
    // The screening row is owned by Sam Sourcer, so it must not appear under Cara.
    expect(rows.some((row)=>row.job_candidate_id===SCREENING)).toBe(false)
  })

  it('searches candidate, job, client and package on the server',async()=>{
    const byPackage=await workbench(owner,{p_query:'Delivery test — revoked'})
    expect(byPackage.error).toBeNull()
    const rows=(byPackage.data||[]) as {package_id:string}[]
    expect(rows.map((row)=>row.package_id)).toEqual([revokedPackage.packageId])

    const byJob=await workbench(owner,{p_query:'Regional Commercial'})
    expect(((byJob.data||[]) as unknown[]).length).toBeGreaterThan(0)

    const nothing=await workbench(owner,{p_query:'no such client anywhere'})
    expect(nothing.data).toEqual([])
  })

  it('pages, and reports the full size of the filtered set on every page',async()=>{
    const first=await workbench(owner,{p_limit:1,p_offset:0})
    expect(first.error).toBeNull()
    const firstRows=(first.data||[]) as {total_count:number;candidate_submission_id:string}[]
    expect(firstRows).toHaveLength(1)
    const total=Number(firstRows[0]?.total_count)
    expect(total).toBeGreaterThan(1)

    const second=await workbench(owner,{p_limit:1,p_offset:1})
    const secondRows=(second.data||[]) as {total_count:number;candidate_submission_id:string}[]
    expect(secondRows).toHaveLength(1)
    // The count is of the filtered set, not of the page.
    expect(Number(secondRows[0]?.total_count)).toBe(total)
    expect(secondRows[0]?.candidate_submission_id).not.toBe(firstRows[0]?.candidate_submission_id)
  })

  it('caps an absurd page size rather than returning the archive',async()=>{
    const result=await workbench(owner,{p_limit:100000})
    expect(result.error).toBeNull()
    expect(((result.data||[]) as unknown[]).length).toBeLessThanOrEqual(200)
  })
})

describe('tenant and permission boundaries',()=>{
  it('returns nothing to a rival tenant asking for this organisation',async()=>{
    const result=await rival.rpc('list_delivery_workbench',{p_organization_id:NORTHSTAR,p_state:'all'})
    expect(result.error).toBeNull()
    expect(result.data).toEqual([])
  })

  it('returns nothing about a rival tenant to this organisation',async()=>{
    const result=await owner.rpc('list_delivery_workbench',{p_organization_id:RIVAL,p_state:'all'})
    expect(result.error).toBeNull()
    expect(result.data).toEqual([])
  })

  it('serves a consultant who holds submissions.read',async()=>{
    const result=await consultant.rpc('list_delivery_workbench',{p_organization_id:NORTHSTAR,p_state:'all'})
    expect(result.error).toBeNull()
    expect(((result.data||[]) as unknown[]).length).toBeGreaterThan(0)
  })

  /* The one widening in this change. Before it, email_deliveries was readable only by
   * organization.manage or by whoever requested the send -- so a consultant in Team view would see
   * their own failures and none of anyone else's, which makes Needs attention wrong in exactly the
   * state that matters most. */
  describe('the client-submission delivery read policy',()=>{
    it('lets a colleague read a submission delivery they did not request',async()=>{
      const result=await consultant.from('email_deliveries')
        .select('id,status,email_type').eq('id',waitingPackage.deliveryId)
      expect(result.error).toBeNull()
      expect(result.data).toHaveLength(1)
      expect(result.data?.[0]?.email_type).toBe('client_submission')
    })

    /* Widened exactly as far as intended. Invitations are about people rather than about work and
     * stay behind organization.manage; a consultant must not gain a list of who has been invited. */
    it('does not widen invitation or calendar deliveries',async()=>{
      // The owner can see it, so it definitely exists -- which is what makes the consultant's empty
      // result a statement about the policy rather than about an empty table.
      const asOwner=await owner.from('email_deliveries').select('id').eq('email_type','team_invitation')
      expect((asOwner.data||[]).length).toBeGreaterThan(0)
      const result=await consultant.from('email_deliveries')
        .select('id,email_type').neq('email_type','client_submission')
      expect(result.error).toBeNull()
      expect(result.data).toEqual([])
    })

    it('does not cross the tenant boundary',async()=>{
      const result=await rival.from('email_deliveries').select('id').eq('id',waitingPackage.deliveryId)
      expect(result.error).toBeNull()
      expect(result.data).toEqual([])
    })
  })
})

describe('marking a client answer handled',()=>{
  it('refuses a feedback row in another organisation, without saying whether it exists',async()=>{
    const result=await rival.rpc('set_submission_feedback_handled',{p_feedback_id:feedbackId,p_handled:true})
    expect(result.error).not.toBeNull()
    expect(result.error?.message).toContain('Client feedback not found')
    const untouched=await owner.from('submission_feedback').select('handled_at').eq('id',feedbackId).single()
    expect(untouched.data?.handled_at).toBeNull()
  })

  it('refuses a member without submissions.write',async()=>{
    const result=await readOnly.rpc('set_submission_feedback_handled',{p_feedback_id:feedbackId,p_handled:true})
    expect(result.error).not.toBeNull()
    expect(result.error?.message).toContain('Client feedback not found')
  })

  it('records who handled it and when, and audits the act',async()=>{
    const result=await owner.rpc('set_submission_feedback_handled',{p_feedback_id:feedbackId,p_handled:true})
    expect(result.error).toBeNull()
    const stored=await owner.from('submission_feedback').select('handled_at,handled_by').eq('id',feedbackId).single()
    expect(stored.data?.handled_at).not.toBeNull()
    expect(stored.data?.handled_by).toBe('10000000-0000-0000-0000-000000000001')

    const audit=await owner.from('audit_logs').select('action,entity_id,metadata')
      .eq('entity_id',feedbackId).eq('action','submission_feedback.handled')
    expect(audit.error).toBeNull()
    expect((audit.data||[]).length).toBeGreaterThan(0)
    /* Ids and the decision only. The client's free-text comment is the one thing on this row that
     * must never be copied into a permanent, immutable ledger. */
    expect(JSON.stringify(audit.data)).not.toContain('Happy to meet next week.')
  })

  it('moves the row out of Needs attention and into Handled',async()=>{
    const attention=await workbench(owner,{p_state:'needs_attention'})
    const attentionPackages=((attention.data||[]) as {package_id:string}[]).map((row)=>row.package_id)
    expect(attentionPackages).not.toContain(waitingPackage.packageId)

    const handled=await workbench(owner,{p_state:'handled'})
    const handledPackages=((handled.data||[]) as {package_id:string}[]).map((row)=>row.package_id)
    expect(handledPackages).toContain(waitingPackage.packageId)
  })

  it('reopens through the same RPC, and audits that too',async()=>{
    const result=await owner.rpc('set_submission_feedback_handled',{p_feedback_id:feedbackId,p_handled:false})
    expect(result.error).toBeNull()
    const stored=await owner.from('submission_feedback').select('handled_at,handled_by').eq('id',feedbackId).single()
    expect(stored.data?.handled_at).toBeNull()
    expect(stored.data?.handled_by).toBeNull()
    const audit=await owner.from('audit_logs').select('action').eq('entity_id',feedbackId).eq('action','submission_feedback.reopened')
    expect((audit.data||[]).length).toBeGreaterThan(0)
  })

  /* A client who comes back and changes their mind updates the existing feedback row in place --
   * submit_submission_feedback upserts on (link_id,candidate_submission_id) -- and the migration adds
   * two lines to that ON CONFLICT clause clearing the handled state, so a revised answer does not
   * inherit the old one's.
   *
   * That function is service_role-only by design and this suite has no service key, so what is
   * asserted here is the half that IS reachable: once handled_at goes back to null, the row returns
   * to Needs attention. The clause itself is pinned by reading the migration, in
   * src/features/submissions/deliveryState.test.ts. */
  it('returns to Needs attention as soon as the handled state is cleared',async()=>{
    await owner.rpc('set_submission_feedback_handled',{p_feedback_id:feedbackId,p_handled:true})
    const handledRows=await workbench(owner,{p_state:'needs_attention'})
    expect(((handledRows.data||[]) as {package_id:string}[]).map((row)=>row.package_id)).not.toContain(waitingPackage.packageId)

    const revised=await owner.from('submission_feedback')
      .update({decision:'reject',handled_at:null,handled_by:null}).eq('id',feedbackId).select('handled_at').single()
    expect(revised.error).toBeNull()
    expect(revised.data?.handled_at).toBeNull()
    const rows=await workbench(owner,{p_state:'needs_attention'})
    expect(((rows.data||[]) as {package_id:string}[]).map((row)=>row.package_id)).toContain(waitingPackage.packageId)
  })
})
