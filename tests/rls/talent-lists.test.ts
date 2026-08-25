import {createClient} from '@supabase/supabase-js'
import {afterAll,beforeAll,describe,expect,it} from 'vitest'

/* Talent Lists, from the database's side.
 *
 * Four things are asserted here and nowhere else:
 *
 * 1. VISIBILITY. A private list belongs to one member. The interesting case is not "a colleague
 *    cannot open it" -- it is that the colleague cannot detect it either, through the picker, through
 *    the membership rows, or by pointing the candidate search at its id and reading the result.
 * 2. WHO MAY EDIT. Readable and writable are different questions for a shared list, and the answer to
 *    the second is the owner (or an admin) in both visibility modes.
 * 3. IDEMPOTENCY AND ITS COUNTS. Adding the same candidate twice is one row and one skip, and the
 *    numbers the RPC returns are the numbers the UI reports -- so they are asserted, not assumed.
 * 4. THE TENANT BOUNDARY. A list id from another workspace, and a candidate id from another
 *    workspace, are both refused -- and refused the same way, so neither confirms the other exists.
 *
 * Deliberately also asserted: that membership grants NOTHING. A do-not-contact candidate can sit on
 * a list, which is the point -- a record of who was considered outlives the decision not to approach
 * them -- and the list must not become a way around the restriction.
 */

const url=process.env.SUPABASE_URL||'http://127.0.0.1:55321'
const anon=process.env.SUPABASE_ANON_KEY
if(!anon)throw new Error('SUPABASE_ANON_KEY is required; RLS tests must not silently skip.')

const owner=createClient(url,anon,{auth:{persistSession:false}})
/* Cara the consultant: a colleague in the same workspace, holding candidates.read. She is who the
 * visibility rules are actually about. */
const colleague=createClient(url,anon,{auth:{persistSession:false}})
const rival=createClient(url,anon,{auth:{persistSession:false}})

const NORTHSTAR='30000000-0000-0000-0000-000000000001'
const RIVAL='30000000-0000-0000-0000-000000000002'
const OWNER_MEMBER='40000000-0000-0000-0000-000000000001'

const createdLists:string[]=[]
const createdCandidates:string[]=[]

async function makeList(client:typeof owner,name:string,visibility:'private'|'workspace'='private',organizationId=NORTHSTAR){
  const result=await client.rpc('create_candidate_list',{p_organization_id:organizationId,p_name:name,p_visibility:visibility})
  expect(result.error).toBeNull()
  const list=result.data as {id:string}
  createdLists.push(list.id)
  return list.id
}

async function makeCandidate(fields:Record<string,unknown>={},organizationId=NORTHSTAR,client=owner){
  // created_by has to be the user actually inserting: the rival fixtures are written by the rival
  // workspace's own owner, and attributing them to a Northstar user would be a cross-tenant write in
  // the very test asserting cross-tenant writes are refused.
  const createdBy=organizationId===RIVAL
    ?'20000000-0000-0000-0000-000000000001'
    :'10000000-0000-0000-0000-000000000001'
  const result=await client.from('candidates').insert({
    organization_id:organizationId,created_by:createdBy,
    full_name:'List Fixture',status:'active',...fields,
  }).select('id').single()
  expect(result.error).toBeNull()
  const id=(result.data as {id:string}).id
  createdCandidates.push(id)
  return id
}

beforeAll(async()=>{
  const sessions=await Promise.all([
    owner.auth.signInWithPassword({email:'owner@northstar.local',password:'LocalTest!123'}),
    colleague.auth.signInWithPassword({email:'consultant@northstar.local',password:'LocalTest!123'}),
    rival.auth.signInWithPassword({email:'owner@rival.local',password:'LocalTest!123'}),
  ])
  for(const session of sessions)if(session.error)throw session.error
})

afterAll(async()=>{
  // Membership rows cascade from the list, so the lists go first and nothing is left orphaned.
  for(const id of createdLists)await owner.from('candidate_lists').delete().eq('id',id)
  for(const id of createdCandidates)await owner.from('candidates').delete().eq('id',id)
})

