import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {describe,expect,it} from 'vitest'
import {DELIVERY_WAITING_DAYS,deliveryAction,deliveryQuickViews,deliveryStates,deliveryStateDefinition,parseDeliveryQuickView} from './deliveryState'
import type {DeliveryWorkbenchRow} from '../../shared/types/domain'

/* This module deliberately does NOT decide what state a delivery is in -- public.submission_delivery_state
 * does, so the list can be filtered and ordered by it on the server. What is asserted here is the
 * half that lives in TypeScript: that every state the SQL can return has a label and a stated rule,
 * that the quick views map onto states the SQL actually knows about, and that the next action is a
 * function of the state alone.
 *
 * The first test pins the two halves together by reading the migration. It is the only thing standing
 * between "the ladder gained an arm" and a column that renders a raw snake_case token to a
 * consultant, and it costs one file read. */

/* Resolved from the Vitest root rather than from import.meta.url: these files run under jsdom, where
 * import.meta.url is an http:// URL and fileURLToPath refuses it. */
const migration=readFileSync(resolve(process.cwd(),'supabase/migrations/20260826000000_delivery_workbench.sql'),'utf8')

const row=(overrides:Partial<DeliveryWorkbenchRow>={})=>({
  candidate_submission_id:'cs-1',package_id:'p-1',job_id:'j-1',job_candidate_id:'jc-1',
  candidate_id:'c-1',candidate_name:'Ni Putu Widya',job_title:'Finance Manager',company_name:'PT Sinar',
  package_title:'Finance shortlist',sent_at:'2026-08-20T09:00:00Z',recipient_email:'client@example.test',
  link_id:'l-1',link_expires_at:'2026-08-27T09:00:00Z',link_revoked_at:null,opened_at:null,
  email_delivery_id:'d-1',email_status:'sent',email_error:null,
  feedback_id:null,feedback_decision:null,feedback_at:null,handled_at:null,
  owner_member_id:'m-1',owner_name:'Satya Mertanadi',delivery_state:'waiting',delivery_priority:6,total_count:1,
  ...overrides,
} as DeliveryWorkbenchRow)

describe('delivery state vocabulary',()=>{
  /* The SQL is the source of truth, so drift can only be detected by reading it. A state added to the
   * ladder without a label here would render its own identifier in the State column. */
  it('has a label and a rule for every arm the migration can return',()=>{
    // Scoped to the ladder's own body, so the quick-view CASE in the list RPC and the priority map
    // cannot contribute tokens that are not states.
    const start=migration.indexOf('create or replace function public.submission_delivery_state')
    const body=migration.slice(start,migration.indexOf('$$;',start))
    const arms=[...body.matchAll(/(?:then|else) '([a-z_]+)'/g)].map((match)=>match[1])
    const fromSql=new Set(arms.filter((arm)=>arm!==undefined))
    // Sanity: if this slice or regex ever stops matching, the test would pass vacuously.
    expect(start).toBeGreaterThan(0)
    expect(fromSql.size).toBeGreaterThanOrEqual(7)
    for(const state of fromSql)expect(deliveryStates.map((entry)=>entry.id)).toContain(state)
    for(const state of deliveryStates)expect(fromSql).toContain(state.id)
  })

  /* One number, three places it is read: the SQL ladder, the UI copy, and the tests. This is the
   * assertion that keeps them one number rather than three. */
  it('names the same waiting threshold the migration does',()=>{
    const declared=migration.match(/returns integer language sql immutable set search_path=public as \$\$\s*select (\d+)/)
    expect(declared?.[1]).toBe(String(DELIVERY_WAITING_DAYS))
    expect(DELIVERY_WAITING_DAYS).toBe(3)
  })

  it('states the rule for every label, so an unfamiliar badge can be explained on hover',()=>{
    for(const state of deliveryStates){
      expect(state.rule.length).toBeGreaterThan(20)
      expect(state.label).not.toContain('_')
    }
  })

  /* Colour carries state, never decoration. 'bad' is reserved for the two states where the client
   * cannot act at all -- if everything is red, nothing is. */
  it('reserves the alarm tone for the two states the client cannot act on',()=>{
    const bad=deliveryStates.filter((state)=>state.tone==='bad').map((state)=>state.id)
    expect(bad).toEqual(['failed','link_unavailable'])
  })

  /* A server can ship a new arm before the screen learns about it. Rendering the raw token is a worse
   * outcome than a friendly label but a much better one than a blank cell or a crash. */
  it('renders an unknown state as itself rather than as nothing',()=>{
    const unknown=deliveryStateDefinition('escalated')
    expect(unknown.label).toBe('escalated')
    expect(unknown.tone).toBe('neutral')
  })
})

/* Two properties of the migration that no runnable test in this repo can reach.
 *
 * submit_submission_feedback is service_role-only by design (20260726010000), so the RLS suite --
 * which authenticates as ordinary users -- cannot call it, and there is no service key in it. Reading
 * the source is a weaker assertion than exercising the function, and it is stated as such; it is
 * still the difference between "we thought about this" and "nothing checks it". */
