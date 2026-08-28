import {createClient} from '@supabase/supabase-js'
import {afterAll,beforeAll,describe,expect,it} from 'vitest'

/* The access rules this domain exists to enforce, tested across two organizations.
 *
 * The one that matters most is the split in the middle: a candidate-fit assessment follows candidate
 * and job access, while a consultant-quality assessment follows its SUBJECT. A colleague holding full
 * candidate access must see nothing about how another consultant interviewed -- that is the whole
 * reason view_own and review_team are separate keys, and it is the assertion most likely to be broken
 * by a well-meaning "just reuse candidates.read" simplification later.
 *
 * Result tables carry no client INSERT policy at all: analysis output is written service-side, so the
 * fixtures below are inserted with the service role and the client attempts are expected to fail. */

const url=process.env.SUPABASE_URL||'http://127.0.0.1:55321'
const anon=process.env.SUPABASE_ANON_KEY
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY
if(!anon)throw new Error('SUPABASE_ANON_KEY is required; these tests must not silently skip.')
if(!serviceKey)throw new Error('SUPABASE_SERVICE_ROLE_KEY is required to seed service-written analysis output.')

const ORG='30000000-0000-0000-0000-000000000001'
const RIVAL_ORG='30000000-0000-0000-0000-000000000002'
const CONSULTANT_MEMBER='40000000-0000-0000-0000-000000000003'
const SOURCER_MEMBER='40000000-0000-0000-0000-000000000004'
const CANDIDATE='70000000-0000-0000-0000-000000000001'
const JOB='80000000-0000-0000-0000-000000000001'
const JOB_CANDIDATE='81000000-0000-0000-0000-000000000001'

const service=createClient(url,serviceKey,{auth:{persistSession:false}})
const owner=createClient(url,anon,{auth:{persistSession:false}})
const consultant=createClient(url,anon,{auth:{persistSession:false}})
const sourcer=createClient(url,anon,{auth:{persistSession:false}})
const readonly=createClient(url,anon,{auth:{persistSession:false}})
const rival=createClient(url,anon,{auth:{persistSession:false}})

const ids={
  interview:'',
  transcript:'',
  speakerConsultant:'',
  speakerCandidate:'',
  entry:'',
  coreRubric:'',
  jobRubric:'',
  run:'',
  candidateAssessment:'',
  consultantAssessment:'',
}
const required=<T,>(value:T|null|undefined,label:string):T=>{if(value===null||value===undefined)throw new Error(`${label} is required`);return value}
const insert=async(table:string,row:Record<string,unknown>)=>{
  const result=await service.from(table).insert(row).select('id').single()
  if(result.error)throw new Error(`${table}: ${result.error.message}`)
  return required(result.data as {id:string}|null,table).id
}

