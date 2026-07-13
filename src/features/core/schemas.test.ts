import { describe,expect,it } from 'vitest'
import { candidateSchema,companySchema,taskSchema } from './schemas'

describe('domain validation',()=>{
  it('normalizes candidate salary and rejects invalid email',()=>{expect(candidateSchema.parse({full_name:'Aisha Rahman',email:'aisha@example.com',expected_salary:'150000'}).expected_salary).toBe(150000);expect(()=>candidateSchema.parse({full_name:'A',email:'bad'})).toThrow()})
  it('requires a valid optional company URL',()=>{expect(companySchema.safeParse({name:'Atlas',website:'nope',account_status:'prospect'}).success).toBe(false)})
  it('accepts an actionable task',()=>{expect(taskSchema.safeParse({title:'Follow up',priority:'high'}).success).toBe(true)})
})

