import Papa from 'papaparse'
import { candidateSchema } from '../core/schemas'
import type { Candidate } from '../../shared/types/domain'

export type CandidateImportRow={row:number;data:Record<string,unknown>;errors:string[]}

export function parseCandidateCsv(text:string):CandidateImportRow[]{
  const parsed=Papa.parse<Record<string,string>>(text,{header:true,skipEmptyLines:true,transformHeader:(header)=>header.trim().toLowerCase().replace(/\s+/g,'_')})
  return parsed.data.map((row,index)=>{
    const candidate={
      full_name:row.full_name||row.name||'',email:row.email||'',phone:row.phone||'',
      current_company:row.current_company||row.company||'',current_position:row.current_position||row.position||'',
      location:row.location||'',source:row.source||'CSV import',expected_salary:row.expected_salary?Number(row.expected_salary):undefined,
      salary_currency:(row.salary_currency||row.currency||'USD').toUpperCase(),
    }
    const result=candidateSchema.safeParse(candidate)
    return {row:index+2,data:result.success?result.data:candidate,errors:result.success?[]:result.error.issues.map((issue)=>`${issue.path.join('.')}: ${issue.message}`)}
  })
}

export function candidatesToCsv(candidates:Candidate[]):string{
  return Papa.unparse(candidates.map((candidate)=>{
    const details=Array.isArray(candidate.candidate_private_details)?candidate.candidate_private_details[0]:candidate.candidate_private_details
    return {full_name:candidate.full_name,email:details?.email||'',phone:details?.phone||'',current_company:candidate.current_company||'',current_position:candidate.current_position||'',location:candidate.location||'',source:candidate.source||'',expected_salary:details?.expected_salary||'',salary_currency:details?.salary_currency||''}
  }))
}