beforeAll(async()=>{
  const signIns=await Promise.all([
    owner.auth.signInWithPassword({email:'owner@northstar.local',password:'LocalTest!123'}),
    consultant.auth.signInWithPassword({email:'consultant@northstar.local',password:'LocalTest!123'}),
    sourcer.auth.signInWithPassword({email:'sourcer@northstar.local',password:'LocalTest!123'}),
    readonly.auth.signInWithPassword({email:'readonly@northstar.local',password:'LocalTest!123'}),
    rival.auth.signInWithPassword({email:'owner@rival.local',password:'LocalTest!123'}),
  ])
  signIns.forEach((result)=>{if(result.error)throw result.error})

  // The feature ships disabled. Every test below the first one needs it on, and turning it on is
  // itself part of what is being asserted.
  const enabled=await service.from('organization_settings').update({interview_intelligence_enabled:true}).eq('organization_id',ORG)
  if(enabled.error)throw enabled.error

  const consultantUser='10000000-0000-0000-0000-000000000003'
  ids.interview=await insert('interviews',{
    organization_id:ORG,job_candidate_id:JOB_CANDIDATE,starts_at:'2026-09-10T09:00:00Z',ends_at:'2026-09-10T10:00:00Z',
    timezone:'UTC',status:'completed',organizer_member_id:CONSULTANT_MEMBER,created_by:consultantUser,
  })
  ids.coreRubric=await insert('interview_rubrics',{
    organization_id:ORG,rubric_type:'core',name:'Agency core',status:'active',
    created_by:consultantUser,activated_by:consultantUser,activated_at:new Date().toISOString(),
  })
  ids.jobRubric=await insert('interview_rubrics',{
    organization_id:ORG,rubric_type:'job',job_id:JOB,name:'Job blueprint',status:'active',
    created_by:consultantUser,activated_by:consultantUser,activated_at:new Date().toISOString(),
  })
  ids.transcript=await insert('interview_transcripts',{
    organization_id:ORG,interview_id:ids.interview,source:'manual_text',status:'ready',
    checksum:'rls-fixture-checksum',has_timestamps:true,entry_count:1,completeness:'complete',
    created_by:consultantUser,purge_due_at:'2026-12-01T00:00:00Z',
  })
  ids.speakerConsultant=await insert('interview_transcript_speakers',{
    organization_id:ORG,transcript_id:ids.transcript,source_speaker_id:'S1',display_name:'Consultant',
    speaker_role:'consultant',member_id:CONSULTANT_MEMBER,
  })
  ids.speakerCandidate=await insert('interview_transcript_speakers',{
    organization_id:ORG,transcript_id:ids.transcript,source_speaker_id:'S2',display_name:'Candidate',
    speaker_role:'candidate',candidate_id:CANDIDATE,
  })
  ids.entry=await insert('interview_transcript_entries',{
    organization_id:ORG,transcript_id:ids.transcript,speaker_id:ids.speakerCandidate,
    sequence_number:1,start_ms:0,end_ms:4000,text:'I led the commercial team for three years.',
  })
  ids.run=await insert('interview_analysis_runs',{
    organization_id:ORG,interview_id:ids.interview,job_candidate_id:JOB_CANDIDATE,
    core_rubric_id:ids.coreRubric,job_rubric_id:ids.jobRubric,
    provider:'anthropic',model:'test-model',prompt_version:'interview-analysis-v1',
    transcript_bundle_hash:'tb',rubric_bundle_hash:'rb',job_input_hash:'jb',candidate_input_hash:'cb',
    input_hash:'rls-fixture-input-hash',status:'completed',
  })
  /* The run records the exact transcript bundle it read. This table has a composite primary key and
   * no `id`, so it cannot go through the insert helper. */
  const runTranscript=await service.from('interview_analysis_run_transcripts').insert({
    organization_id:ORG,analysis_run_id:ids.run,transcript_id:ids.transcript,sort_order:0,
  })
  if(runTranscript.error)throw runTranscript.error

  ids.candidateAssessment=await insert('interview_assessments',{
    organization_id:ORG,analysis_run_id:ids.run,interview_id:ids.interview,
    assessment_type:'candidate_fit',subject_candidate_id:CANDIDATE,
    overall_band:'promising_but_incomplete',confidence:'medium',summary:'Commercial leadership evidenced; compensation not discussed.',
  })
  ids.consultantAssessment=await insert('interview_assessments',{
    organization_id:ORG,analysis_run_id:ids.run,interview_id:ids.interview,
    assessment_type:'consultant_quality',subject_member_id:CONSULTANT_MEMBER,
    overall_band:'needs_development',confidence:'medium',summary:'Compensation and notice period were never tested.',
  })
})

afterAll(async()=>{
  // Children cascade from the run, the transcript and the interview.
  if(ids.run)await service.from('interview_analysis_runs').delete().eq('id',ids.run)
  if(ids.transcript)await service.from('interview_transcripts').delete().eq('id',ids.transcript)
  if(ids.coreRubric)await service.from('interview_rubrics').delete().eq('id',ids.coreRubric)
  if(ids.jobRubric)await service.from('interview_rubrics').delete().eq('id',ids.jobRubric)
  if(ids.interview)await service.from('interviews').delete().eq('id',ids.interview)
  await service.from('organization_settings').update({interview_intelligence_enabled:false}).eq('organization_id',ORG)
})

