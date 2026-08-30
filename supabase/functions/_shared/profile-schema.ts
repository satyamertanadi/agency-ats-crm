export type EvidenceClassification='matched'|'partial'|'missing'|'uncertain'
/* 'candidate_cv' is evidence read out of the attached CV document rather than out of a structured
 * candidate field. It is a separate source and not a widening of candidate_record because the two
 * are checkable to different degrees: a candidate_record excerpt can be found again in the payload
 * that was sent, a CV excerpt read out of a PDF cannot. The UI badges them differently so a
 * consultant knows which citations they can verify. */
/* 'interview_notes' is recruiter-authored first-hand evidence and, unusually, the ONLY source whose
 * excerpt this code can actually check. A candidate_record excerpt is findable in the payload that
 * was sent; a candidate_cv excerpt was read out of a PDF and cannot be confirmed; notes arrive as a
 * string, so a quoted excerpt is verified against it below before the evidence is accepted. That
 * verification is what makes it safe for notes to carry a requirement to 'matched' on their own --
 * they are written by the person whose placement fee depends on the outcome. */
export type EvidenceSource='candidate_record'|'candidate_cv'|'interview_notes'|'none'
export interface CandidateRequirementEvidence {
  requirement:string
  classification:EvidenceClassification
  source:EvidenceSource
  source_path:string
  excerpt:string
  explanation:string
  /* Both optional, and they must stay that way. Stored profile versions are immutable and
   * listCandidateProfileVersions parses EVERY historical generated_content through the client mirror
   * of this shape, so a field made required here breaks the profile history panel for every draft
   * generated before structured requirements shipped -- with no backfill available. */
  requirement_id?:string
  requirement_level?:'must_have'|'nice_to_have'
}
export interface CandidateProfileDraft {
  candidate_summary:string[];strengths_opportunities:string;risks_challenges:string;points_to_validate:string[];
  experience_relevance:{company_name:string;title:string;relevance:string[]}[];
  requirement_evidence:CandidateRequirementEvidence[];score:number
  must_have_coverage?:MustHaveCoverage
  /* 'unstructured' records that this vacancy had no job_requirements rows and the assessment fell
   * back to splitting jobs.requirements on newlines. Surfaced in the UI because it changes what the
   * score means: the requirement set was not one anybody approved. */
  requirements_source?:'structured'|'unstructured'
}

export const candidateProfileJsonSchema={
  type:'object',additionalProperties:false,
  required:['candidate_summary','strengths_opportunities','risks_challenges','points_to_validate','experience_relevance','requirement_evidence'],
  properties:{
    candidate_summary:{type:'array',items:{type:'string'}},
    strengths_opportunities:{type:'string'},risks_challenges:{type:'string'},points_to_validate:{type:'array',items:{type:'string'}},
    experience_relevance:{type:'array',items:{type:'object',additionalProperties:false,required:['company_name','title','relevance'],properties:{company_name:{type:'string'},title:{type:'string'},relevance:{type:'array',items:{type:'string'}}}}},
    requirement_evidence:{type:'array',items:{type:'object',additionalProperties:false,required:['requirement','classification','source','source_path','excerpt','explanation'],properties:{
      requirement:{type:'string'},classification:{type:'string',enum:['matched','partial','missing','uncertain']},source:{type:'string',enum:['candidate_record','candidate_cv','interview_notes','none']},source_path:{type:'string'},excerpt:{type:'string'},explanation:{type:'string'},
      // Echoed back so each judgment can be tied to the row the recruiter actually authored. Not
      // required by the provider schema: the unstructured fallback has no ids to echo.
      requirement_id:{type:'string'},
    }}},
  },
} as const

/* SCORING CONTRACT -- keep byte-identical with src/features/candidates/candidateProfile.ts.
 * The Deno edge runtime cannot import from src/, so this block exists twice. Nothing but the parity
 * test in candidateProfile.test.ts stops the two from drifting, which would mean the score written
 * into ai_evaluations and the score the consultant reads on screen disagreeing. */
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

/* Casefolded and whitespace-collapsed on both sides. A model that re-wraps a quotation or normalises
 * a double space has not fabricated anything, and rejecting a whole paid generation over that would
 * be pedantry; a quotation that is simply not in the notes is a different thing entirely. */
function normalizeForExcerptMatch(value:string){return value.toLowerCase().replace(/\s+/g,' ').trim()}

