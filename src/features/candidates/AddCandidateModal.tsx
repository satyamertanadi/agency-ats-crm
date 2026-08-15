import {useEffect,useRef,useState} from 'react'
import {useForm,useWatch} from 'react-hook-form'
import {zodResolver} from '@hookform/resolvers/zod'
import {useMutation} from '@tanstack/react-query'
import {Link} from 'react-router'
import {candidateFormSchema} from '../core/schemas'
import {DuplicateCandidateError,createCandidate,type CreateCandidateInput} from '../core/repository'
import {updateCandidateWithProfile} from '../core/commercialRepository'
import type {TeamMember} from '../../shared/types/domain'
import {Button} from '../../shared/ui/Button'
import {Callout} from '../../shared/ui/Callout'
import {CollapsibleSection} from '../../shared/ui/CollapsibleSection'
import {Modal} from '../../shared/ui/Modal'
import {Badge} from '../../shared/ui/Page'
import {SegmentedControl} from '../../shared/ui/SegmentedControl'
import {useToast} from '../../shared/ui/Toast'
import {CandidateCvParser} from './CandidateCvParser'
import {CandidateForm,type CandidateFormInput,type CandidateFormOutput} from './CandidateForm'
import {EducationListEditor,EmploymentListEditor,LanguagesListEditor,SkillsListEditor,type EducationItem,type EmploymentItem,type LanguageItem,type SkillItem} from './CandidateProfileEditors'

type AddMode='cv'|'manual'
const MODE_STORAGE_KEY='ats-add-candidate-mode'
/* Remembered because the choice is a habit, not a per-candidate decision: an agency that sources from
 * inbound CVs makes it every time, and so does one that works the phone. Guarded the same way the
 * theme preference is -- private-mode Safari throws on localStorage rather than returning null, and a
 * remembered tab is not worth taking the dialog down for. */
function readMode():AddMode{try{return localStorage.getItem(MODE_STORAGE_KEY)==='manual'?'manual':'cv'}catch{return 'cv'}}
function writeMode(mode:AddMode){try{localStorage.setItem(MODE_STORAGE_KEY,mode)}catch{/* see readMode */}}

const MODES=[{id:'cv' as const,label:'From CV'},{id:'manual' as const,label:'Manual'}]

export interface AddCandidateModalProps {
  open:boolean
  onClose:()=>void
  organizationId:string
  organizationSlug:string
  userId:string
  baseCurrency:string
  salaryPeriod?:'annual'|'monthly'|null
  owners:readonly TeamMember[]
  /* The current user's own membership id. Manual entry defaulted owner to nobody, so every
   * hand-entered candidate arrived unassigned and had to be claimed on a second visit. */
  defaultOwnerMemberId?:string
  onSaved:(candidateId:string)=>void|Promise<void>
}

/* One dialog for both ways a candidate gets into the database.
 *
 * Before this, "Add candidate" opened the CV uploader, and manual entry was a text button underneath
 * it -- so the second-most-common intake path read as a fallback for when the first one failed, and
 * the form it led to was missing nine of the fields the CV path collected. A SegmentedControl makes
 * them two equal modes of one action.
 *
 * Both modes stay mounted, hidden rather than unmounted, for one reason worth the small cost: an
 * in-flight parse and a half-typed manual form both survive switching tabs. Toggling used to be the
 * kind of thing that silently threw away a minute of typing. The dialog is `wide` in both modes so
 * switching never resizes it under the pointer. */
