import {calculateEvidenceScore,type EvidenceClassification} from './profile-schema.ts'

/* The structured output of one reading of an interview transcript.
 *
 * One provider call produces all three blocks. Splitting them into three calls would triple the cost
 * of sending the same transcript three times, for judgements that are better made against the whole
 * conversation anyway -- whether the consultant probed a vague answer is a fact about the same
 * exchange the candidate assessment is drawing on.
 *
 * Every judgement carries a quote. That is the mechanism, not decoration: a claim with no supporting
 * line in the transcript is the failure mode this feature has to avoid, given it produces both a
 * hiring input and a review of a named member of staff.
 */

export type RubricRating='strong'|'adequate'|'needs_work'|'not_observed'

/* Fixed and versioned with the prompt. A stable key set is what makes these reviews comparable
 * across interviews and consultants later; a model free to invent criteria produces a rubric that
 * cannot be aggregated and quietly moves the goalposts between calls. */
export const RUBRIC_CRITERIA=[
  'role_and_process_explained',
  'structured_competency_questions',
  'probed_vague_answers',
  'motivation_and_notice_period',
  'salary_expectation',
  'candidate_questions_answered',
  'talk_time_balance',
  'bias_safe_questioning',
] as const
export type RubricCriterion=typeof RUBRIC_CRITERIA[number]

export const RUBRIC_LABELS:Record<RubricCriterion,string>={
  role_and_process_explained:'Explained the role and the process',
  structured_competency_questions:'Asked structured, role-relevant questions',
  probed_vague_answers:'Followed up on vague or unsupported answers',
  motivation_and_notice_period:'Covered motivation and notice period',
  salary_expectation:'Covered salary expectations',
  candidate_questions_answered:'Answered the candidate’s questions',
  talk_time_balance:'Left the candidate room to talk',
  bias_safe_questioning:'Avoided protected-characteristic questions',
}

export interface InterviewRequirementEvidence {requirement:string;classification:EvidenceClassification;quote:string;explanation:string}
export interface QuotedPoint {point:string;quote:string}
export interface RubricEntry {criterion:RubricCriterion;rating:RubricRating;evidence_quote:string;coaching_note:string}

export interface InterviewNotesDraft {
  detected_language:string
  summary:{
    headline:string
    key_points:string[]
    topics_covered:{topic:string;notes:string}[]
    candidate_stated_facts:QuotedPoint[]
    logistics:{notice_period:string;salary_expectation:string;location_preference:string;availability:string}
  }
  candidate_assessment:{
    requirement_evidence:InterviewRequirementEvidence[]
    strengths:QuotedPoint[]
    concerns:QuotedPoint[]
    open_questions:string[]
    recommendation_note:string
  }
  consultant_assessment:{
    rubric:RubricEntry[]
    missed_topics:string[]
  }
  score:number
  rating_summary:RatingSummary
}

export interface RatingSummary {strong:number;adequate:number;needs_work:number;not_observed:number;index:number}

const quotedPoint={type:'object',additionalProperties:false,required:['point','quote'],properties:{point:{type:'string'},quote:{type:'string'}}} as const

export const interviewNotesJsonSchema={
  type:'object',additionalProperties:false,
  required:['detected_language','summary','candidate_assessment','consultant_assessment'],
  properties:{
    detected_language:{type:'string'},
    summary:{
      type:'object',additionalProperties:false,
      required:['headline','key_points','topics_covered','candidate_stated_facts','logistics'],
      properties:{
        headline:{type:'string'},
        key_points:{type:'array',items:{type:'string'}},
        topics_covered:{type:'array',items:{type:'object',additionalProperties:false,required:['topic','notes'],properties:{topic:{type:'string'},notes:{type:'string'}}}},
        candidate_stated_facts:{type:'array',items:quotedPoint},
        logistics:{type:'object',additionalProperties:false,required:['notice_period','salary_expectation','location_preference','availability'],properties:{
          notice_period:{type:'string'},salary_expectation:{type:'string'},location_preference:{type:'string'},availability:{type:'string'},
        }},
      },
    },
    candidate_assessment:{
      type:'object',additionalProperties:false,
      required:['requirement_evidence','strengths','concerns','open_questions','recommendation_note'],
      properties:{
        requirement_evidence:{type:'array',items:{type:'object',additionalProperties:false,required:['requirement','classification','quote','explanation'],properties:{
          requirement:{type:'string'},classification:{type:'string',enum:['matched','partial','missing','uncertain']},quote:{type:'string'},explanation:{type:'string'},
        }}},
        strengths:{type:'array',items:quotedPoint},
        concerns:{type:'array',items:quotedPoint},
        open_questions:{type:'array',items:{type:'string'}},
        recommendation_note:{type:'string'},
      },
    },
    consultant_assessment:{
      type:'object',additionalProperties:false,
      required:['rubric','missed_topics'],
      properties:{
        rubric:{type:'array',items:{type:'object',additionalProperties:false,required:['criterion','rating','evidence_quote','coaching_note'],properties:{
          criterion:{type:'string',enum:RUBRIC_CRITERIA as unknown as string[]},
          rating:{type:'string',enum:['strong','adequate','needs_work','not_observed']},
          evidence_quote:{type:'string'},coaching_note:{type:'string'},
        }}},
        missed_topics:{type:'array',items:{type:'string'}},
      },
    },
  },
} as const

const ratingWeight:Record<RubricRating,number|null>={strong:1,adequate:.6,needs_work:.2,not_observed:null}

/* An index over the criteria that were actually observable. 'not_observed' is excluded rather than
 * scored zero: a 20-minute screening call that never reaches salary has not been conducted badly,
 * and averaging the gap in would punish the format instead of the interviewer. */
