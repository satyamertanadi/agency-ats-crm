import {createClient} from '@supabase/supabase-js'
import {afterAll,beforeAll,describe,expect,it} from 'vitest'

/* Ingestion and speaker mapping.
 *
 * The two assertions that carry the most weight are the consent gate -- nothing is stored before it
 * passes, not even a metadata row -- and the transactionality of the insert, because a transcript
 * with speakers and no entries reads as a successfully imported empty interview rather than as a
 * failure, and would be analysed as one.
 */

const url=process.env.SUPABASE_URL||'http://127.0.0.1:55321'
const anon=process.env.SUPABASE_ANON_KEY
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY
if(!anon)throw new Error('SUPABASE_ANON_KEY is required; these tests must not silently skip.')
if(!serviceKey)throw new Error('SUPABASE_SERVICE_ROLE_KEY is required to seed ingestion fixtures.')

const ORG='30000000-0000-0000-0000-000000000001'
const CONSULTANT_MEMBER='40000000-0000-0000-0000-000000000003'
const RIVAL_MEMBER='40000000-0000-0000-0000-000000000008'
const CANDIDATE='70000000-0000-0000-0000-000000000001'
const JOB_CANDIDATE='81000000-0000-0000-0000-000000000001'
const CONSULTANT_USER='10000000-0000-0000-0000-000000000003'

const service=createClient(url,serviceKey,{auth:{persistSession:false}})
const consultant=createClient(url,anon,{auth:{persistSession:false}})
const sourcer=createClient(url,anon,{auth:{persistSession:false}})

let interviewId=''
const transcripts:string[]=[]

const required=<T,>(value:T|null|undefined,label:string):T=>{if(value===null||value===undefined)throw new Error(`${label} is required`);return value}

const speakers=[{sourceSpeakerId:'Sarah Chen',displayName:'Sarah Chen'},{sourceSpeakerId:'Aisha Rahman',displayName:'Aisha Rahman'}]
const entries=[
  {sourceSpeakerId:'Sarah Chen',startMs:0,endMs:3000,text:'Tell me about your last role.'},
  {sourceSpeakerId:'Aisha Rahman',startMs:3000,endMs:12000,text:'I led the commercial team for three years.'},
]

async function ingest(overrides:Record<string,unknown>={}){
  const result=await service.rpc('ingest_interview_transcript',{
    p_organization_id:ORG,p_interview_id:interviewId,p_created_by:CONSULTANT_USER,
    p_source:'manual_text',p_checksum:`checksum-${Math.random()}`,p_language_codes:['en'],
    p_has_timestamps:true,p_completeness:'complete',p_started_at:null,p_ended_at:null,
    p_duration_seconds:null,p_retention_days:90,p_supersedes_transcript_id:null,
    p_speakers:speakers,p_entries:entries,
    ...overrides,
  })
  const id=(result.data as {transcript_id?:string}|null)?.transcript_id
  if(id)transcripts.push(id)
  return result
}

async function grantConsent(){
  const consent=await service.from('interview_transcription_consents').insert({
    organization_id:ORG,interview_id:interviewId,candidate_id:CANDIDATE,
    status:'granted',consent_method:'spoken',recorded_by:CONSULTANT_USER,
  })
  if(consent.error)throw consent.error
}

beforeAll(async()=>{
  const signIns=await Promise.all([
    consultant.auth.signInWithPassword({email:'consultant@northstar.local',password:'LocalTest!123'}),
    sourcer.auth.signInWithPassword({email:'sourcer@northstar.local',password:'LocalTest!123'}),
  ])
  signIns.forEach((result)=>{if(result.error)throw result.error})
  const enabled=await service.from('organization_settings').update({interview_intelligence_enabled:true}).eq('organization_id',ORG)
  if(enabled.error)throw enabled.error

  const interview=await service.from('interviews').insert({
    organization_id:ORG,job_candidate_id:JOB_CANDIDATE,starts_at:'2026-09-20T09:00:00Z',ends_at:'2026-09-20T10:00:00Z',
    timezone:'UTC',status:'completed',organizer_member_id:CONSULTANT_MEMBER,created_by:CONSULTANT_USER,
  }).select('id').single()
  if(interview.error)throw interview.error
  interviewId=required(interview.data,'interview').id
})

