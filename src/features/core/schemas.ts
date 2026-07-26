import { z } from 'zod'
import {blankToUndefined,consentStatusField,currencyField,emailField,optionalText,phoneField,salaryField} from '../../shared/validation/candidateFields'

/* One schema for every candidate form in the product.
 *
 * There used to be three, over the same record, with three different field sets: the manual add form
 * (9 fields), the CV review form (~20), and the detail-page edit form (19). The gaps were not
 * cosmetic -- manual entry could not set owner, status, consent, LinkedIn, availability or notice
 * period, so every hand-entered candidate was born unassigned with consent 'unknown' and needed a
 * second visit to fix. It could not set salary_currency either, despite submitting the field, because
 * the form rendered no input for it: an IDR salary in a USD workspace was stored as USD silently.
 *
 * Consequence of one schema: the widest form is no longer the one you reach by having a CV parse fail.
 * `candidateFormSchema` is the whole field set; `candidateConsentSchema` is the slice the detail page's
 * focused consent editor uses, so "update consent" stops meaning "open all nineteen fields". */
export const candidateFormSchema=z.object({
  full_name:z.string().trim().min(2,'Enter at least two characters.'),
  current_company:optionalText,current_position:optionalText,location:optionalText,source:optionalText,
  linkedin_url:z.string().trim().url('Enter a full URL, including https://').optional().or(z.literal('')),
  portfolio_url:z.string().trim().url('Enter a full URL, including https://').optional().or(z.literal('')),
  availability:optionalText,notice_period_days:z.preprocess(blankToUndefined,z.coerce.number().int().nonnegative('Notice period cannot be negative.').optional()),
  status:z.enum(['active','passive','placed','do_not_contact','archived']),
  owner_member_id:optionalText,
  email:emailField,phone:phoneField,
  current_salary:salaryField,expected_salary:salaryField,salary_currency:currencyField,
  work_authorization:optionalText,consent_status:consentStatusField,consent_expires_at:optionalText,
})
export type CandidateFormValues=z.infer<typeof candidateFormSchema>

export const candidateConsentSchema=candidateFormSchema.pick({consent_status:true,consent_expires_at:true})

/* Retained under their old names because the CV parser and the detail page still import them; both are
 * now the same object, so the three forms cannot drift apart again. */
export const candidateSchema=candidateFormSchema
export const candidateProfileEditSchema=candidateFormSchema
export const companySchema=z.object({name:z.string().trim().min(2),industry:optionalText,location:optionalText,website:z.string().trim().url().optional().or(z.literal('')),account_status:z.enum(['prospect','active_client','inactive','do_not_contact'])})
export const contactSchema=z.object({company_id:z.string().uuid(),full_name:z.string().trim().min(2),position:optionalText,email:z.string().trim().email().optional().or(z.literal('')),phone:optionalText})
export const jobSchema=z.object({company_id:z.string().uuid(),title:z.string().trim().min(2)})
export const taskSchema=z.object({title:z.string().trim().min(2),description:optionalText,priority:z.enum(['low','normal','high','urgent']),due_at:optionalText})
export const activitySchema=z.object({activity_type:z.enum(['call','email','whatsapp','meeting','other']),direction:z.enum(['inbound','outbound','internal']),subject:optionalText,summary:z.string().trim().min(2)})
