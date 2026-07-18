import type {
  AiParseResult,BulkCaptureResult,CapturePayload,CaptureResult,CompanySummary,JobSummary,
  LookupResult,MemberSummary,ProspectKind,StateResponse,
} from './messages'

// Thin typed wrappers over chrome.runtime.sendMessage so content scripts never hand-roll message
// objects. Every call resolves to the background handler's response.
async function send<T>(message:unknown):Promise<T>{return chrome.runtime.sendMessage<T>(message)}

export const api={
  getState:()=>send<StateResponse>({type:'get-state'}),
  connect:()=>send<{ok:boolean}>({type:'connect'}),
  listJobs:(organizationId:string)=>send<{jobs:JobSummary[]}>({type:'list-jobs',organizationId}),
  listCompanies:(organizationId:string)=>send<{companies:CompanySummary[]}>({type:'list-companies',organizationId}),
  listMembers:(organizationId:string)=>send<{members:MemberSummary[]}>({type:'list-members',organizationId}),
  listTags:(organizationId:string)=>send<{tags:string[]}>({type:'list-tags',organizationId}),
  lookup:(organizationId:string,linkedinUrls:string[])=>send<LookupResult>({type:'lookup',organizationId,linkedinUrls}),
  aiParse:(organizationId:string,text:string)=>send<AiParseResult>({type:'ai-parse',organizationId,text}),
  capture:(organizationId:string,kind:ProspectKind,payload:CapturePayload,jobId?:string)=>send<CaptureResult>({type:'capture',organizationId,kind,payload,jobId}),
  bulkCapture:(organizationId:string,kind:ProspectKind,items:CapturePayload[],jobId?:string)=>send<BulkCaptureResult>({type:'bulk-capture',organizationId,kind,items,jobId}),
}