describe('visibility',()=>{
  it('keeps a private list out of a colleague picker',async()=>{
    const listId=await makeList(owner,`Private ${Date.now()}`)
    const mine=await colleague.rpc('list_candidate_lists',{p_organization_id:NORTHSTAR})
    expect(mine.error).toBeNull()
    expect((mine.data as {id:string}[]).map((list)=>list.id)).not.toContain(listId)
  })

  it('shows a workspace list to a colleague',async()=>{
    const listId=await makeList(owner,`Shared ${Date.now()}`,'workspace')
    const theirs=await colleague.rpc('list_candidate_lists',{p_organization_id:NORTHSTAR})
    expect(theirs.error).toBeNull()
    expect((theirs.data as {id:string}[]).map((list)=>list.id)).toContain(listId)
  })

  /* The membership rows are the other half of the same question. A visibility rule that hid the list
   * but left its contents readable would be no rule at all. */
  it('hides the membership of a private list from a colleague',async()=>{
    const listId=await makeList(owner,`Private members ${Date.now()}`)
    const candidateId=await makeCandidate({full_name:'Hidden Member'})
    expect((await owner.rpc('add_candidates_to_list',{p_list_id:listId,p_candidate_ids:[candidateId]})).error).toBeNull()

    const rows=await colleague.from('candidate_list_members').select('id').eq('list_id',listId)
    expect(rows.error).toBeNull()
    expect(rows.data).toEqual([])
  })

  /* The one that matters most. Pointing the candidate search at a private list id must return an
   * empty page -- indistinguishable from an empty list -- rather than its contents or an error that
   * would confirm the list is real. */
  it('makes another member private list inert as a search filter',async()=>{
    const listId=await makeList(owner,`Probe ${Date.now()}`)
    const candidateId=await makeCandidate({full_name:'Probe Member'})
    expect((await owner.rpc('add_candidates_to_list',{p_list_id:listId,p_candidate_ids:[candidateId]})).error).toBeNull()

    const seen=await owner.rpc('search_candidates_page',{p_organization_id:NORTHSTAR,p_list:listId,p_limit:100})
    expect(seen.error).toBeNull()
    expect((seen.data as {id:string}[]).map((row)=>row.id)).toContain(candidateId)

    const probed=await colleague.rpc('search_candidates_page',{p_organization_id:NORTHSTAR,p_list:listId,p_limit:100})
    // Not an error: an error is itself information about a list they are not allowed to know exists.
    expect(probed.error).toBeNull()
    expect(probed.data).toEqual([])
  })

  /* The counts above the enrichment queue read through the same filter, so they must agree with the
   * rows -- including when the rows are empty because the list is not the caller's to see. */
  it('counts nothing for a list the caller cannot see',async()=>{
    const listId=await makeList(owner,`Counted ${Date.now()}`)
    const candidateId=await makeCandidate({full_name:'Counted Member',current_position:null,location:null})
    expect((await owner.rpc('add_candidates_to_list',{p_list_id:listId,p_candidate_ids:[candidateId]})).error).toBeNull()

    const mine=await owner.rpc('candidate_quality_summary',{p_organization_id:NORTHSTAR,p_list:listId})
    expect(mine.error).toBeNull()
    expect((mine.data as unknown[]).length).toBeGreaterThan(0)

    const theirs=await colleague.rpc('candidate_quality_summary',{p_organization_id:NORTHSTAR,p_list:listId})
    expect(theirs.error).toBeNull()
    expect(theirs.data).toEqual([])
  })
})

