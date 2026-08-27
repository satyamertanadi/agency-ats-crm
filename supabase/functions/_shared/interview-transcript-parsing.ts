/* Transcript normalisation for manual imports.
 *
 * Everything in here treats its input as hostile text from an unknown tool: a recruiter pastes
 * whatever their meeting platform produced, and the shapes vary more than the format names suggest.
 * The rules that matter downstream:
 *
 * - Original speaker labels are preserved verbatim. They are the join key a human later maps to a
 *   member or candidate, so "normalising" them loses the only thing tying an entry to a person.
 * - A timestamp that cannot be parsed becomes null rather than zero. Zero is a real position in a
 *   recording, and a file full of fabricated zeroes would produce a speaking-share ratio that looks
 *   authoritative and means nothing.
 * - Nothing is silently dropped. An unreadable file raises; a readable file with gaps reports
 *   `partial` so confidence downstream can fall.
 *
 * Text is never trusted as markup or as instructions -- it is stored as text and rendered as text.
 */

export type TranscriptFormat='txt'|'vtt'|'srt'|'json'

export interface ParsedTranscriptEntry {
  sourceSpeakerId:string
  displayName:string|null
  startMs:number|null
  endMs:number|null
  text:string
}

export interface ParsedTranscriptSpeaker {
  sourceSpeakerId:string
  displayName:string|null
}

export interface ParsedTranscript {
  format:TranscriptFormat
  entries:ParsedTranscriptEntry[]
  speakers:ParsedTranscriptSpeaker[]
  hasTimestamps:boolean
  completeness:'complete'|'partial'|'unknown'
  languageCodes:string[]
}

export class TranscriptParseError extends Error {
  code:string
  constructor(code:string,message:string){super(message);this.code=code;this.name='TranscriptParseError'}
}

/* The label used when a line carries text but names nobody. It is a real mapping target: unknown
 * speech stays visible in the metrics rather than being redistributed across identified speakers. */
export const UNKNOWN_SPEAKER='unknown'

const MAX_ENTRIES=20000

/* A pasted transcript arrives as text, so a binary file reaching this point means the caller sent
 * the wrong thing -- a PDF, a DOCX, an audio file. NUL bytes and a high proportion of C0 control
 * characters are what separates those from a UTF-8 transcript in any language. Checked before any
 * parsing so the failure names the real problem. */
export function assertTextualTranscript(raw:string){
  if(raw.includes('\u0000'))throw new TranscriptParseError('binary_content','This file is not a text transcript.')
  const sample=raw.slice(0,4000)
  if(!sample.trim())throw new TranscriptParseError('empty_transcript','The transcript is empty.')
  // eslint-disable-next-line no-control-regex
  const control=(sample.match(/[\u0001-\u0008\u000B\u000C\u000E-\u001F]/g)||[]).length
  if(control>sample.length*0.02)throw new TranscriptParseError('binary_content','This file is not a text transcript.')
}

/* Unicode normalisation happens once, here, before the checksum is taken. Two imports of the same
 * transcript that differ only in composed vs decomposed accents are the same artifact and must
 * deduplicate against each other; normalising after hashing would defeat that. */
export function normalizeTranscriptText(raw:string):string{
  return raw
    .replace(/^\uFEFF/,'')
    .replace(/\r\n?/g,'\n')
    .normalize('NFC')
}

