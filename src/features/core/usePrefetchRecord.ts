import {useQueryClient} from '@tanstack/react-query'
import {useCallback,useRef} from 'react'
import {useOrganization} from '../../app/OrganizationProvider'
import {getCandidateDetail,getCompanyDetail} from './commercialRepository'

/* Warm the detail query for a record the user is about to open.
 *
 * List-to-detail was the slowest transition in the product, and none of it was network time that
 * had to happen after the click: the row the pointer is resting on names the record, and a
 * recruiter's hover-to-click gap is comfortably longer than this query. Prefetching inside it moves
 * the fetch off the critical path entirely without changing what is fetched.
 *
 * Three properties this has to hold, in order of how badly they bite if broken:
 *
 * 1. The cache key is IDENTICAL to the one the detail page mounts with -- same array, same
 *    organization id, same record id. A key that differs by one element is not a warm cache, it is
 *    a second copy of the same row fetched twice, which would make navigation slower rather than
 *    faster while looking like it worked.
 * 2. The organization id comes from the provider, never from the caller. Every key here is
 *    org-scoped for the same reason the detail pages are: a prefetch keyed without it could seed a
 *    cache entry that a different workspace would then read as its own.
 * 3. prefetchQuery is a no-op when a fresh entry already exists, so re-entering a row (or hovering
 *    across a table, where pointerenter and focus both fire) costs nothing. The `seen` guard below
 *    covers the remaining case: a record whose entry has gone stale would otherwise re-fetch on
 *    every single hover as the pointer tracks down a list.
 */
export function usePrefetchRecord(){
  const cache=useQueryClient()
  const {organization}=useOrganization()
  const organizationId=organization?.id
  /* Per-mount, not global: it exists to stop one pass down a list from firing dozens of requests,
   * not to cache across navigations -- react-query already owns that, and a longer-lived guard here
   * would start suppressing genuinely wanted refetches. */
  const seen=useRef(new Set<string>())

  return useCallback((kind:'candidate'|'client',recordId:string|null|undefined)=>{
    if(!organizationId||!recordId)return
    const token=`${kind}:${recordId}`
    if(seen.current.has(token))return
    seen.current.add(token)
    if(kind==='candidate'){
      void cache.prefetchQuery({queryKey:['candidate-detail',organizationId,recordId],queryFn:()=>getCandidateDetail(organizationId,recordId)})
      return
    }
    void cache.prefetchQuery({queryKey:['company-detail',organizationId,recordId],queryFn:()=>getCompanyDetail(organizationId,recordId)})
  },[cache,organizationId])
}

/* Spread onto the row's link. Pointer and keyboard both warm the cache, so tabbing through a list
 * gets the same head start as hovering it -- the alternative (onMouseEnter only) quietly makes the
 * keyboard path the slow one. onFocus rather than onFocusCapture: the link is the focus target. */
export function prefetchHandlers(prefetch:()=>void){
  return {onPointerEnter:prefetch,onFocus:prefetch}
}
