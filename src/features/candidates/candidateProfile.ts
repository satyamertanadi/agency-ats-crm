import {z} from 'zod'

export const profileSectionKeys=['summary','information','experience','education','strengths','risks','questions'] as const
export type ProfileSectionKey=(typeof profileSectionKeys)[number]
export type ProfileLanguage='en'|'id'

const profileSectionSchema=z.object({
  key:z.enum(profileSectionKeys),
  label:z.string().trim().min(1).max(80),
  visible:z.boolean(),
})

export const candidateProfileTemplateConfigSchema=z.object({
  schema_version:z.literal(1),
  output_language:z.enum(['en','id']),
  anonymize_by_default:z.boolean(),
  confidentiality_text:z.string().trim().min(1).max(1200),
  sections:z.array(profileSectionSchema).length(profileSectionKeys.length).superRefine((sections,context)=>{
    const keys=new Set(sections.map((section)=>section.key))
    for(const key of profileSectionKeys)if(!keys.has(key))context.addIssue({code:'custom',message:`Missing ${key} section.`})
  }),
})

export type CandidateProfileTemplateConfig=z.infer<typeof candidateProfileTemplateConfigSchema>

const defaults:Record<ProfileLanguage,CandidateProfileTemplateConfig>={
  en:{schema_version:1,output_language:'en',anonymize_by_default:false,confidentiality_text:'This candidate profile is confidential and intended only for the named client recruitment process.',sections:[
    {key:'summary',label:'Candidate summary',visible:true},{key:'information',label:'Information',visible:true},
    {key:'experience',label:'Work experience',visible:true},{key:'education',label:'Education',visible:true},
    {key:'strengths',label:'Strengths and opportunities',visible:true},{key:'risks',label:'Risks and challenges',visible:true},
    {key:'questions',label:'Points to validate',visible:true},
  ]},
  id:{schema_version:1,output_language:'id',anonymize_by_default:false,confidentiality_text:'Profil kandidat ini bersifat rahasia dan hanya ditujukan untuk proses rekrutmen klien yang disebutkan.',sections:[
    {key:'summary',label:'Ringkasan kandidat',visible:true},{key:'information',label:'Informasi',visible:true},
    {key:'experience',label:'Pengalaman kerja',visible:true},{key:'education',label:'Pendidikan',visible:true},
    {key:'strengths',label:'Kekuatan dan peluang',visible:true},{key:'risks',label:'Risiko dan tantangan',visible:true},
    {key:'questions',label:'Hal yang perlu divalidasi',visible:true},
  ]},
}

export function defaultCandidateProfileTemplate(language:ProfileLanguage='en'){
  return structuredClone(defaults[language])
}

/* requirement_id and requirement_level are optional and must remain so. This schema parses EVERY
 * stored generated_content in listCandidateProfileVersions, including drafts written before
 * structured requirements existed, and stored profile versions are immutable -- a required field
 * here empties the profile history panel for every workspace with history. */
export const candidateRequirementEvidenceSchema=z.object({
  requirement:z.string().trim().min(1),
  classification:z.enum(['matched','partial','missing','uncertain']),
  source:z.enum(['candidate_record','candidate_cv','none']),
  source_path:z.string().trim(),
  excerpt:z.string().trim().max(300),
  explanation:z.string().trim().min(1),
  requirement_id:z.string().trim().min(1).optional(),
  requirement_level:z.enum(['must_have','nice_to_have']).optional(),
}).superRefine((evidence,context)=>{
  if(evidence.source==='none'&&(evidence.source_path||evidence.excerpt))context.addIssue({code:'custom',message:'Missing evidence cannot cite a source.'})
  if(evidence.source==='candidate_record'&&(!evidence.source_path.startsWith('candidate.')||!evidence.excerpt))context.addIssue({code:'custom',message:'Candidate evidence requires an exact candidate field and excerpt.'})
  if(evidence.source==='candidate_cv'&&(!evidence.source_path.startsWith('cv.')||!evidence.excerpt))context.addIssue({code:'custom',message:'CV evidence requires a CV location and excerpt.'})
})

export type CandidateRequirementEvidence=z.infer<typeof candidateRequirementEvidenceSchema>

export const candidateProfileDraftSchema=z.object({
  candidate_summary:z.array(z.string().trim().min(1)).min(1),
  strengths_opportunities:z.string().trim(),
  risks_challenges:z.string().trim(),
  points_to_validate:z.array(z.string().trim().min(1)),
  experience_relevance:z.array(z.object({
    company_name:z.string().trim(),title:z.string().trim(),relevance:z.array(z.string().trim().min(1)),
  })),
  requirement_evidence:z.array(candidateRequirementEvidenceSchema),
  score:z.number().int().min(0).max(100),
  must_have_coverage:z.object({evidenced:z.number().int().min(0),total:z.number().int().min(0)}).optional(),
  requirements_source:z.enum(['structured','unstructured']).optional(),
})

export type CandidateProfileDraft=z.infer<typeof candidateProfileDraftSchema>

