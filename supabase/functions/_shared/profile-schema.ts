// JSON schema + types for the AI-drafted analytical sections of a client-facing
// candidate profile. Only the narrative/analysis is generated here; all factual
// fields (name, employment, education, languages) come from the candidate record.
export const candidateProfileJsonSchema={
  type:'object',additionalProperties:false,
  required:['candidate_summary','strengths_opportunities','risks_challenges','points_to_validate','experience_relevance'],
  properties:{
    candidate_summary:{type:'array',items:{type:'string'},description:'2-4 short paragraphs for the CANDIDATE SUMMARY section.'},
    strengths_opportunities:{type:'string',description:'One concise sentence or two for the Strengths & Opportunities row.'},
    risks_challenges:{type:'string',description:'One concise sentence or two for the Risks & Challenge row.'},
    points_to_validate:{type:'array',items:{type:'string'},description:'Short items still to confirm with the candidate for this specific role.'},
    experience_relevance:{type:'array',items:{
      type:'object',additionalProperties:false,required:['company_name','title','relevance'],
      properties:{
        company_name:{type:'string'},title:{type:'string'},
        relevance:{type:'array',items:{type:'string'},description:'1-3 lines on why this role is relevant to the target job.'},
      },
    },description:'One entry per employment history item, in the same order as provided.'},
  },
} as const

export interface CandidateProfileAnalysis {
  candidate_summary:string[]
  strengths_opportunities:string
  risks_challenges:string
  points_to_validate:string[]
  experience_relevance:{company_name:string;title:string;relevance:string[]}[]
}
