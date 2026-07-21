import type {ReactNode} from 'react'
import {AlertTriangle,Plus,Trash2} from 'lucide-react'
import type {z} from 'zod'
import type {cvEducationSchema,cvEmploymentSchema,cvLanguageSchema,cvSkillSchema} from '../../shared/validation/candidateFields'
import {Button} from '../../shared/ui/Button'
import {Field,Input,Select,Textarea} from '../../shared/ui/Field'

export type EmploymentItem=z.infer<typeof cvEmploymentSchema>
export type EducationItem=z.infer<typeof cvEducationSchema>
export type SkillItem=z.infer<typeof cvSkillSchema>
export type LanguageItem=z.infer<typeof cvLanguageSchema>

// Optional so these editors work both inside CV review (where a field can be flagged low-confidence
// against the parser's extraction) and in plain manual-add / detail-page editing (where there is no
// confidence signal at all and the prop is simply omitted).
export type ConfidenceFn=(index:number,field:string)=>'low'|undefined

const datePrecisionOptions=<><option value="">Unknown</option><option value="day">Day</option><option value="month">Month</option><option value="year">Year</option></>

function RepeatField({label,low,children}:{label:string;low:boolean;children:ReactNode}){
  return <Field label={label}>{children}{low&&<small className="cv-low-confidence"><AlertTriangle size={11}/>Low confidence — check this value</small>}</Field>
}

export function EmploymentListEditor({value,onChange,confidenceFor,disabled,showHeading=true}:{value:EmploymentItem[];onChange:(items:EmploymentItem[])=>void;confidenceFor?:ConfidenceFn;disabled?:boolean;showHeading?:boolean}){
  const change=<K extends keyof EmploymentItem>(index:number,key:K,fieldValue:EmploymentItem[K])=>onChange(value.map((item,itemIndex)=>itemIndex===index?{...item,[key]:fieldValue}:item))
  const low=(index:number,field:string)=>confidenceFor?.(index,field)==='low'
  return <section>
    <div className="cv-section-title">{showHeading&&<h3>Employment</h3>}<Button variant="secondary" leadingIcon={<Plus size={13}/>} disabled={disabled} onClick={()=>onChange([...value,{company_name:'',title:'',location:null,started_on:null,ended_on:null,is_current:false,summary:null,started_on_precision:null,ended_on_precision:null,sort_order:value.length}])}>Add</Button></div>
    {value.map((item,index)=><div className="cv-repeat-card" key={`employment-${index}`}>
      <div className="form-grid">
        <RepeatField label="Company" low={low(index,'company_name')}><Input value={item.company_name} disabled={disabled} onChange={(event)=>change(index,'company_name',event.target.value)}/></RepeatField>
        <RepeatField label="Title" low={low(index,'title')}><Input value={item.title} disabled={disabled} onChange={(event)=>change(index,'title',event.target.value)}/></RepeatField>
        <Field label="Started"><Input type="date" disabled={disabled} value={item.started_on||''} onChange={(event)=>change(index,'started_on',event.target.value||null)}/></Field>
        <Field label="Start precision"><Select value={item.started_on_precision||''} disabled={disabled} onChange={(event)=>change(index,'started_on_precision',(event.target.value||null) as EmploymentItem['started_on_precision'])}>{datePrecisionOptions}</Select></Field>
        <Field label="Ended"><Input type="date" disabled={disabled} value={item.ended_on||''} onChange={(event)=>change(index,'ended_on',event.target.value||null)}/></Field>
        <Field label="End precision"><Select value={item.ended_on_precision||''} disabled={disabled} onChange={(event)=>change(index,'ended_on_precision',(event.target.value||null) as EmploymentItem['ended_on_precision'])}>{datePrecisionOptions}</Select></Field>
        <Field label="Summary"><Textarea value={item.summary||''} disabled={disabled} onChange={(event)=>change(index,'summary',event.target.value||null)}/></Field>
        <label className="cv-checkbox"><input type="checkbox" checked={item.is_current} disabled={disabled} onChange={(event)=>change(index,'is_current',event.target.checked)}/>Current role</label>
      </div>
      <Button variant="quiet" leadingIcon={<Trash2 size={14}/>} disabled={disabled} onClick={()=>onChange(value.filter((_,itemIndex)=>itemIndex!==index))}>Remove</Button>
    </div>)}
  </section>
}

