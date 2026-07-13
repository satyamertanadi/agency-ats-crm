import { createClient } from '@supabase/supabase-js'
import { beforeAll,describe,expect,it } from 'vitest'

const url=process.env.SUPABASE_URL||'http://127.0.0.1:54321'
const anon=process.env.SUPABASE_ANON_KEY
if(!anon)throw new Error('SUPABASE_ANON_KEY is required; RLS tests must not silently skip.')
const owner=createClient(url,anon,{auth:{persistSession:false}})
const rival=createClient(url,anon,{auth:{persistSession:false}})
beforeAll(async()=>{const first=await owner.auth.signInWithPassword({email:'owner@northstar.local',password:'LocalTest!123'});const second=await rival.auth.signInWithPassword({email:'owner@rival.local',password:'LocalTest!123'});if(first.error||second.error)throw first.error||second.error})
describe('organization isolation',()=>{it('cannot read a foreign organization by known UUID',async()=>{const result=await owner.from('organizations').select('id').eq('id','30000000-0000-0000-0000-000000000002');expect(result.error).toBeNull();expect(result.data).toEqual([])});it('cannot insert a candidate into a foreign organization',async()=>{const result=await owner.from('candidates').insert({organization_id:'30000000-0000-0000-0000-000000000002',full_name:'Cross tenant attack',created_by:'10000000-0000-0000-0000-000000000001'});expect(result.error).not.toBeNull()});it('keeps each owner inside their own candidate set',async()=>{const [northstarResult,rivalResult]=await Promise.all([owner.from('candidates').select('organization_id'),rival.from('candidates').select('organization_id')]);expect(northstarResult.data?.every((row)=>row.organization_id==='30000000-0000-0000-0000-000000000001')).toBe(true);expect(rivalResult.data?.every((row)=>row.organization_id==='30000000-0000-0000-0000-000000000002')).toBe(true)})})
