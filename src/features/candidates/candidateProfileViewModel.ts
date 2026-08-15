import {resolveAccent} from '../../shared/lib/branding'
import type {CandidateProfileDraft,CandidateProfileTemplateConfig,ProfileLanguage,ProfileSectionKey} from './candidateProfile'
import {detailFields,emptyProfileDetails,roleKey,type ProfileDetailKey,type ProfileDetails,type RoleWebsites} from './candidateProfileDetails'

export type ProfileEmployment={company_name:string;title:string;started_on:string|null;ended_on:string|null;started_on_precision:string|null;ended_on_precision:string|null;is_current:boolean}
export type ProfileEducation={degree:string|null;field_of_study:string|null;institution:string}
export type ProfileCandidate={full_name:string;current_position:string|null;current_company:string|null;location:string|null;employment:ProfileEmployment[];education:ProfileEducation[];languages:string[]}
export type ProfileLogo={bytes:Uint8Array;type:'png'|'jpg'}
export interface CandidateProfileViewModel {
  language:ProfileLanguage;accent:string;logo?:ProfileLogo;footerBanner?:ProfileLogo;organizationName:string;candidateName:string;jobTitle:string;companyName:string;
  preparedBy:string;preparedDate:string;confidentialityText:string;confidentialLabel:string;anonymized:boolean;
  /* Section labels, not section order. The client template is mandatory, so the document's order is
   * fixed in the renderer; the template's `sections` survive only to supply bilingual wording. */
  /* Information rows are [label, value], with an optional third element marking the value as a
   * bulleted list -- true only for the two AI judgment rows, which are newline-separated points
   * rather than a single value. A trailing optional slot keeps the fifteen factual rows unchanged. */
  sectionLabels:Record<ProfileSectionKey,string>;information:Array<[string,string,boolean?]>;
  summary:string[];currentRoleLine:string;summaryBullets:string[];
  employment:Array<{companyName:string;title:string;date:string;website:string;relevance:string[]}>;
}

