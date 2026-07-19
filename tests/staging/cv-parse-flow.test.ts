// End-to-end contract test for the CV parsing pipeline against a REAL Supabase project
// (staging) and the REAL Anthropic API. This exists because every failure mode it covers
// shipped to production on 2026-07-16: structured-output schema rejections (unsupported
// keywords, union-type limit, optional-parameter limit) and an ambiguous-column bug in
// accept_candidate_cv_parse. OPTIONS-preflight smoke tests catch none of those.
//
// Required environment: STAGING_SUPABASE_URL, STAGING_SUPABASE_ANON_KEY,
// STAGING_SUPABASE_SERVICE_ROLE_KEY. The staging project must have the function secrets
// AI_PROVIDER/AI_MODEL/ANTHROPIC_API_KEY configured, mirroring production.
import {createClient} from '@supabase/supabase-js'
import {afterAll,beforeAll,expect,it} from 'vitest'
import {candidateCvExtractionSchema} from '../../src/features/candidates/cvParsing'
import {announceProviderOutage,providerBillingExhausted} from './providerOutage'

const url=process.env.STAGING_SUPABASE_URL
const anonKey=process.env.STAGING_SUPABASE_ANON_KEY
const serviceKey=process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY
if(!url||!anonKey||!serviceKey)throw new Error('STAGING_SUPABASE_URL, STAGING_SUPABASE_ANON_KEY, and STAGING_SUPABASE_SERVICE_ROLE_KEY are required; the staging gate must not silently skip.')

const runId=`${Date.now().toString(36)}-${crypto.randomUUID().slice(0,8)}`
const testEmail=`ci-cv-parse-${runId}@integration.test`
const admin=createClient(url,serviceKey,{auth:{persistSession:false}})
const user=createClient(url,anonKey,{auth:{persistSession:false}})

let userId=''
let organizationId=''
let parseId=''
let storagePath=''
let candidateId=''
let jobId=''
const generatedStoragePaths:string[]=[]
const sourceStoragePaths:string[]=[]
const required=<T,>(value:T|null|undefined,what:string):T=>{if(value===null||value===undefined)throw new Error(`${what} is required`);return value}

// A billing-exhausted provider skips these contracts loudly instead of blocking every unrelated
// deploy; see providerOutage.ts for why the match is on wording and not on the error code.
let providerOutage=false
const noteOutage=(what:string,message:string|null|undefined):void=>{providerOutage=true;announceProviderOutage(what,message)}

