import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { beforeAll,describe,expect,it } from 'vitest'

const url=process.env.SUPABASE_URL||'http://127.0.0.1:55321'
const anon=process.env.SUPABASE_ANON_KEY
if(!anon)throw new Error('SUPABASE_ANON_KEY is required; these tests must not silently skip.')

const owner=createClient(url,anon,{auth:{persistSession:false}})
beforeAll(async()=>{const signIn=await owner.auth.signInWithPassword({email:'owner@northstar.local',password:'LocalTest!123'});if(signIn.error)throw signIn.error})

const manifestPath=fileURLToPath(new URL('./rpc-acl.expected.json',import.meta.url))
const manifest=JSON.parse(readFileSync(manifestPath,'utf8')) as {authenticated:string[]}

/* Guards against the exact regression class this repo has shipped three times: a `create or replace
 * function` that silently reinstates a pre-lockdown grant (resolve_submission_link twice, then
 * submit_submission_feedback -- see 20260717070000 and 20260726010000), and its quieter sibling: a
 * function whose argument list changes gets a brand-new pg_proc row with Postgres's own default ACL
 * (EXECUTE to PUBLIC), which nothing here ever explicitly revokes (see 20260726020000).
 *
 * public.audit_function_grants() (20260726030000) does the introspection server-side, since
 * PostgREST does not expose pg_catalog to the client. It excludes trigger functions -- Postgres
 * refuses to invoke those outside a trigger context regardless of grant, so an ACL entry on one is
 * inert and would only be noise here.
 *
 * The manifest in rpc-acl.expected.json is a declaration of INTENT (which functions the authenticated
 * role should be able to call), not a snapshot of whatever the database happens to contain. A function
 * appearing in `actual` but not in the manifest, or vice versa, means either an undeclared grant
 * regression or a deliberate change that forgot to update the manifest alongside it -- either way it
 * should fail here and force a look, not pass silently. */
describe('RPC execute grants match the declared allowlist',()=>{
  it('grants nothing to anon or PUBLIC, and exactly the declared set to authenticated',async()=>{
    const result=await owner.rpc('audit_function_grants')
    expect(result.error).toBeNull()
    const rows=(result.data as {function_name:string;granted_roles:string[]}[]|null)||[]
    expect(rows.length).toBeGreaterThan(0)

    const exposedToAnonOrPublic=rows.filter((row)=>row.granted_roles.includes('anon')||row.granted_roles.includes('public')).map((row)=>row.function_name).sort()
    expect(exposedToAnonOrPublic).toEqual([])

    const actualAuthenticated=rows.filter((row)=>row.granted_roles.includes('authenticated')).map((row)=>row.function_name).sort()
    expect(actualAuthenticated).toEqual([...manifest.authenticated].sort())
  })
})
