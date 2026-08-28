/* The contract between the analysis model and the database.
 *
 * Two things are enforced here rather than asked for in the prompt, because a prompt is a request and
 * this has to be a guarantee:
 *
 * 1. Every evidence reference is resolved against a manifest of ids that were actually sent to the
 *    model. A citation of a transcript segment that does not exist, a CV row belonging to a different
 *    candidate, or an id from another workspace fails the run. This is what makes "never invent
 *    quotes" true rather than merely instructed.
 * 2. Protected characteristics are unrepresentable and then re-checked. The finding category is a
 *    closed enum with no slot for age, ethnicity, personality, emotion or honesty, and the free text
 *    is scanned afterwards in case the model tries to say it anyway.
 *
 * The other invariant that lives here is the one the whole feature exists to protect: `not_evidenced`
 * is a distinct result from `not_met`, and a candidate assessment may not be downgraded because the
 * consultant failed to ask something.
 */

export const INTERVIEW_ANALYSIS_PROMPT_VERSION='interview-analysis-v1'

export type CandidateBand='strong_evidence_of_fit'|'promising_but_incomplete'|'material_concerns'|'clear_mismatch'|'insufficient_evidence'
export type ConsultantBand='strong'|'effective'|'needs_development'|'needs_attention'|'insufficient_evidence'
export type Confidence='low'|'medium'|'high'
export type Severity='info'|'coaching'|'attention'|'critical'
export type EvidenceSourceType='transcript_entry'|'candidate_cv'|'candidate_field'|'job_brief'

export const CONSULTANT_DIMENSIONS=['essential_coverage','question_quality','listening_balance','role_presentation','next_step_clarity'] as const
export type ConsultantDimension=typeof CONSULTANT_DIMENSIONS[number]

export const CANDIDATE_RESULTS=['met','partially_met','not_evidenced','contradicted','not_applicable'] as const
export const CONSULTANT_RESULTS=['strong','effective','needs_development','needs_attention','insufficient_evidence','observation'] as const

export interface EvidenceRef {
  source_type:EvidenceSourceType
  source_record_id:string|null
  source_locator:string|null
  excerpt:string|null
}

export interface CandidateFinding {
  rubric_item_id:string|null
  requirement:string
  result:typeof CANDIDATE_RESULTS[number]
  confidence:Confidence
  explanation:string
  verification_question:string|null
  evidence:EvidenceRef[]
}

export interface ConsultantFinding {
  dimension:ConsultantDimension
  rubric_item_id:string|null
  result:typeof CONSULTANT_RESULTS[number]
  score:number
  severity:Severity
  confidence:Confidence
  title:string
  summary:string
  coaching_suggestion:string|null
  evidence:EvidenceRef[]
}

export interface ConsultantAssessmentOutput {
  subject_member_id:string
  overall_band:ConsultantBand
  confidence:Confidence
  summary:string
  findings:ConsultantFinding[]
}

export interface InterviewAnalysisOutput {
  candidate:{
    overall_band:CandidateBand
    confidence:Confidence
    summary:string
    strongest_evidence:string[]
    missing_information:string[]
    contradictions:string[]
    recommended_verification:string[]
    findings:CandidateFinding[]
  }
  consultants:ConsultantAssessmentOutput[]
}

/* The manifest of what the model was actually given. Validation is an intersection against this, not
 * a plausibility check: an id the worker never sent cannot have been read, so citing it is a
 * fabrication regardless of how reasonable it looks. */
export interface AnalysisSourceManifest {
  transcriptEntryIds:Set<string>
  candidateCvSourceIds:Set<string>
  candidateFieldNames:Set<string>
  rubricItemIds:Set<string>
  consultantMemberIds:Set<string>
  jobId:string
}

const MAX_EXCERPT=1000
const MAX_SUMMARY=4000
const MAX_TITLE=300
const MAX_LIST_ITEM=600
const MAX_FINDINGS=200

