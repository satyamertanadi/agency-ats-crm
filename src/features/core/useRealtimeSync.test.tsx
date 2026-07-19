import {QueryClient,QueryClientProvider,useMutation} from '@tanstack/react-query'
import {act,render,waitFor} from '@testing-library/react'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import type {ReactNode} from 'react'

/* A fake Supabase channel. The hook's real risk is not "does a socket connect" -- it is the ordering
 * rules around it, which are pure logic and were previously asserted only by the comments in the
 * file. This captures the registered handlers so a change event can be delivered on demand. */
type Handler=(payload:{table:string})=>void
const handlers:Handler[]=[]
let subscribeCallback:((status:string)=>void)|undefined
const removeChannel=vi.fn()
const channel={
  on:vi.fn((_event:string,_filter:unknown,handler:Handler)=>{handlers.push(handler);return channel}),
  subscribe:vi.fn((callback:(status:string)=>void)=>{subscribeCallback=callback;return channel}),
}
const captureError=vi.fn()

vi.mock('../../shared/lib/supabase',()=>({supabase:{channel:()=>channel,removeChannel:(...args:unknown[])=>removeChannel(...args)}}))
vi.mock('../../shared/lib/observability',()=>({captureError:(...args:unknown[])=>captureError(...args)}))

const {useRealtimeSync}=await import('./useRealtimeSync')

let client:QueryClient
let invalidated:string[]

const emit=(table:string)=>act(()=>{for(const handler of handlers)handler({table})})

function wrapper({children}:{children:ReactNode}){
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

// Exposes a mutation so a test can hold one "in flight" across an incoming event.
let resolvePending:(()=>void)|undefined
function Harness({organizationId,withMutation=false}:{organizationId?:string;withMutation?:boolean}){
  useRealtimeSync(organizationId)
  const mutation=useMutation({mutationFn:()=>new Promise<void>((resolve)=>{resolvePending=resolve})})
  if(withMutation&&mutation.isIdle)mutation.mutate()
  return null
}

beforeEach(()=>{
  handlers.length=0;subscribeCallback=undefined;removeChannel.mockClear();captureError.mockClear();resolvePending=undefined
  invalidated=[]
  client=new QueryClient({defaultOptions:{queries:{retry:false}}})
  vi.spyOn(client,'invalidateQueries').mockImplementation((filters?:{queryKey?:unknown})=>{
    const key=(filters?.queryKey as string[]|undefined)?.[0]
    if(key)invalidated.push(key)
    return Promise.resolve()
  })
})
afterEach(()=>{client.clear()})

describe('useRealtimeSync',()=>{
  it('does not subscribe without a workspace',()=>{
    render(<Harness organizationId={undefined}/>,{wrapper})
    expect(handlers).toHaveLength(0)
  })

  it('refreshes the queries a changed table feeds',()=>{
    render(<Harness organizationId="org-1"/>,{wrapper})
    invalidated=[]
    emit('job_candidates')
    expect(invalidated).toEqual(expect.arrayContaining(['pipeline','job-health','today']))
  })

  it('ignores a table it does not track',()=>{
    render(<Harness organizationId="org-1"/>,{wrapper})
    invalidated=[]
    emit('candidate_private_details')
    expect(invalidated).toEqual([])
  })

  /* The rule that protects the optimistic kanban move. The RPC behind a drag produces a change event
   * that arrives on this same channel; invalidating on it mid-drag refetches and undoes the write the
   * user is still looking at. */
  it('defers an event that lands while this tab is mutating, then replays it',async()=>{
    render(<Harness organizationId="org-1" withMutation/>,{wrapper})
    await waitFor(()=>expect(resolvePending).toBeDefined())
    invalidated=[]
    emit('job_candidates')
    expect(invalidated,'invalidated during an in-flight mutation').toEqual([])
    await act(async()=>{resolvePending?.();await Promise.resolve()})
    await waitFor(()=>expect(invalidated).toEqual(expect.arrayContaining(['pipeline','job-health'])))
  })

  /* A resubscribe means the socket dropped and recovered, so anything that changed while it was down
   * was never delivered -- the cache is silently behind until something else refetches it. */
  it('refreshes everything it covers when the channel (re)subscribes',()=>{
    render(<Harness organizationId="org-1"/>,{wrapper})
    invalidated=[]
    act(()=>subscribeCallback?.('SUBSCRIBED'))
    expect(new Set(invalidated)).toEqual(new Set(['pipeline','job-health','today','candidate-pipelines','jobs','company-pipeline','tasks','interviews','offers','placements']))
  })

  it('reports a channel error without refetching or throwing',()=>{
    render(<Harness organizationId="org-1"/>,{wrapper})
    invalidated=[]
    act(()=>subscribeCallback?.('CHANNEL_ERROR'))
    expect(captureError).toHaveBeenCalled()
    expect(invalidated).toEqual([])
  })

  it('tears the channel down when the workspace goes away',()=>{
    const view=render(<Harness organizationId="org-1"/>,{wrapper})
    view.unmount()
    expect(removeChannel).toHaveBeenCalled()
  })
})
