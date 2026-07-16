import type {CandidateProfileDraft,CandidateProfileTemplateConfig,ProfileLanguage,ProfileSectionKey} from './candidateProfile'

export type ProfileEmployment={company_name:string;title:string;started_on:string|null;ended_on:string|null;started_on_precision:string|null;ended_on_precision:string|null;is_current:boolean}
export type ProfileEducation={degree:string|null;field_of_study:string|null;institution:string}
export type ProfileCandidate={full_name:string;current_position:string|null;current_company:string|null;location:string|null;employment:ProfileEmployment[];education:ProfileEducation[];languages:string[]}
export type ProfileLogo={bytes:Uint8Array;type:'png'|'jpg'}
export interface CandidateProfileViewModel {
  language:ProfileLanguage;accent:string;logo?:ProfileLogo;organizationName:string;candidateName:string;jobTitle:string;companyName:string;
  preparedBy:string;preparedDate:string;confidentialityText:string;confidentialLabel:string;anonymized:boolean;
  sectionOrder:Array<{key:ProfileSectionKey;label:string}>;information:Array<[string,string]>;summary:string[];
  employment:Array<{companyName:string;title:string;date:string;relevance:string[]}>;education:string[];strengths:string;risks:string;questions:string[];
}

const copy={
  en:{anonymous:'Confidential candidate',unknown:'To be confirmed',withheld:'Withheld',preparedBy:'Prepared by',date:'Date',name:'Name',currentEmployment:'Current employment',education:'Education',location:'Current location',languages:'Languages',confidential:'CONFIDENTIAL - FOR CLIENT USE ONLY',present:'Present'},
  id:{anonymous:'Kandidat rahasia',unknown:'Perlu dikonfirmasi',withheld:'Dirahasiakan',preparedBy:'Disiapkan oleh',date:'Tanggal',name:'Nama',currentEmployment:'Pekerjaan saat ini',education:'Pendidikan',location:'Lokasi saat ini',languages:'Bahasa',confidential:'RAHASIA - HANYA UNTUK KLIEN',present:'Sekarang'},
} as const

function datePart(value:string|null,precision:string|null,language:ProfileLanguage){
  if(!value)return ''
  if(precision==='year')return value.slice(0,4)
  const locale=language==='id'?'id-ID':'en-GB';const options:Intl.DateTimeFormatOptions=precision==='month'?{month:'long',year:'numeric',timeZone:'UTC'}:{day:'2-digit',month:'long',year:'numeric',timeZone:'UTC'}
  return new Intl.DateTimeFormat(locale,options).format(new Date(`${value}T00:00:00Z`))
}

export function formatEmploymentRange(item:ProfileEmployment,language:ProfileLanguage='en'){
  const unknown=copy[language].unknown;const start=datePart(item.started_on,item.started_on_precision,language);const end=item.is_current?copy[language].present:datePart(item.ended_on,item.ended_on_precision,language)
  return !start&&!end?unknown:`${start||'-'} - ${end||'-'}`
}

export function relevanceFor(draft:CandidateProfileDraft,item:ProfileEmployment,index:number){
  const key=(company:string,title:string)=>`${company}`.trim().toLowerCase()+'|'+`${title}`.trim().toLowerCase();const target=key(item.company_name,item.title)
  return (draft.experience_relevance.find((entry)=>key(entry.company_name,entry.title)===target)||draft.experience_relevance[index])?.relevance||[]
}

function educationText(candidate:ProfileCandidate,language:ProfileLanguage){
  return candidate.education.map((item)=>[item.degree,item.field_of_study,item.institution].filter(Boolean).join(' - ')).filter(Boolean).map(String).concat(candidate.education.length?[]:[copy[language].unknown])
}

export function buildCandidateProfileViewModel(input:{candidate:ProfileCandidate;job:{title:string;company_name:string|null};draft:CandidateProfileDraft;template:CandidateProfileTemplateConfig;preparedBy:string;preparedDate:string;organizationName:string;accent?:string;logo?:ProfileLogo;anonymized:boolean}):CandidateProfileViewModel{
  const {candidate,job,draft,template}=input;const language=template.output_language;const labels=copy[language];const current=[candidate.current_position,candidate.current_company].filter(Boolean).join(language==='id'?' di ':' at ')
  const candidateName=input.anonymized?labels.anonymous:(candidate.full_name||labels.unknown)
  const information:Array<[string,string]>=[
    [labels.name,candidateName],[labels.currentEmployment,current||labels.unknown],
    [labels.education,educationText(candidate,language).join('; ')],[labels.location,input.anonymized?labels.withheld:(candidate.location||labels.unknown)],
    [labels.languages,candidate.languages.length?candidate.languages.join(', '):labels.unknown],
  ]
  return {language,accent:/^#[0-9a-f]{6}$/i.test(input.accent||'')?input.accent!:'#196f52',logo:input.logo,organizationName:input.organizationName,candidateName,jobTitle:job.title,companyName:job.company_name||labels.unknown,preparedBy:input.preparedBy||labels.unknown,preparedDate:input.preparedDate||labels.unknown,confidentialityText:template.confidentiality_text,confidentialLabel:labels.confidential,anonymized:input.anonymized,sectionOrder:template.sections.filter((section)=>section.visible).map(({key,label})=>({key,label})),information,summary:draft.candidate_summary,employment:candidate.employment.map((item,index)=>({companyName:item.company_name,title:item.title,date:formatEmploymentRange(item,language),relevance:relevanceFor(draft,item,index)})),education:educationText(candidate,language),strengths:draft.strengths_opportunities||labels.unknown,risks:draft.risks_challenges||labels.unknown,questions:draft.points_to_validate.length?draft.points_to_validate:[labels.unknown]}
}

export function profileFilename(view:Pick<CandidateProfileViewModel,'candidateName'|'jobTitle'|'companyName'|'anonymized'>,extension:'docx'|'pdf'){
  const base=[view.anonymized?'confidential-candidate':view.candidateName,view.jobTitle,view.companyName].filter(Boolean).join('_').replace(/[^a-zA-Z0-9._-]+/g,'_')||'candidate-profile'
  return `${base}.${extension}`
}

export async function loadProfileLogo(url?:string|null):Promise<ProfileLogo|undefined>{
  if(!url)return undefined
  const response=await fetch(url);if(!response.ok)return undefined;const blob=await response.blob();const bytes=new Uint8Array(await blob.arrayBuffer())
  if(blob.type==='image/png')return {bytes,type:'png'}
  if(blob.type==='image/jpeg')return {bytes,type:'jpg'}
  if(typeof document==='undefined'||typeof createImageBitmap==='undefined')return undefined
  const bitmap=await createImageBitmap(blob);const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;canvas.getContext('2d')?.drawImage(bitmap,0,0);const png=await new Promise<Blob|null>((resolve)=>canvas.toBlob(resolve,'image/png'));bitmap.close()
  return png?{bytes:new Uint8Array(await png.arrayBuffer()),type:'png'}:undefined
}