/* Protected and prohibited inference. The finding categories are already a closed enum with no slot
 * for any of this, so a compliant model cannot express it structurally -- this scan is the second
 * gate, for free text that tries to say it anyway.
 *
 * Word-boundary matched and deliberately narrow. "Age" must not fire on "manage", and a legitimate
 * observation about a candidate's stated notice period must not be blocked because it contains the
 * word "married" in a quote. The cost of a false positive here is a failed run a human has to look
 * at; the cost of a false negative is the product inferring something it promised never to infer. */
const PROHIBITED_PATTERNS:{label:string;pattern:RegExp}[]=[
  {label:'age',pattern:/\b(?:appears|seems|likely|probably|estimated)\s+(?:to\s+be\s+)?(?:around\s+)?\d{2}\s*(?:years\s+old|yo)\b/i},
  {label:'age',pattern:/\b(?:too\s+(?:old|young)|age\s+(?:group|bracket)|generational\s+fit)\b/i},
  {label:'ethnicity',pattern:/\b(?:ethnicity|ethnic\s+background|race|racial|nationality\s+suggests)\b/i},
  {label:'religion',pattern:/\b(?:religion|religious\s+(?:belief|background)|appears\s+to\s+be\s+(?:muslim|christian|hindu|jewish|buddhist))\b/i},
  {label:'disability',pattern:/\b(?:disability|disabled|impairment|medical\s+condition|health\s+condition)\b/i},
  {label:'pregnancy',pattern:/\b(?:pregnan\w+|maternity\s+risk|likely\s+to\s+take\s+leave)\b/i},
  {label:'marital_status',pattern:/\b(?:marital\s+status|married|divorced|single\s+parent)\b/i},
  {label:'sexual_orientation',pattern:/\b(?:sexual\s+orientation|homosexual|heterosexual)\b/i},
  {label:'political_belief',pattern:/\b(?:political\s+(?:belief|affiliation|leaning)|votes?\s+for)\b/i},
  {label:'personality',pattern:/\b(?:personality\s+(?:type|trait|score)|introvert|extrovert|myers[- ]briggs|big\s+five)\b/i},
  {label:'emotion',pattern:/\b(?:sounded\s+(?:anxious|nervous|angry|upset)|emotional\s+state|appeared\s+stressed)\b/i},
  {label:'honesty',pattern:/\b(?:appears\s+(?:dishonest|untruthful)|likely\s+lying|deception|being\s+deceptive)\b/i},
  {label:'accent',pattern:/\b(?:accent|pronunciation\s+suggests|non[- ]native\s+speaker)\b/i},
  {label:'attractiveness',pattern:/\b(?:attractive|good[- ]looking|appearance\s+is)\b/i},
]

export class AnalysisValidationError extends Error {
  code:string
  details:string[]
  constructor(code:string,details:string[]){
    super(`${code}: ${details.slice(0,5).join('; ')}`)
    this.code=code
    this.details=details
    this.name='AnalysisValidationError'
  }
}

