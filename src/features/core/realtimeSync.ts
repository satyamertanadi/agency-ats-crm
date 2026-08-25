/* Which cached queries a change to each realtime table invalidates.
 *
 * Kept as data, in its own module, for two reasons: the mapping is the part worth testing (a table
 * whose change invalidates nothing is a silently dead subscription, and one that invalidates
 * everything is a refetch storm), and the hook itself is untestable without a live socket.
 *
 * Keys are table names in the `supabase_realtime` publication; see
 * 20260719020000_phase5_realtime_publication.sql and 20260802140000_realtime_submissions_and_activity.sql.
 * `realtimeTables` is derived from this map rather than written out twice, so a table can never be
 * subscribed to without a mapping or vice versa.
 */
export const realtimeQueryMap={
  /* A stage move changes the board, the job-health aggregate that counts candidates per phase, and
   * the Today queue that reads pipeline state.
   *
   * `candidates-page` is here now, and was deliberately absent before. The old comment read "It does
   * not touch the candidate list", which was true when that list showed only attributes. It now
   * renders open_job_count / primary_job_title / primary_stage_name per row, so a job_candidates
   * write changes exactly what it displays -- and without this a colleague's add or stage move left
   * every other open Candidates list showing "Not in a pipeline" indefinitely, since
   * refetchOnWindowFocus is off and nothing else would correct it. */
  job_candidates:['pipeline','job-health','today','candidate-pipelines','candidates-page'],
  // Ownership and status changes: the jobs list, the health aggregate, and Today's unowned-jobs item.
  jobs:['jobs','job-health','today','company-pipeline'],
  tasks:['tasks','today'],
  interviews:['interviews','today'],
  offers:['offers','today'],
  // A placement clears the accepted-offer recommendation and moves reporting numbers.
  placements:['placements','today','job-health','company-pipeline'],
  /* The client-response path. Feedback is the one event in the workflow that arrives from outside the
   * workspace, so there is nobody in the room to notice it -- which is exactly the case realtime
   * exists for. It invalidates Today (the new "client responded" row), the submissions list the
   * workspace rail reads, and the activity feed that records it. */
  submission_feedback:['today','submissions','activities','delivery-workbench'],
  // Sending, revoking or renewing a link changes the rail and Today's expired-link item.
  submission_packages:['submissions','today','delivery-workbench'],
  candidate_submissions:['submissions','today','delivery-workbench'],
  // The feed itself, so a colleague's logged call appears without a navigation.
  activities:['activities'],
  /* Name, status and ownership -- not salary or contact, which live in candidate_private_details and
   * stay off the publication. Touches the board because a card renders the candidate's name and role. */
  candidates:['candidates-page','candidate','pipeline','today'],
} as const

/* Why the Delivery Workbench rides on these three tables and not on its own.
 *
 * Its state is computed from four sources: the package, the candidate submission, the client's
 * feedback, and -- outside this map -- the review link and the email delivery row. The last two are
 * NOT on the realtime publication and are deliberately left off it: email_deliveries carries the
 * client's email address on every row, and public_submission_links carries the recipient's, so
 * publishing either would broadcast a client contact list to every subscribed tab in the workspace
 * to save a refetch. Both only ever change as the direct result of an action a consultant just took
 * here (retry, revoke, send), and those mutations invalidate this key themselves.
 *
 * What genuinely arrives from outside the room is the client's answer, and that is submission_feedback
 * -- which is the whole reason this publication was widened in the first place. */
export type RealtimeTable=keyof typeof realtimeQueryMap
export const realtimeTables=Object.keys(realtimeQueryMap) as RealtimeTable[]

/** Query-key prefixes to invalidate for a change on `table`, or [] for a table we do not track. */
export const queriesForTable=(table:string):readonly string[]=>
  realtimeQueryMap[table as RealtimeTable]??[]

/* The union of keys for several tables at once, each appearing once.
 *
 * Ten of the eleven tables map to 'today'. Invalidating table-by-table therefore hit that one key ten
 * times in a single synchronous pass -- and because invalidateQueries defaults to cancelRefetch, each
 * pass aborted the refetch the previous one had just started. The queryFn never receives an
 * AbortSignal, so those abandoned attempts' HTTP requests stayed in flight regardless: one reconnect
 * could put ~230 requests on the wire and keep the results of nine. Collapsing to a set first makes
 * it one refetch per key, which is all that was ever wanted. */
export const queriesForTables=(tables:readonly string[]):string[]=>
  [...new Set(tables.flatMap((table)=>queriesForTable(table)))]