export function detectTranscriptFormat(text:string,fileName?:string|null):TranscriptFormat{
  const trimmed=text.trimStart()
  /* An opening brace and an opening bracket are treated differently on purpose.
   *
   * No transcript line begins with `{`, so a document that does was meant to be JSON: if it does not
   * parse, the honest answer is "this JSON is broken", not a silent reinterpretation of the braces as
   * prose. A leading `[` is genuinely ambiguous -- `[00:01:00] Sarah: ...` is one of the most common
   * plain-text shapes there is -- so that one is only JSON if the whole document actually parses. */
  if(trimmed.startsWith('{'))return 'json'
  if(trimmed.startsWith('[')){
    try{JSON.parse(trimmed);return 'json'}catch{/* a bracketed timestamp, not a JSON array */}
  }
  if(/^WEBVTT/.test(trimmed))return 'vtt'
  // An SRT block opens with a cue number on its own line followed by a comma-separated timestamp
  // range; VTT uses a dot. Checking the range rather than the extension, because files get renamed.
  if(/^\d+\s*\n\d{2}:\d{2}:\d{2},\d{3}\s*-->/m.test(trimmed))return 'srt'
  if(/-->/.test(trimmed))return 'vtt'
  const extension=(fileName||'').toLowerCase().split('.').pop()
  if(extension==='vtt')return 'vtt'
  if(extension==='srt')return 'srt'
  if(extension==='json')return 'json'
  return 'txt'
}

export function parseTranscript(raw:string,fileName?:string|null):ParsedTranscript{
  assertTextualTranscript(raw)
  const text=normalizeTranscriptText(raw)
  const format=detectTranscriptFormat(text,fileName)
  const entries=format==='json'?parseJson(text)
    :format==='vtt'?parseCues(text,'vtt')
    :format==='srt'?parseCues(text,'srt')
    :parsePlainText(text)

  if(!entries.length)throw new TranscriptParseError('no_entries','No transcript lines could be read from this file.')
  if(entries.length>MAX_ENTRIES)throw new TranscriptParseError('transcript_too_long',`A transcript may contain at most ${MAX_ENTRIES} lines.`)

  return finalize(format,entries)
}

/* Ordering, timestamp coverage and the speaker roster are decided here rather than in each parser,
 * so every format reports coverage the same way. */
function finalize(format:TranscriptFormat,entries:ParsedTranscriptEntry[]):ParsedTranscript{
  // A stable sort on start time keeps out-of-order cues (common in corrected exports) in a sensible
  // order without disturbing entries that carry no timestamp at all.
  const ordered=entries
    .map((entry,index)=>({entry,index}))
    .sort((a,b)=>{
      const left=a.entry.startMs,right=b.entry.startMs
      if(left===null||right===null)return a.index-b.index
      return left===right?a.index-b.index:left-right
    })
    .map((item)=>item.entry)

  const timed=ordered.filter((entry)=>entry.startMs!==null).length
  const hasTimestamps=timed>0
  const completeness=timed===0?'unknown':timed===ordered.length?'complete':'partial'

  const speakers=new Map<string,ParsedTranscriptSpeaker>()
  for(const entry of ordered){
    const existing=speakers.get(entry.sourceSpeakerId)
    if(!existing)speakers.set(entry.sourceSpeakerId,{sourceSpeakerId:entry.sourceSpeakerId,displayName:entry.displayName})
    else if(!existing.displayName&&entry.displayName)existing.displayName=entry.displayName
  }

  return {format,entries:ordered,speakers:[...speakers.values()],hasTimestamps,completeness,languageCodes:[]}
}

/* "Name: what they said", the shape almost every copy-paste produces, optionally preceded by a
 * bracketed or bare timestamp. A continuation line with no label belongs to whoever spoke last --
 * treating it as a new unknown speaker would shred a long answer into anonymous fragments. */
function parsePlainText(text:string):ParsedTranscriptEntry[]{
  const entries:ParsedTranscriptEntry[]=[]
  let current:ParsedTranscriptEntry|null=null

  for(const rawLine of text.split('\n')){
    const line=rawLine.trim()
    if(!line){current=null;continue}

    const match=line.match(/^(?:[[(]?\s*(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?)\s*[\])]?\s+)?([^:]{1,80}?)\s*:\s*(.*)$/)
    if(match&&match[3]!==undefined&&looksLikeSpeakerLabel(match[2])){
      const [,stamp,label,body]=match
      const speaker=label.trim()||UNKNOWN_SPEAKER
      // Pushed even when the body is empty: "Speaker:" on its own line opens a turn whose text
      // arrives on the following lines, and the empty-text entries are filtered at the end.
      current={sourceSpeakerId:speaker,displayName:speaker===UNKNOWN_SPEAKER?null:speaker,startMs:parseClock(stamp),endMs:null,text:body.trim()}
      entries.push(current)
      continue
    }

    if(current){current.text=`${current.text} ${line}`.trim();continue}
    entries.push({sourceSpeakerId:UNKNOWN_SPEAKER,displayName:null,startMs:null,endMs:null,text:line})
    current=entries[entries.length-1]
  }

  return entries.filter((entry)=>entry.text.length>0)
}

