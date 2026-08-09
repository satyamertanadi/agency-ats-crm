import { createClient } from '@supabase/supabase-js'
import { afterAll,beforeAll,describe,expect,it } from 'vitest'

const url=process.env.SUPABASE_URL||'http://127.0.0.1:55321'
const anon=process.env.SUPABASE_ANON_KEY
if(!anon)throw new Error('SUPABASE_ANON_KEY is required; these tests must not silently skip.')

const NORTHSTAR='30000000-0000-0000-0000-000000000001'
const bucket='candidate-documents'
const path=`${NORTHSTAR}/rls-test-${Date.now()}/note.txt`

const owner=createClient(url,anon,{auth:{persistSession:false}})
const finance=createClient(url,anon,{auth:{persistSession:false}})
const consultant=createClient(url,anon,{auth:{persistSession:false}})

// Regression test for F6: candidate_documents_read used to gate on is_organization_member -- any
// active member, regardless of role -- while the documents table indexing these same objects gates
// on candidates.read. The seeded 'finance' role has no candidates.* permission at all (companies.read,
// jobs.read, placements.*, finance.*, reports.read, tasks.*), so it is the clean real-world case: a
// role that legitimately belongs to the organization but was never meant to see candidate files.
beforeAll(async()=>{
  const results=await Promise.all([
    owner.auth.signInWithPassword({email:'owner@northstar.local',password:'LocalTest!123'}),
    finance.auth.signInWithPassword({email:'finance@northstar.local',password:'LocalTest!123'}),
    consultant.auth.signInWithPassword({email:'consultant@northstar.local',password:'LocalTest!123'}),
  ])
  const failure=results.find((result)=>result.error)
  if(failure?.error)throw failure.error
  const upload=await owner.storage.from(bucket).upload(path,'rls test file',{contentType:'text/plain'})
  expect(upload.error).toBeNull()
})

afterAll(async()=>{await owner.storage.from(bucket).remove([path])})

describe('candidate-documents storage requires candidates.read, not just membership',()=>{
  it('refuses a signed URL for a member with no candidates.* permission',async()=>{
    const result=await finance.storage.from(bucket).createSignedUrl(path,60)
    expect(result.error).not.toBeNull()
    expect(result.data).toBeNull()
  })
  it('grants a signed URL for a member with candidates.read',async()=>{
    const result=await consultant.storage.from(bucket).createSignedUrl(path,60)
    expect(result.error).toBeNull()
    expect(result.data?.signedUrl).toBeTruthy()
  })

  /* Every policy on this bucket used to cast the first path segment straight to uuid, on the assumption
   * that everything here lives under an organization-id prefix. refer's signed-upload flow breaks that
   * assumption -- some objects landed under a non-uuid prefix -- and a uuid cast RAISES rather than
   * failing to match, so one such object made every authenticated read of the whole bucket error for
   * every user. Reproduced against the local stack before the fix; this keeps it fixed. */
  it('still lists the bucket when an object sits outside any organization prefix',async()=>{
    const stray=`referrals/rls-test-${Date.now()}/note.txt`
    // Uploaded by the owner, whose insert now also goes through the cast-safe predicate -- so a
    // non-organization prefix is refused rather than erroring, which is itself the fix working.
    const upload=await owner.storage.from(bucket).upload(stray,'stray object',{contentType:'text/plain'})
    expect(upload.error).not.toBeNull()

    // The read path is what used to break. It must answer, not raise.
    const listed=await consultant.storage.from(bucket).list(NORTHSTAR)
    expect(listed.error).toBeNull()
    const signed=await consultant.storage.from(bucket).createSignedUrl(path,60)
    expect(signed.error).toBeNull()
  })
})
