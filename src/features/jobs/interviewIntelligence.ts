import {z} from 'zod'
import type {InterviewNotesStatus,RubricRating,TranscriptStatus} from '../../shared/types/domain'

/* Client-side shape of what interview-transcript and analyze-interview write.
 *
 * Mirrors supabase/functions/_shared/interview-schema.ts. The two are deliberately separate files
 * rather than one shared import: the Edge Functions run on Deno and cannot import from src/, and the
 * validator there enforces provider output while the schema here defends the UI against a row that
 * predates a prompt version. Both are permissive about extra keys and strict about the fields the UI
 * actually renders, so an older draft still displays instead of blanking the card.
 */

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

export const RUBRIC_LABELS:Record<string,string>={
  role_and_process_explained:'Explained the role and the process',
  structured_competency_questions:'Asked structured, role-relevant questions',
  probed_vague_answers:'Followed up on vague or unsupported answers',
  motivation_and_notice_period:'Covered motivation and notice period',
  salary_expectation:'Covered salary expectations',
  candidate_questions_answered:'Answered the candidate’s questions',
  talk_time_balance:'Left the candidate room to talk',
  bias_safe_questioning:'Avoided protected-characteristic questions',
}

export type {InterviewNotesStatus,RubricRating,TranscriptStatus}

const quotedPointSchema=z.object({point:z.string(),quote:z.string().default('')})

export const interviewNotesDraftSchema=z.object({
  detected_language:z.string().default(''),
  summary:z.object({
    headline:z.string(),
    key_points:z.array(z.string()).default([]),
    topics_covered:z.array(z.object({topic:z.string(),notes:z.string().default('')})).default([]),
    candidate_stated_facts:z.array(quotedPointSchema).default([]),
    logistics:z.object({
      notice_period:z.string().default(''),salary_expectation:z.string().default(''),
      location_preference:z.string().default(''),availability:z.string().default(''),
    }).default({notice_period:'',salary_expectation:'',location_preference:'',availability:''}),
  }),
  candidate_assessment:z.object({
    requirement_evidence:z.array(z.object({
      requirement:z.string(),
      classification:z.enum(['matched','partial','missing','uncertain']),
      quote:z.string().default(''),explanation:z.string().default(''),
    })).default([]),
    strengths:z.array(quotedPointSchema).default([]),
    concerns:z.array(quotedPointSchema).default([]),
    open_questions:z.array(z.string()).default([]),
    recommendation_note:z.string().default(''),
  }),
  consultant_assessment:z.object({
    rubric:z.array(z.object({
      criterion:z.string(),rating:z.enum(['strong','adequate','needs_work','not_observed']),
      evidence_quote:z.string().default(''),coaching_note:z.string().default(''),
    })).default([]),
    missed_topics:z.array(z.string()).default([]),
  }),
  score:z.number().default(0),
  rating_summary:z.object({
    strong:z.number().default(0),adequate:z.number().default(0),
    needs_work:z.number().default(0),not_observed:z.number().default(0),index:z.number().default(0),
  }).default({strong:0,adequate:0,needs_work:0,not_observed:0,index:0}),
})
export type InterviewNotesDraft=z.infer<typeof interviewNotesDraftSchema>

export const interviewTranscriptSchema=z.object({
  id:z.string(),interview_id:z.string(),status:z.enum(['pending','fetching','ready','unavailable','failed']),
  language:z.string().nullable(),
  talk_time:z.object({consultant_ms:z.number().default(0),candidate_ms:z.number().default(0),other_ms:z.number().default(0)})
    .default({consultant_ms:0,candidate_ms:0,other_ms:0}),
  duration_seconds:z.number(),entry_count:z.number(),attempts:z.number(),
  next_attempt_at:z.string(),failure_code:z.string().nullable(),failure_message:z.string().nullable(),
  fetched_at:z.string().nullable(),
})
export type InterviewTranscript=z.infer<typeof interviewTranscriptSchema>

export const interviewAiNotesSchema=z.object({
  id:z.string(),interview_id:z.string(),version:z.number(),
  status:z.enum(['draft','accepted']),score:z.number().nullable(),language:z.string().nullable(),
  degraded_reason:z.string().nullable(),
  generated_content:interviewNotesDraftSchema,
  reviewed_content:interviewNotesDraftSchema.nullable(),
  accepted_at:z.string().nullable(),created_at:z.string(),
})
export type InterviewAiNotes=z.infer<typeof interviewAiNotesSchema>

export const interviewCoachingReviewSchema=z.object({
  id:z.string(),interview_id:z.string(),interview_ai_notes_id:z.string(),subject_member_id:z.string().nullable(),
  rubric:z.array(z.object({
    criterion:z.string(),rating:z.enum(['strong','adequate','needs_work','not_observed']),
    evidence_quote:z.string().default(''),coaching_note:z.string().default(''),
  })).default([]),
  rating_summary:z.object({
    strong:z.number().default(0),adequate:z.number().default(0),
    needs_work:z.number().default(0),not_observed:z.number().default(0),index:z.number().default(0),
  }).default({strong:0,adequate:0,needs_work:0,not_observed:0,index:0}),
  missed_topics:z.array(z.string()).default([]),
  created_at:z.string(),
})
export type InterviewCoachingReview=z.infer<typeof interviewCoachingReviewSchema>

/** What the review UI shows: the consultant's edits when they exist, the model's draft otherwise. */
export function currentNotesContent(notes:InterviewAiNotes):InterviewNotesDraft{
  return notes.reviewed_content||notes.generated_content
}

/* A transcript in 'pending' or 'fetching' is still coming, which is what the polling interval keys
 * off. Everything else is settled and stops the poll -- including 'unavailable', which is a real
 * answer (Meet produced no transcript) rather than a state that resolves by waiting longer. */
export const transcriptInFlight=(status:TranscriptStatus|undefined)=>status==='pending'||status==='fetching'

export function talkSharePercent(talkTime:InterviewTranscript['talk_time']){
  const total=talkTime.consultant_ms+talkTime.candidate_ms+talkTime.other_ms
  if(!total)return null
  return {
    consultant:Math.round((talkTime.consultant_ms/total)*100),
    candidate:Math.round((talkTime.candidate_ms/total)*100),
    other:Math.round((talkTime.other_ms/total)*100),
  }
}