/* A speaker label is a name, not a sentence, and the difference has to be guessed because plain text
 * carries no marker for it. The rule is deliberately conservative: short, and free of sentence
 * punctuation anywhere. It accepts "Sarah Chen", "Interviewer", "Speaker 1", "Chen, Sarah (Host)",
 * and rejects "So the position is this" -- a mid-answer sentence that happens to contain a colon.
 *
 * This is a heuristic and it will occasionally be wrong in both directions. It errs towards treating
 * an ambiguous line as continued speech from the previous speaker, because merging two lines of one
 * person's answer is recoverable by a human reading the transcript, whereas inventing a speaker named
 * after half a sentence corrupts the speaker roster the mapping step depends on. */
function looksLikeSpeakerLabel(label:string):boolean{
  const trimmed=label.trim()
  if(!trimmed||trimmed.length>60)return false
  if(/[.!?]/.test(trimmed))return false
  return trimmed.split(/\s+/).length<=4
}

/* VTT and SRT differ only in the header, the cue-number line and the millisecond separator, so one
 * cue reader serves both. */
function parseCues(text:string,dialect:'vtt'|'srt'):ParsedTranscriptEntry[]{
  const body=dialect==='vtt'?text.replace(/^WEBVTT[^\n]*\n?/,''):text
  const entries:ParsedTranscriptEntry[]=[]

  for(const block of body.split(/\n{2,}/)){
    const lines=block.split('\n').map((line)=>line.trim()).filter(Boolean)
    if(!lines.length)continue
    // NOTE and STYLE blocks are metadata, not speech.
    if(dialect==='vtt'&&/^(NOTE|STYLE|REGION)\b/.test(lines[0]))continue

    const timingIndex=lines.findIndex((line)=>line.includes('-->'))
    if(timingIndex===-1)continue

    const timing=lines[timingIndex].split('-->')
    const startMs=parseClock(timing[0]?.trim())
    // A trailing VTT cue setting ("align:start position:50%") is not part of the timestamp.
    const endMs=parseClock(timing[1]?.trim().split(/\s+/)[0])

    const spoken=lines.slice(timingIndex+1)
    if(!spoken.length)continue

    let speaker=UNKNOWN_SPEAKER
    let display:string|null=null
    const collected:string[]=[]

    for(const line of spoken){
      const voice=line.match(/^<v\s+([^>]+)>\s*(.*?)(?:<\/v>)?$/)
      if(voice){speaker=voice[1].trim()||UNKNOWN_SPEAKER;display=speaker===UNKNOWN_SPEAKER?null:speaker;collected.push(voice[2].trim());continue}
      const labelled=line.match(/^([^:]{1,80}?)\s*:\s*(.*)$/)
      if(labelled&&collected.length===0&&looksLikeSpeakerLabel(labelled[1])){
        speaker=labelled[1].trim()||UNKNOWN_SPEAKER
        display=speaker===UNKNOWN_SPEAKER?null:speaker
        collected.push(labelled[2].trim())
        continue
      }
      collected.push(line)
    }

    const content=collected.join(' ').replace(/<[^>]+>/g,'').trim()
    if(!content)continue
    entries.push({sourceSpeakerId:speaker,displayName:display,startMs,endMs,text:content})
  }

  return entries
}

/* The documented JSON shape, tolerant about key naming because every exporter picks its own. What it
 * is NOT tolerant about is inventing data: a missing or unparseable timestamp stays null. */
