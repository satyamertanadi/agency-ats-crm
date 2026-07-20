import {formatSalary} from '../../shared/lib/format'
import type {CandidateDetail,CandidatePrivate} from '../../shared/types/domain'
import type {ProfileLanguage} from './candidateProfile'

/* The mandatory client template states 17 facts. Eight come from the candidate record and two from
 * the AI draft; these are the rest. Seven have no column anywhere in the schema (age, nationality,
 * benefits, motivation, interview process, and the two first impressions) and are consultant
 * judgement gathered in interview, so they are captured per document rather than stored on the
 * candidate. Three more DO exist on the record and are prefilled as editable defaults -- that is
 * three fewer fields typed per profile, with no extra query. Anything left blank prints the
 * template's own "To be confirmed". */
export type ProfileDetailKey='age'|'nationality'|'current_salary'|'other_benefits'|'expected_salary'|'notice_period'|'motivation_to_move'|'other_interview_process'|'first_impression_company'|'first_impression_job'
export type ProfileDetails=Record<ProfileDetailKey,string>

/* Websites are keyed by company+title rather than by array index because employment is re-sorted for
 * display; the same key function backs relevanceFor, so a role's bullets and its link cannot end up
 * attached to different rows. */
export const roleKey=(companyName:string,title:string)=>`${companyName}`.trim().toLowerCase()+'|'+`${title}`.trim().toLowerCase()
export type RoleWebsites=Record<string,string>

export const detailFields:Array<{key:ProfileDetailKey;label:{en:string;id:string};multiline:boolean}>=[
  {key:'age',label:{en:'Age',id:'Usia'},multiline:false},
  {key:'nationality',label:{en:'Nationality',id:'Kewarganegaraan'},multiline:false},
  {key:'current_salary',label:{en:'Current Salary',id:'Gaji saat ini'},multiline:false},
  {key:'other_benefits',label:{en:'Other Benefits',id:'Tunjangan lain'},multiline:false},
  {key:'expected_salary',label:{en:'Expected Salary',id:'Gaji yang diharapkan'},multiline:false},
  {key:'notice_period',label:{en:'Notice Period',id:'Masa pemberitahuan'},multiline:false},
  {key:'motivation_to_move',label:{en:'Motivation to move',id:'Motivasi pindah'},multiline:true},
  {key:'other_interview_process',label:{en:'Other Interview Process',id:'Proses wawancara lain'},multiline:true},
  {key:'first_impression_company',label:{en:'First impression of company',id:'Kesan pertama tentang perusahaan'},multiline:true},
  {key:'first_impression_job',label:{en:'First impression of job',id:'Kesan pertama tentang pekerjaan'},multiline:true},
]

export function emptyProfileDetails():ProfileDetails{
  return Object.fromEntries(detailFields.map((field)=>[field.key,''])) as ProfileDetails
}

const privateOf=(candidate:CandidateDetail):CandidatePrivate|undefined=>Array.isArray(candidate.candidate_private_details)?candidate.candidate_private_details[0]:candidate.candidate_private_details||undefined

export function prefillProfileDetails(candidate:CandidateDetail,currency?:string|null,language:ProfileLanguage='en'):ProfileDetails{
  const priv=privateOf(candidate);const salaryCurrency=priv?.salary_currency||currency
  const days=candidate.notice_period_days
  return {
    ...emptyProfileDetails(),
    current_salary:priv?.current_salary!=null?formatSalary(priv.current_salary,salaryCurrency):'',
    expected_salary:priv?.expected_salary!=null?formatSalary(priv.expected_salary,salaryCurrency):'',
    notice_period:days!=null?(language==='id'?`${days} hari`:`${days} days`):'',
  }
}
