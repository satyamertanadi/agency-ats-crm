import {supabase} from '../../shared/lib/supabase'
import {AppError,humanizeRpcError} from '../../shared/lib/errors'
import type {Json} from '../../generated/database.types'

/* Configuring Interview Intelligence: the switches, the digest recipients, and the agency core
 * rubric.
 *
 * Every write goes through an RPC gated on interview_intelligence.configure rather than through the
 * organization_settings table policy, which is gated on organization.manage. Those are different
 * grants on purpose -- running a workspace is not the same authority as deciding that every
 * interview on the desk gets read by a model.
 */

function fail(error:{message:string;code?:string}|null,fallback:string):never{
  const humanized=error?.message?humanizeRpcError(error.message):null
  if(humanized)throw new AppError(humanized.message,humanized.code,error)
  throw new AppError(fallback,error?.code||'interview_admin_error',error)
}

export interface InterviewIntelligenceSettings {
  intelligenceEnabled:boolean
  rubricGenerationEnabled:boolean
  meetAutoImportEnabled:boolean
  autoAnalysisEnabled:boolean
  digestEnabled:boolean
  /** "HH:MM" in the workspace timezone, never UTC. */
  digestLocalTime:string
  digestSkipEmpty:boolean
  digestLastSuccessAt:string|null
  timezone:string
  /** Null until an agency core rubric is active. Analysis is refused while it is null. */
  coreRubricId:string|null
  coreRubricDraftId:string|null
}

const bool=(value:unknown):boolean=>value===true
/* Postgres returns a `time` as "17:30:00"; an <input type="time"> wants "17:30". */
const clockTime=(value:unknown):string=>typeof value==='string'?value.slice(0,5):'17:30'

export async function getInterviewSettings(organizationId:string):Promise<InterviewIntelligenceSettings|null>{
  const {data,error}=await supabase.rpc('get_interview_intelligence_settings',{p_organization_id:organizationId})
  if(error)fail(error,'Could not load the Interview Intelligence settings.')
  if(!data)return null
  const row=data as unknown as Record<string,unknown>
  return {
    intelligenceEnabled:bool(row.intelligence_enabled),
    rubricGenerationEnabled:bool(row.rubric_generation_enabled),
    meetAutoImportEnabled:bool(row.meet_auto_import_enabled),
    autoAnalysisEnabled:bool(row.auto_analysis_enabled),
    digestEnabled:bool(row.digest_enabled),
    digestLocalTime:clockTime(row.digest_local_time),
    digestSkipEmpty:bool(row.digest_skip_empty),
    digestLastSuccessAt:(row.digest_last_success_at as string|null)??null,
    timezone:String(row.timezone||'UTC'),
    coreRubricId:(row.core_rubric_id as string|null)??null,
    coreRubricDraftId:(row.core_rubric_draft_id as string|null)??null,
  }
}

export interface SettingsPatch {
  intelligenceEnabled?:boolean
  rubricGenerationEnabled?:boolean
  meetAutoImportEnabled?:boolean
  autoAnalysisEnabled?:boolean
  digestEnabled?:boolean
  digestLocalTime?:string
  digestSkipEmpty?:boolean
}

/* Only the switches the caller named are sent; the rest go as null, which the function reads as
 * "leave alone". A panel saving one toggle cannot blank another it never showed. */
export async function updateInterviewSettings(organizationId:string,patch:SettingsPatch){
  const {error}=await supabase.rpc('update_interview_intelligence_settings',{
    p_organization_id:organizationId,
    p_intelligence_enabled:patch.intelligenceEnabled??undefined,
    p_rubric_generation_enabled:patch.rubricGenerationEnabled??undefined,
    p_meet_auto_import_enabled:patch.meetAutoImportEnabled??undefined,
    p_auto_analysis_enabled:patch.autoAnalysisEnabled??undefined,
    p_digest_enabled:patch.digestEnabled??undefined,
    p_digest_local_time:patch.digestLocalTime??undefined,
    p_digest_skip_empty:patch.digestSkipEmpty??undefined,
  })
  if(error)fail(error,'Could not save the Interview Intelligence settings.')
}

/* Just the member ids. Names come from listTeamMembers, which the settings page already loads and
 * which already carries the role and status a picker needs -- a second query for the same people
 * would be a second place for "who is on this desk" to be answered. */
export async function listDigestRecipientIds(organizationId:string):Promise<string[]>{
  const {data,error}=await supabase.from('interview_digest_recipients')
    .select('member_id')
    .eq('organization_id',organizationId)
  if(error)fail(error,'Could not load the digest recipients.')
  return (data||[]).map((row)=>row.member_id)
}

export async function addDigestRecipient(organizationId:string,memberId:string){
  const {error}=await supabase.rpc('add_interview_digest_recipient',{
    p_organization_id:organizationId,p_member_id:memberId,
  })
  if(error)fail(error,'Could not add that person to the daily brief.')
}

export async function removeDigestRecipient(organizationId:string,memberId:string){
  const {error}=await supabase.rpc('remove_interview_digest_recipient',{
    p_organization_id:organizationId,p_member_id:memberId,
  })
  if(error)fail(error,'Could not remove that person from the daily brief.')
}

export interface CoreRubricItemInput {
  dimension:string
  item_type:string
  label:string
  question_text:string|null
  evidence_expected:string|null
  requirement_level:string
}

export async function createCoreRubricDraft(organizationId:string,name:string,items:CoreRubricItemInput[]):Promise<string>{
  const {data,error}=await supabase.rpc('create_interview_core_rubric_draft',{
    p_organization_id:organizationId,p_name:name,p_items:items as unknown as Json,
  })
  if(error)fail(error,'Could not create the agency core rubric.')
  return data as string
}

export async function discardCoreRubricDraft(organizationId:string,rubricId:string){
  const {error}=await supabase.rpc('discard_interview_core_rubric_draft',{
    p_organization_id:organizationId,p_rubric_id:rubricId,
  })
  if(error)fail(error,'Could not discard that draft.')
}

export interface CoreRubricSummary {
  id:string
  name:string
  version:number
  status:'draft'|'active'|'archived'
  itemCount:number
  activatedAt:string|null
}

export async function listCoreRubrics(organizationId:string):Promise<CoreRubricSummary[]>{
  const {data,error}=await supabase.from('interview_rubrics')
    .select('id,name,version,status,activated_at,interview_rubric_items(count)')
    .eq('organization_id',organizationId)
    .eq('rubric_type','core')
    .order('version',{ascending:false})
  if(error)fail(error,'Could not load the agency core rubrics.')

  return (data||[]).map((row)=>({
    id:row.id,
    name:row.name,
    version:row.version,
    status:row.status as CoreRubricSummary['status'],
    itemCount:Number((row.interview_rubric_items as {count:number}[]|null)?.[0]?.count??0),
    activatedAt:row.activated_at,
  }))
}