describe('the migration itself',()=>{
  /* A client who comes back and changes their mind updates the existing feedback row in place, so
   * without these two lines the revised answer would inherit the previous one's handled state and
   * never reach anybody's queue. */
  it('clears the handled state when a client revises their answer',()=>{
    const clause=migration.slice(migration.indexOf('on conflict(link_id,candidate_submission_id)'))
    const upsert=clause.slice(0,clause.indexOf('returning id into feedback_id'))
    expect(upsert).toContain('handled_at=null')
    expect(upsert).toContain('handled_by=null')
  })

  /* `create or replace function` preserves the previous ACL, and this repo has shipped the
   * regression of dropping the revoke/grant pair three times -- see the header of 20260726010000. */
  it('reissues the revoke and grant it inherits, so the anon lockdown is not silently restored',()=>{
    expect(migration).toContain('revoke all on function public.submit_submission_feedback(text,uuid,text,text,text) from public, anon, authenticated;')
    expect(migration).toContain('grant execute on function public.submit_submission_feedback(text,uuid,text,text,text) to service_role;')
  })

  /* Nothing here may be reachable by anon or PUBLIC. tests/rls/rpc-acl.test.ts is the real guard
   * against that, but it needs a live database; this catches the missing line at review time. */
  it('locks every function it adds away from anon and PUBLIC',()=>{
    for(const name of ['submission_delivery_waiting_days','submission_delivery_state',
      'submission_delivery_priority','list_delivery_workbench','set_submission_feedback_handled']){
      expect(migration,`${name} is not revoked`).toContain(`revoke all on function public.${name}(`)
      expect(migration,`${name} is not granted`).toContain(`grant execute on function public.${name}(`)
    }
  })

  /* Security invoker is the default this repo requires, and the one exception is deliberate: the
   * handled RPC writes audit_logs, which authenticated has no INSERT privilege on at all. */
  it('keeps the list on invoker rights and elevates only the audited write',()=>{
    expect(migration).toContain('language plpgsql stable security invoker set search_path=public')
    const definers=[...migration.matchAll(/create or replace function public\.([a-z_]+)\([^)]*\)[\s\S]{0,200}?security definer/g)]
      .map((match)=>match[1])
    expect(definers).toEqual(['set_submission_feedback_handled','submit_submission_feedback'])
  })
})

describe('quick views',()=>{
  /* Each quick view is one value of ?deliveryState=, resolved by the CASE in list_delivery_workbench.
   * A view the SQL does not branch on would silently show everything. */
  it('is a set the migration actually branches on',()=>{
    for(const view of deliveryQuickViews){
      if(view.id==='all')continue
      expect(migration).toContain(`when $4='${view.id}'`)
    }
  })

  it('defaults to Needs attention, which is what the screen is for',()=>{
    expect(parseDeliveryQuickView(null)).toBe('needs_attention')
    expect(parseDeliveryQuickView('')).toBe('needs_attention')
  })

  /* Fails to the default rather than to a strip with nothing selected. The server treats an unknown
   * value as "all"; a UI that showed no active tab while the server showed everything would be two
   * different answers to the same URL. */
  it('treats an unrecognised value as the default',()=>{
    expect(parseDeliveryQuickView('urgent')).toBe('needs_attention')
    expect(parseDeliveryQuickView(' waiting ')).toBe('waiting')
  })

  it('round-trips every view it offers',()=>{
    for(const view of deliveryQuickViews)expect(parseDeliveryQuickView(view.id)).toBe(view.id)
  })
})

describe('the next action for a row',()=>{
  it('offers a retry only when there is a delivery to retry',()=>{
    expect(deliveryAction(row({delivery_state:'failed',email_delivery_id:'d-1'})).kind).toBe('retry_email')
    // No delivery row means send-submission has nothing to retry, so the honest fix is a fresh link.
    expect(deliveryAction(row({delivery_state:'failed',email_delivery_id:null})).kind).toBe('resend_link')
  })

  it('sends a dead link back to the composer rather than growing a second send form',()=>{
    const action=deliveryAction(row({delivery_state:'link_unavailable'}))
    expect(action.kind).toBe('resend_link')
    expect(action.needsWrite).toBe(true)
  })

  it('offers handling in both directions',()=>{
    expect(deliveryAction(row({delivery_state:'feedback_received',feedback_id:'f-1'})).kind).toBe('mark_handled')
    expect(deliveryAction(row({delivery_state:'handled',feedback_id:'f-1'})).kind).toBe('reopen')
  })

  /* Chasing a client is a conversation, not a button. The useful step for a silent client is to open
   * the candidate in the job, where what was actually sent is visible. */
  it('sends the waiting states to the candidate rather than inventing a chase button',()=>{
    for(const state of ['waiting','awaiting_feedback','not_opened']){
      const action=deliveryAction(row({delivery_state:state}))
      expect(action.kind).toBe('open_candidate')
      expect(action.needsWrite).toBe(false)
    }
  })

  it('gives every state an action, including one it has never heard of',()=>{
    for(const state of [...deliveryStates.map((entry)=>entry.id),'escalated']){
      expect(deliveryAction(row({delivery_state:state,feedback_id:'f-1'})).label.length).toBeGreaterThan(0)
    }
  })
})