describe('who may edit',()=>{
  /* Shared does not mean communal. A colleague can use the list and cannot rewrite it -- the same
   * rule saved_views settled on, and for the same reason: a curated set a colleague can silently
   * change is not a curated set. */
  it('refuses a rename of a shared list by someone who does not own it',async()=>{
    const listId=await makeList(owner,`Shared rename ${Date.now()}`,'workspace')
    const attempt=await colleague.rpc('update_candidate_list',{p_list_id:listId,p_name:'Renamed by a colleague'})
    expect(attempt.error).not.toBeNull()
  })

  it('refuses membership changes to a shared list by someone who does not own it',async()=>{
    const listId=await makeList(owner,`Shared members ${Date.now()}`,'workspace')
    const candidateId=await makeCandidate({full_name:'Not Theirs To Add'})
    const attempt=await colleague.rpc('add_candidates_to_list',{p_list_id:listId,p_candidate_ids:[candidateId]})
    expect(attempt.error).not.toBeNull()
  })

  it('lets the owner rename and archive their own list',async()=>{
    const listId=await makeList(owner,`Mine ${Date.now()}`)
    const renamed=await owner.rpc('update_candidate_list',{p_list_id:listId,p_name:'Renamed by its owner'})
    expect(renamed.error).toBeNull()
    expect((renamed.data as {name:string}).name).toBe('Renamed by its owner')

    const archived=await owner.rpc('set_candidate_list_archived',{p_list_id:listId,p_archived:true})
    expect(archived.error).toBeNull()
    expect((archived.data as {archived_at:string|null}).archived_at).not.toBeNull()

    // Archiving takes it out of the picker without deleting it, so it is still there to restore.
    const live=await owner.rpc('list_candidate_lists',{p_organization_id:NORTHSTAR})
    expect((live.data as {id:string}[]).map((list)=>list.id)).not.toContain(listId)
    const all=await owner.rpc('list_candidate_lists',{p_organization_id:NORTHSTAR,p_include_archived:true})
    expect((all.data as {id:string}[]).map((list)=>list.id)).toContain(listId)
  })

  /* Direct writes are denied by the ABSENCE of a policy rather than by one restating the ownership
   * rule. This is the assertion that keeps that decision honest. */
  it('refuses a direct insert that bypasses the RPC',async()=>{
    const listId=await makeList(owner,`Direct ${Date.now()}`)
    const candidateId=await makeCandidate({full_name:'Direct Insert'})
    const attempt=await owner.from('candidate_list_members')
      .insert({organization_id:NORTHSTAR,list_id:listId,candidate_id:candidateId})
    expect(attempt.error).not.toBeNull()
  })

  it('refuses a direct insert of a list row',async()=>{
    const attempt=await owner.from('candidate_lists')
      .insert({organization_id:NORTHSTAR,owner_member_id:OWNER_MEMBER,name:'Straight to the table'})
    expect(attempt.error).not.toBeNull()
  })
})

describe('membership',()=>{
  it('adds once and reports the duplicate as skipped',async()=>{
    const listId=await makeList(owner,`Idempotent ${Date.now()}`)
    const first=await makeCandidate({full_name:'First Member'})
    const second=await makeCandidate({full_name:'Second Member'})

    const initial=await owner.rpc('add_candidates_to_list',{p_list_id:listId,p_candidate_ids:[first,second]})
    expect(initial.error).toBeNull()
    expect(initial.data).toEqual([{added:2,skipped:0}])

    const again=await owner.rpc('add_candidates_to_list',{p_list_id:listId,p_candidate_ids:[first,second]})
    expect(again.error).toBeNull()
    expect(again.data).toEqual([{added:0,skipped:2}])

    const rows=await owner.from('candidate_list_members').select('id').eq('list_id',listId)
    expect(rows.data).toHaveLength(2)
  })

  /* The same id twice in ONE call is the caller's duplicate, not the list's. Counting it as skipped
   * would report a collision that never happened. */
  it('collapses a repeated id within a single call',async()=>{
    const listId=await makeList(owner,`Repeated ${Date.now()}`)
    const candidateId=await makeCandidate({full_name:'Sent Twice'})
    const result=await owner.rpc('add_candidates_to_list',{p_list_id:listId,p_candidate_ids:[candidateId,candidateId]})
    expect(result.error).toBeNull()
    expect(result.data).toEqual([{added:1,skipped:0}])
  })

  it('reports a removal that had nothing to remove',async()=>{
    const listId=await makeList(owner,`Removal ${Date.now()}`)
    const onList=await makeCandidate({full_name:'On The List'})
    const notOnList=await makeCandidate({full_name:'Never Added'})
    expect((await owner.rpc('add_candidates_to_list',{p_list_id:listId,p_candidate_ids:[onList]})).error).toBeNull()

    const result=await owner.rpc('remove_candidates_from_list',{p_list_id:listId,p_candidate_ids:[onList,notOnList]})
    expect(result.error).toBeNull()
    expect(result.data).toEqual([{removed:1,skipped:1}])
  })

  it('accepts an empty batch without writing anything',async()=>{
    const listId=await makeList(owner,`Empty ${Date.now()}`)
    const result=await owner.rpc('add_candidates_to_list',{p_list_id:listId,p_candidate_ids:[]})
    expect(result.error).toBeNull()
    expect(result.data).toEqual([{added:0,skipped:0}])
  })

  /* Membership is an organising fact and grants nothing. A do-not-contact candidate belongs on an
   * internal list -- that is a record of who was considered -- and the restriction that matters lives
   * where it always did, untouched. */
  it('lets a do-not-contact candidate sit on a list',async()=>{
    const listId=await makeList(owner,`Restricted ${Date.now()}`)
    const candidateId=await makeCandidate({full_name:'Do Not Contact',status:'do_not_contact'})
    const result=await owner.rpc('add_candidates_to_list',{p_list_id:listId,p_candidate_ids:[candidateId]})
    expect(result.error).toBeNull()
    expect(result.data).toEqual([{added:1,skipped:0}])

    const found=await owner.rpc('search_candidates_page',{p_organization_id:NORTHSTAR,p_list:listId,p_limit:100})
    const row=(found.data as {id:string;status:string}[]).find((entry)=>entry.id===candidateId)
    // Still carrying the status that restricts it. The list changed nothing about the record.
    expect(row?.status).toBe('do_not_contact')
  })

  it('writes an audit entry carrying counts and no candidate ids',async()=>{
    const listId=await makeList(owner,`Audited ${Date.now()}`)
    const candidateId=await makeCandidate({full_name:'Audited Member'})
    expect((await owner.rpc('add_candidates_to_list',{p_list_id:listId,p_candidate_ids:[candidateId]})).error).toBeNull()

    const entries=await owner.from('audit_logs').select('action,metadata')
      .eq('entity_id',listId).eq('action','candidate_list.members_added')
    expect(entries.error).toBeNull()
    expect(entries.data).toHaveLength(1)
    const [entry]=entries.data as {metadata:Record<string,unknown>}[]
    const metadata=entry?.metadata
    expect(metadata).toEqual({added:1,requested:1})
    // The ledger records that a curation happened and how large it was, never who is on the list.
    expect(JSON.stringify(metadata)).not.toContain(candidateId)
  })
})