export function validateAnalysisOutput(raw:unknown,manifest:AnalysisSourceManifest):InterviewAnalysisOutput{
  const errors:string[]=[]
  if(!isRecord(raw))throw new AnalysisValidationError('malformed_output',['The analysis result was not an object.'])

  const candidateRaw=raw.candidate
  if(!isRecord(candidateRaw)){
    throw new AnalysisValidationError('malformed_output',['The analysis result had no candidate assessment.'])
  }

  const candidateFindingsRaw=Array.isArray(candidateRaw.findings)?candidateRaw.findings:[]
  if(candidateFindingsRaw.length>MAX_FINDINGS)errors.push('Too many candidate findings.')

  const candidateFindings:CandidateFinding[]=[]
  candidateFindingsRaw.slice(0,MAX_FINDINGS).forEach((item,index)=>{
    if(!isRecord(item)){errors.push(`candidate.findings[${index}] is not an object.`);return}
    const result=enumValue(item.result,CANDIDATE_RESULTS)
    if(!result){errors.push(`candidate.findings[${index}].result is not a supported classification.`);return}
    const confidence=enumValue(item.confidence,['low','medium','high'] as const)
    if(!confidence){errors.push(`candidate.findings[${index}].confidence is invalid.`);return}
    const rubricItemId=optionalId(item.rubric_item_id)
    if(rubricItemId&&!manifest.rubricItemIds.has(rubricItemId)){
      errors.push(`candidate.findings[${index}] cites rubric item ${rubricItemId}, which was not part of this analysis.`)
      return
    }
    const evidence=validateEvidence(item.evidence,manifest,`candidate.findings[${index}]`,errors)

    /* The invariant the whole feature exists to protect. `not_evidenced` means nobody asked; it is
     * not a soft form of `contradicted`, and it must not arrive carrying evidence that would make it
     * look like a tested and failed requirement. */
    if(result==='not_evidenced'&&evidence.length>0){
      errors.push(`candidate.findings[${index}] is marked not_evidenced but cites evidence.`)
      return
    }
    if((result==='met'||result==='partially_met'||result==='contradicted')&&evidence.length===0){
      errors.push(`candidate.findings[${index}] is marked ${result} but cites no evidence.`)
      return
    }

    candidateFindings.push({
      rubric_item_id:rubricItemId,
      requirement:boundedText(item.requirement,MAX_TITLE,`candidate.findings[${index}].requirement`,errors),
      result,
      confidence,
      explanation:boundedText(item.explanation,MAX_SUMMARY,`candidate.findings[${index}].explanation`,errors),
      verification_question:optionalBoundedText(item.verification_question,MAX_LIST_ITEM),
      evidence,
    })
  })

  const candidateBand=enumValue(candidateRaw.overall_band,['strong_evidence_of_fit','promising_but_incomplete','material_concerns','clear_mismatch','insufficient_evidence'] as const)
  if(!candidateBand)errors.push('candidate.overall_band is not a supported band.')
  const candidateConfidence=enumValue(candidateRaw.confidence,['low','medium','high'] as const)
  if(!candidateConfidence)errors.push('candidate.confidence is invalid.')

  const consultantsRaw=Array.isArray(raw.consultants)?raw.consultants:[]
  const consultants:ConsultantAssessmentOutput[]=[]
  const seenSubjects=new Set<string>()

  consultantsRaw.forEach((item,index)=>{
    if(!isRecord(item)){errors.push(`consultants[${index}] is not an object.`);return}
    const subject=optionalId(item.subject_member_id)
    if(!subject||!manifest.consultantMemberIds.has(subject)){
      // Attributing a finding to somebody who was not in this interview is the multi-consultant
      // failure mode: one colleague's behaviour landing on another's record.
      errors.push(`consultants[${index}] names ${subject??'no one'} as its subject, who is not a mapped consultant on this interview.`)
      return
    }
    if(seenSubjects.has(subject)){errors.push(`consultants[${index}] repeats subject ${subject}.`);return}
    seenSubjects.add(subject)

    const band=enumValue(item.overall_band,['strong','effective','needs_development','needs_attention','insufficient_evidence'] as const)
    if(!band){errors.push(`consultants[${index}].overall_band is not a supported band.`);return}
    const confidence=enumValue(item.confidence,['low','medium','high'] as const)
    if(!confidence){errors.push(`consultants[${index}].confidence is invalid.`);return}

    const findingsRaw=Array.isArray(item.findings)?item.findings:[]
    const findings:ConsultantFinding[]=[]
    findingsRaw.slice(0,MAX_FINDINGS).forEach((finding,findingIndex)=>{
      const path=`consultants[${index}].findings[${findingIndex}]`
      if(!isRecord(finding)){errors.push(`${path} is not an object.`);return}
      const dimension=enumValue(finding.dimension,CONSULTANT_DIMENSIONS)
      if(!dimension){errors.push(`${path}.dimension is not one of the five dimensions.`);return}
      const result=enumValue(finding.result,CONSULTANT_RESULTS)
      if(!result){errors.push(`${path}.result is not supported.`);return}
      const severity=enumValue(finding.severity,['info','coaching','attention','critical'] as const)
      if(!severity){errors.push(`${path}.severity is invalid.`);return}
      const findingConfidence=enumValue(finding.confidence,['low','medium','high'] as const)
      if(!findingConfidence){errors.push(`${path}.confidence is invalid.`);return}

      const score=finding.score
      if(typeof score!=='number'||!Number.isInteger(score)||score<0||score>4){
        errors.push(`${path}.score must be an integer between 0 and 4.`)
        return
      }

      const rubricItemId=optionalId(finding.rubric_item_id)
      if(rubricItemId&&!manifest.rubricItemIds.has(rubricItemId)){
        errors.push(`${path} cites rubric item ${rubricItemId}, which was not part of this analysis.`)
        return
      }

      const evidence=validateEvidence(finding.evidence,manifest,path,errors)
      /* A material judgement about how somebody interviewed has to point at the moment in the
       * transcript it is about. Anything else is an opinion the consultant cannot check. */
      if(severity!=='info'&&!evidence.some((reference)=>reference.source_type==='transcript_entry')){
        errors.push(`${path} is a ${severity} finding with no transcript evidence.`)
        return
      }

      findings.push({
        dimension,
        rubric_item_id:rubricItemId,
        result,
        score,
        severity,
        confidence:findingConfidence,
        title:boundedText(finding.title,MAX_TITLE,`${path}.title`,errors),
        summary:boundedText(finding.summary,MAX_SUMMARY,`${path}.summary`,errors),
        coaching_suggestion:optionalBoundedText(finding.coaching_suggestion,MAX_SUMMARY),
        evidence,
      })
    })

    consultants.push({
      subject_member_id:subject,
      overall_band:band,
      confidence,
      summary:boundedText(item.summary,MAX_SUMMARY,`consultants[${index}].summary`,errors),
      findings,
    })
  })

  const output:InterviewAnalysisOutput={
    candidate:{
      overall_band:candidateBand??'insufficient_evidence',
      confidence:candidateConfidence??'low',
      summary:boundedText(candidateRaw.summary,MAX_SUMMARY,'candidate.summary',errors),
      strongest_evidence:stringList(candidateRaw.strongest_evidence),
      missing_information:stringList(candidateRaw.missing_information),
      contradictions:stringList(candidateRaw.contradictions),
      recommended_verification:stringList(candidateRaw.recommended_verification),
      findings:candidateFindings,
    },
    consultants,
  }

  const prohibited=findProhibitedInference(output)
  if(prohibited.length){
    // Reported as its own code so the failure is legible in the logs as a policy breach rather than
    // as a generic schema problem.
    throw new AnalysisValidationError('prohibited_inference',prohibited)
  }

  if(errors.length)throw new AnalysisValidationError('invalid_analysis_output',errors)
  return output
}

