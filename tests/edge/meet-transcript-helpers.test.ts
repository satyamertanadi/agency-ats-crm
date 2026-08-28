import assert from 'node:assert/strict'
import {meetingCodeFrom,rebaseSession,toEpochMillis} from '../../supabase/functions/_shared/meet-transcript.ts'

/* The two pure decisions in the Meet fetcher: which meeting a link points at, and what a timestamp
 * is worth. Both are places where guessing produces something that looks right and is not. */

Deno.test('reads the meeting code out of a Meet link',()=>{
  assert.deepStrictEqual(meetingCodeFrom('https://meet.google.com/abc-defg-hij'),'abc-defg-hij')
  // Calendar appends query parameters; the code is still the path segment.
  assert.deepStrictEqual(meetingCodeFrom('https://meet.google.com/abc-defg-hij?hs=224'),'abc-defg-hij')
  assert.deepStrictEqual(meetingCodeFrom('https://MEET.GOOGLE.COM/ABC-DEFG-HIJ'),'abc-defg-hij')
})

Deno.test('refuses a link that is not a Meet meeting',()=>{
  /* Returning a wrong code would make us ask Google about somebody else's conference, so anything
   * unrecognised is null and the fetch stops. */
  assert.deepStrictEqual(meetingCodeFrom('https://zoom.us/j/123456'),null)
  assert.deepStrictEqual(meetingCodeFrom('https://meet.google.com/lookup/short'),null)
  assert.deepStrictEqual(meetingCodeFrom(null),null)
  assert.deepStrictEqual(meetingCodeFrom(''),null)
})

Deno.test('parses an RFC3339 timestamp to epoch milliseconds',()=>{
  assert.deepStrictEqual(toEpochMillis('2026-09-01T10:00:00Z'),Date.parse('2026-09-01T10:00:00Z'))
  assert.deepStrictEqual(toEpochMillis('2026-09-01T10:00:00.500Z'),Date.parse('2026-09-01T10:00:00.500Z'))
})

Deno.test('returns null rather than zero for a missing or unreadable timestamp',()=>{
  /* Zero is a real position in a recording. A helper that returned it for a missing value would make
   * the first line of the interview indistinguishable from an entry Google never timed, and the
   * speaking share computed from it would look authoritative and mean nothing. */
  assert.deepStrictEqual(toEpochMillis(undefined),null)
  assert.deepStrictEqual(toEpochMillis(''),null)
  assert.deepStrictEqual(toEpochMillis('not-a-time'),null)
})

Deno.test('rebases one session onto offsets from its own first entry',()=>{
  const {rebased,nextOffset}=rebaseSession([
    {startTime:'2026-09-01T10:00:00Z',endTime:'2026-09-01T10:00:04Z'},
    {startTime:'2026-09-01T10:00:04Z',endTime:'2026-09-01T10:00:10Z'},
  ],0)
  assert.deepStrictEqual(rebased[0],{startMs:0,endMs:4000})
  assert.deepStrictEqual(rebased[1],{startMs:4000,endMs:10_000})
  assert.deepStrictEqual(nextOffset,11_000)
})

Deno.test('continues a resumed call past the previous session instead of overlapping it',()=>{
  /* A dropped-and-resumed call produces one transcript per session, each starting near zero. Without
   * this the two timelines overlap and every speaking-share figure derived from them is wrong in a
   * way that still looks plausible. */
  const first=rebaseSession([{startTime:'2026-09-01T10:00:00Z',endTime:'2026-09-01T10:00:30Z'}],0)
  const second=rebaseSession([{startTime:'2026-09-01T11:00:00Z',endTime:'2026-09-01T11:00:20Z'}],first.nextOffset)
  assert.deepStrictEqual(first.rebased[0].endMs,30_000)
  // Starts after the first session ended, not back at zero.
  assert.deepStrictEqual(second.rebased[0].startMs,31_000)
  assert.deepStrictEqual(second.rebased[0].endMs,51_000)
})

Deno.test('leaves an untimed session untimed rather than inventing an origin',()=>{
  const {rebased,nextOffset}=rebaseSession([{text:'no timestamps'} as {startTime?:string},{}],5000)
  assert.deepStrictEqual(rebased[0],{startMs:null,endMs:null})
  assert.deepStrictEqual(rebased[1],{startMs:null,endMs:null})
  // Nothing measurable happened, so the next session starts where this one did.
  assert.deepStrictEqual(nextOffset,6000)
})

Deno.test('keeps a single untimed entry inside an otherwise timed session',()=>{
  const {rebased}=rebaseSession([
    {startTime:'2026-09-01T10:00:00Z',endTime:'2026-09-01T10:00:02Z'},
    {},
    {startTime:'2026-09-01T10:00:05Z',endTime:'2026-09-01T10:00:09Z'},
  ],0)
  assert.deepStrictEqual(rebased[0].startMs,0)
  assert.deepStrictEqual(rebased[1],{startMs:null,endMs:null})
  assert.deepStrictEqual(rebased[2],{startMs:5000,endMs:9000})
})