describe('the tenant boundary',()=>{
  it('refuses a list id belonging to another workspace',async()=>{
    const listId=await makeList(rival,`Rival ${Date.now()}`,'workspace',RIVAL)
    const candidateId=await makeCandidate({full_name:'Northstar Candidate'})
    const attempt=await owner.rpc('add_candidates_to_list',{p_list_id:listId,p_candidate_ids:[candidateId]})
    expect(attempt.error).not.toBeNull()
    // Cleaned up by its own workspace, since the afterAll signs in as Northstar's owner.
    await rival.from('candidate_lists').delete().eq('id',listId)
    createdLists.splice(createdLists.indexOf(listId),1)
  })

  it('refuses a candidate belonging to another workspace',async()=>{
    const listId=await makeList(owner,`Cross tenant ${Date.now()}`)
    const foreign=await makeCandidate({full_name:'Rival Candidate'},RIVAL,rival)
    const attempt=await owner.rpc('add_candidates_to_list',{p_list_id:listId,p_candidate_ids:[foreign]})
    expect(attempt.error).not.toBeNull()

    const rows=await owner.from('candidate_list_members').select('id').eq('list_id',listId)
    expect(rows.data).toEqual([])
    await rival.from('candidates').delete().eq('id',foreign)
    createdCandidates.splice(createdCandidates.indexOf(foreign),1)
  })

  /* The whole batch, not the valid part of it. A partial write here would be a cross-tenant id
   * quietly reported as a skipped row in a toast nobody reads. */
  it('refuses the whole batch when one candidate is foreign',async()=>{
    const listId=await makeList(owner,`Mixed batch ${Date.now()}`)
    const local=await makeCandidate({full_name:'Local Candidate'})
    const foreign=await makeCandidate({full_name:'Foreign Candidate'},RIVAL,rival)
    const attempt=await owner.rpc('add_candidates_to_list',{p_list_id:listId,p_candidate_ids:[local,foreign]})
    expect(attempt.error).not.toBeNull()

    const rows=await owner.from('candidate_list_members').select('id').eq('list_id',listId)
    expect(rows.data).toEqual([])
    await rival.from('candidates').delete().eq('id',foreign)
    createdCandidates.splice(createdCandidates.indexOf(foreign),1)
  })

  it('shows another workspace nothing at all',async()=>{
    await makeList(owner,`Invisible ${Date.now()}`,'workspace')
    const probe=await rival.rpc('list_candidate_lists',{p_organization_id:NORTHSTAR})
    expect(probe.error).toBeNull()
    expect(probe.data).toEqual([])
  })
})