export function EducationListEditor({value,onChange,confidenceFor,disabled,showHeading=true}:{value:EducationItem[];onChange:(items:EducationItem[])=>void;confidenceFor?:ConfidenceFn;disabled?:boolean;showHeading?:boolean}){
  const change=<K extends keyof EducationItem>(index:number,key:K,fieldValue:EducationItem[K])=>onChange(value.map((item,itemIndex)=>itemIndex===index?{...item,[key]:fieldValue}:item))
  const low=(index:number,field:string)=>confidenceFor?.(index,field)==='low'
  return <section>
    <div className="cv-section-title">{showHeading&&<h3>Education</h3>}<Button variant="secondary" leadingIcon={<Plus size={13}/>} disabled={disabled} onClick={()=>onChange([...value,{institution:'',degree:null,field_of_study:null,started_on:null,ended_on:null,started_on_precision:null,ended_on_precision:null,sort_order:value.length}])}>Add</Button></div>
    {value.map((item,index)=><div className="cv-repeat-card" key={`education-${index}`}>
      <div className="form-grid">
        <RepeatField label="Institution" low={low(index,'institution')}><Input value={item.institution} disabled={disabled} onChange={(event)=>change(index,'institution',event.target.value)}/></RepeatField>
        <Field label="Degree"><Input value={item.degree||''} disabled={disabled} onChange={(event)=>change(index,'degree',event.target.value||null)}/></Field>
        <Field label="Field of study"><Input value={item.field_of_study||''} disabled={disabled} onChange={(event)=>change(index,'field_of_study',event.target.value||null)}/></Field>
        <Field label="Started"><Input type="date" disabled={disabled} value={item.started_on||''} onChange={(event)=>change(index,'started_on',event.target.value||null)}/></Field>
        <Field label="Start precision"><Select value={item.started_on_precision||''} disabled={disabled} onChange={(event)=>change(index,'started_on_precision',(event.target.value||null) as EducationItem['started_on_precision'])}>{datePrecisionOptions}</Select></Field>
        <Field label="Ended"><Input type="date" disabled={disabled} value={item.ended_on||''} onChange={(event)=>change(index,'ended_on',event.target.value||null)}/></Field>
        <Field label="End precision"><Select value={item.ended_on_precision||''} disabled={disabled} onChange={(event)=>change(index,'ended_on_precision',(event.target.value||null) as EducationItem['ended_on_precision'])}>{datePrecisionOptions}</Select></Field>
      </div>
      <Button variant="quiet" leadingIcon={<Trash2 size={14}/>} disabled={disabled} onClick={()=>onChange(value.filter((_,itemIndex)=>itemIndex!==index))}>Remove</Button>
    </div>)}
  </section>
}

export function SkillsListEditor({value,onChange,disabled,showHeading=true}:{value:SkillItem[];onChange:(items:SkillItem[])=>void;disabled?:boolean;showHeading?:boolean}){
  const change=<K extends keyof SkillItem>(index:number,key:K,fieldValue:SkillItem[K])=>onChange(value.map((item,itemIndex)=>itemIndex===index?{...item,[key]:fieldValue}:item))
  return <section>
    <div className="cv-section-title">{showHeading&&<h3>Skills</h3>}<Button variant="secondary" leadingIcon={<Plus size={13}/>} disabled={disabled} onClick={()=>onChange([...value,{name:'',proficiency:null,years_experience:null}])}>Add</Button></div>
    {value.length>0&&<div className="cv-inline-row cv-inline-row-header" aria-hidden="true"><span>Skill</span><span>Proficiency</span><span>Years</span><span/></div>}
    {value.map((item,index)=><div className="cv-inline-row" key={`skill-${index}`}>
      <Input aria-label="Skill" value={item.name} disabled={disabled} onChange={(event)=>change(index,'name',event.target.value)}/>
      <Input aria-label="Skill proficiency" value={item.proficiency||''} disabled={disabled} onChange={(event)=>change(index,'proficiency',event.target.value||null)}/>
      <Input aria-label="Years of experience" type="number" min="0" step="0.5" value={item.years_experience??''} disabled={disabled} onChange={(event)=>change(index,'years_experience',event.target.value?Number(event.target.value):null)}/>
      <Button variant="quiet" leadingIcon={<Trash2 size={14}/>} disabled={disabled} onClick={()=>onChange(value.filter((_,itemIndex)=>itemIndex!==index))}>Remove</Button>
    </div>)}
  </section>
}

export function LanguagesListEditor({value,onChange,disabled,showHeading=true}:{value:LanguageItem[];onChange:(items:LanguageItem[])=>void;disabled?:boolean;showHeading?:boolean}){
  const change=<K extends keyof LanguageItem>(index:number,key:K,fieldValue:LanguageItem[K])=>onChange(value.map((item,itemIndex)=>itemIndex===index?{...item,[key]:fieldValue}:item))
  return <section>
    <div className="cv-section-title">{showHeading&&<h3>Languages</h3>}<Button variant="secondary" leadingIcon={<Plus size={13}/>} disabled={disabled} onClick={()=>onChange([...value,{language:'',proficiency:null}])}>Add</Button></div>
    {value.length>0&&<div className="cv-inline-row cv-inline-row-short cv-inline-row-header" aria-hidden="true"><span>Language</span><span>Proficiency</span><span/></div>}
    {value.map((item,index)=><div className="cv-inline-row cv-inline-row-short" key={`language-${index}`}>
      <Input aria-label="Language" value={item.language} disabled={disabled} onChange={(event)=>change(index,'language',event.target.value)}/>
      <Input aria-label="Language proficiency" value={item.proficiency||''} disabled={disabled} onChange={(event)=>change(index,'proficiency',event.target.value||null)}/>
      <Button variant="quiet" leadingIcon={<Trash2 size={14}/>} disabled={disabled} onClick={()=>onChange(value.filter((_,itemIndex)=>itemIndex!==index))}>Remove</Button>
    </div>)}
  </section>
}
