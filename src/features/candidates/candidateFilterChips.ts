import type {ActiveFilter} from '../core/ActiveFilterChips'
import {candidateAvailability,candidateSource} from '../../shared/lib/optionSets'
import {candidateStatus,lookup} from '../../shared/lib/status'
import {issueLabel,parseIssue} from './candidateQuality'
import {parseQueue} from './candidateQueues'

export interface FilterChipContext {
  /** Member id -> display name, so an owner chip reads "Owner: Satya" rather than a uuid. */
  ownerNames:Record<string,string>
}

/* Turns the list's URL params into the chips shown above it.
 *
 * Pure and separate from the component so the wording is testable without rendering a page: a chip
 * that shows a raw enum (`do_not_contact`) or a bare uuid is worse than no chip, and that is exactly
 * the kind of thing a unit test pins cheaply.
 *
 * `sort` and `dir` are deliberately not chips -- see ActiveFilterChips for why ordering is not a
 * filter. `page` is not one either: it is a position in the result, not a narrowing of it.
 */
export function candidateFilterChips(params:URLSearchParams,{ownerNames}:FilterChipContext):ActiveFilter[]{
  const chips:ActiveFilter[]=[]
  const raw=(key:string)=>params.get(key)?.trim()||''
  const push=(key:string,label:string,value:string)=>{if(value)chips.push({key,label,value})}

  push('q','Search',raw('q'))
  /* Enum values are resolved through the same helpers the filter controls and table badges render
   * from -- `lookup` for the status map, the option set's own `label` -- so a chip can never disagree
   * with the dropdown that set it, and an unrecognised value from a hand-edited URL degrades to
   * readable text rather than printing a raw enum. */
  const status=raw('status');push('status','Status',status?lookup(candidateStatus,status).label:'')
  push('location','Location',raw('location'))
  const source=raw('source');push('source','Source',source?candidateSource.label(source)||source:'')
  // A uuid is not a filter a human can read; without the name this chip would be worse than nothing.
  const owner=raw('owner');push('owner','Owner',owner?ownerNames[owner]||'Selected member':'')
  push('tag','Tag',raw('tag'))
  push('skill','Skill',raw('skill'))
  const availability=raw('availability');push('availability','Availability',availability?candidateAvailability.label(availability)||availability:'')
  /* The data-quality issue IS a chip, unlike `queue`, and the difference is where each one is
   * visible. The queue tabs state the active queue permanently, so a chip for it would say the same
   * thing twice and offer a second way to clear it. The issue is chosen from a small select that
   * only exists while the enrichment queue is active -- so once the reader scrolls, or shares the
   * URL, the chip is the only thing still saying the list is narrowed to one gap.
   *
   * Resolved through parseIssue, so a hand-edited `?issue=nonsense` -- which the SQL matches nothing
   * for -- produces no chip either, rather than a chip claiming a filter that is not applying. */
  /* Only inside the queue it belongs to. An `?issue=` that arrives without `?queue=needs_enrichment`
   * is never sent to the server -- the page narrows it away -- so a chip for it would be claiming a
   * filter that is not applying, which is worse than no chip at all. */
  const issue=parseQueue(raw('queue'))==='needs_enrichment'?parseIssue(raw('issue')):null
  push('issue','Issue',issue?issueLabel(issue)||issue:'')
  return chips
}

/** The param keys `candidateFilterChips` can produce, for a "clear all" that cannot drift from it. */
export const candidateFilterKeys=['q','status','location','source','owner','tag','skill','availability','issue'] as const