export function summarizeRubric(rubric:RubricEntry[]):RatingSummary{
  const summary:RatingSummary={strong:0,adequate:0,needs_work:0,not_observed:0,index:0}
  let total=0;let counted=0
  for(const entry of rubric){
    summary[entry.rating]+=1
    const weight=ratingWeight[entry.rating]
    if(weight!==null){total+=weight;counted+=1}
  }
  summary.index=counted?Math.round(total/counted*100):0
  return summary
}

function strings(value:unknown,limit=40){
  return Array.isArray(value)?value.filter((item):item is string=>typeof item==='string'&&item.trim().length>0).map((item)=>item.trim().slice(0,600)).slice(0,limit):[]
}

function quotedPoints(value:unknown,limit=20):QuotedPoint[]{
  if(!Array.isArray(value))return []
  return value.map((entry)=>{
    const item=(entry||{}) as Record<string,unknown>
    return {point:String(item.point||'').trim().slice(0,600),quote:String(item.quote||'').trim().slice(0,600)}
  }).filter((item)=>item.point!=='').slice(0,limit)
}

export function validateInterviewNotes(value:unknown):InterviewNotesDraft{
  if(!value||typeof value!=='object')throw new Error('Interview notes must be an object.')
  const raw=value as Record<string,unknown>
  const summary=(raw.summary||{}) as Record<string,unknown>
  const headline=String(summary.headline||'').trim().slice(0,2000)
  if(!headline)throw new Error('Interview notes have no summary headline.')

  const candidate=(raw.candidate_assessment||{}) as Record<string,unknown>
  const classifications=new Set(['matched','partial','missing','uncertain'])
  const evidence=Array.isArray(candidate.requirement_evidence)?candidate.requirement_evidence.map((entry)=>{
    const item=(entry||{}) as Record<string,unknown>
    const requirement=String(item.requirement||'').trim()
    const classification=String(item.classification||'')
    if(!requirement||!classifications.has(classification))throw new Error('Interview requirement evidence is invalid.')
    const quote=String(item.quote||'').trim().slice(0,600)
    // Same rule the candidate-profile validator enforces: a positive finding has to point at
    // something that was actually said, or it is an inference wearing evidence's clothes.
    if((classification==='matched'||classification==='partial')&&!quote)throw new Error('Supported requirement evidence must quote the transcript.')
    return {requirement:requirement.slice(0,600),classification:classification as EvidenceClassification,quote,explanation:String(item.explanation||'').trim().slice(0,1000)}
  }).slice(0,40):[]

  const consultant=(raw.consultant_assessment||{}) as Record<string,unknown>
  const seen=new Map<RubricCriterion,RubricEntry>()
  if(Array.isArray(consultant.rubric)){
    for(const entry of consultant.rubric){
      const item=(entry||{}) as Record<string,unknown>
      const criterion=String(item.criterion||'') as RubricCriterion
      if(!RUBRIC_CRITERIA.includes(criterion)||seen.has(criterion))continue
      const rating=String(item.rating||'not_observed') as RubricRating
      const safeRating:RubricRating=(['strong','adequate','needs_work','not_observed'] as string[]).includes(rating)?rating:'not_observed'
      const quote=String(item.evidence_quote||'').trim().slice(0,600)
      seen.set(criterion,{
        criterion,
        // A rating with nothing behind it is downgraded rather than dropped: the criterion still
        // belongs in the rubric, but it is not evidence of anything.
        rating:safeRating!=='not_observed'&&!quote?'not_observed':safeRating,
        evidence_quote:quote,
        coaching_note:String(item.coaching_note||'').trim().slice(0,1000),
      })
    }
  }
  // A criterion the model simply omitted is 'not_observed', so the rubric is always the full set.
  const rubric=RUBRIC_CRITERIA.map((criterion)=>seen.get(criterion)||{criterion,rating:'not_observed' as RubricRating,evidence_quote:'',coaching_note:''})

  return {
    detected_language:String(raw.detected_language||'').trim().slice(0,32),
    summary:{
      headline,
      key_points:strings(summary.key_points),
      topics_covered:Array.isArray(summary.topics_covered)?summary.topics_covered.map((entry)=>{
        const item=(entry||{}) as Record<string,unknown>
        return {topic:String(item.topic||'').trim().slice(0,200),notes:String(item.notes||'').trim().slice(0,2000)}
      }).filter((item)=>item.topic!=='').slice(0,20):[],
      candidate_stated_facts:quotedPoints(summary.candidate_stated_facts,30),
      logistics:{
        notice_period:String((summary.logistics as Record<string,unknown>|undefined)?.notice_period||'').trim().slice(0,300),
        salary_expectation:String((summary.logistics as Record<string,unknown>|undefined)?.salary_expectation||'').trim().slice(0,300),
        location_preference:String((summary.logistics as Record<string,unknown>|undefined)?.location_preference||'').trim().slice(0,300),
        availability:String((summary.logistics as Record<string,unknown>|undefined)?.availability||'').trim().slice(0,300),
      },
    },
    candidate_assessment:{
      requirement_evidence:evidence,
      strengths:quotedPoints(candidate.strengths),
      concerns:quotedPoints(candidate.concerns),
      open_questions:strings(candidate.open_questions),
      recommendation_note:String(candidate.recommendation_note||'').trim().slice(0,2000),
    },
    consultant_assessment:{rubric,missed_topics:strings(consultant.missed_topics,20)},
    // Both derived, never taken from the model -- same rule the candidate profile follows.
    score:calculateEvidenceScore(evidence.map((item)=>({requirement:item.requirement,classification:item.classification,source:'none' as const,source_path:'',excerpt:'',explanation:item.explanation}))),
    rating_summary:summarizeRubric(rubric),
  }
}
