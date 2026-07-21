import {z} from 'zod'

// Shared by manual candidate entry (schemas.ts), CV-parse extraction (cvParsing.ts), and the
// candidate detail edit form -- these three forms used to define overlapping rules independently
// and had drifted (e.g. only one of them constrained currency to 3 letters).
export const optionalString=z.string().trim().nullable().default(null)
export const optionalText=z.string().trim().optional().or(z.literal(''))
export const datePrecision=z.enum(['day','month','year']).nullable().default(null)
export const dateValue=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null)

export const emailField=z.string().trim().email().optional().or(z.literal(''))
export const phoneField=optionalText
export const salaryField=z.coerce.number().nonnegative().optional()
export const currencyField=z.string().trim().length(3).optional().or(z.literal(''))
export const consentStatusField=z.enum(['unknown','requested','granted','withdrawn','expired'])

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
