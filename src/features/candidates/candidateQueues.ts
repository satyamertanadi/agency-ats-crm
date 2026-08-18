import type {CandidateQueue} from '../core/repository'

/* The named views a consultant switches between, as data rather than as markup.
 *
 * These are queues, not composable filters: exactly one is active, each is a single server-side
 * predicate in search_candidates_page, and it applies as one extra AND alongside the eight filters.
 * That is why the tab row is separate from the filter disclosure and why `queue` is deliberately
 * absent from candidateFilterKeys -- a visible tab that ALSO appeared as a dismissible chip would
 * state the same thing twice and give two different ways to clear it.
 *
 * Every entry carries its rule. A queue called "Stale" whose definition lives only in SQL is a queue
 * nobody can trust: the consultant cannot tell whether an absent candidate was excluded or simply
 * missing. The rule is rendered as the tab's title so it is always one hover away, and the tests
 * below pin these strings against the migration so the two cannot drift apart silently. */
export interface QueueDefinition{
  id:CandidateQueue
  label:string
  /** The predicate in plain words. Must match the SQL in 20260818000000_candidate_workflow_signals. */
  rule:string
}

export const STALE_DAYS=21

export const candidateQueues:readonly QueueDefinition[]=[
  {id:'in_process',label:'In process',rule:'In at least one open pipeline.'},
  {id:'needs_follow_up',label:'Needs follow-up',rule:'Has an open task due today or earlier.'},
  {id:'stale',label:'Stale',rule:`In an open pipeline, nothing scheduled, and no activity for ${STALE_DAYS} days.`},
  {id:'unassigned',label:'Unassigned',rule:'No owner set.'},
  {id:'needs_enrichment',label:'Needs enrichment',rule:'Missing a current role, skills, or a CV.'},
]

const byId=new Map(candidateQueues.map((queue)=>[queue.id as string,queue]))

/** Narrows a raw URL value to a queue we actually serve. Anything else is treated as no queue, which
 *  matches the SQL: an unrecognised value matches nothing rather than everything. */
export function parseQueue(raw:string|null|undefined):CandidateQueue|null{
  const value=(raw||'').trim()
  return value&&byId.has(value)?value as CandidateQueue:null
}

export const queueLabel=(id:CandidateQueue|null)=>id?byId.get(id)?.label??null:null

/* What an empty queue should say. Deliberately never "there are none": these predicates read tables
 * behind jobs.read / tasks.read / activities.read, and the RPC is security invoker, so a member
 * without those permissions gets an empty result rather than an error. Stating the RULE lets the
 * reader decide which it is, instead of the screen asserting something it cannot know. */
export function emptyQueueMessage(id:CandidateQueue|null):{title:string;description:string}{
  const queue=id?byId.get(id):undefined
  if(!queue)return {title:'No candidates found',description:'Add a candidate or change the filters.'}
  return {title:`Nothing in ${queue.label.toLowerCase()}`,description:`${queue.rule} Nothing here matches, and any filters you have set still apply.`}
}
