import type {CompanyPipelineRow} from '../../shared/types/domain'

/* The default business-development flow. `business_development_stage` is a free-text column with no
 * database check constraint, so this list is the product's vocabulary, not the schema's -- which is
 * exactly why `groupCompaniesByStage` must never assume a row matches one of these. */
export const bdStages=[
  {key:'lead',label:'Lead',description:'Identified, not yet qualified.'},
  {key:'qualifying',label:'Qualifying',description:'Establishing fit and hiring need.'},
  {key:'pitching',label:'Pitching',description:'Credentials and terms presented.'},
  {key:'negotiating',label:'Negotiating',description:'Agreeing commercial terms.'},
  {key:'won',label:'Won',description:'Agreement in place, ready for roles.'},
  {key:'lost',label:'Lost',description:'Closed without agreement.'},
  {key:'dormant',label:'Dormant',description:'Parked; revisit later.'},
] as const

export type BdStageKey=(typeof bdStages)[number]['key']
/* Sentence case, always -- for the known stages via the table above, and for the unknown ones via the
 * normalisation below.
 *
 * `business_development_stage` is free text with no check constraint, so an import brings whatever the
 * previous system wrote: "NEGOTIATING", "Pitching", "client_review". Printed as stored, one column of
 * a client list showed three different casing conventions, which reads as three different values
 * rather than one value written three ways -- and that is the specific kind of thing that makes an
 * ATS look like a spreadsheet with a UI on it.
 *
 * This is a DISPLAY normalisation. The column keeps exactly what was imported; nothing is written
 * back, so an agency mid-migration can still see and correct the raw value by editing the record. */
export const bdStageLabel=(key:string)=>{
  const known=bdStages.find((stage)=>stage.key===key)
  if(known)return known.label
  const words=key.replaceAll('_',' ').trim()
  if(!words)return key
  return words.charAt(0).toUpperCase()+words.slice(1).toLowerCase()
}
const known=new Set<string>(bdStages.map((stage)=>stage.key))

export interface BdColumn {key:string;label:string;description?:string;companies:CompanyPipelineRow[];openJobs:number;value:number}

/* Groups accounts into board columns.
 *
 * Any stage the product does not know about gets its own trailing column rather than being dropped
 * or silently relabelled 'lead'. A workspace that imported accounts with its own vocabulary would
 * otherwise find them missing from the board entirely -- a client you cannot see is a client you
 * stop working, which is worse than a column with an unfamiliar name. */
export function groupCompaniesByStage(rows:CompanyPipelineRow[]):BdColumn[]{
  const build=(key:string,label:string,description?:string):BdColumn=>{
    const companies=rows.filter((row)=>row.business_development_stage===key)
    return {key,label,description,companies,openJobs:companies.reduce((sum,row)=>sum+row.open_jobs,0),value:companies.reduce((sum,row)=>sum+Number(row.expected_open_fee||0),0)}
  }
  const columns=bdStages.map((stage)=>build(stage.key,stage.label,stage.description))
  const extras=[...new Set(rows.map((row)=>row.business_development_stage).filter((stage)=>!known.has(stage)))].sort()
  return [...columns,...extras.map((stage)=>build(stage,bdStageLabel(stage),'Stage not in the default flow.'))]
}

export type BdRiskKey='unowned'|'no_next_action'|'follow_up_overdue'|'stale'|'terms_missing'|'terms_expired'
export interface BdRisk {key:BdRiskKey;label:string;tone:'bad'|'warn'}

/* Accounts only count as "at risk" while they are still being worked. Lost and dormant accounts are
 * deliberately exempt: flagging a closed account for having no next action is noise that trains
 * people to ignore the flags that matter. */
const workedStages=new Set<string>(['lead','qualifying','pitching','negotiating','won'])
const STALE_DAYS=21

export function accountRisks(row:CompanyPipelineRow,now:Date):BdRisk[]{
  if(!workedStages.has(row.business_development_stage))return []
  const risks:BdRisk[]=[]
  if(!row.owner_member_id)risks.push({key:'unowned',label:'No account owner',tone:'bad'})
  const followUp=row.next_follow_up_at?new Date(row.next_follow_up_at):null
  if(followUp&&followUp<now)risks.push({key:'follow_up_overdue',label:'Follow-up overdue',tone:'bad'})
  else if(!followUp)risks.push({key:'no_next_action',label:'No next action',tone:'warn'})
  const last=row.last_activity_at?new Date(row.last_activity_at):null
  if(!last||now.getTime()-last.getTime()>STALE_DAYS*86_400_000)risks.push({key:'stale',label:`No contact in ${STALE_DAYS} days`,tone:'warn'})
  // Commercial terms only become a risk once an account is actually winnable. Asking a brand-new
  // lead for a signed fee agreement is not a real finding.
  if(row.business_development_stage==='won'||row.open_jobs>0){
    if(row.terms_status==='expired')risks.push({key:'terms_expired',label:'Fee agreement expired',tone:'bad'})
    else if(row.terms_status==='none')risks.push({key:'terms_missing',label:'No fee agreement',tone:'bad'})
  }
  return risks
}

/* The list's health filter. Every option is expressed as a question about `accountRisks` rather than
 * as its own predicate, so the filter can never disagree with the risk badges on the same row or with
 * the "Need attention" figure above the table -- which is exactly what would happen the first time
 * someone tuned STALE_DAYS and updated one of three copies of the rule.
 *
 * 'healthy' is the complement over WORKED accounts only, matching accountRisks' own exemption: a lost
 * account has no risks, but calling it healthy would be an odd thing for the list to claim. */
export type AccountHealthFilter='all'|'attention'|'unowned'|'overdue'|'terms'|'healthy'
export const accountHealthFilters:Array<[AccountHealthFilter,string]>=[
  ['all','All health'],
  ['attention','Needs attention'],
  ['unowned','Unowned'],
  ['overdue','Follow-up overdue'],
  ['terms','Fee agreement missing'],
  ['healthy','No open risks'],
]

export function filterAccountHealth(rows:CompanyPipelineRow[],filter:AccountHealthFilter,now:Date):CompanyPipelineRow[]{
  if(filter==='all')return rows
  return rows.filter((row)=>{
    const risks=accountRisks(row,now)
    switch(filter){
      case 'attention':return risks.length>0
      case 'unowned':return risks.some((risk)=>risk.key==='unowned')
      case 'overdue':return risks.some((risk)=>risk.key==='follow_up_overdue')
      case 'terms':return risks.some((risk)=>risk.key==='terms_missing'||risk.key==='terms_expired')
      case 'healthy':return workedStages.has(row.business_development_stage)&&risks.length===0
      default:return true
    }
  })
}

export interface BdSummary {active:number;won:number;openJobs:number;pipelineValue:number;atRisk:number;unowned:number}

export function bdSummary(rows:CompanyPipelineRow[],now:Date):BdSummary{
  const worked=rows.filter((row)=>workedStages.has(row.business_development_stage))
  return {
    active:worked.length,
    won:rows.filter((row)=>row.business_development_stage==='won').length,
    openJobs:rows.reduce((sum,row)=>sum+row.open_jobs,0),
    // Pipeline value counts accounts still in play only. Including won-and-billed or lost accounts
    // would make the headline number drift upward forever and stop meaning anything.
    pipelineValue:worked.reduce((sum,row)=>sum+Number(row.expected_open_fee||0),0),
    atRisk:worked.filter((row)=>accountRisks(row,now).length>0).length,
    unowned:worked.filter((row)=>!row.owner_member_id).length,
  }
}
