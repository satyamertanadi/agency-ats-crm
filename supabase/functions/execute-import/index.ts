import {FunctionError,requirePermission} from '../_shared/auth.ts'
import {corsHeaders,json,log,requestId} from '../_shared/http.ts'
import type {SupabaseClient} from 'https://esm.sh/@supabase/supabase-js@2'

type Row=Record<string,unknown>
interface RelatedChange{entityType:string;entityId:string}
interface InsertResult{entityId:string;relatedChanges?:RelatedChange[]}
interface Input{organizationId:string;action:'stage'|'commit'|'rollback';entityType?:string;fileName?:string;sourceFormat?:'csv'|'xlsx';rows?:Row[];importId?:string;rollbackReason?:string}
const allowed=['candidates','candidate_employment','candidate_education','candidate_languages','companies','contacts','jobs','job_candidates','submissions','tasks','activities','interviews','offers','placements','revenue_splits','invoices']
const textValue=(row:Row,key:string)=>String(row[key]??'').trim()
const lowerValue=(row:Row,key:string)=>textValue(row,key).toLowerCase()
const currencyValue=(row:Row,key:string)=>textValue(row,key).toUpperCase()||null
const numberValue=(row:Row,key:string)=>{const raw=textValue(row,key);if(!raw)return null;const value=Number(raw.replaceAll(',',''));return Number.isFinite(value)?value:null}
const dateValue=(row:Row,key:string)=>{const value=textValue(row,key);if(!value)return null;const date=new Date(value);return Number.isNaN(date.valueOf())?null:date.toISOString()}
const dateOnly=(row:Row,key:string)=>dateValue(row,key)?.slice(0,10)||null
const boolValue=(row:Row,key:string)=>['true','yes','1','y'].includes(lowerValue(row,key))
const listValue=(row:Row,key:string)=>textValue(row,key).split(';').map((value)=>value.trim()).filter(Boolean)

function validate(entityType:string,row:Row){
  const errors:string[]=[];const required=(key:string)=>{if(!textValue(row,key))errors.push(`${key} is required`)}
  required('legacy_id')
  if(entityType==='candidates')required('full_name')
  if(entityType==='candidate_employment'){required('candidate_legacy_id');required('company_name');required('title')}
  if(entityType==='candidate_education'){required('candidate_legacy_id');required('institution')}
  if(entityType==='candidate_languages'){required('candidate_legacy_id');required('language')}
  if(entityType==='companies')required('name')
  if(entityType==='contacts'){required('full_name');required('company_legacy_id')}
  if(entityType==='jobs'){required('title');required('company_legacy_id')}
  if(entityType==='job_candidates'){required('candidate_legacy_id');required('job_legacy_id')}
  if(entityType==='submissions'){required('job_legacy_id');required('job_candidate_legacy_ids');required('title');required('recipient_email')}
  if(entityType==='tasks')required('title')
  if(entityType==='activities')required('summary')
  if(entityType==='interviews'){required('job_candidate_legacy_id');required('starts_at');required('ends_at')}
  if(entityType==='offers'){required('job_candidate_legacy_id');required('salary');required('currency')}
  if(entityType==='placements'){required('job_candidate_legacy_id');required('start_date');required('salary');required('placement_fee');required('currency')}
  if(entityType==='revenue_splits'){required('placement_legacy_id');required('member_email');required('split_percentage')}
  if(entityType==='invoices'){required('placement_legacy_id');required('amount');required('currency')}
  return errors
}

