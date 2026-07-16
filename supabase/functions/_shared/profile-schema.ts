export type EvidenceClassification='matched'|'partial'|'missing'|'uncertain'
export interface CandidateRequirementEvidence {requirement:string;classification:EvidenceClassification;source:'candidate_record'|'none';source_path:string;excerpt:string;explanation:string}
export interface CandidateProfileDraft {
  candidate_summary:string[];strengths_opportunities:string;risks_challenges:string;points_to_validate:string[];
  experience_relevance:{company_name:string;title:string;relevance:string[]}[];
  requirement_evidence:CandidateRequirementEvidence[];score:number
}

export const candidateProfileJsonSchema={
  type:'object',additionalProperties:false,
  required:['candidate_summary','strengths_opportunities','risks_challenges','points_to_validate','experience_relevance','requirement_evidence'],
  properties:{
    candidate_summary:{type:'array',items:{type:'string'}},
    strengths_opportunities:{type:'string'},risks_challenges:{type:'string'},points_to_validate:{type:'array',items:{type:'string'}},
    experience_relevance:{type:'array',items:{type:'object',additionalProperties:false,required:['company_name','title','relevance'],properties:{company_name:{type:'string'},title:{type:'string'},relevance:{type:'array',items:{type:'string'}}}}},
    requirement_evidence:{type:'array',items:{type:'object',additionalProperties:false,required:['requirement','classification','source','source_path','excerpt','explanation'],properties:{
      requirement:{type:'string'},classification:{type:'string',enum:['matched','partial','missing','uncertain']},source:{type:'string',enum:['candidate_record','none']},source_path:{type:'string'},excerpt:{type:'string'},explanation:{type:'string'},
    }}},
  },
} as const

const weight:Record<EvidenceClassification,number>={matched:1,partial:.5,missing:0,uncertain:.25}
export function calculateEvidenceScore(evidence:CandidateRequirementEvidence[]){return evidence.length?Math.round(evidence.reduce((sum,item)=>sum+weight[item.classification],0)/evidence.length*100):0}

export function validateCandidateProfileDraft(value:unknown):CandidateProfileDraft{
  if(!value||typeof value!=='object')throw new Error('Profile result must be an object.')
  const raw=value as Record<string,unknown>;const strings=(input:unknown)=>Array.isArray(input)?input.filter((item):item is string=>typeof item==='string'&&item.trim().length>0).map((item)=>item.trim()):[]
  const classifications=new Set(['matched','partial','missing','uncertain']);const sources=new Set(['candidate_record','none'])
  const evidence=Array.isArray(raw.requirement_evidence)?raw.requirement_evidence.map((entry)=>{
    const item=entry as Record<string,unknown>;const classification=String(item.classification||'');const source=String(item.source||'')
    if(!String(item.requirement||'').trim()||!classifications.has(classification)||!sources.has(source)||!String(item.explanation||'').trim())throw new Error('Profile evidence is invalid.')
    const excerpt=String(item.excerpt||'').trim().slice(0,300);const sourcePath=String(item.source_path||'').trim()
    if(source==='none'&&(excerpt||sourcePath))throw new Error('Missing evidence cannot cite a source.')
    if(source==='candidate_record'&&(!sourcePath.startsWith('candidate.')||!excerpt))throw new Error('Candidate evidence must cite an exact candidate field and excerpt.')
    return {requirement:String(item.requirement).trim(),classification:classification as EvidenceClassification,source:source as CandidateRequirementEvidence['source'],source_path:sourcePath,excerpt,explanation:String(item.explanation).trim()}
  }):[]
  if(!evidence.length)throw new Error('Profile result did not evaluate any role requirements.')
  const experience=Array.isArray(raw.experience_relevance)?raw.experience_relevance.map((entry)=>{const item=entry as Record<string,unknown>;return {company_name:String(item.company_name||'').trim(),title:String(item.title||'').trim(),relevance:strings(item.relevance)}}):[]
  const summary=strings(raw.candidate_summary);if(!summary.length)throw new Error('Profile result has no candidate summary.')
  return {candidate_summary:summary,strengths_opportunities:String(raw.strengths_opportunities||'').trim(),risks_challenges:String(raw.risks_challenges||'').trim(),points_to_validate:strings(raw.points_to_validate),experience_relevance:experience,requirement_evidence:evidence,score:calculateEvidenceScore(evidence)}
}
