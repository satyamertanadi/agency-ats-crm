import {z} from 'zod'

/* Validation for the Edit job form.
 *
 * The form had none. Its only rule was a disabled Save below two characters of title; everything else
 * was checked by the database and surfaced as a raw constraint error -- inverting the salary band
 * produced "new row for relation \"jobs\" violates check constraint
 * \"jobs_salary_min_check\"" over an unchanged form. This follows candidateFormSchema in
 * src/features/core/schemas.ts, which exists for the same reason on the candidate side.
 *
 * The fee fields keep their empty-is-not-zero meaning, which is the subtle one: a null override falls
 * back to the client's approved commercial terms, a 0 asserts the job is worked for free.
 */

const blankToNull=(value:unknown)=>typeof value==='string'&&value.trim()===''?null:value

/* A money input that must survive '' as null rather than being coerced to 0. z.coerce.number() alone
 * turns '' into 0, which is how an empty fee would silently become "this placement earns nothing". */
const optionalMoney=(message:string)=>z.preprocess(blankToNull,z.coerce.number().nonnegative(message).nullable())

export const jobFormSchema=z.object({
  title:z.string().trim().min(2,'Enter at least two characters.'),
  location:z.string().trim().nullable(),
  priority:z.enum(['low','normal','high','urgent']),
  status:z.enum(['draft','open','on_hold','filled','closed','cancelled']),
  employment_type:z.string().trim().nullable(),
  owner_member_id:z.string().trim().nullable(),
  description:z.string().trim().nullable(),
  salary_min:optionalMoney('A salary cannot be negative.'),
  salary_max:optionalMoney('A salary cannot be negative.'),
  currency:z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/,'Pick a currency.'),
  placement_fee_percentage:z.preprocess(blankToNull,z.coerce.number().min(0,'A fee cannot be negative.').max(100,'A percentage fee cannot exceed 100.').nullable()),
  fixed_fee:optionalMoney('A fee cannot be negative.'),
}).superRefine((values,context)=>{
  // The DB enforces this too. Doing it here as well is what turns a rejected save into a message
  // pointing at the field the recruiter has to change.
  if(values.salary_min!==null&&values.salary_max!==null&&values.salary_min>values.salary_max){
    context.addIssue({code:'custom',path:['salary_max'],message:'The maximum must be at least the minimum.'})
  }
  /* Both set is not a database error -- the fee resolver simply prefers the fixed fee and ignores the
   * percentage. That silence is the problem: the job page then quotes a number the recruiter did not
   * think they had entered. Refused here so the choice is made deliberately. */
  if(values.placement_fee_percentage!==null&&values.fixed_fee!==null){
    context.addIssue({code:'custom',path:['fixed_fee'],message:'Set a percentage or a fixed fee, not both. A fixed fee would win.'})
  }
})

export type JobFormValues=z.infer<typeof jobFormSchema>

/* Flattens zod issues to one message per field, which is all the Field component renders. Keyed by
 * the top-level path segment so superRefine issues land on the input they name. */
export function jobFormErrors(error:z.ZodError):Record<string,string>{
  const errors:Record<string,string>={}
  for(const issue of error.issues){
    const key=String(issue.path[0]??'')
    if(key&&!errors[key])errors[key]=issue.message
  }
  return errors
}
