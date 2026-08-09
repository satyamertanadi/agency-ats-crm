// Message contract between the content-script panel and the background service worker.
export type ProspectKind='candidate'|'contact'

// Timeline/skill shapes mirror the CvExtraction contract (supabase/functions/_shared/cv-schema.ts) so
// the AI parse output and the rich scraper feed capture_prospect through one shape.
export interface EmploymentItem{company_name:string;title:string;location?:string;started_on?:string|null;ended_on?:string|null;is_current?:boolean;summary?:string;sort_order?:number}
export interface EducationItem{institution:string;degree?:string;field_of_study?:string;started_on?:string|null;ended_on?:string|null;sort_order?:number}
export interface SkillItem{name:string;proficiency?:string;years_experience?:number}
export interface LanguageItem{language:string;proficiency?:string}
export interface PrivateDetails{email?:string;phone?:string;current_salary?:number;expected_salary?:number;salary_currency?:string;work_authorization?:string}

export interface CapturePayload{
  full_name:string;current_company?:string;current_position?:string;location?:string;linkedin_url?:string;portfolio_url?:string;
  email?:string;phone?:string;company_id?:string;position?:string;source?:string;
  private?:PrivateDetails;employment?:EmploymentItem[];education?:EducationItem[];skills?:SkillItem[];languages?:LanguageItem[];
  note?:string;tags?:string[];owner_member_id?:string;status?:string;
}

export interface OrgSummary{id:string;name:string}
export interface JobSummary{id:string;title:string}
export interface CompanySummary{id:string;name:string}
export interface MemberSummary{id:string;name:string}
// The browser extension receives only the short-lived access credential it needs to call ATS APIs.
// Refresh tokens can mint new access tokens and therefore must stay inside the ATS application.
export interface HandoffSession{access_token:string;expires_at:number}

// One radar entry per queried LinkedIn URL.
export interface ProspectMatch{linkedin_url:string;candidate:{id:string;full_name:string;status:string;stages:{job:string;stage:string}[]}|null;contact:{id:string;full_name:string}|null}

export type BgRequest =
  | {type:'get-state'}
  | {type:'connect'}
  | {type:'disconnect'}
  | {type:'session';session:HandoffSession}
  | {type:'list-jobs';organizationId:string}
  | {type:'list-companies';organizationId:string}
  | {type:'list-members';organizationId:string}
  | {type:'list-tags';organizationId:string}
  | {type:'lookup';organizationId:string;linkedinUrls:string[]}
  | {type:'ai-parse';organizationId:string;text:string}
  | {type:'capture';organizationId:string;kind:ProspectKind;payload:CapturePayload;jobId?:string}
  | {type:'bulk-capture';organizationId:string;kind:ProspectKind;items:CapturePayload[];jobId?:string}

export interface StateResponse{connected:boolean;email?:string;organizations:OrgSummary[];error?:string}
export interface CaptureOutcome{id:string;kind:ProspectKind;deduped:boolean;job_linked:boolean}
export interface CaptureResult{result?:CaptureOutcome;error?:string}
export interface BulkCaptureResult{results?:{linkedin_url:string;ok:boolean;result?:CaptureOutcome;error?:string}[];error?:string}
export interface LookupResult{matches?:ProspectMatch[];error?:string}
// The AI parse returns the CvExtraction shape; we only consume the fields capture_prospect accepts.
export interface AiParseResult{extraction?:CapturePayload&{private?:PrivateDetails};error?:string}