describe('the feature is off until an owner turns it on',()=>{
  it('reports no operational capability while the workspace switch is off',async()=>{
    await service.from('organization_settings').update({interview_intelligence_enabled:false}).eq('organization_id',ORG)
    const capabilities=await consultant.rpc('get_my_workspace_capabilities',{p_organization_id:ORG})
    expect(capabilities.error).toBeNull()
    const row=required(capabilities.data?.[0],'capability row')
    expect(row.can_use_interview_intelligence).toBe(false)
    expect(row.can_view_own_interview_quality).toBe(false)
    // The permission is still held -- it is the switch, not the grant, that is off.
    expect((await consultant.rpc('has_permission',{p_organization_id:ORG,p_permission:'interview_intelligence.use'})).data).toBe(true)
    expect((await consultant.rpc('can_use_interview_intelligence',{p_organization_id:ORG})).data).toBe(false)
    await service.from('organization_settings').update({interview_intelligence_enabled:true}).eq('organization_id',ORG)
  })

  it('grants the operational capabilities once it is on, and never to read-only', async()=>{
    const consultantRow=required((await consultant.rpc('get_my_workspace_capabilities',{p_organization_id:ORG})).data?.[0],'consultant capabilities')
    expect(consultantRow.can_use_interview_intelligence).toBe(true)
    expect(consultantRow.can_view_own_interview_quality).toBe(true)
    // A consultant reviews nobody and configures nothing.
    expect(consultantRow.can_review_team_interview_quality).toBe(false)
    expect(consultantRow.can_configure_interview_intelligence).toBe(false)

    const readonlyRow=required((await readonly.rpc('get_my_workspace_capabilities',{p_organization_id:ORG})).data?.[0],'readonly capabilities')
    expect(readonlyRow.can_use_interview_intelligence).toBe(false)
    expect(readonlyRow.can_view_own_interview_quality).toBe(false)
    expect(readonlyRow.can_review_team_interview_quality).toBe(false)
    expect(readonlyRow.can_configure_interview_intelligence).toBe(false)
  })

  it('gives the owner review and configure authority',async()=>{
    const row=required((await owner.rpc('get_my_workspace_capabilities',{p_organization_id:ORG})).data?.[0],'owner capabilities')
    expect(row.can_review_team_interview_quality).toBe(true)
    expect(row.can_configure_interview_intelligence).toBe(true)
  })

  it('does not hand interview permissions to a custom role',async()=>{
    /* The sourcer holds a custom (is_system=false) role built from an explicit permission list. The
     * migration's backfill touches only the owner and consultant system bundles, so a workspace's own
     * roles gain nothing because a migration ran.
     *
     * Asserted against the sourcer rather than the seeded "manager" role deliberately: that fixture
     * is defined as "every permission except three", so it picks up new keys by construction and
     * would prove nothing about the backfill. */
    expect((await sourcer.rpc('has_permission',{p_organization_id:ORG,p_permission:'interview_intelligence.review_team'})).data).toBe(false)
    expect((await sourcer.rpc('has_permission',{p_organization_id:ORG,p_permission:'interview_intelligence.view_own'})).data).toBe(false)
    expect((await sourcer.rpc('has_permission',{p_organization_id:ORG,p_permission:'interview_intelligence.use'})).data).toBe(false)
    expect((await sourcer.rpc('has_permission',{p_organization_id:ORG,p_permission:'interview_intelligence.configure'})).data).toBe(false)
  })
})

describe('assessment visibility follows the subject, not candidate access',()=>{
  it('lets a consultant read the findings about their own interview',async()=>{
    const result=await consultant.from('interview_assessments').select('id,assessment_type,overall_band').eq('id',ids.consultantAssessment)
    expect(result.error).toBeNull()
    expect(result.data).toHaveLength(1)
  })

  it('hides a colleague interview-quality assessment from someone with full candidate access',async()=>{
    // The sourcer holds candidates.read and jobs.read through the seeded custom role, and can read
    // the candidate this interview is about -- which is exactly why this assertion exists.
    expect((await sourcer.rpc('has_permission',{p_organization_id:ORG,p_permission:'candidates.read'})).data).toBe(true)
    const candidateRow=await sourcer.from('candidates').select('id').eq('id',CANDIDATE)
    expect(candidateRow.data).toHaveLength(1)

    const result=await sourcer.from('interview_assessments').select('id').eq('id',ids.consultantAssessment)
    expect(result.error).toBeNull()
    expect(result.data).toEqual([])
  })

  it('lets a team reviewer read colleague interview quality',async()=>{
    const result=await owner.from('interview_assessments').select('id').eq('id',ids.consultantAssessment)
    expect(result.error).toBeNull()
    expect(result.data).toHaveLength(1)
  })

  it('keeps the candidate-fit assessment on candidate and job access',async()=>{
    const result=await consultant.from('interview_assessments').select('id,overall_band').eq('id',ids.candidateAssessment)
    expect(result.error).toBeNull()
    expect(result.data).toHaveLength(1)
    // Read-only holds candidates.read but not the feature, so it gets nothing.
    const denied=await readonly.from('interview_assessments').select('id').eq('id',ids.candidateAssessment)
    expect(denied.data).toEqual([])
  })

  it('refuses client writes to machine output',async()=>{
    const write=await owner.from('interview_assessments').insert({
      organization_id:ORG,analysis_run_id:ids.run,interview_id:ids.interview,
      assessment_type:'consultant_quality',subject_member_id:SOURCER_MEMBER,
      overall_band:'strong',confidence:'high',summary:'Injected by a client.',
    })
    // An INSERT with no matching policy fails the WITH CHECK and raises.
    expect(write.error?.code).toBe('42501')

    /* An UPDATE with no matching policy behaves differently, and the difference matters: the row is
     * simply not visible to the command, so it reports success having changed nothing rather than
     * raising 42501. Asserting on an error here would pass for the wrong reason the day someone adds
     * a permissive UPDATE policy, so the assertion is on the row itself. */
    const edit=await owner.from('interview_assessments').update({overall_band:'strong'}).eq('id',ids.consultantAssessment).select('id')
    expect(edit.error).toBeNull()
    expect(edit.data).toEqual([])
    // The row is unchanged: machine output is immutable, not merely conventionally so.
    const after=await owner.from('interview_assessments').select('overall_band').eq('id',ids.consultantAssessment).single()
    expect(after.data?.overall_band).toBe('needs_development')
  })
})