export function validateCandidateProfileDraft(value:unknown,requirements?:readonly ScoredRequirement[],interviewNotes?:string|null):CandidateProfileDraft{
  const notesHaystack=interviewNotes?normalizeForExcerptMatch(interviewNotes):''
  if(!value||typeof value!=='object')throw new Error('Profile result must be an object.')
  const raw=value as Record<string,unknown>;const strings=(input:unknown)=>Array.isArray(input)?input.filter((item):item is string=>typeof item==='string'&&item.trim().length>0).map((item)=>item.trim()):[]
  const classifications=new Set(['matched','partial','missing','uncertain']);const sources=new Set(['candidate_record','candidate_cv','interview_notes','none'])
  const known=new Map((requirements||[]).map((requirement)=>[requirement.id,requirement]))
  const evidence=Array.isArray(raw.requirement_evidence)?raw.requirement_evidence.map((entry)=>{
    const item=entry as Record<string,unknown>;const classification=String(item.classification||'');const source=String(item.source||'')
    if(!String(item.requirement||'').trim()||!classifications.has(classification)||!sources.has(source)||!String(item.explanation||'').trim())throw new Error('Profile evidence is invalid.')
    const excerpt=String(item.excerpt||'').trim().slice(0,300);const sourcePath=String(item.source_path||'').trim()
    if(source==='none'&&(excerpt||sourcePath))throw new Error('Missing evidence cannot cite a source.')
    if(source==='candidate_record'&&(!sourcePath.startsWith('candidate.')||!excerpt))throw new Error('Candidate evidence must cite an exact candidate field and excerpt.')
    if(source==='candidate_cv'&&(!sourcePath.startsWith('cv.')||!excerpt))throw new Error('CV evidence must cite a CV location and excerpt.')
    if(source==='interview_notes'){
      if(!sourcePath.startsWith('notes.')||!excerpt)throw new Error('Interview note evidence must cite a notes location and excerpt.')
      // Citing notes that were never supplied, or quoting words that are not in them, is fabrication
      // backing a requirement the recruiter is about to send to a client. Rejected, not downgraded.
      if(!notesHaystack)throw new Error('Interview note evidence was cited, but no interview notes were supplied.')
      if(!notesHaystack.includes(normalizeForExcerptMatch(excerpt)))throw new Error('Interview note evidence quoted text that does not appear in the supplied notes.')
    }
    const requirementId=String(item.requirement_id||'').trim()
    const level=known.get(requirementId)?.requirement_level
    /* A requirement_id that was never sent is fabrication, not sloppiness -- it would attach a real
     * judgment to a requirement nobody wrote. Rejected outright, in the same spirit as the interview
     * analysis validator refusing citations of records that were not in its manifest. */
    if(requirements&&requirements.length&&requirementId&&!known.has(requirementId))throw new Error('Profile evidence cited a requirement that was not supplied.')
    return {
      requirement:String(item.requirement).trim(),classification:classification as EvidenceClassification,
      source:source as EvidenceSource,source_path:sourcePath,excerpt,explanation:String(item.explanation).trim(),
      ...(requirementId?{requirement_id:requirementId}:{}),
      // Level is taken from the supplied requirement, never from the model: it decides how heavily
      // this entry counts, so it is not something the output is allowed to influence.
      ...(level?{requirement_level:level}:{}),
    } as CandidateRequirementEvidence
  }):[]
  if(!evidence.length)throw new Error('Profile result did not evaluate any role requirements.')

  /* A requirement the model simply did not return. Scoring over what came back would silently shrink
   * the denominator and reward the omission, so the row is restored -- as an explicit non-assessment,
   * never as a judgment. 'uncertain' rather than 'missing': nothing here says the candidate lacks it,
   * only that this run did not say either way. Backfilling costs nothing a rerun would recover and
   * keeps a usable draft, where rejecting the whole generation would spend the call again to punish
   * the consultant for the model's omission. */
  if(requirements&&requirements.length){
    const returned=new Set(evidence.map((item)=>item.requirement_id).filter(Boolean))
    for(const requirement of requirements){
      if(returned.has(requirement.id))continue
      evidence.push({
        requirement:requirementLabel(requirement),classification:'uncertain',source:'none',source_path:'',excerpt:'',
        explanation:'Not assessed: the evaluation did not return a judgment for this requirement.',
        requirement_id:requirement.id,requirement_level:requirement.requirement_level,
      })
    }
    evidence.sort((left,right)=>orderOf(left.requirement_id,requirements)-orderOf(right.requirement_id,requirements))
  }

  const experience=Array.isArray(raw.experience_relevance)?raw.experience_relevance.map((entry)=>{const item=entry as Record<string,unknown>;return {company_name:String(item.company_name||'').trim(),title:String(item.title||'').trim(),relevance:strings(item.relevance)}}):[]
  const summary=strings(raw.candidate_summary);if(!summary.length)throw new Error('Profile result has no candidate summary.')
  return {
    candidate_summary:summary,strengths_opportunities:String(raw.strengths_opportunities||'').trim(),
    risks_challenges:String(raw.risks_challenges||'').trim(),points_to_validate:strings(raw.points_to_validate),
    experience_relevance:experience,requirement_evidence:evidence,
    // Both computed here and never read from the model, exactly as the score always has been.
    score:calculateEvidenceScore(evidence,requirements),
    must_have_coverage:calculateMustHaveCoverage(evidence,requirements),
    requirements_source:requirements&&requirements.length?'structured':'unstructured',
  }
}

/* The label is carried on ScoredRequirement only when the caller has it; the edge function always
 * does. Falls back to the id so a backfilled row is never blank on screen. */
function requirementLabel(requirement:ScoredRequirement){return requirement.label?.trim()||requirement.id}

function orderOf(requirementId:string|undefined,requirements:readonly ScoredRequirement[]){
  const index=requirementId?requirements.findIndex((requirement)=>requirement.id===requirementId):-1
  // Entries with no id sort last rather than interleaving unpredictably.
  return index<0?requirements.length:index
}
