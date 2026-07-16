import {AlignmentType,BorderStyle,Document,PageBreak,Packer,Paragraph,Table,TableCell,TableRow,TextRun,WidthType,type IBorderOptions} from 'docx'
import type {CandidateProfileAnalysis} from './candidateProfile'

const TO_BE_CONFIRMED='To be confirmed'
const BORDER_COLOR='BEBEBE'
export const CONFIDENTIALITY_REMARK='This report is presented to you in strict confidence and its use should be limited to key stakeholders expressly involved in this assignment only. We request that no communication be entered into with either past or present employers of the applicant without an expressed permission. The information provided in this report is the result of a formal interview. It is given in good faith and is believed to be correct, however, may require further verification. Should this candidate be employed by your organization within 12 months of the date of this report the standard Terms of Business apply.'

export type ProfileEmployment={company_name:string;title:string;started_on:string|null;ended_on:string|null;started_on_precision:string|null;ended_on_precision:string|null;is_current:boolean}
export type ProfileEducation={degree:string|null;field_of_study:string|null;institution:string}
export type ProfileCandidate={
  full_name:string;current_position:string|null;current_company:string|null;location:string|null;
  employment:ProfileEmployment[];education:ProfileEducation[];languages:string[]
}
export type ProfileDocInput={
  candidate:ProfileCandidate;job:{title:string;company_name:string|null};analysis:CandidateProfileAnalysis;
  preparedBy:string;date:string
}

// ---- Pure, testable helpers ---------------------------------------------------

export function formatEmploymentRange(item:ProfileEmployment):string{
  const start=formatDate(item.started_on,item.started_on_precision)
  const end=item.is_current?'Present':formatDate(item.ended_on,item.ended_on_precision)
  if(!start&&!end)return TO_BE_CONFIRMED
  return `${start||'—'} – ${end||'—'}`
}
function formatDate(value:string|null,precision:string|null):string{
  if(!value)return ''
  if(precision==='year')return value.slice(0,4)
  if(precision==='month')return new Intl.DateTimeFormat('en-GB',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(`${value}T00:00:00Z`))
  return new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(`${value}T00:00:00Z`))
}
function currentEmployment(candidate:ProfileCandidate):string{
  const parts=[candidate.current_position,candidate.current_company].filter(Boolean)
  return parts.length?parts.join(' at '):TO_BE_CONFIRMED
}
function educationText(candidate:ProfileCandidate):string{
  const lines=candidate.education.map((item)=>[item.degree,item.field_of_study].filter(Boolean).join(' in ')+(item.institution?`${[item.degree,item.field_of_study].filter(Boolean).length?' at ':''}${item.institution}`:'')).filter((line)=>line.trim())
  return lines.length?lines.join('; '):TO_BE_CONFIRMED
}

/** The INFORMATION table as ordered [label, value] pairs — auto-filled where known, "To be confirmed" otherwise. */
export function informationRows(candidate:ProfileCandidate,analysis:CandidateProfileAnalysis):[string,string][]{
  return [
    ['Name',candidate.full_name||TO_BE_CONFIRMED],
    ['Photo',''],
    ['Age',TO_BE_CONFIRMED],
    ['Current Employment',currentEmployment(candidate)],
    ['Education',educationText(candidate)],
    ['Nationality',TO_BE_CONFIRMED],
    ['Current Location',candidate.location||TO_BE_CONFIRMED],
    ['Current Salary',TO_BE_CONFIRMED],
    ['Other Benefits',TO_BE_CONFIRMED],
    ['Expected Salary',TO_BE_CONFIRMED],
    ['Notice Period',TO_BE_CONFIRMED],
    ['Languages',candidate.languages.length?candidate.languages.join(', '):TO_BE_CONFIRMED],
    ['Motivation to move',TO_BE_CONFIRMED],
    ['Other Interview Process',TO_BE_CONFIRMED],
    ['First impression of company',TO_BE_CONFIRMED],
    ['First impression of job',TO_BE_CONFIRMED],
    ['Strengths & Opportunities',analysis.strengths_opportunities||TO_BE_CONFIRMED],
    ['Risks & Challenge',analysis.risks_challenges||TO_BE_CONFIRMED],
  ]
}

/** Match an employment item to its AI relevance entry by company+title, falling back to positional index. */
export function relevanceFor(analysis:CandidateProfileAnalysis,item:ProfileEmployment,index:number):string[]{
  const key=(company:string,title:string)=>`${company}`.trim().toLowerCase()+'|'+`${title}`.trim().toLowerCase()
  const target=key(item.company_name,item.title)
  const matched=analysis.experience_relevance.find((entry)=>key(entry.company_name,entry.title)===target)
  return (matched||analysis.experience_relevance[index])?.relevance||[]
}

