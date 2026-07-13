import { z } from 'zod'

const optionalText=z.string().trim().optional().or(z.literal(''))
export const candidateSchema=z.object({full_name:z.string().trim().min(2),email:z.string().trim().email().optional().or(z.literal('')),phone:optionalText,current_company:optionalText,current_position:optionalText,location:optionalText,source:optionalText,expected_salary:z.coerce.number().nonnegative().optional(),salary_currency:z.string().trim().length(3).optional().or(z.literal(''))})
export const companySchema=z.object({name:z.string().trim().min(2),industry:optionalText,location:optionalText,website:z.string().trim().url().optional().or(z.literal('')),account_status:z.enum(['prospect','active_client','inactive','do_not_contact'])})
export const contactSchema=z.object({company_id:z.string().uuid(),full_name:z.string().trim().min(2),position:optionalText,email:z.string().trim().email().optional().or(z.literal('')),phone:optionalText})
export const jobSchema=z.object({company_id:z.string().uuid(),title:z.string().trim().min(2)})
export const taskSchema=z.object({title:z.string().trim().min(2),description:optionalText,priority:z.enum(['low','normal','high','urgent']),due_at:optionalText})
export const activitySchema=z.object({activity_type:z.enum(['call','email','whatsapp','meeting','other']),direction:z.enum(['inbound','outbound','internal']),subject:optionalText,summary:z.string().trim().min(2)})