function validateEvidence(raw:unknown,manifest:AnalysisSourceManifest,path:string,errors:string[]):EvidenceRef[]{
  if(!Array.isArray(raw))return []
  const refs:EvidenceRef[]=[]
  raw.forEach((item,index)=>{
    if(!isRecord(item)){errors.push(`${path}.evidence[${index}] is not an object.`);return}
    const sourceType=enumValue(item.source_type,['transcript_entry','candidate_cv','candidate_field','job_brief'] as const)
    if(!sourceType){errors.push(`${path}.evidence[${index}].source_type is not supported.`);return}

    const recordId=optionalId(item.source_record_id)
    const locator=optionalBoundedText(item.source_locator,300)

    /* The anti-hallucination boundary. Each branch checks membership of the manifest the worker
     * built from what it actually sent, so an id that was never in the prompt cannot be cited. */
    if(sourceType==='transcript_entry'){
      if(!recordId||!manifest.transcriptEntryIds.has(recordId)){
        errors.push(`${path}.evidence[${index}] cites transcript segment ${recordId??'(none)'}, which is not part of this interview.`)
        return
      }
    }else if(sourceType==='candidate_cv'){
      if(!recordId||!manifest.candidateCvSourceIds.has(recordId)){
        errors.push(`${path}.evidence[${index}] cites CV record ${recordId??'(none)'}, which does not belong to this candidate.`)
        return
      }
    }else if(sourceType==='candidate_field'){
      if(!locator||!manifest.candidateFieldNames.has(locator)){
        errors.push(`${path}.evidence[${index}] cites candidate field ${locator??'(none)'}, which was not supplied.`)
        return
      }
    }else if(recordId&&recordId!==manifest.jobId){
      errors.push(`${path}.evidence[${index}] cites job brief ${recordId}, which is not the job under analysis.`)
      return
    }

    const excerpt=optionalBoundedText(item.excerpt,MAX_EXCERPT)
    refs.push({source_type:sourceType,source_record_id:recordId,source_locator:locator,excerpt})
  })
  return refs
}

