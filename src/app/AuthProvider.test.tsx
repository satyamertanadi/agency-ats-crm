import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {render,waitFor} from '@testing-library/react'
import {beforeEach,describe,expect,it,vi} from 'vitest'

/* The session boundary is the only thing standing between one user's cached candidate private
 * details and the next user to sign in on the same tab. supabase.auth.signOut() ends the session but
 * does not touch the react-query cache, and AuthProvider sits INSIDE QueryClientProvider, so nothing
 * remounts to discard it -- these assert the explicit clear that closes that gap.
 *
 * Driven through the real onAuthStateChange callback rather than a mocked hook: the ordering between
 * "auth said the user changed" and "the cache was emptied" is the entire behaviour under test, and a
 * mock of the provider would assert the test's own wiring instead. */
type AuthEvent='SIGNED_IN'|'SIGNED_OUT'|'TOKEN_REFRESHED'|'USER_UPDATED'
type Listener=(event:AuthEvent,session:{user:{id:string}}|null)=>void

/* Reassigned by the onAuthStateChange mock the moment AuthProvider subscribes. The initial value
 * only has to be callable; a test that fires an event before mount is asserting nothing. */
let listener:Listener=()=>undefined
const unsubscribe=vi.fn()
/* Typed on the alias rather than inferred from the default implementation: inference would pin the
 * return to `session: null` and reject the one test that needs getSession to resolve WITH a user. */
type SessionResult={data:{session:{user:{id:string}}|null};error:null}
const getSession=vi.fn<()=>Promise<SessionResult>>(async()=>({data:{session:null},error:null}))

vi.mock('../shared/lib/supabase',()=>({
  supabase:{
    auth:{
      getSession:()=>getSession(),
      onAuthStateChange:(callback:Listener)=>{listener=callback;return {data:{subscription:{unsubscribe}}}},
    },
    from:()=>({update:()=>({eq:()=>Promise.resolve({error:null})})}),
  },
}))
vi.mock('../shared/lib/observability',()=>({captureError:vi.fn()}))

const {AuthProvider}=await import('./AuthProvider')

const session=(id:string)=>({user:{id}})
const mountWithCache=()=>{
  const cache=new QueryClient({defaultOptions:{queries:{retry:false}}})
  cache.setQueryData(['candidate-detail','org-1','cand-1'],{full_name:'Prior User Candidate'})
  render(<QueryClientProvider client={cache}><AuthProvider><div/></AuthProvider></QueryClientProvider>)
  return cache
}

beforeEach(()=>{getSession.mockClear();unsubscribe.mockClear()})

describe('AuthProvider clears cached workspace data at the session boundary',()=>{
  it('empties the cache on sign-out',async()=>{
    const cache=mountWithCache()
    await waitFor(()=>expect(getSession).toHaveBeenCalled())
    expect(cache.getQueryData(['candidate-detail','org-1','cand-1'])).toBeDefined()
    listener('SIGNED_OUT',null)
    await waitFor(()=>expect(cache.getQueryData(['candidate-detail','org-1','cand-1'])).toBeUndefined())
  })

  /* The case that actually leaks: a second person signing in on the same tab without a reload. */
  it('empties the cache when a different user signs in',async()=>{
    const cache=mountWithCache()
    await waitFor(()=>expect(getSession).toHaveBeenCalled())
    listener('SIGNED_IN',session('user-two'))
    await waitFor(()=>expect(cache.getQueryData(['candidate-detail','org-1','cand-1'])).toBeUndefined())
  })

  /* ...and the case that must NOT clear it. A token refresh fires several times an hour in normal
   * use; throwing away a warm cache on each one would undo the prefetching this pass exists to add. */
  it('keeps the cache across a token refresh for the same user',async()=>{
    getSession.mockImplementationOnce(async()=>({data:{session:session('user-one')},error:null}))
    const cache=mountWithCache()
    await waitFor(()=>expect(getSession).toHaveBeenCalled())
    listener('TOKEN_REFRESHED',session('user-one'))
    listener('USER_UPDATED',session('user-one'))
    expect(cache.getQueryData(['candidate-detail','org-1','cand-1'])).toBeDefined()
  })
})
