import {z} from 'zod'

const optionalString=z.string().trim().nullable().default(null)
const datePrecision=z.enum(['day','month','year']).nullable().default(null)
const dateValue=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null)

export const cvEmploymentSchema=z.object({
  company_name:z.string().trim().min(1),title:z.string().trim().min(1),location:optionalString,
  started_on:dateValue,ended_on:dateValue,is_current:z.boolean().default(false),summary:optionalString,
  started_on_precision:datePrecision,ended_on_precision:datePrecision,sort_order:z.number().int().nonnegative().default(0),
})
export const cvEducationSchema=z.object({
  institution:z.string().trim().min(1),degree:optionalString,field_of_study:optionalString,
  started_on:dateValue,ended_on:dateValue,started_on_precision:datePrecision,ended_on_precision:datePrecision,
  sort_order:z.number().int().nonnegative().default(0),
})
export const cvSkillSchema=z.object({name:z.string().trim().min(1),proficiency:optionalString,years_experience:z.number().nonnegative().nullable().default(null)})
export const cvLanguageSchema=z.object({language:z.string().trim().min(1),proficiency:optionalString})

export const candidateCvExtractionSchema=z.object({
  full_name:z.string().trim().default(''),current_company:optionalString,current_position:optionalString,location:optionalString,
  linkedin_url:optionalString,portfolio_url:optionalString,source:optionalString,availability:optionalString,
  notice_period_days:z.number().int().nonnegative().nullable().default(null),
  private:z.object({
    email:optionalString,phone:optionalString,current_salary:z.number().nonnegative().nullable().default(null),
    expected_salary:z.number().nonnegative().nullable().default(null),salary_currency:optionalString,work_authorization:optionalString,
  }),
  employment:z.array(cvEmploymentSchema).default([]),education:z.array(cvEducationSchema).default([]),
  skills:z.array(cvSkillSchema).default([]),languages:z.array(cvLanguageSchema).default([]),
  field_evidence:z.record(z.string(),z.object({confidence:z.enum(['high','medium','low']),evidence:z.string().trim().nullable()})).default({}),
  uncertainties:z.array(z.string().trim()).default([]),
})

export type CandidateCvExtraction=z.infer<typeof candidateCvExtractionSchema>
export type CvParseStatus='uploaded'|'processing'|'ready'|'failed'|'accepted'|'cancelled'|'expired'
export type CvParseResult={
  id:string;status:CvParseStatus;extraction:CandidateCvExtraction|null;errorCode:string|null;errorMessage:string|null;
  matchedCandidate:{id:string;full_name:string;current_position:string|null;current_company:string|null}|null;
}

export const emptyCandidateCvExtraction:CandidateCvExtraction={
  full_name:'',current_company:null,current_position:null,location:null,linkedin_url:null,portfolio_url:null,source:'CV upload',
  availability:null,notice_period_days:null,private:{email:null,phone:null,current_salary:null,expected_salary:null,salary_currency:null,work_authorization:null},
  employment:[],education:[],skills:[],languages:[],field_evidence:{},uncertainties:[],
}

export function confidenceFor(extraction:CandidateCvExtraction,path:string){return extraction.field_evidence[path]?.confidence}