/* Scans everything a human will actually read. Structured fields are already closed enums, so this
 * only has to cover free text. */
function findProhibitedInference(output:InterviewAnalysisOutput):string[]{
  const texts:string[]=[
    output.candidate.summary,
    ...output.candidate.strongest_evidence,
    ...output.candidate.missing_information,
    ...output.candidate.contradictions,
    ...output.candidate.recommended_verification,
  ]
  for(const finding of output.candidate.findings){
    texts.push(finding.requirement,finding.explanation)
    if(finding.verification_question)texts.push(finding.verification_question)
  }
  for(const consultant of output.consultants){
    texts.push(consultant.summary)
    for(const finding of consultant.findings){
      texts.push(finding.title,finding.summary)
      if(finding.coaching_suggestion)texts.push(finding.coaching_suggestion)
    }
  }

  const hits:string[]=[]
  for(const text of texts){
    if(!text)continue
    for(const {label,pattern} of PROHIBITED_PATTERNS){
      if(pattern.test(text)){
        // The matched text is not echoed: it is a claim about a real person that must not be
        // duplicated into the logs.
        hits.push(`A finding referenced a prohibited category (${label}).`)
        break
      }
    }
  }
  return [...new Set(hits)]
}

function isRecord(value:unknown):value is Record<string,unknown>{return Boolean(value)&&typeof value==='object'&&!Array.isArray(value)}

function enumValue<T extends readonly string[]>(value:unknown,allowed:T):T[number]|null{
  return typeof value==='string'&&(allowed as readonly string[]).includes(value)?value as T[number]:null
}

function optionalId(value:unknown):string|null{
  if(typeof value!=='string')return null
  const trimmed=value.trim()
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)?trimmed.toLowerCase():null
}

function boundedText(value:unknown,max:number,path:string,errors:string[]):string{
  if(typeof value!=='string'||!value.trim()){errors.push(`${path} is required.`);return ''}
  const trimmed=value.trim()
  if(trimmed.length>max){errors.push(`${path} is longer than ${max} characters.`);return trimmed.slice(0,max)}
  return trimmed
}

function optionalBoundedText(value:unknown,max:number):string|null{
  if(typeof value!=='string')return null
  const trimmed=value.trim()
  if(!trimmed)return null
  return trimmed.slice(0,max)
}

function stringList(value:unknown):string[]{
  if(!Array.isArray(value))return []
  return value
    .filter((item):item is string=>typeof item==='string'&&Boolean(item.trim()))
    .map((item)=>item.trim().slice(0,MAX_LIST_ITEM))
    .slice(0,25)
}
