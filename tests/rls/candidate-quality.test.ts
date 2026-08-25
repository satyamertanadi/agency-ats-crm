import {createClient} from '@supabase/supabase-js'
import {afterAll,beforeAll,describe,expect,it} from 'vitest'

/* Data quality, from the database's side.
 *
 * Three things are asserted here and nowhere else:
 *
 * 1. THE RULES. public.candidate_quality_issues is the only definition of what makes a record
 *    unusable, and the UI holds no copy of it. Every code and every combination is exercised by
 *    calling the function directly -- seven scalars per case rather than seven candidates.
 * 2. THE PERMISSION BOUNDARY. missing_contact_method must never be reported to a member who cannot
 *    read the columns it is about. That is the one rule where being wrong leaks something.
 * 3. AGREEMENT. The queue, the issue filter and the summary counts have to be describing the same
 *    population -- that is the whole point of there being one predicate -- so they are compared to
 *    each other rather than to hard-coded numbers.
 */

const url=process.env.SUPABASE_URL||'http://127.0.0.1:55321'
const anon=process.env.SUPABASE_ANON_KEY
if(!anon)throw new Error('SUPABASE_ANON_KEY is required; RLS tests must not silently skip.')

const owner=createClient(url,anon,{auth:{persistSession:false}})
const rival=createClient(url,anon,{auth:{persistSession:false}})
/* Bianca in Business Development holds candidates.read but NOT candidates_private.read -- the exact
 * shape the permission flag exists for. */
const bd=createClient(url,anon,{auth:{persistSession:false}})

const NORTHSTAR='30000000-0000-0000-0000-000000000001'
const RIVAL='30000000-0000-0000-0000-000000000002'

const created:string[]=[]

async function addCandidate(fields:Record<string,unknown>){
  const result=await owner.from('candidates').insert({
    organization_id:NORTHSTAR,created_by:'10000000-0000-0000-0000-000000000001',
    status:'active',...fields,
  }).select('id').single()
  expect(result.error).toBeNull()
  const id=result.data?.id as string
  created.push(id)
  return id
}

beforeAll(async()=>{
  const sessions=await Promise.all([
    owner.auth.signInWithPassword({email:'owner@northstar.local',password:'LocalTest!123'}),
    rival.auth.signInWithPassword({email:'owner@rival.local',password:'LocalTest!123'}),
    bd.auth.signInWithPassword({email:'bd@northstar.local',password:'LocalTest!123'}),
  ])
  for(const session of sessions)if(session.error)throw session.error
})

afterAll(async()=>{
  for(const id of created)await owner.from('candidates').delete().eq('id',id)
})

describe('the issue rules',()=>{
  const issues=async(overrides:Record<string,unknown>={})=>{
    const result=await owner.rpc('candidate_quality_issues',{
      p_current_position:'Finance Manager',p_location:'Denpasar',p_has_skills:true,p_has_cv:true,
      p_email:'ana@example.test',p_phone:'+62811',p_can_read_private:true,...overrides,
    })
    expect(result.error).toBeNull()
    return result.data as string[]
  }

  it('reports nothing about a complete record',async()=>{
    expect(await issues()).toEqual([])
  })

  it('names each gap on its own',async()=>{
    expect(await issues({p_current_position:null})).toEqual(['missing_role'])
    expect(await issues({p_location:null})).toEqual(['missing_location'])
    expect(await issues({p_has_skills:false})).toEqual(['missing_skills'])
    expect(await issues({p_has_cv:false})).toEqual(['missing_cv'])
    expect(await issues({p_email:null,p_phone:null})).toEqual(['missing_contact_method'])
  })

  /* Whitespace is not data. A record whose location is a space is missing a location, and treating it
   * otherwise is how an import of blank cells looks complete. */
  it('treats blank and whitespace-only values as absent',async()=>{
    expect(await issues({p_current_position:''})).toEqual(['missing_role'])
    expect(await issues({p_location:'   '})).toEqual(['missing_location'])
    expect(await issues({p_email:'  ',p_phone:''})).toEqual(['missing_contact_method'])
  })

  // A candidate reachable by phone alone is reachable. BOTH have to be absent.
  it('accepts either contact method',async()=>{
    expect(await issues({p_email:null})).toEqual([])
    expect(await issues({p_phone:null})).toEqual([])
  })

  /* Order is part of the contract: the chips in Quick View and the buttons in the summary strip both
   * render in this order, and neither sorts. */
  it('returns every code at once, in the declared order',async()=>{
    expect(await issues({p_current_position:null,p_location:null,p_has_skills:false,p_has_cv:false,p_email:null,p_phone:null}))
      .toEqual(['missing_role','missing_location','missing_skills','missing_cv','missing_contact_method'])
  })

  /* THE ONE THAT MATTERS. Without the flag, a member who cannot read contact details would be told
   * that every candidate is missing them -- which is both wrong and a statement about data they are
   * not allowed to see. */
  it('says nothing about contact details when the caller cannot read them',async()=>{
    expect(await issues({p_can_read_private:false,p_email:null,p_phone:null})).toEqual([])
    // The other four are unaffected: they are about columns everyone with candidates.read can see.
    expect(await issues({p_can_read_private:false,p_has_cv:false,p_email:null,p_phone:null})).toEqual(['missing_cv'])
  })

  it('treats an unknown has-skills or has-cv as missing rather than throwing',async()=>{
    expect(await issues({p_has_skills:null,p_has_cv:null})).toEqual(['missing_skills','missing_cv'])
  })
})