Deno.serve(async(request)=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:corsHeaders(request)})
  const id=requestId(request);const started=Date.now();let activeImportId='';let adminClient:SupabaseClient|undefined
  try{
    const input=await request.json() as Input
    if(!input.organizationId||!input.action)throw new FunctionError(400,'invalid_request','Organization and action are required.')
    const {caller,admin,user}=await requirePermission(request,input.organizationId,'imports.manage');adminClient=admin
    if(input.action==='stage'){
      if(!input.entityType||!allowed.includes(input.entityType)||!input.fileName||!Array.isArray(input.rows))throw new FunctionError(400,'invalid_import','Entity type, file, and rows are required.')
      if(input.rows.length>25_000)throw new FunctionError(413,'import_too_large','Import files are limited to 25,000 rows per batch.')
      const entityType=input.entityType;const seen=new Set<string>();const staged=input.rows.map((row,index)=>{const errors=validate(entityType,row);const legacy=textValue(row,'legacy_id');if(legacy&&seen.has(legacy))errors.push('duplicate legacy_id in file');seen.add(legacy);return {row,index:index+2,errors}});const failed=staged.filter((item)=>item.errors.length).length
      const {data:created,error}=await admin.from('imports').insert({organization_id:input.organizationId,entity_type:entityType,file_name:input.fileName,source_filename:input.fileName,source_format:input.sourceFormat||'csv',mapping:{mode:'canonical_headers',headers:Object.keys(input.rows[0]||{})},status:failed?'staged':'ready',total_rows:input.rows.length,valid_rows:input.rows.length-failed,failed_rows:failed,created_by:user.id,validation_summary:{failedRows:failed,validRows:input.rows.length-failed,duplicateRows:staged.filter((item)=>item.errors.includes('duplicate legacy_id in file')).length}}).select('id').single()
      if(error||!created)throw error||new Error('Could not create import batch.')
      if(staged.length){const {error:rowsError}=await admin.from('import_rows').insert(staged.map((item)=>({import_id:created.id,organization_id:input.organizationId,row_number:item.index,source_data:item.row,mapped_data:item.row,errors:item.errors,status:item.errors.length?'invalid':'valid'})));if(rowsError)throw rowsError}
      log('info','import.staged',{requestId:id,organizationId:input.organizationId,importId:created.id,entityType,totalRows:input.rows.length,failedRows:failed,durationMs:Date.now()-started})
      return json(request,{importId:created.id,totalRows:input.rows.length,validRows:input.rows.length-failed,failedRows:failed,status:failed?'staged':'ready'},201)
    }
    if(!input.importId)throw new FunctionError(400,'import_required','Import batch is required.');activeImportId=input.importId
    const {data:batch,error:batchError}=await admin.from('imports').select('*').eq('id',input.importId).eq('organization_id',input.organizationId).single()
    if(batchError||!batch)throw new FunctionError(404,'import_not_found','Import batch not found.')
    if(input.action==='rollback'){
      if(!['completed','failed'].includes(batch.status))throw new FunctionError(409,'rollback_unavailable','Only completed or failed imports can be rolled back.')
      const {data:changes}=await admin.from('import_change_log').select('*').eq('import_id',batch.id).order('id',{ascending:false})
      for(const change of changes||[]){
        if(change.operation!=='insert')continue
        const entityType=String(change.entity_type)
        const operation=entityType==='jobs'
          ?admin.from('jobs').update({deleted_at:new Date().toISOString()}).eq('id',change.entity_id)
          :admin.from(actualTable(entityType)).delete().eq('id',change.entity_id)
        const {error}=await operation
        if(error)throw error
      }
      const {error:mappingDeleteError}=await admin.from('import_entity_mappings').delete().eq('import_id',batch.id)
      if(mappingDeleteError)throw mappingDeleteError
      await admin.from('imports').update({status:'rolled_back',rolled_back_at:new Date().toISOString(),rollback_reason:(input.rollbackReason||'Owner requested rollback').slice(0,500)}).eq('id',batch.id)
      await admin.from('audit_logs').insert({organization_id:input.organizationId,actor_user_id:user.id,action:'import.rolled_back',entity_type:'import',entity_id:batch.id,metadata:{reason:input.rollbackReason||null}})
      return json(request,{status:'rolled_back'})
    }
    if(batch.failed_rows>0||!['ready','approved'].includes(batch.status))throw new FunctionError(409,'import_not_ready','Resolve validation errors before committing.')
    const {data:rows,error:rowsError}=await admin.from('import_rows').select('row_number,mapped_data').eq('import_id',batch.id).eq('status','valid').order('row_number');if(rowsError)throw rowsError
    await admin.from('imports').update({status:'committing',approved_by:user.id,approved_at:new Date().toISOString()}).eq('id',batch.id)
    let committed=0;let duplicates=0
    for(const source of rows||[]){const row=(source.mapped_data||{}) as Row;const legacyId=textValue(row,'legacy_id');const existing=await existingMapping(admin,input.organizationId,batch.entity_type,legacyId);let entityId=existing;let relatedChanges:RelatedChange[]=[]
      if(existing)duplicates++
      else {const created=await insertEntity(admin,caller,input.organizationId,user.id,batch.entity_type,row);entityId=created.entityId;relatedChanges=created.relatedChanges||[]}
      if(entityId){
        if(!existing){
          const writes=await Promise.all([
            admin.from('import_entity_mappings').insert({organization_id:input.organizationId,import_id:batch.id,entity_type:batch.entity_type,legacy_id:legacyId,entity_id:entityId}),
            admin.from('import_change_log').insert({organization_id:input.organizationId,import_id:batch.id,entity_type:batch.entity_type,entity_id:entityId,operation:'insert'}),
            ...relatedChanges.map((change)=>admin.from('import_change_log').insert({organization_id:input.organizationId,import_id:batch.id,entity_type:change.entityType,entity_id:change.entityId,operation:'insert'})),
          ])
          for(const write of writes)if(write.error)throw write.error
        }
        const {error:rowUpdateError}=await admin.from('import_rows').update({status:'committed'}).eq('import_id',batch.id).eq('row_number',source.row_number)
        if(rowUpdateError)throw rowUpdateError
        committed++
      }
    }
    await admin.from('imports').update({status:'completed',completed_at:new Date().toISOString(),reconciliation_summary:{sourceRows:batch.total_rows,committedRows:committed,existingLegacyIds:duplicates,rejectedRows:batch.failed_rows,orphanReferences:0}}).eq('id',batch.id)
    await admin.from('audit_logs').insert({organization_id:input.organizationId,actor_user_id:user.id,action:'import.committed',entity_type:'import',entity_id:batch.id,metadata:{entityType:batch.entity_type,committedRows:committed,existingLegacyIds:duplicates}})
    log('info','import.committed',{requestId:id,organizationId:input.organizationId,importId:batch.id,entityType:batch.entity_type,committedRows:committed,durationMs:Date.now()-started})
    return json(request,{status:'completed',committedRows:committed})
  }catch(error){const known=error instanceof FunctionError;const message=known?error.message:(error instanceof Error?error.message:'Import failed.');if(adminClient&&activeImportId)await adminClient.from('imports').update({status:'failed',reconciliation_summary:{error:message}}).eq('id',activeImportId);log('error','import.failed',{requestId:id,importId:activeImportId||undefined,code:known?error.code:'unexpected_error',durationMs:Date.now()-started});return json(request,{error:{code:known?error.code:'unexpected_error',message,requestId:id}},known?error.status:500)}
})

