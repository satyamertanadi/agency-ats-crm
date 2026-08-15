import { describe,expect,it } from 'vitest'
import { candidateFormSchema,candidateSchema,companySchema,taskSchema } from './schemas'

/* The one field set every candidate form now validates against. `status` is required rather than
 * optional-with-a-default on purpose: it used to be unsettable at creation, and a default here would
 * quietly reintroduce exactly that -- every hand-entered candidate born 'active' by omission. */
const valid={full_name:'Aisha Rahman',email:'aisha@example.com',status:'active'}

describe('domain validation',()=>{
  it('coerces the numeric fields the inputs submit as strings',()=>{
    const parsed=candidateFormSchema.parse({...valid,expected_salary:'150000',current_salary:'120000',notice_period_days:'30'})
    expect(parsed.expected_salary).toBe(150000)
    expect(parsed.current_salary).toBe(120000)
    expect(parsed.notice_period_days).toBe(30)
  })
  it('rejects a bad email, a too-short name, and a bare-domain profile URL',()=>{
    expect(candidateFormSchema.safeParse({...valid,email:'bad'}).success).toBe(false)
    expect(candidateFormSchema.safeParse({...valid,full_name:'A'}).success).toBe(false)
    expect(candidateFormSchema.safeParse({...valid,linkedin_url:'linkedin.com/in/aisha'}).success).toBe(false)
  })
  /* An empty number input submits '', which z.coerce.number() reads as 0 -- so a blank notice period
   * was recorded as "0 days" and a blank salary as a real zero on a private column. */
  it('leaves blank numbers absent rather than recording them as zero',()=>{
    const parsed=candidateFormSchema.parse({...valid,expected_salary:'',current_salary:'',notice_period_days:''})
    expect(parsed.notice_period_days).toBeUndefined()
    expect(parsed.expected_salary).toBeUndefined()
    expect(parsed.current_salary).toBeUndefined()
    // ...while a deliberate zero still means zero.
    expect(candidateFormSchema.parse({...valid,notice_period_days:'0'}).notice_period_days).toBe(0)
  })
  it('rejects a negative notice period and a currency that is not a three-letter code',()=>{
    expect(candidateFormSchema.safeParse({...valid,notice_period_days:'-5'}).success).toBe(false)
    expect(candidateFormSchema.safeParse({...valid,salary_currency:'rupiah'}).success).toBe(false)
    expect(candidateFormSchema.safeParse({...valid,salary_currency:'IDR'}).success).toBe(true)
  })
  // The add form and the detail edit form are the same object now, so they cannot drift apart again.
  it('keeps the retained aliases pointing at the one schema',()=>{expect(candidateSchema).toBe(candidateFormSchema)})
  it('requires a valid optional company URL',()=>{expect(companySchema.safeParse({name:'Atlas',website:'nope',account_status:'prospect'}).success).toBe(false)})
  it('accepts an actionable task',()=>{expect(taskSchema.safeParse({title:'Follow up',priority:'high'}).success).toBe(true)})
})