describe('transcript access is participation, not candidate access',()=>{
  it('returns nothing from a direct read of transcript entries, even for the owner',async()=>{
    // interview_transcript_entries carries no policy for any client role. The only supported read is
    // the bounded RPC below.
    const direct=await owner.from('interview_transcript_entries').select('id,text').eq('transcript_id',ids.transcript)
    expect(direct.error).toBeNull()
    expect(direct.data).toEqual([])
  })

  it('pages transcript text through the bounded RPC for a participant',async()=>{
    const page=await consultant.rpc('get_interview_transcript_page',{p_organization_id:ORG,p_transcript_id:ids.transcript,p_after_sequence:null,p_limit:50})
    expect(page.error).toBeNull()
    expect(page.data).toHaveLength(1)
    expect(page.data?.[0].speaker_role).toBe('candidate')
  })

  it('caps the page size no matter what the caller asks for',async()=>{
    const page=await consultant.rpc('get_interview_transcript_page',{p_organization_id:ORG,p_transcript_id:ids.transcript,p_after_sequence:null,p_limit:5000})
    expect(page.error).toBeNull()
    expect((page.data||[]).length).toBeLessThanOrEqual(100)
  })

  it('refuses a non-participant without team review standing',async()=>{
    const page=await sourcer.rpc('get_interview_transcript_page',{p_organization_id:ORG,p_transcript_id:ids.transcript,p_after_sequence:null,p_limit:50})
    expect(page.error).not.toBeNull()
    expect(page.error?.message).toContain('permission_denied')
  })
})

describe('cross-organization isolation',()=>{
  it('tells a foreign caller nothing, even holding the exact UUID',async()=>{
    const transcript=await rival.from('interview_transcripts').select('id').eq('id',ids.transcript)
    expect(transcript.data).toEqual([])
    const assessment=await rival.from('interview_assessments').select('id').eq('id',ids.candidateAssessment)
    expect(assessment.data).toEqual([])
    const rubric=await rival.from('interview_rubrics').select('id').eq('id',ids.coreRubric)
    expect(rubric.data).toEqual([])
  })

  it('does not distinguish a foreign transcript from a missing one', async()=>{
    // Passing the rival's own organization id with our transcript must not leak existence either.
    const page=await rival.rpc('get_interview_transcript_page',{p_organization_id:RIVAL_ORG,p_transcript_id:ids.transcript,p_after_sequence:null,p_limit:50})
    expect(page.error).not.toBeNull()
    expect(page.error?.message).toContain('transcript_not_found')
  })

  it('refuses to map a transcript speaker onto a foreign member',async()=>{
    const foreign=await service.from('interview_transcript_speakers').insert({
      organization_id:ORG,transcript_id:ids.transcript,source_speaker_id:'S9',
      speaker_role:'consultant',member_id:'40000000-0000-0000-0000-000000000008',
    })
    // 40000000-...-0008 is a real organization_members row, so a single-column foreign key would
    // happily resolve it. The composite (member_id, organization_id) key is what makes a Northstar
    // transcript naming a Rival consultant unrepresentable. Asserted with the service role, because
    // this is a schema guarantee rather than an RLS one -- RLS governs which rows you can see, not
    // which ids you may store.
    if(!foreign.error){
      await service.from('interview_transcript_speakers').delete().eq('transcript_id',ids.transcript).eq('source_speaker_id','S9')
      throw new Error('a cross-organization speaker mapping was accepted')
    }
    expect(foreign.error?.code).toBe('23503')
  })
})

