/* Pure shaping of a Google Meet transcript into the row the analysis step reads.
 *
 * Deliberately free of Deno and network APIs so tests/unit can import it directly, the same way
 * cv-schema.ts is imported by tests/unit/cv-extraction-normalization.test.ts.
 *
 * The hard part here is not parsing -- it is deciding who was talking. The Meet API identifies a
 * participant by a resource name and a display name; there is no email on it, and getting one would
 * mean a Directory/People scope this feature does not otherwise need. So roles are resolved by name,
 * with a deliberate ordering: the organizer's own name is the single most reliable signal, any other
 * workspace member is next, the candidate on the pipeline row is next, and a two-speaker call lets
 * the remaining voice be inferred. When none of that lands, the speaker is 'other' -- an honest
 * answer that costs a rubric criterion, rather than a guess that attributes the candidate's words to
 * the consultant being reviewed.
 */

export type SpeakerRole='consultant'|'candidate'|'other'

export interface MeetParticipant {
  name:string
  displayName:string
}

export interface MeetEntry {
  participant:string
  text:string
  languageCode?:string
  startTime?:string
  endTime?:string
}

export interface TranscriptEntry {
  speaker_id:string
  speaker_name:string
  speaker_role:SpeakerRole
  text:string
  start_ms:number
  end_ms:number
}

export interface TalkTime {
  consultant_ms:number
  candidate_ms:number
  other_ms:number
}

export interface ShapeInput {
  participants:MeetParticipant[]
  entries:MeetEntry[]
  /** Full name of the interview's organizer, from profiles.full_name. */
  organizerName?:string|null
  /** Full names of every active workspace member, used to catch a second consultant on the call. */
  memberNames?:string[]
  /** Full name of the candidate on the pipeline row this interview belongs to. */
  candidateName?:string|null
}

export interface ShapedTranscript {
  entries:TranscriptEntry[]
  plainText:string
  talkTime:TalkTime
  language:string|null
  durationSeconds:number
  speakers:{id:string;name:string;role:SpeakerRole}[]
}

// Bounds the row and the prompt. A 90-minute interview runs to roughly 15,000 words; these leave
// generous headroom while keeping a pathological transcript from becoming a pathological row.
const MAX_ENTRIES=6000
const MAX_PLAIN_TEXT=400_000

function normalizeName(value:string|null|undefined){
  return (value||'').toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]+/g,'').replace(/\s+/g,' ').trim()
}

/* Two names match when one contains the other as a whole-word run: Meet display names are routinely
 * shorter or longer than the ATS record ("Ari" vs "Pak Ari Wibowo"), and requiring equality would
 * push most real calls to 'other'. Substring containment alone would match "Ari" inside "Mariana",
 * hence the word-boundary padding. */
function namesMatch(a:string,b:string){
  if(!a||!b)return false
  if(a===b)return true
  const long=a.length>=b.length?a:b
  const short=a.length>=b.length?b:a
  // A single-character "name" is noise, not an identity.
  if(short.length<2)return false
  return ` ${long} `.includes(` ${short} `)
}

export function resolveSpeakerRoles(input:ShapeInput):Map<string,{name:string;role:SpeakerRole}> {
  const organizer=normalizeName(input.organizerName)
  const members=(input.memberNames||[]).map(normalizeName).filter(Boolean)
  const candidate=normalizeName(input.candidateName)
  const resolved=new Map<string,{name:string;role:SpeakerRole}>()

  for(const participant of input.participants){
    const display=participant.displayName||'Unknown speaker'
    const normalized=normalizeName(display)
    let role:SpeakerRole='other'
    if(organizer&&namesMatch(normalized,organizer))role='consultant'
    else if(candidate&&namesMatch(normalized,candidate))role='candidate'
    else if(members.some((member)=>namesMatch(normalized,member)))role='consultant'
    resolved.set(participant.name,{name:display,role})
  }

  /* The common case this rescues: a candidate who joined with a display name that does not match the
   * ATS record at all (a nickname, a personal account, a phone dial-in). With exactly two voices on
   * the call and one of them positively identified as the consultant, the other one is the candidate
   * by elimination -- no guessing about which is which. Three or more unidentified voices, or no
   * identified consultant, and everything stays 'other'. */
  const values=[...resolved.values()]
  if(values.length===2&&values.filter((entry)=>entry.role==='consultant').length===1){
    for(const entry of values)if(entry.role==='other')entry.role='candidate'
  }
  return resolved
}