async function insertEntity(admin:SupabaseClient,caller:SupabaseClient,organizationId:string,userId:string,entityType:string,row:Row):Promise<InsertResult>{
  if(entityType==='candidates'){
    const entity=await insert(admin,'candidates',{organization_id:organizationId,full_name:textValue(row,'full_name'),current_company:textValue(row,'current_company')||null,current_position:textValue(row,'current_position')||null,location:textValue(row,'location')||null,linkedin_url:textValue(row,'linkedin_url')||null,status:lowerValue(row,'status')||'active',source:textValue(row,'source')||'migration',availability:textValue(row,'availability')||null,notice_period_days:numberValue(row,'notice_period_days'),owner_member_id:await optionalMember(admin,organizationId,lowerValue(row,'owner_email')),created_by:userId})
    const detail=await admin.from('candidate_private_details').insert({candidate_id:entity,organization_id:organizationId,email:lowerValue(row,'email')||null,phone:textValue(row,'phone')||null,current_salary:numberValue(row,'current_salary'),expected_salary:numberValue(row,'expected_salary'),salary_currency:currencyValue(row,'salary_currency'),work_authorization:textValue(row,'work_authorization')||null,consent_status:lowerValue(row,'consent_status')||'unknown'})
    if(detail.error)throw detail.error
    return result(entity)
  }
  if(entityType==='candidate_employment')return result(await insert(admin,'candidate_employment',{organization_id:organizationId,candidate_id:await resolveLegacy(admin,organizationId,'candidates',textValue(row,'candidate_legacy_id')),company_name:textValue(row,'company_name'),title:textValue(row,'title'),location:textValue(row,'location')||null,started_on:dateOnly(row,'started_on'),ended_on:dateOnly(row,'ended_on'),is_current:boolValue(row,'is_current'),summary:textValue(row,'summary')||null}))
  if(entityType==='candidate_education')return result(await insert(admin,'candidate_education',{organization_id:organizationId,candidate_id:await resolveLegacy(admin,organizationId,'candidates',textValue(row,'candidate_legacy_id')),institution:textValue(row,'institution'),degree:textValue(row,'degree')||null,field_of_study:textValue(row,'field_of_study')||null,started_on:dateOnly(row,'started_on'),ended_on:dateOnly(row,'ended_on')}))
  if(entityType==='candidate_languages')return result(await insert(admin,'candidate_languages',{organization_id:organizationId,candidate_id:await resolveLegacy(admin,organizationId,'candidates',textValue(row,'candidate_legacy_id')),language:textValue(row,'language'),proficiency:textValue(row,'proficiency')||null}))
  if(entityType==='companies')return result(await insert(admin,'companies',{organization_id:organizationId,name:textValue(row,'name'),industry:textValue(row,'industry')||null,website:textValue(row,'website')||null,location:textValue(row,'location')||null,company_size:textValue(row,'company_size')||null,account_status:lowerValue(row,'account_status')||'prospect',business_development_stage:lowerValue(row,'business_development_stage')||'lead',notes_summary:textValue(row,'notes_summary')||null,owner_member_id:await optionalMember(admin,organizationId,lowerValue(row,'owner_email')),created_by:userId}))
  if(entityType==='contacts')return result(await insert(admin,'contacts',{organization_id:organizationId,company_id:await resolveLegacy(admin,organizationId,'companies',textValue(row,'company_legacy_id')),full_name:textValue(row,'full_name'),position:textValue(row,'position')||null,email:lowerValue(row,'email')||null,phone:textValue(row,'phone')||null,linkedin_url:textValue(row,'linkedin_url')||null,contact_status:lowerValue(row,'contact_status')||'active',decision_authority:textValue(row,'decision_authority')||null,next_follow_up_at:dateValue(row,'next_follow_up_at'),relationship_owner_id:await optionalMember(admin,organizationId,lowerValue(row,'owner_email')),created_by:userId}))
  if(entityType==='jobs'){
    const companyId=await resolveLegacy(admin,organizationId,'companies',textValue(row,'company_legacy_id'))
    const ownerMemberId=await optionalMember(admin,organizationId,lowerValue(row,'owner_email'))
    const {data,error}=await caller.rpc('create_job_with_pipeline',{p_organization_id:organizationId,p_company_id:companyId,p_title:textValue(row,'title'),p_owner_member_id:ownerMemberId})
    if(error)throw error
    const entity=String(data)
    const update=await admin.from('jobs').update({location:textValue(row,'location')||null,employment_type:textValue(row,'employment_type')||null,salary_min:numberValue(row,'salary_min'),salary_max:numberValue(row,'salary_max'),description:textValue(row,'description')||null,requirements:textValue(row,'requirements')||null,priority:lowerValue(row,'priority')||'normal',status:lowerValue(row,'status')||'open',currency:currencyValue(row,'currency'),placement_fee_percentage:numberValue(row,'placement_fee_percentage'),fixed_fee:numberValue(row,'fixed_fee'),target_close_date:dateOnly(row,'target_close_date'),internal_notes:textValue(row,'internal_notes')||null,client_visible_notes:textValue(row,'client_visible_notes')||null}).eq('id',entity)
    if(update.error)throw update.error
    const contactLegacyId=textValue(row,'primary_contact_legacy_id')
    if(contactLegacyId){
      const contactId=await resolveLegacy(admin,organizationId,'contacts',contactLegacyId)
      const {data:contact,error:contactError}=await admin.from('contacts').select('company_id').eq('id',contactId).single()
      if(contactError||contact?.company_id!==companyId)throw new FunctionError(409,'contact_company_mismatch','Primary contact must belong to the imported job company.')
      const {error:linkError}=await admin.from('job_contacts').insert({organization_id:organizationId,job_id:entity,contact_id:contactId,is_primary:true})
      if(linkError)throw linkError
    }
    for(const email of listValue(row,'team_member_emails')){
      const memberId=await requiredMember(admin,organizationId,email.toLowerCase())
      const {error:teamError}=await admin.from('job_team_members').insert({organization_id:organizationId,job_id:entity,member_id:memberId,team_role:'consultant'})
      if(teamError)throw teamError
    }
    return result(entity)
  }
  if(entityType==='job_candidates'){
    const jobId=await resolveLegacy(admin,organizationId,'jobs',textValue(row,'job_legacy_id'))
    const candidateId=await resolveLegacy(admin,organizationId,'candidates',textValue(row,'candidate_legacy_id'))
    const {data:job,error:jobError}=await admin.from('jobs').select('pipeline_id').eq('id',jobId).single()
    if(jobError||!job?.pipeline_id)throw new FunctionError(409,'pipeline_not_found','Imported job has no pipeline.')
    let stageQuery=admin.from('pipeline_stages').select('id').eq('pipeline_id',job.pipeline_id)
    const stage=textValue(row,'stage')
    if(stage)stageQuery=stageQuery.ilike('name',stage);else stageQuery=stageQuery.order('position').limit(1)
    const {data:stageRow,error:stageError}=await stageQuery.limit(1).single()
    if(stageError)throw new FunctionError(409,'pipeline_stage_not_found',`Pipeline stage not found: ${stage||'first stage'}`)
    const entity=await insert(admin,'job_candidates',{organization_id:organizationId,job_id:jobId,candidate_id:candidateId,current_stage_id:stageRow.id,owner_member_id:await optionalMember(admin,organizationId,lowerValue(row,'owner_email')),source:textValue(row,'source')||'migration',added_by:userId})
    const {error:historyError}=await admin.from('stage_history').insert({organization_id:organizationId,job_candidate_id:entity,from_stage_id:null,to_stage_id:stageRow.id,changed_by:userId,source:'import',note:'Initial stage from controlled import',occurred_at:dateValue(row,'stage_occurred_at')||new Date().toISOString()})
    if(historyError)throw historyError
    return result(entity)
  }
  if(entityType==='submissions'){
    const jobId=await resolveLegacy(admin,organizationId,'jobs',textValue(row,'job_legacy_id'))
    const contactId=textValue(row,'contact_legacy_id')?await resolveLegacy(admin,organizationId,'contacts',textValue(row,'contact_legacy_id')):null
    const items=[]
    for(const legacyId of listValue(row,'job_candidate_legacy_ids'))items.push({job_candidate_id:await resolveLegacy(admin,organizationId,'job_candidates',legacyId),candidate_summary:'Experienced candidate selected for this fictional demo shortlist.',recruiter_comments:'Demo record — no external outreach was performed.'})
    const {data,error}=await caller.rpc('create_submission_package',{p_organization_id:organizationId,p_job_id:jobId,p_contact_id:contactId,p_title:textValue(row,'title'),p_message:textValue(row,'message')||null,p_items:items,p_recipient_name:textValue(row,'recipient_name')||null,p_recipient_email:lowerValue(row,'recipient_email'),p_expiry_days:numberValue(row,'expiry_days')||30})
    if(error)throw error
    const response=data as {package_id?:string;activity_id?:string}|null
    if(!response?.package_id)throw new Error('Submission import did not return a package ID.')
    return result(response.package_id,response.activity_id?[{entityType:'activities',entityId:response.activity_id}]:[])
  }
  if(entityType==='tasks'){const entity=await insert(admin,'tasks',{organization_id:organizationId,title:textValue(row,'title'),description:textValue(row,'description')||null,priority:lowerValue(row,'priority')||'normal',status:lowerValue(row,'status')||'open',due_at:dateValue(row,'due_at'),owner_member_id:await optionalMember(admin,organizationId,lowerValue(row,'owner_email')),created_by:userId});await insertOptionalLink(admin,'task_links','task_id',entity,organizationId,row);return result(entity)}
  if(entityType==='activities'){const entity=await insert(admin,'activities',{organization_id:organizationId,activity_type:lowerValue(row,'activity_type')||'other',direction:lowerValue(row,'direction')||'internal',subject:textValue(row,'subject')||null,summary:textValue(row,'summary'),occurred_at:dateValue(row,'occurred_at')||new Date().toISOString(),owner_member_id:await optionalMember(admin,organizationId,lowerValue(row,'owner_email')),created_by:userId});await insertOptionalLink(admin,'activity_links','activity_id',entity,organizationId,row);return result(entity)}
  if(entityType==='interviews')return result(await insert(admin,'interviews',{organization_id:organizationId,job_candidate_id:await resolveLegacy(admin,organizationId,'job_candidates',textValue(row,'job_candidate_legacy_id')),interview_type:textValue(row,'interview_type')||'client_interview',starts_at:dateValue(row,'starts_at'),ends_at:dateValue(row,'ends_at'),timezone:textValue(row,'timezone')||'UTC',location:textValue(row,'location')||null,meeting_url:textValue(row,'meeting_url')||null,status:lowerValue(row,'status')||'scheduled',calendar_sync_status:'not_requested',created_by:userId}))
  if(entityType==='offers')return result(await insert(admin,'offers',{organization_id:organizationId,job_candidate_id:await resolveLegacy(admin,organizationId,'job_candidates',textValue(row,'job_candidate_legacy_id')),salary:numberValue(row,'salary'),currency:currencyValue(row,'currency'),offered_at:dateOnly(row,'offered_at')||new Date().toISOString().slice(0,10),start_date:dateOnly(row,'start_date'),status:lowerValue(row,'status')||'presented',notes:textValue(row,'notes')||null,created_by:userId}))
  if(entityType==='placements'){const jobCandidateId=await resolveLegacy(admin,organizationId,'job_candidates',textValue(row,'job_candidate_legacy_id'));const {data:jc,error}=await admin.from('job_candidates').select('candidate_id,job_id,jobs(company_id)').eq('id',jobCandidateId).single();if(error||!jc)throw error||new Error('Pipeline assignment not found.');const job=Array.isArray(jc.jobs)?jc.jobs[0]:jc.jobs;return result(await insert(admin,'placements',{organization_id:organizationId,job_candidate_id:jobCandidateId,candidate_id:jc.candidate_id,job_id:jc.job_id,company_id:job.company_id,start_date:dateOnly(row,'start_date'),salary:numberValue(row,'salary'),placement_fee:numberValue(row,'placement_fee'),currency:currencyValue(row,'currency'),guarantee_days:numberValue(row,'guarantee_days')||90,status:lowerValue(row,'status')||'confirmed',created_by:userId}))}
  if(entityType==='revenue_splits'){const placementId=await resolveLegacy(admin,organizationId,'placements',textValue(row,'placement_legacy_id'));const memberId=await requiredMember(admin,organizationId,lowerValue(row,'member_email'));const {data,error}=await caller.rpc('create_placement_revenue_split',{p_organization_id:organizationId,p_placement_id:placementId,p_member_id:memberId,p_percentage:numberValue(row,'split_percentage')});if(error)throw error;return result(String(data))}
  if(entityType==='invoices')return result(await insert(admin,'placement_invoices',{organization_id:organizationId,placement_id:await resolveLegacy(admin,organizationId,'placements',textValue(row,'placement_legacy_id')),invoice_reference:textValue(row,'invoice_reference')||null,amount:numberValue(row,'amount'),currency:currencyValue(row,'currency'),issued_on:dateOnly(row,'issued_on'),due_on:dateOnly(row,'due_on'),status:lowerValue(row,'status')||'not_issued',paid_on:dateOnly(row,'paid_on'),notes:textValue(row,'notes')||null}))
  throw new FunctionError(400,'unsupported_entity','Unsupported entity type.')
}