function parseJson(text:string):ParsedTranscriptEntry[]{
  let parsed:unknown
  try{parsed=JSON.parse(text)}
  catch{throw new TranscriptParseError('malformed_json','This JSON transcript could not be read.')}

  const list=Array.isArray(parsed)?parsed
    :isRecord(parsed)&&Array.isArray(parsed.entries)?parsed.entries
    :isRecord(parsed)&&Array.isArray(parsed.segments)?parsed.segments
    :null
  if(!list)throw new TranscriptParseError('malformed_json','This JSON transcript has no entries array.')

  const entries:ParsedTranscriptEntry[]=[]
  for(const item of list){
    if(!isRecord(item))continue
    const content=firstString(item,['text','content','transcript','value'])
    if(!content||!content.trim())continue
    const label=firstString(item,['speaker','speaker_name','speakerLabel','speaker_id','name'])
    const speaker=label&&label.trim()?label.trim():UNKNOWN_SPEAKER
    entries.push({
      sourceSpeakerId:speaker,
      displayName:speaker===UNKNOWN_SPEAKER?null:speaker,
      startMs:firstTime(item,['start_ms','startMs','start','start_time','offset_ms']),
      endMs:firstTime(item,['end_ms','endMs','end','end_time']),
      text:content.trim(),
    })
  }
  return entries
}

function isRecord(value:unknown):value is Record<string,unknown>{return Boolean(value)&&typeof value==='object'&&!Array.isArray(value)}

function firstString(source:Record<string,unknown>,keys:string[]):string|null{
  for(const key of keys){const value=source[key];if(typeof value==='string')return value}
  return null
}

/* Accepts a millisecond number, a seconds number, or a clock string, and refuses anything else.
 * Distinguishing seconds from milliseconds by key name rather than by magnitude: a 45-second answer
 * and 45 milliseconds are both plausible numbers, and guessing wrong silently rescales the whole
 * conversation. */
function firstTime(source:Record<string,unknown>,keys:string[]):number|null{
  for(const key of keys){
    const value=source[key]
    if(typeof value==='number'&&Number.isFinite(value)&&value>=0){
      return key.endsWith('_ms')||key.endsWith('Ms')?Math.round(value):Math.round(value*1000)
    }
    if(typeof value==='string'){const parsed=parseClock(value);if(parsed!==null)return parsed}
  }
  return null
}

/* hh:mm:ss.mmm / mm:ss,mmm / plain seconds. Returns null -- never 0 -- for anything it cannot read,
 * including the malformed ranges that show up in hand-edited files. */
export function parseClock(value:string|null|undefined):number|null{
  if(!value)return null
  const trimmed=value.trim()
  if(!trimmed)return null

  const clock=trimmed.match(/^(?:(\d{1,3}):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/)
  if(clock){
    const hours=clock[1]?Number(clock[1]):0
    const minutes=Number(clock[2])
    const seconds=Number(clock[3])
    // 00:75:00 is not a time. A file that contains one is malformed, not a 75-minute mark.
    if(minutes>59||seconds>59)return null
    const fraction=clock[4]?Number(clock[4].padEnd(3,'0')):0
    return ((hours*3600)+(minutes*60)+seconds)*1000+fraction
  }

  if(/^\d+(\.\d+)?$/.test(trimmed))return Math.round(Number(trimmed)*1000)
  return null
}

/* Content-addressed identity for duplicate detection. Taken over the normalised text so the same
 * transcript pasted twice, or uploaded once and pasted once, collides. */
export async function transcriptChecksum(normalized:string):Promise<string>{
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(normalized))
  return [...new Uint8Array(digest)].map((byte)=>byte.toString(16).padStart(2,'0')).join('')
}

/* Filenames arrive from the user's machine and are stored and echoed back. Path separators, traversal
 * segments and control characters are removed rather than escaped. */
export function sanitizeTranscriptFileName(name:string|null|undefined):string{
  if(!name)return 'transcript.txt'
  const base=name.split(/[\\/]/).pop()||'transcript.txt'
  // eslint-disable-next-line no-control-regex
  const cleaned=base.replace(/[\u0000-\u001F<>:"|?*]/g,'').replace(/^\.+/,'').trim()
  return cleaned.slice(0,180)||'transcript.txt'
}