// A minimal single-page PDF with a synthetic CV, built by hand so the test has no
// binary fixture to maintain. Content mirrors what the parser must extract.
function buildTestCvPdf(language:'en'|'id'='en'):Uint8Array{
  const lines=language==='id'?[
    'Siti Rahmawati','Manajer Rekayasa Perangkat Lunak','Bandung, Indonesia',
    `Email: ci-cv-bahasa-${runId}@integration.test`,'Telepon: +62 811 2345 6789','',
    'PENGALAMAN KERJA','Manajer Rekayasa, PT Produk Nusantara (Feb 2020 - Sekarang)',
    'Memimpin tim pengembang dan meningkatkan kualitas pengiriman produk.','',
    'PENDIDIKAN','Sarjana Teknik Informatika, Universitas Indonesia (2013 - 2017)','',
    'KEAHLIAN','TypeScript, Node.js, PostgreSQL, Kepemimpinan Tim','',
    'BAHASA','Bahasa Indonesia (Asli), Bahasa Inggris (Profesional)',
  ]:[
    'Budi Santoso','Senior Software Engineer','Jakarta, Indonesia',
    'Email: ci-cv-parse-candidate@integration.test','Phone: +62 812 3456 7890','',
    'EXPERIENCE',
    'Senior Software Engineer, PT Teknologi Maju (Jan 2021 - Present)',
    'Led backend development for a fintech platform.','',
    'Software Engineer, PT Solusi Digital (Jun 2018 - Dec 2020)',
    'Built internal tooling and APIs.','',
    'EDUCATION',
    'Bachelor of Computer Science, Institut Teknologi Bandung (2014 - 2018)','',
    'SKILLS','JavaScript, TypeScript, Node.js, PostgreSQL','',
    'LANGUAGES','Indonesian (Native), English (Professional)',
  ]
  const escape=(value:string)=>value.replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)')
  const content=`BT /F1 11 Tf 50 750 Td 14 TL\n${lines.map((line)=>`(${escape(line)}) Tj T*`).join('\n')}\nET`
  const encoder=new TextEncoder()
  const objects=[
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 612 792] /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${encoder.encode(content).length} >>\nstream\n${content}\nendstream`,
  ]
  let pdf='%PDF-1.4\n'
  const offsets:number[]=[0]
  objects.forEach((object,index)=>{
    offsets.push(encoder.encode(pdf).length)
    pdf+=`${index+1} 0 obj\n${object}\nendobj\n`
  })
  const xrefStart=encoder.encode(pdf).length
  pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`
  for(let index=1;index<=objects.length;index++)pdf+=`${String(offsets[index]).padStart(10,'0')} 00000 n \n`
  pdf+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`
  return encoder.encode(pdf)
}

beforeAll(async()=>{
  const created=await admin.auth.admin.createUser({email:testEmail,email_confirm:true})
  if(created.error&&!/already/i.test(created.error.message))throw created.error
  const link=await admin.auth.admin.generateLink({type:'magiclink',email:testEmail})
  if(link.error||!link.data.properties.hashed_token)throw link.error||new Error('Could not generate a staging test session link.')
  const session=await user.auth.verifyOtp({type:'magiclink',token_hash:link.data.properties.hashed_token})
  if(session.error||!session.data.user)throw session.error||new Error('Could not sign in the staging test user.')
  userId=session.data.user.id
  const provisioned=await admin.rpc('provision_initial_organization_owner',{p_owner_email:testEmail,p_name:`CI Integration ${runId}`,p_slug:`ci-${runId}`,p_currency:'IDR',p_timezone:'Asia/Makassar'})
  if(provisioned.error)throw provisioned.error
  organizationId=provisioned.data as string
  const enabled=await admin.rpc('configure_founding_partner',{p_organization_id:organizationId,p_enabled:true})
  if(enabled.error)throw enabled.error
})

afterAll(async()=>{
  if(generatedStoragePaths.length)await admin.storage.from('candidate-documents').remove(generatedStoragePaths)
  if(sourceStoragePaths.length)await admin.storage.from('candidate-documents').remove(sourceStoragePaths)
  if(organizationId)await admin.from('organizations').delete().eq('id',organizationId)
  if(userId)await admin.auth.admin.deleteUser(userId)
})

it('parses a real CV through the deployed edge function and accepts it into a candidate',async(ctx)=>{
  parseId=crypto.randomUUID()
  storagePath=`${organizationId}/cv-drafts/${userId}/${parseId}/ci-test-cv.pdf`
  sourceStoragePaths.push(storagePath)
  const upload=await user.storage.from('candidate-documents').upload(storagePath,buildTestCvPdf(),{contentType:'application/pdf',upsert:false})
  expect(upload.error,`CV upload failed: ${upload.error?.message}`).toBeNull()

  const start=await user.functions.invoke('parse-candidate-cv',{body:{action:'start',organizationId,parseId,storagePath,originalFilename:'ci-test-cv.pdf',mimeType:'application/pdf'}})
  expect(start.error,`start failed: ${JSON.stringify(start.error)} ${JSON.stringify(start.data)}`).toBeNull()

  // Poll until the background parse (which calls the real Anthropic API with the real
  // production schema) settles. A 'failed' status carries the raw provider error in
  // errorMessage, so schema regressions fail this assertion with the exact cause.
  interface StatusPayload{status:string;extraction:unknown;errorCode:string|null;errorMessage:string|null}
  let payload:StatusPayload|null=null
  const deadline=Date.now()+180_000
  while(Date.now()<deadline){
    await new Promise((resolve)=>setTimeout(resolve,4_000))
    const status=await user.functions.invoke('parse-candidate-cv',{body:{action:'status',organizationId,parseId}})
    expect(status.error,`status failed: ${JSON.stringify(status.error)}`).toBeNull()
    payload=status.data as StatusPayload
    if(!['uploaded','processing'].includes(payload.status))break
  }
  if(!payload)throw new Error('The parse status was never readable.')
  if(payload.status==='failed'&&providerBillingExhausted(payload.errorMessage)){noteOutage('The CV parse contract',payload.errorMessage);ctx.skip()}
  expect(payload.status,`parse ended ${payload.status}: ${payload.errorCode} — ${payload.errorMessage}`).toBe('ready')

  // The client zod schema must accept exactly what the edge schema makes Anthropic emit;
  // this is the contract that broke when nullable fields became omitted fields.
  const extraction=candidateCvExtractionSchema.parse(payload.extraction)
  expect(extraction.full_name.length).toBeGreaterThan(1)
  expect(extraction.employment.length).toBeGreaterThan(0)

  const accepted=await user.rpc('accept_candidate_cv_parse',{p_organization_id:organizationId,p_parse_id:parseId,p_payload:extraction})
  expect(accepted.error,`accept failed: ${accepted.error?.message}`).toBeNull()
  candidateId=accepted.data as string
  expect(candidateId).toMatch(/^[0-9a-f-]{36}$/)

  const candidate=await user.from('candidates').select('id,full_name,source').eq('id',candidateId).single()
  expect(candidate.error).toBeNull()
  expect(candidate.data?.full_name.length).toBeGreaterThan(1)
},240_000)

it('parses and accepts a real Bahasa Indonesia CV through the same provider contract',async(ctx)=>{
  const indonesianParseId=crypto.randomUUID();const indonesianPath=`${organizationId}/cv-drafts/${userId}/${indonesianParseId}/ci-test-cv-id.pdf`;sourceStoragePaths.push(indonesianPath)
  const upload=await user.storage.from('candidate-documents').upload(indonesianPath,buildTestCvPdf('id'),{contentType:'application/pdf',upsert:false});expect(upload.error,upload.error?.message).toBeNull()
  const start=await user.functions.invoke('parse-candidate-cv',{body:{action:'start',organizationId,parseId:indonesianParseId,storagePath:indonesianPath,originalFilename:'ci-test-cv-id.pdf',mimeType:'application/pdf'}});expect(start.error,JSON.stringify(start.data)).toBeNull()
  interface StatusPayload{status:string;extraction:unknown;errorCode:string|null;errorMessage:string|null}
  let payload:StatusPayload|null=null;const deadline=Date.now()+180_000
  while(Date.now()<deadline){await new Promise((resolve)=>setTimeout(resolve,4_000));const status=await user.functions.invoke('parse-candidate-cv',{body:{action:'status',organizationId,parseId:indonesianParseId}});expect(status.error,JSON.stringify(status.error)).toBeNull();payload=status.data as StatusPayload;if(!['uploaded','processing'].includes(payload.status))break}
  if(!payload)throw new Error('The Indonesian parse status was never readable.')
  if(payload.status==='failed'&&providerBillingExhausted(payload.errorMessage)){noteOutage('The Bahasa Indonesia parse contract',payload.errorMessage);ctx.skip()}
  expect(payload.status,`${payload.errorCode}: ${payload.errorMessage}`).toBe('ready')
  const extraction=candidateCvExtractionSchema.parse(payload.extraction);expect(extraction.full_name.toLowerCase()).toContain('siti');expect(extraction.employment.length).toBeGreaterThan(0)
  const accepted=await user.rpc('accept_candidate_cv_parse',{p_organization_id:organizationId,p_parse_id:indonesianParseId,p_payload:extraction});expect(accepted.error,accepted.error?.message).toBeNull()
},240_000)

it('generates persisted Indonesian evidence and finalizes only with both private formats',async(ctx)=>{
  // This builds on the candidate the parse test creates, so a billing skip upstream leaves nothing
  // to profile. Skip rather than fail on that one cause; a genuinely absent candidate still blocks.
  if(providerOutage)ctx.skip()
  expect(candidateId).not.toBe('')
  const company=await admin.from('companies').insert({organization_id:organizationId,name:'PT Klien Integrasi',industry:'Technology',created_by:userId}).select('id').single()
  expect(company.error,company.error?.message).toBeNull()
  const companyId=required(company.data,'staging company').id
  const job=await admin.from('jobs').insert({organization_id:organizationId,company_id:companyId,title:'Engineering Manager',description:'Lead a product engineering team and improve delivery quality.',requirements:'Five years of software engineering experience; team leadership; TypeScript; stakeholder communication.',created_by:userId}).select('id').single()
  expect(job.error,job.error?.message).toBeNull();jobId=required(job.data,'staging job').id
  const stage=await admin.from('pipeline_stages').select('id,pipelines!inner(is_default,kind)').eq('organization_id',organizationId).eq('pipelines.is_default',true).eq('pipelines.kind','template').order('position').limit(1).single()
  expect(stage.error,stage.error?.message).toBeNull()
  const linked=await admin.from('job_candidates').insert({organization_id:organizationId,job_id:jobId,candidate_id:candidateId,current_stage_id:required(stage.data,'staging pipeline stage').id,added_by:userId}).select('id').single()
  expect(linked.error,linked.error?.message).toBeNull()
  const assignmentId=required(linked.data,'staging candidate assignment').id
  const template=await user.from('templates').select('id,configuration').eq('organization_id',organizationId).eq('template_type','candidate_profile').eq('is_default',true).single()
  expect(template.error,template.error?.message).toBeNull()
  const templateData=required(template.data,'default profile template');const indonesian={...(templateData.configuration as Record<string,unknown>),output_language:'id'}
  const saved=await user.rpc('save_candidate_profile_template',{p_organization_id:organizationId,p_template_id:templateData.id,p_name:'Profil Klien Indonesia',p_configuration:indonesian,p_is_default:true})
  expect(saved.error,saved.error?.message).toBeNull()
  const generated=await user.functions.invoke('generate-candidate-profile',{body:{organizationId,candidateId,jobId,templateId:templateData.id,anonymize:true}})
  if(generated.error&&providerBillingExhausted(JSON.stringify(generated.data))){noteOutage('The profile generation contract',JSON.stringify(generated.data));ctx.skip()}
  expect(generated.error,JSON.stringify(generated.data)).toBeNull()
  const payload=generated.data as {profileVersionId:string;draft:{candidate_summary:string[];requirement_evidence:{classification:string;source:string}[];score:number};evaluation:{id:string;score:number};requestId:string}
  expect(payload.profileVersionId).toMatch(/^[0-9a-f-]{36}$/);expect(payload.draft.candidate_summary.length).toBeGreaterThan(0);expect(payload.draft.requirement_evidence.length).toBeGreaterThan(0);expect(payload.draft.score).toBeGreaterThanOrEqual(0);expect(payload.draft.score).toBeLessThanOrEqual(100)
  const persisted=await user.from('candidate_profile_versions').select('status,anonymized,ai_evaluations!inner(status,evidence,input_hash,duration_ms)').eq('id',payload.profileVersionId).single()
  expect(persisted.error,persisted.error?.message).toBeNull();expect(persisted.data?.status).toBe('draft');expect(persisted.data?.anonymized).toBe(true)

  // Dedup: an identical re-request must serve the stored draft (same version + evaluation) without a
  // second model call. No provider call means no new evaluation row and no new version row are created.
  const cachedGen=await user.functions.invoke('generate-candidate-profile',{body:{organizationId,candidateId,jobId,templateId:templateData.id,anonymize:true}})
  expect(cachedGen.error,JSON.stringify(cachedGen.data)).toBeNull()
  const cachedPayload=cachedGen.data as {profileVersionId:string;evaluation:{id:string}}
  expect(cachedPayload.profileVersionId).toBe(payload.profileVersionId);expect(cachedPayload.evaluation.id).toBe(payload.evaluation.id)
  const versionCount=await user.from('candidate_profile_versions').select('id',{count:'exact',head:true}).eq('organization_id',organizationId).eq('candidate_id',candidateId).eq('job_id',jobId)
  expect(versionCount.error,versionCount.error?.message).toBeNull();expect(versionCount.count).toBe(1)

  const uploadDocument=async(extension:'docx'|'pdf',mimeType:string)=>{const path=`${organizationId}/${candidateId}/profiles/${crypto.randomUUID()}-staging-profile.${extension}`;generatedStoragePaths.push(path);const bytes=extension==='pdf'?buildTestCvPdf():new TextEncoder().encode('synthetic docx contract fixture');const upload=await admin.storage.from('candidate-documents').upload(path,bytes,{contentType:mimeType});expect(upload.error,upload.error?.message).toBeNull();const document=await admin.from('documents').insert({organization_id:organizationId,file_name:`staging-profile.${extension}`,original_filename:`staging-profile.${extension}`,storage_path:path,mime_type:mimeType,size_bytes:bytes.byteLength,document_type:'candidate_profile',uploaded_by:userId}).select('id').single();expect(document.error,document.error?.message).toBeNull();const documentId=required(document.data,'staging profile document').id;const link=await admin.from('document_links').insert({organization_id:organizationId,document_id:documentId,candidate_id:candidateId});expect(link.error,link.error?.message).toBeNull();return documentId}
  const docxId=await uploadDocument('docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document');const pdfId=await uploadDocument('pdf','application/pdf')
  const partial=await user.rpc('finalize_candidate_profile',{p_organization_id:organizationId,p_profile_version_id:payload.profileVersionId,p_reviewed_content:payload.draft,p_anonymized:true,p_docx_document_id:docxId,p_pdf_document_id:docxId,p_edited_field_count:0});expect(partial.error).not.toBeNull()
  const stillDraft=await user.from('candidate_profile_versions').select('status').eq('id',payload.profileVersionId).single();expect(stillDraft.data?.status).toBe('draft')
  const finalized=await user.rpc('finalize_candidate_profile',{p_organization_id:organizationId,p_profile_version_id:payload.profileVersionId,p_reviewed_content:payload.draft,p_anonymized:true,p_docx_document_id:docxId,p_pdf_document_id:pdfId,p_edited_field_count:0})
  expect(finalized.error,finalized.error?.message).toBeNull()
  const immutable=await user.rpc('finalize_candidate_profile',{p_organization_id:organizationId,p_profile_version_id:payload.profileVersionId,p_reviewed_content:{...payload.draft,candidate_summary:['Tampered after finalization.']},p_anonymized:false,p_docx_document_id:pdfId,p_pdf_document_id:docxId,p_edited_field_count:1});expect(immutable.error).not.toBeNull()
  const finalRow=await user.from('candidate_profile_versions').select('status,reviewed_content,docx_document_id,pdf_document_id,finalization_ms,exported_formats').eq('id',payload.profileVersionId).single()
  expect(finalRow.error,finalRow.error?.message).toBeNull();expect(finalRow.data?.status).toBe('finalized');expect(finalRow.data?.exported_formats).toEqual(['docx','pdf'])
  const submission=await user.rpc('create_submission_package',{p_organization_id:organizationId,p_job_id:jobId,p_title:'Staging profile review',p_items:[{job_candidate_id:assignmentId,candidate_summary:'Synthetic staging candidate.',document_ids:[docxId,pdfId]}],p_recipient_email:'client@integration.test',p_expiry_days:1})
  expect(submission.error,submission.error?.message).toBeNull()
  const token=(submission.data as {token:string}).token;const selectedDocuments=await admin.rpc('resolve_submission_documents',{p_token:token});expect(selectedDocuments.error,selectedDocuments.error?.message).toBeNull();expect(selectedDocuments.data?.map((document)=>document.document_id).sort()).toEqual([docxId,pdfId].sort())
  const submitted=await user.from('candidate_profile_versions').select('submitted_at').eq('id',payload.profileVersionId).single();expect(submitted.error,submitted.error?.message).toBeNull();expect(submitted.data?.submitted_at).not.toBeNull()
},300_000)
