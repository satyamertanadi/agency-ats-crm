import {describe,expect,it} from 'vitest'
import {jobFormErrors,jobFormSchema} from './jobFormSchema'

/* The Edit job form had no validation at all, so these are the rules that used to reach the user as
 * a Postgres constraint string over an unchanged form -- or, worse, not at all.
 */

const valid={
  title:'Engineering Manager',location:'Jakarta',priority:'normal',status:'open',
  employment_type:'full_time',owner_member_id:null,description:'Own the mandate.',
  salary_min:'300000000',salary_max:'480000000',currency:'IDR',
  placement_fee_percentage:'20',fixed_fee:'',
}

const parse=(overrides:Record<string,unknown>)=>jobFormSchema.safeParse({...valid,...overrides})

describe('the edit job form',()=>{
  it('accepts a complete job and normalises the money fields to numbers',()=>{
    const result=parse({})
    expect(result.success).toBe(true)
    if(!result.success)return
    expect(result.data.salary_min).toBe(300000000)
    expect(result.data.salary_max).toBe(480000000)
    expect(result.data.placement_fee_percentage).toBe(20)
  })

  /* The distinction the whole file exists for. A null fee override falls back to the client's
   * approved commercial terms; a 0 asserts the placement is worked for free. z.coerce.number() on a
   * blank string yields 0, so an empty input would silently commit the agency to a free placement. */
  it('keeps an empty fee as null rather than zero',()=>{
    const result=parse({placement_fee_percentage:'',fixed_fee:''})
    expect(result.success).toBe(true)
    if(!result.success)return
    expect(result.data.placement_fee_percentage).toBeNull()
    expect(result.data.fixed_fee).toBeNull()
  })

  it('still lets a fee be deliberately set to zero',()=>{
    const result=parse({placement_fee_percentage:'0',fixed_fee:''})
    expect(result.success).toBe(true)
    if(!result.success)return
    expect(result.data.placement_fee_percentage).toBe(0)
  })

  it('keeps an empty salary as null rather than zero',()=>{
    const result=parse({salary_min:'',salary_max:''})
    expect(result.success).toBe(true)
    if(!result.success)return
    expect(result.data.salary_min).toBeNull()
    expect(result.data.salary_max).toBeNull()
  })

  it('rejects an inverted salary band against the field the user has to change',()=>{
    const result=parse({salary_min:'480000000',salary_max:'300000000'})
    expect(result.success).toBe(false)
    if(result.success)return
    expect(jobFormErrors(result.error).salary_max).toBe('The maximum must be at least the minimum.')
  })

  it('allows a band whose ends are equal',()=>{
    expect(parse({salary_min:'400',salary_max:'400'}).success).toBe(true)
  })

  it('does not compare the band when only one end is set',()=>{
    expect(parse({salary_min:'480000000',salary_max:''}).success).toBe(true)
    expect(parse({salary_min:'',salary_max:'300000000'}).success).toBe(true)
  })

  /* Not a database error: the fee resolver simply prefers the fixed fee. That silence is the bug --
   * the job then quotes a number the recruiter did not think they had entered. */
  it('refuses a percentage and a fixed fee together',()=>{
    const result=parse({placement_fee_percentage:'20',fixed_fee:'50000000'})
    expect(result.success).toBe(false)
    if(result.success)return
    expect(jobFormErrors(result.error).fixed_fee).toContain('not both')
  })

  it('rejects a percentage over 100 and negative money',()=>{
    expect(parse({placement_fee_percentage:'120',fixed_fee:''}).success).toBe(false)
    expect(parse({salary_min:'-1'}).success).toBe(false)
  })

  it('rejects a title under two characters',()=>{
    const result=parse({title:' A '})
    expect(result.success).toBe(false)
    if(result.success)return
    expect(jobFormErrors(result.error).title).toBe('Enter at least two characters.')
  })

  it('upper-cases the currency and rejects anything that is not three letters',()=>{
    const lower=parse({currency:'idr'})
    expect(lower.success).toBe(true)
    if(lower.success)expect(lower.data.currency).toBe('IDR')
    expect(parse({currency:'RUPIAH'}).success).toBe(false)
    expect(parse({currency:''}).success).toBe(false)
  })

  it('reports one message per field so each Field renders a single error',()=>{
    const result=parse({title:'',currency:'',salary_min:'-5'})
    expect(result.success).toBe(false)
    if(result.success)return
    const errors=jobFormErrors(result.error)
    expect(Object.keys(errors).sort()).toEqual(['currency','salary_min','title'])
  })
})