afterAll(async()=>{
  for(const id of transcripts)await service.from('interview_transcripts').delete().eq('id',id)
  if(interviewId){
    await service.from('interview_transcription_consents').delete().eq('interview_id',interviewId)
    await service.from('interviews').delete().eq('id',interviewId)
  }
  await service.from('organization_settings').update({interview_intelligence_enabled:false}).eq('organization_id',ORG)
})

describe('consent gates storage, not just analysis',()=>{
  it('refuses to store anything before consent is recorded',async()=>{
    const result=await ingest()
    expect(result.error?.message).toContain('transcript_consent_required')

    // Not even a metadata row. Consent is checked before the first insert, not after.
    const stored=await service.from('interview_transcripts').select('id').eq('interview_id',interviewId)
    expect(stored.data).toEqual([])
  })

  it('refuses when the latest consent event is a withdrawal',async()=>{
    await grantConsent()
    const withdrawn=await service.from('interview_transcription_consents').insert({
      organization_id:ORG,interview_id:interviewId,candidate_id:CANDIDATE,
      status:'withdrawn',consent_method:'written',recorded_by:CONSULTANT_USER,
    })
    expect(withdrawn.error).toBeNull()
    const result=await ingest()
    expect(result.error?.message).toContain('transcript_consent_required')
    await service.from('interview_transcription_consents').delete().eq('interview_id',interviewId)
  })
})

describe('ingestion',()=>{
  beforeAll(grantConsent)

  it('stores metadata, speakers and entries in one act',async()=>{
    const result=await ingest({p_checksum:'fixture-primary'})
    expect(result.error).toBeNull()
    const payload=result.data as {transcript_id:string;status:string;entry_count:number;speaker_count:number}
    expect(payload.status).toBe('needs_mapping')
    expect(payload.entry_count).toBe(2)
    expect(payload.speaker_count).toBe(2)

    const stored=await service.from('interview_transcript_entries').select('sequence_number,text').eq('transcript_id',payload.transcript_id).order('sequence_number')
    expect(stored.data).toHaveLength(2)
    // Sequence numbers come from array position, not from the payload.
    expect(stored.data?.map((row)=>row.sequence_number)).toEqual([1,2])
  })

  it('arrives needing mapping, never ready',async()=>{
    // Parser labels are strings off somebody's meeting tool. Until a human says which string is the
    // candidate, nothing downstream can attribute a word to anyone.
    const transcript=await service.from('interview_transcripts').select('status').eq('checksum','fixture-primary').single()
    expect(transcript.data?.status).toBe('needs_mapping')
  })

  it('treats the same content imported twice as one artifact',async()=>{
    const again=await ingest({p_checksum:'fixture-primary'})
    expect(again.error).toBeNull()
    const payload=again.data as {duplicate:boolean;transcript_id:string}
    expect(payload.duplicate).toBe(true)

    const all=await service.from('interview_transcripts').select('id').eq('interview_id',interviewId).eq('checksum','fixture-primary')
    expect(all.data).toHaveLength(1)
  })

  it('refuses an entry naming a speaker the parser did not list',async()=>{
    // That join would silently drop the line, and a transcript missing lines is worse than one that
    // failed to import.
    const result=await ingest({
      p_checksum:'fixture-mismatch',
      p_entries:[{sourceSpeakerId:'Nobody',startMs:0,endMs:1000,text:'Orphaned line.'}],
    })
    expect(result.error?.message).toContain('transcript_speaker_mismatch')
    const stored=await service.from('interview_transcripts').select('id').eq('checksum','fixture-mismatch')
    expect(stored.data).toEqual([])
  })

  it('refuses an empty transcript',async()=>{
    const result=await ingest({p_checksum:'fixture-empty',p_entries:[]})
    expect(result.error?.message).toContain('transcript_empty')
  })

  it('records an audit event carrying counts and no transcript text',async()=>{
    const audit=await service.from('audit_logs').select('metadata').eq('action','interview_transcript.imported').eq('organization_id',ORG)
    expect((audit.data||[]).length).toBeGreaterThan(0)
    const serialized=JSON.stringify(audit.data)
    expect(serialized).not.toContain('commercial team')
    expect(serialized).toContain('entry_count')
  })

  it('supersedes a corrected import without deleting the original',async()=>{
    const original=required((await service.from('interview_transcripts').select('id').eq('checksum','fixture-primary').single()).data,'original').id
    const correction=await ingest({p_checksum:'fixture-correction',p_supersedes_transcript_id:original})
    expect(correction.error).toBeNull()

    const previous=await service.from('interview_transcripts').select('superseded_by_transcript_id').eq('id',original).single()
    expect(previous.data?.superseded_by_transcript_id).toBe((correction.data as {transcript_id:string}).transcript_id)

    const bundle=await service.rpc('current_interview_transcripts',{p_interview_id:interviewId})
    expect((bundle.data as {id:string}[]|null||[]).map((row)=>row.id)).not.toContain(original)
  })
})