function result(entityId:string,relatedChanges:RelatedChange[]=[]):InsertResult{return {entityId,relatedChanges}}
function actualTable(entityType:string){const tables:Record<string,string>={submissions:'submission_packages',revenue_splits:'placement_revenue_splits',invoices:'placement_invoices'};const table=tables[entityType]||entityType;if(!allowed.includes(entityType)&&entityType!=='activities')throw new FunctionError(400,'rollback_entity_unsupported',`Cannot roll back ${entityType}`);return table}
async function insert(admin:SupabaseClient,table:string,values:Record<string,unknown>){const {data,error}=await admin.from(table).insert(values).select('id').single();if(error)throw error;return data.id as string}
async function existingMapping(admin:SupabaseClient,organizationId:string,entityType:string,legacyId:string){const {data}=await admin.from('import_entity_mappings').select('entity_id').eq('organization_id',organizationId).eq('entity_type',entityType).eq('legacy_id',legacyId).maybeSingle();return data?.entity_id as string|undefined}
async function resolveLegacy(admin:SupabaseClient,organizationId:string,entityType:string,legacyId:string){const existing=await existingMapping(admin,organizationId,entityType,legacyId);if(!existing)throw new FunctionError(409,'orphan_reference',`Missing ${entityType} legacy reference: ${legacyId}`);return existing}
async function optionalMember(admin:SupabaseClient,organizationId:string,email:string){if(!email)return null;return requiredMember(admin,organizationId,email)}
async function requiredMember(admin:SupabaseClient,organizationId:string,email:string){const {data,error}=await admin.from('organization_members').select('id,profiles:user_id!inner(email)').eq('organization_id',organizationId).eq('profiles.email',email).eq('status','active').single();if(error||!data)throw new FunctionError(409,'member_reference_missing',`No active member has email ${email}`);return data.id as string}
async function insertOptionalLink(admin:SupabaseClient,table:string,parentKey:string,parentId:string,organizationId:string,row:Row){const mappings={candidate:'candidates',company:'companies',contact:'contacts',job:'jobs'} as const;for(const entityType of Object.keys(mappings) as (keyof typeof mappings)[]){const legacy=textValue(row,`${entityType}_legacy_id`);if(!legacy)continue;const id=await resolveLegacy(admin,organizationId,mappings[entityType],legacy);const {error}=await admin.from(table).insert({organization_id:organizationId,[parentKey]:parentId,[`${entityType}_id`]:id});if(error)throw error;return}}
