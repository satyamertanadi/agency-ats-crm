import {z} from 'zod'

// Client-side mirror of _shared/profile-schema.ts, used to validate the edge
// function response and to type the editable review form + docx builder input.
export const candidateProfileAnalysisSchema=z.object({
  candidate_summary:z.array(z.string()).default([]),
  strengths_opportunities:z.string().default(''),
  risks_challenges:z.string().default(''),
  points_to_validate:z.array(z.string()).default([]),
  experience_relevance:z.array(z.object({
    company_name:z.string().default(''),
    title:z.string().default(''),
    relevance:z.array(z.string()).default([]),
  })).default([]),
})

export type CandidateProfileAnalysis=z.infer<typeof candidateProfileAnalysisSchema>

export type CandidateProfileJob={id:string;title:string;company_name:string|null}