describe('the enrichment queue and its filter',()=>{
  let incomplete:string
  let complete:string

  beforeAll(async()=>{
    /* Deliberately missing everything the helper checks, so it lands in every issue's bucket at once
     * -- which is what lets one fixture assert both the queue and each filter. */
    incomplete=await addCandidate({full_name:'ZZ Quality Incomplete'})
    /* Complete for the four public rules. It still has no CV -- candidate_search_documents is
     * written by the CV pipeline and cannot be forged from a client -- so it is asserted below only
     * for the rules it can actually satisfy. */
    complete=await addCandidate({full_name:'ZZ Quality Complete',current_position:'Finance Manager',location:'Denpasar'})
    const skill=await owner.from('skills').insert({organization_id:NORTHSTAR,name:'ZZ Quality Skill'}).select('id').single()
    expect(skill.error).toBeNull()
    const link=await owner.from('candidate_skills').insert({
      organization_id:NORTHSTAR,candidate_id:complete,skill_id:skill.data?.id,
    })
    expect(link.error).toBeNull()
    const contact=await owner.from('candidate_private_details').insert({
      organization_id:NORTHSTAR,candidate_id:complete,email:'zz-complete@example.test',
    })
    expect(contact.error).toBeNull()
  })

  const page=async(client:typeof owner,args:Record<string,unknown>={})=>{
    const result=await client.rpc('search_candidates_page',{p_organization_id:NORTHSTAR,p_limit:500,...args})
    expect(result.error).toBeNull()
    return (result.data||[]) as {id:string;full_name:string;quality_issue_codes:string[]}[]
  }

  it('returns the codes on every row of the list',async()=>{
    const rows=await page(owner,{p_query:'ZZ Quality Incomplete'})
    expect(rows).toHaveLength(1)
    expect(rows[0]?.quality_issue_codes).toEqual(
      ['missing_role','missing_location','missing_skills','missing_cv','missing_contact_method'])
  })

  it('puts a record with at least one gap in the queue and keeps a complete one out',async()=>{
    const queue=await page(owner,{p_queue:'needs_enrichment'})
    const ids=queue.map((candidate)=>candidate.id)
    expect(ids).toContain(incomplete)
    // The complete fixture still has no CV, so it IS in the queue -- for exactly one reason.
    const completeRow=queue.find((candidate)=>candidate.id===complete)
    expect(completeRow?.quality_issue_codes).toEqual(['missing_cv'])
  })

  /* The queue predicate IS "cardinality(issues) > 0", so this must hold for every row without
   * exception -- it is the property that stops the queue, the strip and the badges disagreeing. */
  it('never returns a row with no issues in the enrichment queue',async()=>{
    const queue=await page(owner,{p_queue:'needs_enrichment'})
    expect(queue.length).toBeGreaterThan(0)
    for(const candidate of queue){
      expect(candidate.quality_issue_codes.length,`${candidate.full_name} has no issues`).toBeGreaterThan(0)
    }
  })

  it('narrows to one issue, and every row it returns carries that issue',async()=>{
    const rows=await page(owner,{p_queue:'needs_enrichment',p_issue:'missing_skills'})
    expect(rows.length).toBeGreaterThan(0)
    for(const candidate of rows)expect(candidate.quality_issue_codes).toContain('missing_skills')
    expect(rows.map((candidate)=>candidate.id)).toContain(incomplete)
    // The complete fixture has skills, so it must not appear under this issue.
    expect(rows.map((candidate)=>candidate.id)).not.toContain(complete)
  })

  // Fails closed, exactly as an unrecognised queue does.
  it('returns nothing for an issue code it does not serve',async()=>{
    expect(await page(owner,{p_queue:'needs_enrichment',p_issue:'missing_visa'})).toEqual([])
  })

  /* A member without candidates_private.read never sees the code, so filtering on it cannot become a
   * way to enumerate who has no email. */
  it('returns nothing when a restricted member filters on the private issue',async()=>{
    const rows=await page(bd,{p_queue:'needs_enrichment',p_issue:'missing_contact_method'})
    expect(rows).toEqual([])
    // And the code never appears on any row they can see.
    const all=await page(bd,{p_queue:'needs_enrichment'})
    for(const candidate of all)expect(candidate.quality_issue_codes).not.toContain('missing_contact_method')
  })

  it('still reports the public gaps to that member',async()=>{
    const rows=await page(bd,{p_query:'ZZ Quality Incomplete'})
    expect(rows[0]?.quality_issue_codes).toEqual(['missing_role','missing_location','missing_skills','missing_cv'])
  })
})

