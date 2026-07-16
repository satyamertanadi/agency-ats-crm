import {describe,expect,it} from 'vitest'
import {candidateProfileAnalysisSchema} from './candidateProfile'
import {buildCandidateProfileDocx,formatEmploymentRange,informationRows,profileFilename,relevanceFor,type ProfileCandidate} from './candidateProfileDocx'

const analysis=candidateProfileAnalysisSchema.parse({
  candidate_summary:['Para one.','Para two.'],
  strengths_opportunities:'Strong operator.',
  risks_challenges:'P&L depth to confirm.',
  points_to_validate:['Salary','Notice period'],
  experience_relevance:[{company_name:'Betterplace',title:'Hotel Manager',relevance:['Runs property operations.']}],
})

const candidate:ProfileCandidate={
  full_name:'Franco George Wenas',current_position:'Hotel Manager',current_company:'Betterplace',location:'Bali, Indonesia',
  employment:[{company_name:'Betterplace',title:'Hotel Manager',started_on:'2025-11-01',ended_on:null,started_on_precision:'month',ended_on_precision:null,is_current:true}],
  education:[{degree:'Diploma III',field_of_study:'Hotel Management',institution:'AKPAR NHI'}],
  languages:['Indonesian','English','Italian'],
}

describe('candidate profile document',()=>{
  it('auto-fills known fields and leaves unknown fields as "To be confirmed"',()=>{
    const rows=Object.fromEntries(informationRows(candidate,analysis))
    expect(rows.Name).toBe('Franco George Wenas')
    expect(rows.Languages).toBe('Indonesian, English, Italian')
    expect(rows['Current Location']).toBe('Bali, Indonesia')
    expect(rows['Strengths & Opportunities']).toBe('Strong operator.')
    expect(rows.Age).toBe('To be confirmed')
    expect(rows.Nationality).toBe('To be confirmed')
    expect(rows['Expected Salary']).toBe('To be confirmed')
    expect(rows.Photo).toBe('')
  })

  const role=candidate.employment[0]!
  it('formats employment ranges by precision and marks current roles',()=>{
    expect(formatEmploymentRange(role)).toBe('November 2025 – Present')
    expect(formatEmploymentRange({...role,is_current:false,ended_on:'2024-10-01',ended_on_precision:'month'})).toBe('November 2025 – October 2024')
    expect(formatEmploymentRange({...role,started_on:null,is_current:false})).toBe('To be confirmed')
  })

  it('matches relevance to employment by company and title, not position',()=>{
    const shuffled=candidateProfileAnalysisSchema.parse({experience_relevance:[{company_name:'Other',title:'X',relevance:['no']},{company_name:'Betterplace',title:'Hotel Manager',relevance:['yes']}]})
    expect(relevanceFor(shuffled,role,0)).toEqual(['yes'])
  })

  it('builds a non-empty .docx blob',async()=>{
    const blob=await buildCandidateProfileDocx({candidate,job:{title:'Operations Manager',company_name:'House of Kairos'},analysis,preparedBy:'Felina Kuswanto',date:'June 2026'})
    expect(blob.size).toBeGreaterThan(0)
  })

  it('produces a safe filename',()=>{
    expect(profileFilename(candidate,{title:'Operations Manager',company_name:'House of Kairos'})).toBe('Franco_George_Wenas_Operations_Manager_House_of_Kairos.docx')
  })
})