export type CandidateProfileJob={id:string;title:string;company_name:string|null}
export type CandidateProfileTemplate={id:string;name:string;configuration:CandidateProfileTemplateConfig;version:number;is_default:boolean;created_at:string;updated_at:string}
export type CandidateProfileVersion={id:string;version:number;status:'draft'|'finalized'|'failed';candidate_id:string;job_id:string;template_id:string;template_version:number;generated_content:CandidateProfileDraft;reviewed_content:CandidateProfileDraft|null;input_versions:Record<string,unknown>;anonymized:boolean;docx_document_id:string|null;pdf_document_id:string|null;created_at:string;finalized_at:string|null;job_title:string;template_name:string;stale:boolean}
/* `degraded` is set when the provider refused on billing and the draft's judgment fields were left
 * blank for the consultant to write. The document is still finalizable -- everything factual comes
 * from the record, not the model -- so this is a notice to surface, not an error to handle. */
export type CandidateProfileGeneration={profileVersionId:string;draft:CandidateProfileDraft;evaluation:{id:string;score:number;evidence:CandidateRequirementEvidence[]};requestId:string;degraded?:{reason:string;message:string}|null}

/* SCORING CONTRACT -- keep byte-identical with supabase/functions/_shared/profile-schema.ts.
 * The Deno edge runtime cannot import from src/, so this block exists twice. Nothing but the parity
 * test in candidateProfile.test.ts stops the two from drifting, which would mean the score written
 * into ai_evaluations and the score the consultant reads on screen disagreeing. */
type EvidenceClassification=CandidateRequirementEvidence['classification']
// --- scoring:begin ---
export interface ScoredRequirement {id:string;label?:string;requirement_level:'must_have'|'nice_to_have';weight:number}
export interface MustHaveCoverage {evidenced:number;total:number}
interface ScorableEvidence {classification:EvidenceClassification;requirement_id?:string;requirement_level?:'must_have'|'nice_to_have'}

const classificationWeight:Record<EvidenceClassification,number>={matched:1,partial:.5,missing:0,uncertain:.25}

/* A must-have counts double its own weight. The multiplier is deliberately modest: it has to be
 * large enough that a missing non-negotiable moves the number visibly, and small enough that the
 * score stays a weighted average a human can reason about rather than a gate. The gate-shaped
 * signal is must_have_coverage, reported separately and never folded in here. */
function requirementImportance(requirement:ScoredRequirement){
  return Math.max(requirement.weight,0)*(requirement.requirement_level==='must_have'?2:1)
}

export function calculateEvidenceScore(evidence:ScorableEvidence[],requirements?:readonly ScoredRequirement[]){
  if(!evidence.length)return 0
  const flat=()=>Math.round(evidence.reduce((total,item)=>total+classificationWeight[item.classification],0)/evidence.length*100)
  // No requirement set means a legacy draft or the unstructured fallback: the flat mean this
  // function has always computed, unchanged, so historical scores stay comparable to themselves.
  if(!requirements||!requirements.length)return flat()
  const byId=new Map(requirements.map((requirement)=>[requirement.id,requirement]))
  let available=0;let earned=0
  for(const item of evidence){
    const requirement=item.requirement_id?byId.get(item.requirement_id):undefined
    // An entry with no matching requirement still counts at weight 1 rather than vanishing from the
    // denominator, which would let a dropped id quietly inflate the score.
    const importance=requirement?requirementImportance(requirement):1
    available+=importance
    earned+=importance*classificationWeight[item.classification]
  }
  // Every requirement weighted zero. Scoring 0 would read as "matched nothing" rather than "nobody
  // set a weight", so fall back to the unweighted mean.
  if(available<=0)return flat()
  return Math.round(earned/available*100)
}

/* Counts only 'matched' as evidenced. A partial or uncertain must-have is precisely the thing a
 * consultant needs to go and check, so folding it in here would hide the question this number
 * exists to raise. */
export function calculateMustHaveCoverage(evidence:ScorableEvidence[],requirements?:readonly ScoredRequirement[]):MustHaveCoverage{
  const byId=new Map((requirements||[]).map((requirement)=>[requirement.id,requirement]))
  let total=0;let evidenced=0
  for(const item of evidence){
    const level=(item.requirement_id?byId.get(item.requirement_id)?.requirement_level:undefined)??item.requirement_level
    if(level!=='must_have')continue
    total+=1
    if(item.classification==='matched')evidenced+=1
  }
  return {evidenced,total}
}
// --- scoring:end ---

export function countEditedFields(original:CandidateProfileDraft,reviewed:CandidateProfileDraft){
  const text=(value:unknown)=>JSON.stringify(value)
  return (['candidate_summary','strengths_opportunities','risks_challenges','points_to_validate','experience_relevance'] as const)
    .reduce((count,key)=>count+(text(original[key])===text(reviewed[key])?0:1),0)
}

export function hasStaleProfileInputs(inputVersions:Record<string,unknown>,current:{candidateUpdatedAt:string;jobUpdatedAt:string;templateVersion:number}){
  return inputVersions.candidate_updated_at!==current.candidateUpdatedAt||inputVersions.job_updated_at!==current.jobUpdatedAt||inputVersions.template_version!==current.templateVersion
}