describe('the summary counts',()=>{
  const summary=async(client:typeof owner,organizationId=NORTHSTAR,args:Record<string,unknown>={})=>{
    const result=await client.rpc('candidate_quality_summary',{p_organization_id:organizationId,...args})
    expect(result.error).toBeNull()
    return new Map(((result.data||[]) as {issue_code:string;candidate_count:number}[])
      .map((row)=>[row.issue_code,Number(row.candidate_count)]))
  }

  const page=async(args:Record<string,unknown>={})=>{
    const result=await owner.rpc('search_candidates_page',{p_organization_id:NORTHSTAR,p_limit:500,...args})
    expect(result.error).toBeNull()
    return (result.data||[]) as {id:string}[]
  }

  /* The count and the list it filters to must be the same number. This is the assertion the whole
   * "summary does not take the issue filter" decision exists to make true. */
  it('counts exactly what the filtered list returns, for every issue',async()=>{
    const counts=await summary(owner)
    expect(counts.size).toBeGreaterThan(0)
    for(const [code,count] of counts){
      const rows=await page({p_queue:'needs_enrichment',p_issue:code})
      expect(rows.length,`${code} counted ${count} but listed ${rows.length}`).toBe(count)
    }
  })

  it('applies the same filters the list does',async()=>{
    const narrowed=await summary(owner,NORTHSTAR,{p_query:'ZZ Quality Incomplete'})
    expect(narrowed.get('missing_role')).toBe(1)
    expect(narrowed.get('missing_cv')).toBe(1)
    const rows=await page({p_queue:'needs_enrichment',p_query:'ZZ Quality Incomplete'})
    expect(rows).toHaveLength(1)
  })

  it('omits the private issue for a member who cannot read it',async()=>{
    const restricted=await summary(bd)
    expect(restricted.has('missing_contact_method')).toBe(false)
    // The public issues are still counted for them.
    expect((restricted.get('missing_cv')||0)).toBeGreaterThan(0)
  })
})

describe('tenant boundaries',()=>{
  it('counts nothing for a rival tenant asking about this organisation',async()=>{
    const result=await rival.rpc('candidate_quality_summary',{p_organization_id:NORTHSTAR})
    expect(result.error).toBeNull()
    expect(result.data).toEqual([])
  })

  it('lists nothing for a rival tenant asking about this organisation',async()=>{
    const result=await rival.rpc('search_candidates_page',{p_organization_id:NORTHSTAR,p_queue:'needs_enrichment'})
    expect(result.error).toBeNull()
    expect(result.data).toEqual([])
  })

  it('reports nothing about a rival tenant to this organisation',async()=>{
    const counts=await owner.rpc('candidate_quality_summary',{p_organization_id:RIVAL})
    expect(counts.error).toBeNull()
    expect(counts.data).toEqual([])
  })
})
