import {useEffect,useRef,useState} from 'react'
import {useIsMutating,useQueryClient} from '@tanstack/react-query'
import type {RealtimeChannel} from '@supabase/supabase-js'
import {supabase} from '../../shared/lib/supabase'
import {captureError} from '../../shared/lib/observability'
import {queriesForTable,realtimeTables} from './realtimeSync'

/* Keeps one workspace's operational data live across colleagues.
 *
 * Three things this deliberately does NOT do:
 *
 * 1. It never writes the payload into the cache. The event is only a signal to refetch through the
 *    normal RLS-checked query path. Trusting a broadcast row would mean rendering data whose
 *    permission filtering happened somewhere other than the query that owns that cache entry.
 *
 * 2. It never invalidates while one of this tab's own mutations is in flight. An optimistic kanban
 *    move writes the cache, fires the RPC, and the RPC's own change comes straight back down this
 *    channel -- invalidating on it would refetch mid-drag and undo the optimistic write the user is
 *    still looking at. `useIsMutating` is the guard, and the pending events are replayed once the
 *    mutation settles so a colleague's change arriving during your drag is not simply lost.
 *
 * 3. It never retries by hand. supabase-js reconnects its own socket; a failed connection degrades
 *    to exactly the pre-realtime behaviour (data refreshes on navigation and refetch), which is why
 *    there is no error state in the UI for this.
 */
/* 'live' once subscribed, 'connecting' before the first SUBSCRIBED and after a drop, 'off' when there
 * is no workspace to subscribe for. Deliberately three states and not four: the hook does not retry by
 * hand, so "errored" and "reconnecting" are the same thing from the consultant's side -- supabase-js is
 * already trying, and the only honest thing to say is that the data is not live right now. */
export type RealtimeStatus='off'|'connecting'|'live'

export function useRealtimeSync(organizationId:string|undefined){
  const cache=useQueryClient()
  const mutating=useIsMutating()
  const [status,setStatus]=useState<RealtimeStatus>('off')
  // Tables whose events arrived while a mutation was in flight, held until it settles.
  const deferred=useRef(new Set<string>())
  // Mirrored into a ref so the long-lived channel callback reads the current value instead of the
  // one captured when the subscription was created. Written in an effect, not during render: a ref
  // mutation in the render body is not safe under concurrent rendering, where a render can be
  // started and thrown away.
  const mutatingRef=useRef(mutating)
  useEffect(()=>{mutatingRef.current=mutating},[mutating])

  useEffect(()=>{
    if(!organizationId){setStatus('off');return}
    setStatus('connecting')
    const flush=(table:string)=>{
      for(const key of queriesForTable(table))void cache.invalidateQueries({queryKey:[key]})
    }
    let channel:RealtimeChannel|undefined
    try{
      channel=supabase.channel(`workspace:${organizationId}`)
      for(const table of realtimeTables){
        channel.on('postgres_changes',
          {event:'*',schema:'public',table,filter:`organization_id=eq.${organizationId}`},
          (payload)=>{
            if(mutatingRef.current){deferred.current.add(payload.table);return}
            flush(payload.table)
          })
      }
      channel.subscribe((status)=>{
        // A resubscribe means the socket dropped and came back, so anything that changed while it
        // was down was never delivered. Refetch everything this channel covers rather than sit on
        // a cache that is quietly behind.
        if(status==='SUBSCRIBED'){setStatus('live');for(const table of realtimeTables)flush(table)}
        // Every non-subscribed status is reported the same way, for the reason given on RealtimeStatus.
        if(status!=='SUBSCRIBED')setStatus('connecting')
        if(status==='CHANNEL_ERROR')captureError(new Error('Realtime channel error'),{area:'realtime',organizationId})
      })
    }catch(error){
      // Realtime is an enhancement; losing it must never take the workspace down with it.
      captureError(error,{area:'realtime_subscribe',organizationId})
      setStatus('connecting')
    }
    return()=>{if(channel)void supabase.removeChannel(channel)}
  },[organizationId,cache])

  // Replay whatever arrived during a mutation, once no mutation is in flight.
  useEffect(()=>{
    if(mutating>0||deferred.current.size===0)return
    const pending=[...deferred.current]
    deferred.current.clear()
    for(const table of pending)for(const key of queriesForTable(table))void cache.invalidateQueries({queryKey:[key]})
  },[mutating,cache])

  return status
}
