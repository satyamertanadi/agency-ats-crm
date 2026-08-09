import {readdirSync,readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {describe,expect,it} from 'vitest'
import {DUPLICATE_CANDIDATE,humanizeRpcError} from './errors'

describe('humanizeRpcError',()=>{
  it('turns a bare RPC identifier into a sentence and keeps the token as the code',()=>{
    const result=humanizeRpcError('invalid_nonnegative_value')
    expect(result?.message).toBe('Amounts cannot be negative.')
    expect(result?.code).toBe('invalid_nonnegative_value')
  })

  it('recognises an identifier embedded in plpgsql context rather than showing the whole string',()=>{
    const result=humanizeRpcError('permission_denied\nCONTEXT: PL/pgSQL function public.create_job_with_pipeline(uuid,uuid,text,uuid) line 5')
    expect(result?.message).toBe('Your role does not allow this action.')
  })

  it('carries the colliding record id off a duplicate_candidate raise',()=>{
    const result=humanizeRpcError('duplicate_candidate:70000000-0000-0000-0000-000000000001')
    expect(result?.code).toBe(DUPLICATE_CANDIDATE)
    expect(result?.recordId).toBe('70000000-0000-0000-0000-000000000001')
    expect(result?.message).toBe('A candidate with this email already exists.')
  })

  it('returns null for anything it does not recognise, so the caller keeps its own fallback',()=>{
    expect(humanizeRpcError('could not connect to server')).toBeNull()
    expect(humanizeRpcError('')).toBeNull()
  })

  it('never leaves a mapped sentence looking like an identifier',()=>{
    // A snake_case "sentence" means someone pasted the token into the value column by mistake.
    const messages=['permission_denied','rate_limited','seat_limit_reached','invalid_fee_source'].map((key)=>humanizeRpcError(key)?.message)
    messages.forEach((message)=>{
      expect(message).toBeDefined()
      expect(message).not.toMatch(/^[a-z]+(_[a-z]+)+$/)
      expect(message?.endsWith('.')).toBe(true)
    })
  })
})

/* Drift guard, in the spirit of providerOutage.test.ts pairing two implementations that must agree.
 * The failure this prevents is quiet: a new migration raises a new identifier, nothing here knows about
 * it, and the token itself is what a consultant reads. Deriving the expectation from the migrations
 * means the test fails when the SQL changes rather than when someone remembers to update a list. */
describe('every identifier the migrations raise has a human sentence',()=>{
  it('covers all raise exception tokens',()=>{
    const dir=resolve(process.cwd(),'supabase/migrations')
    const raised=new Set<string>()
    readdirSync(dir).filter((file)=>file.endsWith('.sql')).forEach((file)=>{
      const sql=readFileSync(resolve(dir,file),'utf8')
      for(const match of sql.matchAll(/raise exception '([a-z][a-z_]*)'/g)){
        const token=match[1]
        if(token)raised.add(token)
      }
    })
    expect(raised.size).toBeGreaterThan(30)
    /* Tokens raised only by functions that have since been dropped. The migration that created them
     * is still on disk (already applied everywhere; deleting an applied migration file is what
     * breaks `supabase db push`), so the scan above still finds their text -- but
     * 20260810030000_drop_unreachable_schema.sql removed the functions, so no code path can raise
     * them and a user-facing sentence for each would be a message that can never be shown.
     * Anything NOT on this list still has to be mapped. */
    const retired=new Set(['referral_not_found','referral_not_pending'])
    const unmapped=[...raised].filter((token)=>!retired.has(token)&&humanizeRpcError(token)===null).sort()
    expect(unmapped,`These identifiers are raised by a migration but would reach the user verbatim. Add a sentence for each in rpcMessages (src/shared/lib/errors.ts):\n${unmapped.join('\n')}`).toEqual([])
  })
})