const copy={
  en:{anonymous:'Confidential candidate',unknown:'To be confirmed',withheld:'Withheld',preparedBy:'Prepared by',date:'Date',remarks:'Remarks',name:'Name',photo:'Photo',currentEmployment:'Current Employment',education:'Education',location:'Current Location',languages:'Languages',strengths:'Strengths & Opportunities',risks:'Risks & Challenge',information:'INFORMATION',currentRole:'Current Role',forTheRole:'FOR THE ROLE OF',at:'AT',confidential:'CONFIDENTIAL - FOR CLIENT USE ONLY',present:'Present'},
  id:{anonymous:'Kandidat rahasia',unknown:'Perlu dikonfirmasi',withheld:'Dirahasiakan',preparedBy:'Disiapkan oleh',date:'Tanggal',remarks:'Catatan',name:'Nama',photo:'Foto',currentEmployment:'Pekerjaan saat ini',education:'Pendidikan',location:'Lokasi saat ini',languages:'Bahasa',strengths:'Kekuatan & Peluang',risks:'Risiko & Tantangan',information:'INFORMASI',currentRole:'Peran saat ini',forTheRole:'UNTUK POSISI',at:'DI',confidential:'RAHASIA - HANYA UNTUK KLIEN',present:'Sekarang'},
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

/* Strengths and risks are one free-text field each, with newline separating the points -- the shape
 * predates this and cannot change, since finalized profile versions store the draft verbatim and are
 * immutable. This turns that text into at most MAX_JUDGEMENT_POINTS display lines.
 *
 * The count is capped here rather than trusted to the prompt: a model that ignores the instruction
 * would otherwise put a nine-point list into a table cell, which is the exact failure this fixes.
 * Word length is NOT capped -- truncating a sentence mid-clause on a client-facing document reads
 * worse than one slightly long bullet, so that stays a prompt instruction.
 *
 * Leading markers are stripped because the renderer supplies the bullet glyph: a model that emits
 * "- Ran operations" despite the prompt would otherwise print as "• - Ran operations".
 *
 * A legacy value written before the bulleted contract is a single prose blob with no newlines. It
 * returns as one long point, which is honest -- deliberately not sentence-split, because splitting on
 * ". " mangles "15-20%." and "Ltd." and guessing wrong here is worse than one untidy line. */
const MAX_JUDGEMENT_POINTS=3
export function judgementPoints(value:string,max=MAX_JUDGEMENT_POINTS){
  return value.split('\n').map((line)=>line.replace(/^\s*[•\-–—*]+\s*/,'').trim()).filter(Boolean).slice(0,max)
}

/* Builds one information row for a judgment field. An empty field keeps the plain "To be confirmed"
 * placeholder every other blank row uses -- bulleting a placeholder would imply a point was made. */
function judgementRow(label:string,value:string,unknown:string):[string,string,boolean?]{
  const points=judgementPoints(value)
  return points.length?[label,points.join('\n'),true]:[label,unknown]
}

export function buildCandidateProfileViewModel(input:{candidate:ProfileCandidate;job:{title:string;company_name:string|null};draft:CandidateProfileDraft;template:CandidateProfileTemplateConfig;preparedBy:string;preparedDate:string;organizationName:string;accent?:string;logo?:ProfileLogo;footerBanner?:ProfileLogo;anonymized:boolean;details?:ProfileDetails;websites?:RoleWebsites}):CandidateProfileViewModel{
  const {candidate,job,draft,template}=input;const language=template.output_language;const labels=copy[language];const current=[candidate.current_position,candidate.current_company].filter(Boolean).join(language==='id'?' di ':' at ')
  const candidateName=input.anonymized?labels.anonymous:(candidate.full_name||labels.unknown)
  const details=input.details||emptyProfileDetails();const websites=input.websites||{}
  const sectionLabels=Object.fromEntries(template.sections.map(({key,label})=>[key,label])) as Record<ProfileSectionKey,string>
  /* Anonymizing withholds who the person is -- name, age, nationality, precise location -- but keeps
   * the commercial terms, because salary and notice are the substance a client is being asked to
   * judge. Withholding those would leave a document with nothing to decide on. */
  const withheld=(value:string)=>input.anonymized?labels.withheld:(value.trim()||labels.unknown)
  const row=(key:ProfileDetailKey):[string,string]=>[detailLabel(key,language),details[key].trim()||labels.unknown]
  const information:Array<[string,string,boolean?]>=[
    [`${labels.name}\n${labels.photo}`,candidateName],
    [detailLabel('age',language),withheld(details.age)],
    [labels.currentEmployment,current||labels.unknown],
    [labels.education,educationText(candidate,language).join('; ')],
    [detailLabel('nationality',language),withheld(details.nationality)],
    [labels.location,input.anonymized?labels.withheld:(candidate.location||labels.unknown)],
    row('current_salary'),row('other_benefits'),row('expected_salary'),row('notice_period'),
    [labels.languages,candidate.languages.length?candidate.languages.join(', '):labels.unknown],
    row('motivation_to_move'),row('other_interview_process'),row('first_impression_company'),row('first_impression_job'),
    judgementRow(labels.strengths,draft.strengths_opportunities,labels.unknown),
    judgementRow(labels.risks,draft.risks_challenges,labels.unknown),
  ]
  /* The summary reads as one intro paragraph, a current-role line, then bullets, with the points to
   * validate collapsed into the final bullet rather than standing as their own section. */
  const [intro,...rest]=draft.candidate_summary
  const summaryBullets=[...rest,...(draft.points_to_validate.length?[`${sectionLabels.questions}: ${draft.points_to_validate.join(', ')}`]:[])]
  return {language,accent:resolveAccent(input.accent),logo:input.logo,footerBanner:input.footerBanner,organizationName:input.organizationName,candidateName,jobTitle:job.title,companyName:job.company_name||labels.unknown,preparedBy:input.preparedBy||labels.unknown,preparedDate:input.preparedDate||labels.unknown,confidentialityText:template.confidentiality_text,confidentialLabel:labels.confidential,anonymized:input.anonymized,sectionLabels,information,summary:intro?[intro]:[],currentRoleLine:current?`${labels.currentRole}: ${current}.`:'',summaryBullets,employment:candidate.employment.map((item,index)=>({companyName:item.company_name,title:item.title,date:formatEmploymentRange(item,language),website:(websites[roleKey(item.company_name,item.title)]||'').trim(),relevance:relevanceFor(draft,item,index)}))}
}

// One label source for both the fill-in form and the table row, so the two cannot drift apart.
function detailLabel(key:ProfileDetailKey,language:ProfileLanguage){return detailFields.find((field)=>field.key===key)!.label[language]}

export function profileFilename(view:Pick<CandidateProfileViewModel,'candidateName'|'jobTitle'|'companyName'|'anonymized'>,extension:'docx'){
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
