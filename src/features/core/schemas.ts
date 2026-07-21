import { z } from 'zod'
import {consentStatusField,currencyField,emailField,optionalText,phoneField,salaryField} from '../../shared/validation/candidateFields'

export const candidateSchema=z.object({full_name:z.string().trim().min(2),email:emailField,phone:phoneField,current_company:optionalText,current_position:optionalText,location:optionalText,source:optionalText,expected_salary:salaryField,salary_currency:currencyField})
// Validates the candidate detail page's "Profile and ownership" + "Private details and consent"
// edit panels -- previously that form had no schema at all, just native `required` attributes.
export const candidateProfileEditSchema=z.object({
  full_name:z.string().trim().min(2),owner_member_id:optionalText,current_company:optionalText,current_position:optionalText,
  location:optionalText,source:optionalText,linkedin_url:z.string().trim().url().optional().or(z.literal('')),
  portfolio_url:z.string().trim().url().optional().or(z.literal('')),availability:optionalText,
  notice_period_days:z.coerce.number().int().nonnegative().optional(),status:z.enum(['active','passive','placed','do_not_contact','archived']),
  email:emailField,phone:phoneField,current_salary:salaryField,expected_salary:salaryField,salary_currency:currencyField,
  work_authorization:optionalText,consent_status:consentStatusField,consent_expires_at:optionalText,
})
export const companySchema=z.object({name:z.string().trim().min(2),industry:optionalText,location:optionalText,website:z.string().trim().url().optional().or(z.literal('')),account_status:z.enum(['prospect','active_client','inactive','do_not_contact'])})
export const contactSchema=z.object({company_id:z.string().uuid(),full_name:z.string().trim().min(2),position:optionalText,email:z.string().trim().email().optional().or(z.literal('')),phone:optionalText})
export const jobSchema=z.object({company_id:z.string().uuid(),title:z.string().trim().min(2)})
export const taskSchema=z.object({title:z.string().trim().min(2),description:optionalText,priority:z.enum(['low','normal','high','urgent']),due_at:optionalText})
export const activitySchema=z.object({activity_type:z.enum(['call','email','whatsapp','meeting','other']),direction:z.enum(['inbound','outbound','internal']),subject:optionalText,summary:z.string().trim().min(2)})