describe('speaker mapping',()=>{
  let transcriptId=''
  let sarah=''
  let aisha=''

  beforeAll(async()=>{
    const result=await ingest({p_checksum:'fixture-mapping'})
    if(result.error)throw new Error(result.error.message)
    transcriptId=(result.data as {transcript_id:string}).transcript_id
    const rows=await service.from('interview_transcript_speakers').select('id,source_speaker_id').eq('transcript_id',transcriptId)
    sarah=required(rows.data?.find((row)=>row.source_speaker_id==='Sarah Chen'),'sarah').id
    aisha=required(rows.data?.find((row)=>row.source_speaker_id==='Aisha Rahman'),'aisha').id
  })

  it('refuses a consultant mapping with nobody behind it',async()=>{
    // A consultant speaker with no member cannot be a performance subject.
    const result=await consultant.rpc('confirm_interview_transcript_speaker',{
      p_organization_id:ORG,p_speaker_id:sarah,p_speaker_role:'consultant',
      p_member_id:null,p_candidate_id:null,p_contact_id:null,
    })
    expect(result.error?.message).toContain('invalid_speaker_identity')
  })

  it('refuses two identities for one speaker',async()=>{
    const result=await consultant.rpc('confirm_interview_transcript_speaker',{
      p_organization_id:ORG,p_speaker_id:sarah,p_speaker_role:'consultant',
      p_member_id:CONSULTANT_MEMBER,p_candidate_id:CANDIDATE,p_contact_id:null,
    })
    expect(result.error?.message).toContain('invalid_speaker_identity')
  })

  it('refuses a speaker from another workspace',async()=>{
    const result=await consultant.rpc('confirm_interview_transcript_speaker',{
      p_organization_id:ORG,p_speaker_id:sarah,p_speaker_role:'consultant',
      p_member_id:RIVAL_MEMBER,p_candidate_id:null,p_contact_id:null,
    })
    expect(result.error).not.toBeNull()
  })

  it('refuses somebody who cannot access the transcript',async()=>{
    const result=await sourcer.rpc('confirm_interview_transcript_speaker',{
      p_organization_id:ORG,p_speaker_id:sarah,p_speaker_role:'consultant',
      p_member_id:CONSULTANT_MEMBER,p_candidate_id:null,p_contact_id:null,
    })
    expect(result.error?.message).toContain('permission_denied')
  })

  it('records who confirmed, and promotes the transcript only once every speaker is decided',async()=>{
    const first=await consultant.rpc('confirm_interview_transcript_speaker',{
      p_organization_id:ORG,p_speaker_id:sarah,p_speaker_role:'consultant',
      p_member_id:CONSULTANT_MEMBER,p_candidate_id:null,p_contact_id:null,
    })
    expect(first.error).toBeNull()

    // One of two decided: still not ready.
    const midway=await service.from('interview_transcripts').select('status').eq('id',transcriptId).single()
    expect(midway.data?.status).toBe('needs_mapping')

    const second=await consultant.rpc('confirm_interview_transcript_speaker',{
      p_organization_id:ORG,p_speaker_id:aisha,p_speaker_role:'candidate',
      p_member_id:null,p_candidate_id:CANDIDATE,p_contact_id:null,
    })
    expect(second.error).toBeNull()

    const ready=await service.from('interview_transcripts').select('status').eq('id',transcriptId).single()
    expect(ready.data?.status).toBe('ready')

    const stored=await service.from('interview_transcript_speakers').select('member_id,candidate_id,confirmed_by,confirmed_at').eq('id',sarah).single()
    expect(stored.data?.member_id).toBe(CONSULTANT_MEMBER)
    expect(stored.data?.candidate_id).toBeNull()
    expect(stored.data?.confirmed_by).toBe(CONSULTANT_USER)
    expect(stored.data?.confirmed_at).not.toBeNull()
  })

  it('accepts unknown as a real decision rather than blocking the import',async()=>{
    const result=await ingest({p_checksum:'fixture-unknown'})
    const id=(result.data as {transcript_id:string}).transcript_id
    const rows=await service.from('interview_transcript_speakers').select('id').eq('transcript_id',id)
    for(const row of rows.data||[]){
      const confirmed=await consultant.rpc('confirm_interview_transcript_speaker',{
        p_organization_id:ORG,p_speaker_id:row.id,p_speaker_role:'unknown',
        p_member_id:null,p_candidate_id:null,p_contact_id:null,
      })
      expect(confirmed.error).toBeNull()
    }
    const transcript=await service.from('interview_transcripts').select('status').eq('id',id).single()
    expect(transcript.data?.status).toBe('ready')
  })

  it('maps a whole transcript in one call and audits it once',async()=>{
    const result=await ingest({p_checksum:'fixture-bulk'})
    const id=(result.data as {transcript_id:string}).transcript_id
    const rows=await service.from('interview_transcript_speakers').select('id,source_speaker_id').eq('transcript_id',id)
    const mappings=(rows.data||[]).map((row)=>row.source_speaker_id==='Sarah Chen'
      ? {speaker_id:row.id,speaker_role:'consultant',member_id:CONSULTANT_MEMBER}
      : {speaker_id:row.id,speaker_role:'candidate',candidate_id:CANDIDATE})

    const bulk=await consultant.rpc('bulk_confirm_interview_transcript_speakers',{
      p_organization_id:ORG,p_transcript_id:id,p_mappings:mappings,
    })
    expect(bulk.error).toBeNull()
    expect(bulk.data).toBe(2)

    const transcript=await service.from('interview_transcripts').select('status').eq('id',id).single()
    expect(transcript.data?.status).toBe('ready')

    // One audit row for the act, not one per label.
    const audit=await service.from('audit_logs').select('id').eq('action','interview_transcript.speakers_confirmed').eq('entity_id',id)
    expect(audit.data).toHaveLength(1)
  })
})

describe('transcript overview',()=>{
  it('lists the interview transcripts with what is still undecided',async()=>{
    const overview=await consultant.rpc('get_interview_transcript_overview',{p_organization_id:ORG,p_interview_id:interviewId})
    expect(overview.error).toBeNull()
    const rows=overview.data as {transcript_id:string;status:string;unmapped_speaker_count:number;speaker_count:number}[]
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((row)=>row.speaker_count===2)).toBe(true)
  })

  it('tells somebody without transcript access nothing',async()=>{
    const overview=await sourcer.rpc('get_interview_transcript_overview',{p_organization_id:ORG,p_interview_id:interviewId})
    expect(overview.error).toBeNull()
    expect(overview.data).toEqual([])
  })
})
