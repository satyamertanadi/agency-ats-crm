import {supabase} from '../../shared/lib/supabase'
import {AppError,humanizeRpcError} from '../../shared/lib/errors'

/* Data access for interview blueprints.
 *
 * Reads go through get_interview_blueprint_status, which answers the whole Job Workspace panel in one
 * bounded call rather than four -- the panel renders on every job page, so a fan-out here is a
 * fan-out on the busiest screen in the product.
 *
 * Draft edits are ordinary table writes: interview_intelligence.configure already gates them through
 * RLS, and a draft carries no invariant worth an RPC. Activation is the exception and goes through an
 * audited one, because it is the human decision the whole draft/active split exists to protect.
 */

function fail(error:{message:string;code?:string}|null,fallback:string):never{
  const humanized=error?.message?humanizeRpcError(error.message):null
  if(humanized)throw new AppError(humanized.message,humanized.code,error)
  throw new AppError(fallback,error?.code||'blueprint_error',error)
}

export type BlueprintDimension='essential_coverage'|'question_quality'|'listening_balance'|'role_presentation'|'next_step_clarity'
export type BlueprintItemType='essential_question'|'requirement'|'role_presentation'|'logistics'|'next_steps'|'quality_criterion'
export type RequirementLevel='must_have'|'nice_to_have'|'not_applicable'

export interface BlueprintStatus {
  rubricId:string|null
  version:number|null
  activatedAt:string|null
  sourceDocumentId:string|null
  essentialQuestionCount:number
  mustHaveCount:number
  niceToHaveCount:number
  isStale:boolean
  draftRubricId:string|null
  draftUpdatedAt:string|null
  coreRubricId:string|null
  coreRubricVersion:number|null
}

export interface BlueprintItem {
  id:string
  dimension:BlueprintDimension
  itemType:BlueprintItemType
  label:string
  questionText:string|null
  evidenceExpected:string|null
  requirementLevel:RequirementLevel
  sortOrder:number
}

export interface JobDocumentOption {id:string;fileName:string;mimeType:string}

/* Returns null when the workspace has the feature off or the caller cannot use it -- the RPC yields
 * no row in that case, and the panel renders nothing rather than an error. */
export async function getBlueprintStatus(organizationId:string,jobId:string):Promise<BlueprintStatus|null>{
  const {data,error}=await supabase.rpc('get_interview_blueprint_status',{p_organization_id:organizationId,p_job_id:jobId})
  if(error)fail(error,'Could not load the interview blueprint.')
  const row=data?.[0]
  if(!row)return null
  return {
    rubricId:row.rubric_id,
    version:row.version,
    activatedAt:row.activated_at,
    sourceDocumentId:row.source_document_id,
    essentialQuestionCount:row.essential_question_count??0,
    mustHaveCount:row.must_have_count??0,
    niceToHaveCount:row.nice_to_have_count??0,
    isStale:Boolean(row.is_stale),
    draftRubricId:row.draft_rubric_id,
    draftUpdatedAt:row.draft_updated_at,
    coreRubricId:row.core_rubric_id,
    coreRubricVersion:row.core_rubric_version,
  }
}

export async function listBlueprintItems(rubricId:string):Promise<BlueprintItem[]>{
  const {data,error}=await supabase.from('interview_rubric_items')
    .select('id,dimension,item_type,label,question_text,evidence_expected,requirement_level,sort_order')
    .eq('rubric_id',rubricId).order('sort_order')
  if(error)fail(error,'Could not load the blueprint questions.')
  return (data||[]).map((item)=>({
    id:item.id,
    dimension:item.dimension as BlueprintDimension,
    itemType:item.item_type as BlueprintItemType,
    label:item.label,
    questionText:item.question_text,
    evidenceExpected:item.evidence_expected,
    requirementLevel:item.requirement_level as RequirementLevel,
    sortOrder:item.sort_order,
  }))
}

/* Only documents attached to this job. The edge function enforces the same rule server-side; this
 * keeps an unrelated client's JD out of the picker in the first place. */
export async function listJobDocuments(organizationId:string,jobId:string):Promise<JobDocumentOption[]>{
  const {data,error}=await supabase.from('documents')
    .select('id,file_name,mime_type,document_links!inner(job_id)')
    .eq('organization_id',organizationId).is('deleted_at',null)
    .eq('document_links.job_id',jobId).eq('is_current',true)
    .order('created_at',{ascending:false})
  if(error)fail(error,'Could not load job documents.')
  return (data||[]).map((item)=>({id:item.id,fileName:item.file_name,mimeType:item.mime_type}))
}

export async function generateBlueprintDraft(organizationId:string,jobId:string,documentId:string|null){
  const {data,error}=await supabase.functions.invoke('generate-interview-rubric',{body:{organizationId,jobId,documentId}})
  if(error)throw new AppError(error.message,'function_error',error)
  const failure=(data as {error?:{message?:string;code?:string}})?.error
  if(failure)throw new AppError(failure.message||'Could not generate a blueprint.',failure.code||'function_error',data)
  return data as {rubricId:string;itemCount:number;status:'draft'}
}

export async function activateBlueprint(organizationId:string,rubricId:string):Promise<string>{
  const {data,error}=await supabase.rpc('activate_interview_rubric',{p_organization_id:organizationId,p_rubric_id:rubricId})
  if(error)fail(error,'Could not activate the blueprint.')
  return data as string
}

export async function updateBlueprintItem(itemId:string,changes:{label?:string;questionText?:string|null;evidenceExpected?:string|null;requirementLevel?:RequirementLevel}){
  const {error}=await supabase.from('interview_rubric_items').update({
    ...(changes.label!==undefined?{label:changes.label}:{}),
    ...(changes.questionText!==undefined?{question_text:changes.questionText}:{}),
    ...(changes.evidenceExpected!==undefined?{evidence_expected:changes.evidenceExpected}:{}),
    ...(changes.requirementLevel!==undefined?{requirement_level:changes.requirementLevel}:{}),
  }).eq('id',itemId)
  if(error)fail(error,'Could not save the blueprint question.')
}

export async function removeBlueprintItem(itemId:string){
  const {error}=await supabase.from('interview_rubric_items').delete().eq('id',itemId)
  if(error)fail(error,'Could not remove the blueprint question.')
}

export async function addBlueprintItem(organizationId:string,rubricId:string,item:{dimension:BlueprintDimension;itemType:BlueprintItemType;label:string;questionText:string|null;requirementLevel:RequirementLevel;sortOrder:number}){
  const {error}=await supabase.from('interview_rubric_items').insert({
    organization_id:organizationId,rubric_id:rubricId,dimension:item.dimension,item_type:item.itemType,
    label:item.label,question_text:item.questionText,requirement_level:item.requirementLevel,sort_order:item.sortOrder,
  })
  if(error)fail(error,'Could not add the blueprint question.')
}
