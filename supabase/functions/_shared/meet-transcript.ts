/* The pure decisions in Meet transcript retrieval, kept out of the worker so they can be tested
 * without dragging in the credential module -- which reads its encryption key at import time and
 * therefore cannot load in a test runner with no environment access.
 */

/* meet.google.com/abc-defg-hij -> abc-defg-hij.
 *
 * Derived from meeting_url rather than stored alongside it: a copy is a second place for the same
 * fact to go stale the first time an interview is rescheduled. Anything that is not a Meet meeting
 * code returns null, because a wrong code would make us ask Google about somebody else's conference.
 */
export function meetingCodeFrom(meetingUrl:string|null):string|null{
  if(!meetingUrl)return null
  const match=meetingUrl.match(/meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})/i)
  return match?match[1].toLowerCase():null
}

/* Absolute epoch milliseconds from an RFC3339 timestamp.
 *
 * Deliberately does NOT rebase to an offset: a helper that returned 0 for the first entry could not
 * tell the opening line of an interview from an entry Google never timed. Callers rebase; an
 * unreadable value is null, never 0.
 */
export function toEpochMillis(value:string|undefined):number|null{
  if(!value)return null
  const parsed=Date.parse(value)
  return Number.isFinite(parsed)?parsed:null
}

export interface RebasedEntry {startMs:number|null;endMs:number|null}

/* Turns one session's absolute timestamps into offsets from the artifact start, continuing after the
 * previous session.
 *
 * A dropped-and-resumed call produces one transcript per session. Rebasing each on its own first
 * entry and pushing it past the last would otherwise leave two overlapping timelines, and every
 * speaking-share figure derived from them would be wrong in a way that still looks plausible.
 */
export function rebaseSession(
  entries:{startTime?:string;endTime?:string}[],
  sessionOffset:number,
):{rebased:RebasedEntry[];nextOffset:number}{
  const origin=entries.map((entry)=>toEpochMillis(entry.startTime)).find((value)=>value!==null)??null
  let sessionEnd=sessionOffset
  const rebased=entries.map((entry)=>{
    const start=toEpochMillis(entry.startTime)
    const end=toEpochMillis(entry.endTime)
    const startMs=start===null||origin===null?null:start-origin+sessionOffset
    const endMs=end===null||origin===null?null:end-origin+sessionOffset
    if(endMs!==null&&endMs>sessionEnd)sessionEnd=endMs
    return {startMs,endMs}
  })
  // A second between sessions: visible as a gap, and it belongs to nobody's speaking time.
  return {rebased,nextOffset:sessionEnd+1000}
}
