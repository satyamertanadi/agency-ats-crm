import {describe,expect,it} from 'vitest'
import {readSupabaseSession} from './session'

function storage(entries:Record<string,string>):Pick<Storage,'length'|'key'|'getItem'>{
  const keys=Object.keys(entries)
  return {length:keys.length,key:(index)=>keys[index]??null,getItem:(key)=>entries[key]??null}
}

describe('readSupabaseSession',()=>{
  it('hands off only a live access token and its expiry',()=>{
    const result=readSupabaseSession(storage({
      'unrelated':'value',
      'sb-project-auth-token':JSON.stringify({access_token:'access-secret',refresh_token:'must-not-leave-the-ats',expires_at:2_000}),
    }),1_000)

    expect(result).toEqual({access_token:'access-secret',expires_at:2_000})
    expect(result).not.toHaveProperty('refresh_token')
  })

  it('supports wrapped Supabase session storage shapes',()=>{
    const result=readSupabaseSession(storage({
      'sb-project-auth-token':JSON.stringify({currentSession:{access_token:'wrapped-access',refresh_token:'refresh-secret',expires_at:2_000}}),
    }),1_000)

    expect(result).toEqual({access_token:'wrapped-access',expires_at:2_000})
  })

  it('refuses expired or nearly expired credentials',()=>{
    const expired=storage({'sb-project-auth-token':JSON.stringify({access_token:'expired',refresh_token:'refresh-secret',expires_at:1_030})})
    expect(readSupabaseSession(expired,1_000)).toBeNull()
  })

  it('fails closed for malformed storage',()=>{
    expect(readSupabaseSession(storage({'sb-project-auth-token':'not-json'}),1_000)).toBeNull()
  })
})
