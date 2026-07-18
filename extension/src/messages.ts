// Message contract between the content-script panel and the background service worker.
export type ProspectKind='candidate'|'contact'
export interface CapturePayload{full_name:string;current_company?:string;current_position?:string;location?:string;linkedin_url?:string;email?:string;phone?:string;company_id?:string;position?:string}
export interface OrgSummary{id:string;name:string}
export interface JobSummary{id:string;title:string}
export interface CompanySummary{id:string;name:string}
export interface HandoffSession{access_token:string;refresh_token:string}

export type BgRequest =
  | {type:'get-state'}
  | {type:'connect'}
  | {type:'disconnect'}
  | {type:'session';session:HandoffSession}
  | {type:'list-jobs';organizationId:string}
  | {type:'list-companies';organizationId:string}
  | {type:'capture';organizationId:string;kind:ProspectKind;payload:CapturePayload;jobId?:string}

export interface StateResponse{connected:boolean;email?:string;organizations:OrgSummary[];error?:string}
export interface CaptureResult{result?:{id:string;kind:ProspectKind;deduped:boolean;job_linked:boolean};error?:string}