export function profileFilename(candidate:ProfileCandidate,job:{title:string;company_name:string|null}):string{
  const parts=[candidate.full_name,job.title,job.company_name].filter(Boolean).join('_')
  return `${(parts||'candidate-profile').replace(/[^a-zA-Z0-9._-]+/g,'_')}.docx`
}

// ---- Document assembly --------------------------------------------------------

function border(size=4):IBorderOptions{return {style:BorderStyle.SINGLE,size,color:BORDER_COLOR}}
const cellBorders={top:border(),bottom:border(),left:border(),right:border()}

function labelValueRow(label:string,value:string):TableRow{
  return new TableRow({children:[
    new TableCell({width:{size:28,type:WidthType.PERCENTAGE},borders:cellBorders,children:[new Paragraph({children:[new TextRun({text:label,bold:true})]})]}),
    new TableCell({width:{size:72,type:WidthType.PERCENTAGE},borders:cellBorders,children:[new Paragraph({children:[new TextRun({text:value})]})]}),
  ]})
}

function sectionHeading(text:string):Paragraph{
  return new Paragraph({spacing:{before:280,after:140},children:[new TextRun({text,bold:true,size:28})]})
}

export function buildProfileDocument(input:ProfileDocInput):Document{
  const {candidate,job,analysis,preparedBy,date}=input
  const cover:Paragraph[]=[
    new Paragraph({spacing:{after:120},children:[new TextRun({text:candidate.full_name.toUpperCase(),bold:true,size:40})]}),
    new Paragraph({children:[new TextRun({text:`FOR THE ROLE OF ${(job.title||'').toUpperCase()}`,bold:true,size:28})]}),
    new Paragraph({spacing:{after:360},children:[new TextRun({text:`AT ${(job.company_name||'').toUpperCase()}`,bold:true,size:28})]}),
  ]
  const coverMeta=new Table({width:{size:100,type:WidthType.PERCENTAGE},rows:[
    labelValueRow('Prepared by',preparedBy||TO_BE_CONFIRMED),
    labelValueRow('Date',date||TO_BE_CONFIRMED),
  ]})
  const remarks:Paragraph[]=[
    new Paragraph({spacing:{before:280,after:120},children:[new TextRun({text:'Remarks',bold:true})]}),
    new Paragraph({alignment:AlignmentType.JUSTIFIED,children:[new TextRun({text:CONFIDENTIALITY_REMARK})]}),
    new Paragraph({spacing:{before:200},children:[new TextRun({text:'CONFIDENTIAL: FOR CLIENT USE ONLY',bold:true})]}),
  ]

  const infoTable=new Table({width:{size:100,type:WidthType.PERCENTAGE},rows:informationRows(candidate,analysis).map(([label,value])=>labelValueRow(label,value))})

  const summary:Paragraph[]=[sectionHeading('CANDIDATE SUMMARY')]
  const summaryParas=analysis.candidate_summary.length?analysis.candidate_summary:[TO_BE_CONFIRMED]
  for(const para of summaryParas)summary.push(new Paragraph({alignment:AlignmentType.JUSTIFIED,spacing:{after:120},children:[new TextRun({text:para})]}))
  if(analysis.points_to_validate.length)summary.push(new Paragraph({spacing:{before:120},children:[new TextRun({text:'Points to validate: ',bold:true}),new TextRun({text:analysis.points_to_validate.join('; ')})]}))

  const experience:Paragraph[]=[sectionHeading('WORK EXPERIENCE')]
  if(candidate.employment.length){
    candidate.employment.forEach((item,index)=>{
      const relevance=relevanceFor(analysis,item,index)
      experience.push(
        new Paragraph({spacing:{before:index?200:0},children:[new TextRun({text:'Company: ',bold:true}),new TextRun({text:item.company_name})]}),
        new Paragraph({children:[new TextRun({text:'Job Title: ',bold:true}),new TextRun({text:item.title})]}),
        new Paragraph({spacing:{after:80},children:[new TextRun({text:'Date: ',bold:true}),new TextRun({text:formatEmploymentRange(item)})]}),
      )
      for(const line of relevance)experience.push(new Paragraph({bullet:{level:0},children:[new TextRun({text:line})]}))
    })
  }else{
    experience.push(new Paragraph({children:[new TextRun({text:TO_BE_CONFIRMED})]}))
  }

  return new Document({sections:[{children:[
    ...cover,coverMeta,...remarks,
    new Paragraph({children:[new PageBreak()]}),
    sectionHeading('INFORMATION'),infoTable,
    ...summary,
    ...experience,
  ]}]})
}

export function buildCandidateProfileDocx(input:ProfileDocInput):Promise<Blob>{
  return Packer.toBlob(buildProfileDocument(input))
}

export function downloadBlob(blob:Blob,filename:string):void{
  const url=URL.createObjectURL(blob)
  const anchor=document.createElement('a')
  anchor.href=url;anchor.download=filename;anchor.click()
  URL.revokeObjectURL(url)
}
