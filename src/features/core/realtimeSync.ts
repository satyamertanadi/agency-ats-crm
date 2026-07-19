/* Which cached queries a change to each realtime table invalidates.
 *
 * Kept as data, in its own module, for two reasons: the mapping is the part worth testing (a table
 * whose change invalidates nothing is a silently dead subscription, and one that invalidates
 * everything is a refetch storm), and the hook itself is untestable without a live socket.
 *
 * Keys are table names in the `supabase_realtime` publication; see
 * 20260719020000_phase5_realtime_publication.sql. `realtimeTables` is derived from this map rather
 * than written out twice, so a table can never be subscribed to without a mapping or vice versa.
 */
export const realtimeQueryMap={
  // A stage move changes the board, the job-health aggregate that counts candidates per phase, and
  // the Today queue that reads pipeline state. It does not touch the candidate list.
  job_candidates:['pipeline','job-health','today','candidate-pipelines'],
  // Ownership and status changes: the jobs list, the health aggregate, and Today's unowned-jobs item.
  jobs:['jobs','job-health','today','company-pipeline'],
  tasks:['tasks','today'],
  interviews:['interviews','today'],
  offers:['offers','today'],
  // A placement clears the accepted-offer recommendation and moves reporting numbers.
  placements:['placements','today','job-health','company-pipeline'],
} as const

export type RealtimeTable=keyof typeof realtimeQueryMap
export const realtimeTables=Object.keys(realtimeQueryMap) as RealtimeTable[]

/** Query-key prefixes to invalidate for a change on `table`, or [] for a table we do not track. */
export const queriesForTable=(table:string):readonly string[]=>
  realtimeQueryMap[table as RealtimeTable]??[]