describe('consent is append-only',()=>{
  it('records a consent event and refuses to rewrite it',async()=>{
    const consultantUser=required((await consultant.auth.getUser()).data.user,'consultant user')
    const granted=await consultant.from('interview_transcription_consents').insert({
      organization_id:ORG,interview_id:ids.interview,candidate_id:CANDIDATE,
      status:'granted',consent_method:'spoken',notice_method:'spoken',notice_version:'v1',
      recorded_by:consultantUser.id,
    }).select('id').single()
    expect(granted.error).toBeNull()

    /* There is no UPDATE or DELETE policy on the consent table, so neither command can see the row.
     * Both report success having touched nothing -- the history is append-only because the database
     * offers no way to rewrite it, not because the application declines to. */
    const rewrite=await consultant.from('interview_transcription_consents').update({status:'withdrawn'}).eq('id',granted.data?.id).select('id')
    expect(rewrite.error).toBeNull()
    expect(rewrite.data).toEqual([])
    const erase=await consultant.from('interview_transcription_consents').delete().eq('id',granted.data?.id).select('id')
    expect(erase.error).toBeNull()
    expect(erase.data).toEqual([])

    // The original event survived both attempts.
    expect((await consultant.rpc('interview_consent_status',{p_interview_id:ids.interview})).data).toBe('granted')

    // Withdrawal is a new event, and the latest event is what counts.
    const withdrawn=await consultant.from('interview_transcription_consents').insert({
      organization_id:ORG,interview_id:ids.interview,candidate_id:CANDIDATE,
      status:'withdrawn',consent_method:'written',recorded_by:consultantUser.id,
    }).select('id').single()
    expect(withdrawn.error).toBeNull()
    expect((await consultant.rpc('interview_consent_status',{p_interview_id:ids.interview})).data).toBe('withdrawn')

    await service.from('interview_transcription_consents').delete().eq('interview_id',ids.interview)
  })
})

describe('an activated rubric is frozen',()=>{
  it('refuses to edit the yardstick a historical run cites',async()=>{
    const rewrite=await service.from('interview_rubrics').update({version:2}).eq('id',ids.coreRubric)
    expect(rewrite.error).not.toBeNull()
    expect(rewrite.error?.message).toContain('interview_rubric_immutable_after_activation')
  })

  it('refuses to add items to an active rubric',async()=>{
    const added=await service.from('interview_rubric_items').insert({
      organization_id:ORG,rubric_id:ids.coreRubric,dimension:'essential_coverage',item_type:'essential_question',
      label:'Added after activation',
    })
    expect(added.error).not.toBeNull()
    expect(added.error?.message).toContain('interview_rubric_items_frozen_after_activation')
  })

  it('allows only one active core rubric per organization',async()=>{
    const second=await service.from('interview_rubrics').insert({
      organization_id:ORG,rubric_type:'core',name:'Competing core',status:'active',
      created_by:'10000000-0000-0000-0000-000000000001',activated_by:'10000000-0000-0000-0000-000000000001',
      activated_at:new Date().toISOString(),
    })
    expect(second.error?.code).toBe('23505')
  })
})