export function AddCandidateModal({open,onClose,organizationId,organizationSlug,userId,baseCurrency,salaryPeriod,owners,defaultOwnerMemberId,onSaved}:AddCandidateModalProps){
  const toast=useToast()
  const [mode,setMode]=useState<AddMode>(readMode)
  const [employment,setEmployment]=useState<EmploymentItem[]>([]);const [education,setEducation]=useState<EducationItem[]>([])
  const [skills,setSkills]=useState<SkillItem[]>([]);const [languages,setLanguages]=useState<LanguageItem[]>([])
  /* Set when the insert collides on email and the repository could resolve what it collided with.
   * `email` is kept so editing the address clears the state -- otherwise the callout keeps naming a
   * record that has nothing to do with what is now in the field. */
  const [duplicate,setDuplicate]=useState<{id:string;name:string;email:string}|null>(null)
  const [cvActive,setCvActive]=useState(false)

  const form=useForm<CandidateFormInput,unknown,CandidateFormOutput>({resolver:zodResolver(candidateFormSchema),
    defaultValues:{full_name:'',email:'',phone:'',current_company:'',current_position:'',location:'',source:'',
      linkedin_url:'',portfolio_url:'',availability:'',status:'active',owner_member_id:defaultOwnerMemberId||'',
      work_authorization:'',salary_currency:baseCurrency}})
  const profileEmpty=employment.length===0&&education.length===0&&skills.length===0&&languages.length===0
  const resetAll=()=>{form.reset({full_name:'',email:'',phone:'',current_company:'',current_position:'',location:'',source:'',
    linkedin_url:'',portfolio_url:'',availability:'',status:'active',owner_member_id:defaultOwnerMemberId||'',
    work_authorization:'',salary_currency:baseCurrency});
    setEmployment([]);setEducation([]);setSkills([]);setLanguages([]);setDuplicate(null)}
  // Reopening is always a new candidate, so the defaults are re-read here rather than held stale.
  useEffect(()=>{if(open)resetAll()},[open])
  /* The team list is a query, and the dialog opens faster than it resolves -- so on the first "Add
   * candidate" of a session the reset above baked in an empty owner and the candidate was created
   * unassigned, which is the exact defect this form exists to fix. Seeded once per opening, so
   * choosing Unassigned deliberately still sticks. setValue rather than reset, and without
   * shouldDirty, so arriving late never trips the discard guard on an untouched form. */
  const ownerSeeded=useRef(false)
  useEffect(()=>{
    if(!open){ownerSeeded.current=false;return}
    if(ownerSeeded.current||!defaultOwnerMemberId)return
    ownerSeeded.current=true
    form.setValue('owner_member_id',defaultOwnerMemberId)
  },[defaultOwnerMemberId,form,open])
  /* useWatch rather than form.watch(): watch() is a function identity the React compiler cannot
   * memoize, so it opts the whole component out of compilation. */
  const email=useWatch({control:form.control,name:'email'})
  useEffect(()=>{if(duplicate&&(email||'').trim().toLowerCase()!==duplicate.email)setDuplicate(null)},[duplicate,email])

  const ownerOptions=owners.filter((member)=>member.status==='active').map((member)=>({id:member.id,label:member.profiles?.full_name||member.profiles?.email||'Teammate'}))
  /* Blank rows are normal in repeatable editors, so they are removed before the whole candidate and
   * profile are handed to one transactional RPC. No child write happens after candidate creation. */
  const profileLists=()=>({
    employment:employment.filter((item)=>item.company_name.trim()&&item.title.trim()),
    education:education.filter((item)=>item.institution.trim()),
    languages:languages.filter((item)=>item.language.trim()),
    skills:skills.filter((item)=>item.name.trim()),
  })

  const toInput=(data:CandidateFormOutput):CreateCandidateInput=>({full_name:data.full_name,email:data.email,phone:data.phone,
    current_company:data.current_company,current_position:data.current_position,location:data.location,source:data.source,
    linkedin_url:data.linkedin_url,portfolio_url:data.portfolio_url,availability:data.availability,
    notice_period_days:data.notice_period_days,status:data.status,owner_member_id:data.owner_member_id,
    current_salary:data.current_salary,expected_salary:data.expected_salary,salary_currency:data.salary_currency,
    work_authorization:data.work_authorization})

  const create=useMutation({mutationFn:async(data:CandidateFormOutput)=>{
    return createCandidate(organizationId,userId,toInput(data),profileLists())
  },onSuccess:async(id,data)=>{toast.success(`${data.full_name} was added to the talent database.`);resetAll();await onSaved(id)},
    /* A collision is not a failure the consultant caused, and it has an obvious next step, so it is
     * handled in the form rather than thrown at them as a red toast. Everything else is. */
    onError:(error,data)=>{
      if(error instanceof DuplicateCandidateError){setDuplicate({id:error.candidateId,name:error.candidateName,email:(data.email||'').trim().toLowerCase()});return}
      toast.error(error,'The candidate was not saved.')
    }})

  /* "Save as update" -- the way out of a duplicate that does not mean retyping into the existing
   * record. Consultant-entered values win here (unlike the CV path, which only fills blanks), because
   * everything in this form was just typed by hand on purpose. */
  const update=useMutation({mutationFn:async(data:CandidateFormOutput)=>{
    const id=duplicate!.id
    await updateCandidateWithProfile(organizationId,id,
      {full_name:data.full_name,current_company:data.current_company,current_position:data.current_position,location:data.location,
        linkedin_url:data.linkedin_url,portfolio_url:data.portfolio_url,status:data.status,owner_member_id:data.owner_member_id||null,
        source:data.source,availability:data.availability,notice_period_days:data.notice_period_days??null},
      {email:data.email,phone:data.phone,current_salary:data.current_salary??null,expected_salary:data.expected_salary??null,
        salary_currency:data.salary_currency,work_authorization:data.work_authorization,
        },profileLists())
    return id
  },onSuccess:async(id,data)=>{toast.success(`${data.full_name} was updated.`,'The existing record was kept — no duplicate was created.');resetAll();await onSaved(id)},
    onError:(error)=>toast.error(error,'The existing record was not updated.')})

  const saving=create.isPending||update.isPending
  const dirty=mode==='manual'?form.formState.isDirty||!profileEmpty:cvActive
  const switchMode=(next:AddMode)=>{setMode(next);writeMode(next);if(next==='manual')setTimeout(()=>form.setFocus('full_name'),0)}

  return <Modal title="Add candidate" eyebrow="Talent database" open={open} wide onClose={onClose} dirty={dirty&&!saving}
    discardMessage={mode==='manual'?'Close without saving this candidate?':'Discard this CV upload?'}>
    <div className="add-candidate stack">
      <SegmentedControl label="How to add this candidate" options={MODES} value={mode} onChange={switchMode}/>

      <div hidden={mode!=='cv'}>
        <CandidateCvParser organizationId={organizationId} userId={userId} onDirtyChange={setCvActive}
          onCancel={onClose} onManual={()=>switchMode('manual')}
          onAccepted={async(id)=>{setCvActive(false);await onSaved(id)}}/>
      </div>

      <form hidden={mode!=='manual'} onSubmit={form.handleSubmit((data)=>(duplicate?update:create).mutate(data))}>
        <div className="stack">
          {duplicate&&<Callout tone="warning" title="That email is already in the database"
            action={<Link className="button button-secondary button-sm" to={`/app/${organizationSlug}/candidates/${duplicate.id}`}>Open existing record</Link>}>
            {duplicate.name} already has this email address. Change the email to add someone new, or save what you have typed onto that record instead.
          </Callout>}
          <CandidateForm form={form} mode="create" owners={ownerOptions} salaryPeriod={salaryPeriod} baseCurrency={baseCurrency}/>
          {/* Collapsed by default: most candidates arrive with a CV that fills these richly, and the
            * ones typed by hand are usually typed from a phone call where none of it is known yet.
            * Available in one click is the right cost; nine empty rows on screen is not. */}
          <CollapsibleSection title="Employment" badge={employment.length>0?<Badge>{employment.length}</Badge>:undefined}><EmploymentListEditor value={employment} onChange={setEmployment} showHeading={false}/></CollapsibleSection>
          <CollapsibleSection title="Education" badge={education.length>0?<Badge>{education.length}</Badge>:undefined}><EducationListEditor value={education} onChange={setEducation} showHeading={false}/></CollapsibleSection>
          <CollapsibleSection title="Skills" badge={skills.length>0?<Badge>{skills.length}</Badge>:undefined}><SkillsListEditor value={skills} onChange={setSkills} showHeading={false}/></CollapsibleSection>
          <CollapsibleSection title="Languages" badge={languages.length>0?<Badge>{languages.length}</Badge>:undefined}><LanguagesListEditor value={languages} onChange={setLanguages} showHeading={false}/></CollapsibleSection>
          <div className="form-actions">
            <Button type="button" variant="quiet" disabled={saving} onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={saving}>{duplicate?'Save as update':'Create candidate'}</Button>
          </div>
        </div>
      </form>
    </div>
  </Modal>
}
