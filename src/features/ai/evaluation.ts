export type EvidenceClassification='matched'|'partial'|'missing'|'uncertain'
export type EvidenceSource='cv_extracted'|'recruiter_entered'|'inferred'
export type EvidenceItem={requirement:string;classification:EvidenceClassification;source:EvidenceSource;explanation:string}
export type ExplainableEvaluation={summary:string;evidence:EvidenceItem[];score:number;uncertainty:string[]}
export interface AIProvider{extractDocument(text:string):Promise<Record<string,unknown>>;classifyEvidence(candidate:Record<string,unknown>,requirements:string[]):Promise<Omit<ExplainableEvaluation,'score'>>}

const weights:Record<EvidenceClassification,number>={matched:1,partial:.5,missing:0,uncertain:.25}
export function calculateEvidenceScore(items:EvidenceItem[]):number{if(items.length===0)return 0;return Math.round(items.reduce((total,item)=>total+weights[item.classification],0)/items.length*100)}
export function finalizeEvaluation(input:Omit<ExplainableEvaluation,'score'>):ExplainableEvaluation{return {...input,score:calculateEvidenceScore(input.evidence)}}