describe('one interview can carry several transcripts',()=>{
  it('drops a superseded artifact from the current bundle without deleting it',async()=>{
    // A corrected import supersedes its predecessor rather than mutating it, so a historical run can
    // still say what it actually read.
    const correction=await insert('interview_transcripts',{
      organization_id:ORG,interview_id:ids.interview,source:'manual_text',status:'ready',
      checksum:'rls-fixture-correction',has_timestamps:true,entry_count:1,completeness:'complete',
      purge_due_at:'2026-12-01T00:00:00Z',
    })
    try{
      const supersede=await service.from('interview_transcripts')
        .update({superseded_by_transcript_id:correction,superseded_at:new Date().toISOString()})
        .eq('id',ids.transcript)
      expect(supersede.error).toBeNull()

      const bundle=await service.rpc('current_interview_transcripts',{p_interview_id:ids.interview})
      expect(bundle.error).toBeNull()
      const bundleIds=(bundle.data as {id:string}[]|null||[]).map((row)=>row.id)
      expect(bundleIds).toEqual([correction])

      // The superseded artifact is still stored and still readable -- superseding is not deletion.
      const original=await service.from('interview_transcripts').select('id,superseded_by_transcript_id').eq('id',ids.transcript).single()
      expect(original.data?.superseded_by_transcript_id).toBe(correction)

      // And the completed run still points at the exact transcript it read.
      const link=await service.from('interview_analysis_run_transcripts').select('transcript_id').eq('analysis_run_id',ids.run)
      expect((link.data||[]).map((row)=>row.transcript_id)).toEqual([ids.transcript])
    }finally{
      await service.from('interview_transcripts').update({superseded_by_transcript_id:null,superseded_at:null}).eq('id',ids.transcript)
      await service.from('interview_transcripts').delete().eq('id',correction)
    }
  })

  it('refuses a transcript that supersedes itself',async()=>{
    // A self-referencing supersede would make the current-bundle query skip an artifact that nothing
    // actually replaced, so the interview would silently lose its only transcript. The cross-workspace
    // case is covered by the composite foreign key, as asserted for speaker mapping above.
    const loop=await service.from('interview_transcripts').update({
      superseded_by_transcript_id:ids.transcript,superseded_at:new Date().toISOString(),
    }).eq('id',ids.transcript).select('id')
    expect(loop.error).not.toBeNull()
  })
})

describe('evidence resolves to real records',()=>{
  it('stores multi-source evidence and cascades it with the finding',async()=>{
    const finding=await insert('interview_assessment_findings',{
      organization_id:ORG,assessment_id:ids.candidateAssessment,category:'requirement',
      result:'met',confidence:'high',title:'Commercial leadership',
      summary:'Led a commercial team for three years.',
    })
    // Three source types against one finding: the transcript segment, an ATS field by locator, and
    // the job brief. This is the shape the plan calls multi-source evidence.
    const evidence=await service.from('interview_finding_evidence').insert([
      {organization_id:ORG,finding_id:finding,source_type:'transcript_entry',source_record_id:ids.entry,excerpt:'I led the commercial team.'},
      {organization_id:ORG,finding_id:finding,source_type:'candidate_field',source_record_id:CANDIDATE,source_locator:'availability'},
      {organization_id:ORG,finding_id:finding,source_type:'job_brief',source_record_id:JOB},
    ]).select('id')
    expect(evidence.error).toBeNull()
    expect(evidence.data).toHaveLength(3)

    // job_brief is the only source type allowed to omit a record id.
    const unanchored=await service.from('interview_finding_evidence').insert({
      organization_id:ORG,finding_id:finding,source_type:'transcript_entry',source_record_id:null,
    })
    expect(unanchored.error).not.toBeNull()

    // Deleting the finding takes its evidence with it -- evidence never outlives what it supports.
    await service.from('interview_assessment_findings').delete().eq('id',finding)
    const orphaned=await service.from('interview_finding_evidence').select('id').eq('finding_id',finding)
    expect(orphaned.data).toEqual([])
  })

  it('does not accept a finding whose assessment belongs to another workspace',async()=>{
    const foreign=await service.from('interview_assessment_findings').insert({
      organization_id:RIVAL_ORG,assessment_id:ids.candidateAssessment,category:'requirement',
      result:'met',confidence:'high',title:'Cross-tenant finding',summary:'Should not be storable.',
    })
    expect(foreign.error?.code).toBe('23503')
  })
})

describe('suspension removes access immediately',()=>{
  it('drops a suspended consultant to nothing without touching their role',async()=>{
    const suspend=await service.from('organization_members').update({status:'suspended'}).eq('id',CONSULTANT_MEMBER)
    expect(suspend.error).toBeNull()
    try{
      const row=required((await consultant.rpc('get_my_workspace_capabilities',{p_organization_id:ORG})).data?.[0],'suspended capabilities')
      expect(row.can_use_interview_intelligence).toBe(false)
      expect(row.can_view_own_interview_quality).toBe(false)

      const assessment=await consultant.from('interview_assessments').select('id').eq('id',ids.consultantAssessment)
      expect(assessment.data).toEqual([])

      const page=await consultant.rpc('get_interview_transcript_page',{p_organization_id:ORG,p_transcript_id:ids.transcript,p_after_sequence:null,p_limit:50})
      expect(page.error).not.toBeNull()
    }finally{
      await service.from('organization_members').update({status:'active'}).eq('id',CONSULTANT_MEMBER)
    }
  })
})
