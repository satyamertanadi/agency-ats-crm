import {describe,expect,it} from 'vitest'
import {candidateCvExtractionSchema,confidenceFor} from './cvParsing'

describe('candidate CV extraction contract',()=>{
  it('keeps unknown and unsupported values explicit',()=>{
    const value=candidateCvExtractionSchema.parse({full_name:'Ayu Lestari',private:{},field_evidence:{full_name:{confidence:'high',evidence:'Ayu Lestari'}}})
    expect(value.private.expected_salary).toBeNull()
    expect(value.notice_period_days).toBeNull()
    expect(confidenceFor(value,'full_name')).toBe('high')
  })

  it('preserves partial-date precision',()=>{
    const value=candidateCvExtractionSchema.parse({full_name:'Ayu Lestari',private:{},employment:[{company_name:'Samara',title:'Consultant',started_on:'2024-05-01',started_on_precision:'month'}]})
    expect(value.employment[0]).toMatchObject({started_on:'2024-05-01',started_on_precision:'month'})
  })

  it('rejects invalid normalized dates and negative inferred durations',()=>{
    expect(()=>candidateCvExtractionSchema.parse({full_name:'Ayu',private:{},employment:[{company_name:'A',title:'B',started_on:'May 2024'}]})).toThrow()
    expect(()=>candidateCvExtractionSchema.parse({full_name:'Ayu',private:{},skills:[{name:'React',years_experience:-1}]})).toThrow()
  })
})