function toMillis(value:string|undefined,base:number|null):number|null{
  if(!value)return null
  const parsed=Date.parse(value)
  if(Number.isNaN(parsed))return null
  return base===null?0:parsed-base
}

export function shapeTranscript(input:ShapeInput):ShapedTranscript{
  const speakers=resolveSpeakerRoles(input)
  const usable=input.entries.filter((entry)=>typeof entry.text==='string'&&entry.text.trim()!=='').slice(0,MAX_ENTRIES)
  // Entry timestamps are absolute RFC 3339 instants; the first one anchors the relative clock so a
  // reader (and the model) sees offsets into the interview rather than wall-clock times.
  const firstStart=usable.reduce<number|null>((earliest,entry)=>{
    const parsed=entry.startTime?Date.parse(entry.startTime):Number.NaN
    if(Number.isNaN(parsed))return earliest
    return earliest===null||parsed<earliest?parsed:earliest
  },null)

  const entries:TranscriptEntry[]=[]
  const talkTime:TalkTime={consultant_ms:0,candidate_ms:0,other_ms:0}
  let language:string|null=null
  let lastEnd=0

  for(const entry of usable){
    const speaker=speakers.get(entry.participant)
    const role=speaker?.role||'other'
    const start=toMillis(entry.startTime,firstStart)??lastEnd
    const end=toMillis(entry.endTime,firstStart)
    // An entry with no usable end time contributes text but no talk time, rather than a negative or
    // invented duration that would quietly skew the balance the rubric reads.
    const safeEnd=end!==null&&end>=start?end:start
    entries.push({speaker_id:entry.participant,speaker_name:speaker?.name||'Unknown speaker',speaker_role:role,text:entry.text.trim(),start_ms:Math.max(0,start),end_ms:Math.max(0,safeEnd)})
    talkTime[`${role}_ms` as keyof TalkTime]+=Math.max(0,safeEnd-start)
    if(!language&&entry.languageCode)language=entry.languageCode
    lastEnd=Math.max(lastEnd,safeEnd)
  }

  let plainText=''
  for(const entry of entries){
    const line=`${entry.speaker_name} (${entry.speaker_role}): ${entry.text}\n`
    if(plainText.length+line.length>MAX_PLAIN_TEXT)break
    plainText+=line
  }

  return {
    entries,
    plainText:plainText.trimEnd(),
    talkTime,
    language,
    durationSeconds:Math.round(lastEnd/1000),
    speakers:[...speakers.entries()].map(([id,value])=>({id,name:value.name,role:value.role})),
  }
}

/** `https://meet.google.com/abc-defg-hij?authuser=0` -> `abc-defg-hij`. */
export function meetingCodeFromUrl(meetingUrl:string|null|undefined):string|null{
  if(!meetingUrl)return null
  const match=/meet\.google\.com\/([a-z]{3,4}-[a-z]{3,4}-[a-z]{3,4})/i.exec(meetingUrl)
  return match&&match[1]?match[1].toLowerCase():null
}

/* Meet publishes a transcript minutes after the call ends, not instantly, and a host who never
 * started transcription never produces one at all. Both look identical from the API -- an empty
 * transcripts list -- so the retry schedule has to cover "not yet" without hammering for a
 * transcript that will never exist. */
const BACKOFF_MINUTES=[5,15,45,120,240,360]
export const MAX_TRANSCRIPT_ATTEMPTS=BACKOFF_MINUTES.length

export function nextAttemptDelayMs(attempts:number):number{
  const index=Math.min(Math.max(attempts,1),BACKOFF_MINUTES.length)-1
  return (BACKOFF_MINUTES[index]??360)*60_000
}
