import {useState,type FocusEvent} from 'react'
import {useForm} from 'react-hook-form'
import {zodResolver} from '@hookform/resolvers/zod'
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query'
import {Archive,ArrowLeft,Briefcase,CalendarClock,FileSignature,FileText,GraduationCap,Inbox,Languages,Layers3,Mail,MessageSquare,MoreHorizontal,Plus,RotateCcw,Tag,TriangleAlert,Trash2,Upload,Wrench} from 'lucide-react'
import {Link,useParams,useSearchParams} from 'react-router-dom'
import type {z} from 'zod'
import {useOrganization} from '../../app/OrganizationProvider'
import {useAuth} from '../../app/AuthProvider'
import {addCandidateEmployment,addCandidateEducation,addCandidateLanguage,addCandidateSkill,addCandidateTag,deleteCandidateDocument,deleteCandidateProfileItem,getCandidateDetail,listCandidateDocuments,listCandidateProfileVersions,listTeamMembers,removeCandidateSkill,removeCandidateTag,setCandidateArchived,updateCandidateEducation,updateCandidateEmployment,updateCandidateLanguage,updateCandidateProfile,updateCandidateSkill} from '../core/commercialRepository'
import {candidateProfileEditSchema} from '../core/schemas'
import {Button} from '../../shared/ui/Button'
import {Field,Input,Select} from '../../shared/ui/Field'
import {Modal} from '../../shared/ui/Modal'
import {Badge,Panel,StatusBadge} from '../../shared/ui/Page'
import {candidateStatus,consentStatus,lookup,profileStatus,type Tone} from '../../shared/lib/status'
import {EmptyState,ErrorState,LoadingState} from '../../shared/ui/States'
import {formatCvDate,formatDate,formatSalary} from '../../shared/lib/format'
import {whatsAppLink} from '../../shared/lib/whatsapp'
import {CandidateCvParser} from './CandidateCvParser'
import {CandidateProfileGenerator} from './CandidateProfileGenerator'
import {EducationListEditor,EmploymentListEditor,LanguagesListEditor,SkillsListEditor,type EducationItem,type EmploymentItem,type LanguageItem,type SkillItem} from './CandidateProfileEditors'
import {ActivityFeed} from '../activities/ActivityFeed'
import {useWorkspaceCapabilities} from '../../app/useWorkspaceCapabilities'
import {Table} from '../../shared/ui/Table'
import {createActivity,listCandidatePipelineAssignments} from '../core/repository'
import {phaseForStage,pipelinePhases} from '../workflow/workflow'
import {AddCandidateToJobModal} from './AddCandidateToJobModal'
import {TaskButton} from '../activities/TaskButton'
import {useToast} from '../../shared/ui/Toast'

type AddMode='tag'|null
type EditFormInput=z.input<typeof candidateProfileEditSchema>;type EditFormData=z.output<typeof candidateProfileEditSchema>
type EditableEmployment=EmploymentItem&{id?:string}
type EditableEducation=EducationItem&{id?:string}
type EditableLanguage=LanguageItem&{id?:string}
type EditableSkill=SkillItem&{skill_id?:string}

/* The record used to be one ~11-panel scroll. The panels are unchanged; they are now grouped into
 * four tabs so the common case (where is this person in our pipelines, how do I reach them) is the
 * default view and costs no scrolling. Tab state lives in `?tab=` rather than useState so a tab is
 * deep-linkable and survives refresh and back -- the same reason JobWorkspacePage keys `?view=`. */
const TABS=[{key:'overview',label:'Overview'},{key:'profile',label:'Profile'},{key:'activity',label:'Activity'},{key:'documents',label:'Documents & profiles'}] as const
type TabKey=typeof TABS[number]['key']

export function CandidateDetailPage(){
  const {candidateId=''}=useParams();const {organization}=useOrganization();const {user}=useAuth();const capabilities=useWorkspaceCapabilities();const cache=useQueryClient();const toast=useToast();const [params,setParams]=useSearchParams();const [addMode,setAddMode]=useState<AddMode>(null);const [cvOpen,setCvOpen]=useState(false);const [profileOpen,setProfileOpen]=useState(false);const [editing,setEditing]=useState(false);const [jobOpen,setJobOpen]=useState(false);const [menuOpen,setMenuOpen]=useState(false);const [renderedAt]=useState(Date.now)
  const detail=useQuery({queryKey:['candidate-detail',organization?.id,candidateId],enabled:Boolean(organization&&candidateId),queryFn:()=>getCandidateDetail(organization!.id,candidateId)})
  const documents=useQuery({queryKey:['candidate-documents',organization?.id,candidateId],enabled:Boolean(organization&&candidateId),queryFn:()=>listCandidateDocuments(organization!.id,candidateId)})
  const profileVersions=useQuery({queryKey:['candidate-profile-versions',organization?.id,candidateId],enabled:Boolean(organization&&candidateId&&organization.profile_enabled),queryFn:()=>listCandidateProfileVersions(organization!.id,candidateId)})
  const members=useQuery({queryKey:['members',organization?.id],enabled:Boolean(organization),queryFn:()=>listTeamMembers(organization!.id)})
  const pipelines=useQuery({queryKey:['candidate-pipelines',organization?.id,candidateId],enabled:Boolean(organization&&candidateId),queryFn:()=>listCandidatePipelineAssignments(organization!.id,candidateId)})
  const refresh=()=>Promise.all([cache.invalidateQueries({queryKey:['candidate-detail',organization?.id,candidateId]}),cache.invalidateQueries({queryKey:['candidate-documents',organization?.id,candidateId]}),cache.invalidateQueries({queryKey:['candidate-profile-versions',organization?.id,candidateId]}),cache.invalidateQueries({queryKey:['candidates-page',organization?.id]})])
  // candidateProfileEditSchema didn't exist before -- this panel previously saved via a raw
  // FormData read with only native `required` attributes, so a bad email or phone saved silently.
  const editForm=useForm<EditFormInput,unknown,EditFormData>({resolver:zodResolver(candidateProfileEditSchema),defaultValues:{full_name:'',status:'active',consent_status:'unknown'}})
  const save=useMutation({mutationFn:(data:EditFormData)=>updateCandidateProfile(organization!.id,candidateId,{full_name:data.full_name,current_company:data.current_company,current_position:data.current_position,location:data.location,linkedin_url:data.linkedin_url,portfolio_url:data.portfolio_url,status:data.status,owner_member_id:data.owner_member_id||null,source:data.source,availability:data.availability,notice_period_days:data.notice_period_days??null},{email:data.email,phone:data.phone,current_salary:data.current_salary??null,expected_salary:data.expected_salary??null,salary_currency:data.salary_currency,work_authorization:data.work_authorization,consent_status:data.consent_status,consent_expires_at:data.consent_expires_at||null}),onSuccess:async()=>{setEditing(false);await refresh()}})
  const archive=useMutation({mutationFn:(archived:boolean)=>setCandidateArchived(organization!.id,candidateId,archived),onSuccess:refresh})
  const removeItem=useMutation({mutationFn:({table,id}:{table:'candidate_employment'|'candidate_education'|'candidate_languages';id:string})=>deleteCandidateProfileItem(table,organization!.id,id),onSuccess:refresh})
  const removeSkill=useMutation({mutationFn:(skillId:string)=>removeCandidateSkill(organization!.id,candidateId,skillId),onSuccess:refresh})
  /* Was a bare promise with .then(refresh) and no catch -- a failure changed nothing and said
   * nothing. Archiving a CV is also the one document action a consultant cannot redo from the
   * UI, so it reports both outcomes by name. */
  const removeDocument=useMutation({mutationFn:({id,storagePath}:{id:string;storagePath:string;filename:string})=>deleteCandidateDocument(organization!.id,id,storagePath),onSuccess:async(_result,variables)=>{toast.success(`${variables.filename} archived.`);await refresh()},onError:(error,variables)=>toast.error(error,`${variables.filename} was not archived.`)})
  const removeTag=useMutation({mutationFn:(tagId:string)=>removeCandidateTag(organization!.id,candidateId,tagId),onSuccess:refresh})
  // wa.me only opens a chat with the message pre-filled -- nothing sends until the recruiter hits
  // send inside WhatsApp itself, so this logs "opened," not "sent," and never blocks the tab from
  // opening even if the activity write fails.
  const logWhatsApp=useMutation({mutationFn:(name:string)=>createActivity(organization!.id,{activity_type:'whatsapp',direction:'outbound',summary:`WhatsApp conversation opened with ${name}.`},[{candidate_id:candidateId}]),onSuccess:refresh})
  // In-place panel editing (Phase 5): each panel keeps its own open/draft state and diffs the draft
  // against the record on save (present id -> update, missing id -> delete, no id -> insert). This
  // replaces AddProfileItem's old one-entry-at-a-time flow for these four profile sections.
  const [employmentEditing,setEmploymentEditing]=useState(false);const [employmentDraft,setEmploymentDraft]=useState<EditableEmployment[]>([])
  const [educationEditing,setEducationEditing]=useState(false);const [educationDraft,setEducationDraft]=useState<EditableEducation[]>([])
  const [languagesEditing,setLanguagesEditing]=useState(false);const [languagesDraft,setLanguagesDraft]=useState<EditableLanguage[]>([])
  const [skillsEditing,setSkillsEditing]=useState(false);const [skillsDraft,setSkillsDraft]=useState<EditableSkill[]>([])
  const saveEmployment=useMutation({mutationFn:async(items:EditableEmployment[])=>{const originalIds=new Set((detail.data?.candidate_employment||[]).map((item)=>item.id));const draftIds=new Set(items.filter((item)=>item.id).map((item)=>item.id as string));await Promise.all([...[...originalIds].filter((id)=>!draftIds.has(id)).map((id)=>deleteCandidateProfileItem('candidate_employment',organization!.id,id)),...items.filter((item)=>item.id).map((item)=>updateCandidateEmployment(organization!.id,item.id as string,item)),...items.filter((item)=>!item.id&&item.company_name.trim()&&item.title.trim()).map((item)=>addCandidateEmployment(organization!.id,candidateId,item))])},onSuccess:async()=>{setEmploymentEditing(false);await refresh()}})
  const saveEducation=useMutation({mutationFn:async(items:EditableEducation[])=>{const originalIds=new Set((detail.data?.candidate_education||[]).map((item)=>item.id));const draftIds=new Set(items.filter((item)=>item.id).map((item)=>item.id as string));await Promise.all([...[...originalIds].filter((id)=>!draftIds.has(id)).map((id)=>deleteCandidateProfileItem('candidate_education',organization!.id,id)),...items.filter((item)=>item.id).map((item)=>updateCandidateEducation(organization!.id,item.id as string,item)),...items.filter((item)=>!item.id&&item.institution.trim()).map((item)=>addCandidateEducation(organization!.id,candidateId,item))])},onSuccess:async()=>{setEducationEditing(false);await refresh()}})
  const saveLanguages=useMutation({mutationFn:async(items:EditableLanguage[])=>{const originalIds=new Set((detail.data?.candidate_languages||[]).map((item)=>item.id));const draftIds=new Set(items.filter((item)=>item.id).map((item)=>item.id as string));await Promise.all([...[...originalIds].filter((id)=>!draftIds.has(id)).map((id)=>deleteCandidateProfileItem('candidate_languages',organization!.id,id)),...items.filter((item)=>item.id).map((item)=>updateCandidateLanguage(organization!.id,item.id as string,item.language,item.proficiency||'')),...items.filter((item)=>!item.id&&item.language.trim()).map((item)=>addCandidateLanguage(organization!.id,candidateId,item.language,item.proficiency||''))])},onSuccess:async()=>{setLanguagesEditing(false);await refresh()}})
  const saveSkills=useMutation({mutationFn:async(items:EditableSkill[])=>{const originalIds=new Set((detail.data?.candidate_skills||[]).map((item)=>item.skill_id));const draftIds=new Set(items.filter((item)=>item.skill_id).map((item)=>item.skill_id as string));await Promise.all([...[...originalIds].filter((id)=>!draftIds.has(id)).map((id)=>removeCandidateSkill(organization!.id,candidateId,id)),...items.filter((item)=>item.skill_id&&item.name.trim()).map((item)=>updateCandidateSkill(organization!.id,candidateId,item.skill_id as string,item.name,item.proficiency||'',item.years_experience??undefined)),...items.filter((item)=>!item.skill_id&&item.name.trim()).map((item)=>addCandidateSkill(organization!.id,candidateId,item.name,item.proficiency||'',item.years_experience??undefined))])},onSuccess:async()=>{setSkillsEditing(false);await refresh()}})
  if(detail.isLoading||documents.isLoading||members.isLoading||profileVersions.isLoading||pipelines.isLoading)return <LoadingState/>;if(detail.error||documents.error||members.error||profileVersions.error||pipelines.error||!detail.data)return <ErrorState error={detail.error||documents.error||members.error||profileVersions.error||pipelines.error}/>
  const candidate=detail.data;const privateData=Array.isArray(candidate.candidate_private_details)?candidate.candidate_private_details[0]:candidate.candidate_private_details
  const startEditing=()=>{editForm.reset({full_name:candidate.full_name,owner_member_id:candidate.owner_member_id||'',current_company:candidate.current_company||'',current_position:candidate.current_position||'',location:candidate.location||'',source:candidate.source||'',linkedin_url:candidate.linkedin_url||'',portfolio_url:candidate.portfolio_url||'',availability:candidate.availability||'',notice_period_days:candidate.notice_period_days??undefined,status:candidate.status,email:privateData?.email||'',phone:privateData?.phone||'',current_salary:privateData?.current_salary??undefined,expected_salary:privateData?.expected_salary??undefined,salary_currency:privateData?.salary_currency||organization?.base_currency||'',work_authorization:privateData?.work_authorization||'',consent_status:privateData?.consent_status||'unknown',consent_expires_at:privateData?.consent_expires_at?.slice(0,10)||''});setEditing(true)}
  // Entering edit mode from an empty panel seeds one blank row so "Add the first role" (etc.) lands
  // straight on a fillable form, the same as the old one-entry-at-a-time modal did, rather than an
  // empty editor that needs its own internal "+Add" clicked first.
  const startEmploymentEdit=()=>{const existing=candidate.candidate_employment||[];setEmploymentDraft(existing.length?existing.map((item,index)=>({id:item.id,company_name:item.company_name,title:item.title,location:null,started_on:item.started_on,ended_on:item.ended_on,is_current:item.is_current,summary:item.summary,started_on_precision:item.started_on_precision as EmploymentItem['started_on_precision'],ended_on_precision:item.ended_on_precision as EmploymentItem['ended_on_precision'],sort_order:index})):[{company_name:'',title:'',location:null,started_on:null,ended_on:null,is_current:false,summary:null,started_on_precision:null,ended_on_precision:null,sort_order:0}]);setEmploymentEditing(true)}
  const startEducationEdit=()=>{const existing=candidate.candidate_education||[];setEducationDraft(existing.length?existing.map((item,index)=>({id:item.id,institution:item.institution,degree:item.degree,field_of_study:item.field_of_study,started_on:item.started_on,ended_on:item.ended_on,started_on_precision:item.started_on_precision as EducationItem['started_on_precision'],ended_on_precision:item.ended_on_precision as EducationItem['ended_on_precision'],sort_order:index})):[{institution:'',degree:null,field_of_study:null,started_on:null,ended_on:null,started_on_precision:null,ended_on_precision:null,sort_order:0}]);setEducationEditing(true)}
  const startLanguagesEdit=()=>{const existing=candidate.candidate_languages||[];setLanguagesDraft(existing.length?existing.map((item)=>({id:item.id,language:item.language,proficiency:item.proficiency})):[{language:'',proficiency:null}]);setLanguagesEditing(true)}
  const startSkillsEdit=()=>{const existing=candidate.candidate_skills||[];setSkillsDraft(existing.length?existing.map((item)=>({skill_id:item.skill_id,name:item.skills?.name||'',proficiency:item.proficiency,years_experience:item.years_experience})):[{name:'',proficiency:null,years_experience:null}]);setSkillsEditing(true)}
  const preparedBy=members.data?.find((member)=>member.user_id===user?.id)?.profiles?.full_name||''
  const canWrite=Boolean(capabilities.data?.canWriteCandidates)
  const openWhatsApp=()=>{
    if(!privateData?.phone){toast.error('No phone number on file for this candidate.');return}
    const firstName=candidate.full_name.split(/\s+/)[0]||candidate.full_name
    const link=whatsAppLink(privateData.phone,`Hi ${firstName}, this is ${preparedBy||'the team'} from ${organization?.name||'our agency'}. Do you have a moment to chat?`)
    if(!link){toast.error('That phone number could not be turned into a WhatsApp link.');return}
    window.open(link,'_blank','noopener,noreferrer')
    logWhatsApp.mutate(candidate.full_name)
  }
  const tab=(TABS.find((item)=>item.key===params.get('tab'))?.key||'overview') as TabKey
  const selectTab=(next:TabKey)=>{const nextParams=new URLSearchParams(params);if(next==='overview')nextParams.delete('tab');else nextParams.set('tab',next);setParams(nextParams)}
  const initials=candidate.full_name.split(/\s+/).filter(Boolean).slice(0,2).map((part)=>part[0]?.toUpperCase()||'').join('')||'?'
  const pipelineCount=pipelines.data?.length||0
  /* The readiness facts a recruiter checks before doing anything else, lifted out of the old
   * mid-page panel into a band under the name. Consent borrows tone from the domain status map so
   * this strip cannot drift from how consent is coloured everywhere else. */
  const consentMeta=lookup(consentStatus,privateData?.consent_status||'unknown')
  const cvMissing=!documents.data?.length
  const consentExpiresInDays=privateData?.consent_expires_at?Math.ceil((new Date(privateData.consent_expires_at).getTime()-renderedAt)/86_400_000):null
  const consentNeedsAction=['unknown','withdrawn','expired'].includes(privateData?.consent_status||'unknown')
  const consentExpiringSoon=!consentNeedsAction&&consentExpiresInDays!=null&&consentExpiresInDays>=0&&consentExpiresInDays<=30
  const readiness:{label:string;value:string;tone:Tone}[]=[
    {label:'Consent',value:consentMeta.label,tone:consentMeta.tone},
    {label:'Contactable',value:candidate.status==='do_not_contact'?'Do not contact':'Yes',tone:candidate.status==='do_not_contact'?'bad':'good'},
    {label:'CV',value:documents.data?.length?'Available':'Upload required',tone:documents.data?.length?'good':'warn'},
    {label:'Availability',value:candidate.availability||'Not recorded',tone:candidate.availability?'neutral':'warn'},
    {label:'Expected salary',value:formatSalary(privateData?.expected_salary,privateData?.salary_currency||organization?.base_currency),tone:'neutral'},
    {label:'In pipelines',value:String(pipelineCount),tone:pipelineCount?'info':'neutral'},
  ]
  /* Only genuinely actionable facts get promoted into the action band -- everything else (including
   * CV/consent when they're already fine) stays in the reference strip below. Built from the exact
   * same `readiness` array rather than a second data source, per the redesign handoff. */
  type ActionItem={key:string;title:string;description:string;cta:string;primary?:boolean;onClick:()=>void}
  const actionItems:ActionItem[]=[]
  if(cvMissing)actionItems.push({key:'cv',title:'CV missing',description:'This candidate cannot be submitted to a client without one.',cta:'Upload CV',primary:true,onClick:()=>setCvOpen(true)})
  if(consentNeedsAction)actionItems.push({key:'consent-status',title:consentMeta.label,description:'Update this candidate’s consent before further outreach.',cta:'Update consent',onClick:startEditing})
  else if(consentExpiringSoon)actionItems.push({key:'consent-expiring',title:`Consent expires in ${consentExpiresInDays} day${consentExpiresInDays===1?'':'s'}`,description:`Renew before ${formatDate(privateData!.consent_expires_at!)}.`,cta:'Renew',onClick:startEditing})
  const referenceFacts=readiness.filter((item)=>!((item.label==='CV'&&cvMissing)||(item.label==='Consent'&&(consentNeedsAction||consentExpiringSoon))))
  const closeMenu=(event:FocusEvent<HTMLDivElement>)=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))setMenuOpen(false)}
  const runFromMenu=(action:()=>void)=>{setMenuOpen(false);action()}
  /* Every overflow entry is write-gated, so a reader sees no menu button at all rather than one
   * that opens onto nothing. */
  const hasOverflow=canWrite

  return <main className="page candidate-detail">
    <div className="breadcrumbs"><Link className="button button-quiet" to={`/app/${organization?.slug}/candidates`}><ArrowLeft size={15}/>Candidates</Link></div>
    <header className="candidate-summary">
      <span className="candidate-summary-avatar" aria-hidden="true">{initials}</span>
      <div className="candidate-summary-identity">
        <p className="eyebrow">Candidate</p>
        <h1>{candidate.full_name}</h1>
        <p>{candidate.current_position||'Role not recorded'}{candidate.current_company?` at ${candidate.current_company}`:''}</p>
        <div className="candidate-summary-meta"><StatusBadge map={candidateStatus} value={candidate.status}/>{candidate.location&&<span>{candidate.location}</span>}</div>
      </div>
      <div className="candidate-summary-actions">
        {capabilities.data?.canMovePipeline&&<Button onClick={()=>setJobOpen(true)} disabled={Boolean(candidate.deleted_at)||candidate.status==='do_not_contact'}>Add to job</Button>}
        <TaskButton linkType="candidate" linkId={candidateId}/>
        {canWrite&&<Button variant="secondary" onClick={()=>editing?setEditing(false):startEditing()}>{editing?'Cancel edit':'Edit candidate'}</Button>}
        {hasOverflow&&<div className="record-actions-menu" onBlur={closeMenu}>
          <Button variant="secondary" aria-haspopup="menu" aria-expanded={menuOpen} iconOnlyLabel="More actions" leadingIcon={<MoreHorizontal size={16}/>} onClick={()=>setMenuOpen((value)=>!value)} onKeyDown={(event)=>{if(event.key==='Escape')setMenuOpen(false)}}/>
          {menuOpen&&<div className="record-actions-menu-panel" role="menu">
            {organization?.profile_enabled&&canWrite&&<button type="button" role="menuitem" onClick={()=>runFromMenu(()=>setProfileOpen(true))}><FileSignature size={15}/>Generate client profile</button>}
            {canWrite&&<button type="button" role="menuitem" onClick={()=>runFromMenu(()=>setCvOpen(true))}><Upload size={15}/>Upload or parse CV</button>}
            {canWrite&&<><span className="record-actions-menu-divider"/><button type="button" role="menuitem" className="menu-caution" disabled={archive.isPending} onClick={()=>runFromMenu(()=>archive.mutate(!candidate.deleted_at))}>{candidate.deleted_at?<><RotateCcw size={15}/>Restore candidate</>:<><Archive size={15}/>Archive candidate</>}</button></>}
          </div>}
        </div>}
      </div>
    </header>
    {candidate.deleted_at&&<p className="warning-box">This record is archived and excluded from normal candidate searches.</p>}
    {actionItems.length>0&&<section className="readiness-action-band">
      <header><TriangleAlert size={15}/><strong>Needs action · {actionItems.length}</strong></header>
      <div className="readiness-action-grid">{actionItems.map((item)=><div className="readiness-action-card" key={item.key}>
        <span className="readiness-action-icon">{item.key==='cv'?<Upload size={15}/>:<CalendarClock size={15}/>}</span>
        <div><strong>{item.title}</strong><span>{item.description}</span></div>
        <Button size="sm" variant={item.primary?'primary':'secondary'} onClick={item.onClick}>{item.cta}</Button>
      </div>)}</div>
    </section>}
    <dl className="readiness-strip readiness-strip-reference">{referenceFacts.map((item)=><div className={`readiness-chip tone-${item.tone}`} key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>

    {/* While editing, the two edit panels take the place of the tab content exactly as before; the
      * tab bar is hidden because switching tabs would not change what is on screen. */}
    {editing?<form className="stack" onSubmit={editForm.handleSubmit((data)=>save.mutate(data))}>
      <Panel title="Profile and ownership"><div className="form-grid"><Field label="Full name" error={editForm.formState.errors.full_name?.message}><Input {...editForm.register('full_name')}/></Field><Field label="Owner"><Select {...editForm.register('owner_member_id')}><option value="">Unassigned</option>{members.data?.filter((member)=>member.status==='active').map((member)=><option key={member.id} value={member.id}>{member.profiles?.full_name||member.profiles?.email}</option>)}</Select></Field><Field label="Current company"><Input {...editForm.register('current_company')}/></Field><Field label="Current position"><Input {...editForm.register('current_position')}/></Field><Field label="Location"><Input {...editForm.register('location')}/></Field><Field label="Source"><Input {...editForm.register('source')}/></Field><Field label="LinkedIn" error={editForm.formState.errors.linkedin_url?.message}><Input type="url" {...editForm.register('linkedin_url')}/></Field><Field label="Portfolio" error={editForm.formState.errors.portfolio_url?.message}><Input type="url" {...editForm.register('portfolio_url')}/></Field><Field label="Availability"><Input {...editForm.register('availability')}/></Field><Field label="Notice period (days)" error={editForm.formState.errors.notice_period_days?.message}><Input type="number" min="0" {...editForm.register('notice_period_days')}/></Field><Field label="Status"><Select {...editForm.register('status')}><option value="active">Active</option><option value="passive">Passive</option><option value="placed">Placed</option><option value="do_not_contact">Do not contact</option><option value="archived">Archived</option></Select></Field></div></Panel>
      <Panel title="Private details and consent"><div className="form-grid"><Field label="Email" error={editForm.formState.errors.email?.message}><Input type="email" {...editForm.register('email')}/></Field><Field label="Phone"><Input {...editForm.register('phone')}/></Field><Field label={`Current salary (per ${organization?.salary_period==='monthly'?'month':'year'})`} error={editForm.formState.errors.current_salary?.message}><Input type="number" min="0" {...editForm.register('current_salary')}/></Field><Field label={`Expected salary (per ${organization?.salary_period==='monthly'?'month':'year'})`} error={editForm.formState.errors.expected_salary?.message}><Input type="number" min="0" {...editForm.register('expected_salary')}/></Field><Field label="Currency" error={editForm.formState.errors.salary_currency?.message}><Input maxLength={3} {...editForm.register('salary_currency')}/></Field><Field label="Work authorization"><Input {...editForm.register('work_authorization')}/></Field><Field label="Consent status"><Select {...editForm.register('consent_status')}><option value="unknown">Unknown</option><option value="requested">Requested</option><option value="granted">Granted</option><option value="withdrawn">Withdrawn</option><option value="expired">Expired</option></Select></Field><Field label="Consent expires"><Input type="date" {...editForm.register('consent_expires_at')}/></Field></div><p className="muted">Salary and contact details remain behind the candidate-private permission boundary.</p></Panel>
      {save.error&&<p className="form-error" role="alert">{save.error.message}</p>}<div className="form-actions"><Button loading={save.isPending}>{'Save candidate'}</Button></div>
    </form>:<>
      <div className="record-tabs" role="tablist">{TABS.map((item)=><button key={item.key} type="button" role="tab" aria-selected={tab===item.key} className={tab===item.key?'active':''} onClick={()=>selectTab(item.key)}>{item.label}</button>)}</div>
      <div className="page-content">
        {tab==='overview'&&<>
          <Panel title="In pipelines" icon={<Layers3 size={17}/>} subtitle="Every job this candidate is being considered for, with both the recruitment phase and exact working stage.">{pipelineCount?<Table headers={['Job','Client','Phase','Detailed stage','Owner','Added','Days in stage']}>{pipelines.data!.map((assignment)=>{const stage=assignment.pipeline_stages;const phase=stage?pipelinePhases.find((item)=>item.key===phaseForStage(stage))?.label:'Unknown';const changed=assignment.stage_history[0]?.occurred_at||assignment.updated_at;const days=Math.max(0,Math.floor((renderedAt-new Date(changed).getTime())/86_400_000));return <tr key={assignment.id}><td><Link className="record-link" to={`/app/${organization?.slug}/jobs/${assignment.job_id}`}>{assignment.jobs?.title||'Job'}</Link></td><td>{assignment.jobs?.companies?.name||'—'}</td><td>{phase}</td><td>{stage?.name||'—'}</td><td>{assignment.jobs?.organization_members?.profiles?.full_name||assignment.jobs?.organization_members?.profiles?.email||'Unassigned'}</td><td>{formatDate(assignment.added_at)}</td><td>{days}</td></tr>})}</Table>:<EmptyState title="Not in a job pipeline" description="This candidate is not being considered for any job yet. Add them to one to start tracking their progress." action={capabilities.data?.canMovePipeline&&<Button onClick={()=>setJobOpen(true)} disabled={Boolean(candidate.deleted_at)||candidate.status==='do_not_contact'}>Add to job</Button>}/>}</Panel>
          <Panel title="Contact details" icon={<Mail size={17}/>}><dl className="record-summary"><div><dt>Email</dt><dd>{privateData?.email||'Not recorded'}</dd></div><div><dt>Phone</dt><dd>{privateData?.phone||'Not recorded'}{privateData?.phone&&canWrite&&<Button size="sm" variant="secondary" leadingIcon={<MessageSquare size={13}/>} onClick={openWhatsApp}>WhatsApp</Button>}</dd></div><div><dt>Notice period</dt><dd>{candidate.notice_period_days!=null?`${candidate.notice_period_days} days`:'Not recorded'}</dd></div><div><dt>Source</dt><dd>{candidate.source||'Not recorded'}</dd></div><div><dt>LinkedIn</dt><dd>{candidate.linkedin_url?<a className="record-link" href={candidate.linkedin_url} target="_blank" rel="noreferrer">Profile</a>:'Not recorded'}</dd></div><div><dt>Portfolio</dt><dd>{candidate.portfolio_url?<a className="record-link" href={candidate.portfolio_url} target="_blank" rel="noreferrer">Portfolio</a>:'Not recorded'}</dd></div></dl></Panel>
        </>}

        {tab==='profile'&&<div className="two-column">
          <Panel title="Employment" icon={<Briefcase size={17}/>} action={canWrite&&<Button variant="secondary" onClick={()=>employmentEditing?setEmploymentEditing(false):startEmploymentEdit()}>{employmentEditing?'Cancel':'Edit'}</Button>}>
            {employmentEditing?<div className="stack"><EmploymentListEditor value={employmentDraft} onChange={(items)=>setEmploymentDraft(items as EditableEmployment[])} disabled={saveEmployment.isPending}/>{saveEmployment.error&&<p className="form-error" role="alert">{saveEmployment.error.message}</p>}<div className="form-actions"><Button variant="quiet" disabled={saveEmployment.isPending} onClick={()=>setEmploymentEditing(false)}>Cancel</Button><Button loading={saveEmployment.isPending} onClick={()=>saveEmployment.mutate(employmentDraft)}>{'Save'}</Button></div></div>
            :<div className="list">{candidate.candidate_employment?.length?candidate.candidate_employment.map((item)=><article className="list-row" key={item.id}><div><strong>{item.title}</strong><span>{item.company_name} · {formatCvDate(item.started_on,item.started_on_precision)} – {item.is_current?'Present':formatCvDate(item.ended_on,item.ended_on_precision)}</span></div>{canWrite&&<Button variant="quiet" aria-label="Remove employment" onClick={()=>removeItem.mutate({table:'candidate_employment',id:item.id})}><Trash2 size={14}/></Button>}</article>):<PanelEmpty message="No employment history yet" actionLabel={canWrite?'Add the first role':undefined} onAction={startEmploymentEdit}/>}</div>}
          </Panel>
          <Panel title="Education" icon={<GraduationCap size={17}/>} action={canWrite&&<Button variant="secondary" onClick={()=>educationEditing?setEducationEditing(false):startEducationEdit()}>{educationEditing?'Cancel':'Edit'}</Button>}>
            {educationEditing?<div className="stack"><EducationListEditor value={educationDraft} onChange={(items)=>setEducationDraft(items as EditableEducation[])} disabled={saveEducation.isPending}/>{saveEducation.error&&<p className="form-error" role="alert">{saveEducation.error.message}</p>}<div className="form-actions"><Button variant="quiet" disabled={saveEducation.isPending} onClick={()=>setEducationEditing(false)}>Cancel</Button><Button loading={saveEducation.isPending} onClick={()=>saveEducation.mutate(educationDraft)}>{'Save'}</Button></div></div>
            :<div className="list">{candidate.candidate_education?.length?candidate.candidate_education.map((item)=><article className="list-row" key={item.id}><div><strong>{item.institution}</strong><span>{[item.degree,item.field_of_study].filter(Boolean).join(' · ')}</span><span>{formatCvDate(item.started_on,item.started_on_precision)} – {formatCvDate(item.ended_on,item.ended_on_precision)}</span></div>{canWrite&&<Button variant="quiet" aria-label="Remove education" onClick={()=>removeItem.mutate({table:'candidate_education',id:item.id})}><Trash2 size={14}/></Button>}</article>):<PanelEmpty message="No education history yet" actionLabel={canWrite?'Add a qualification':undefined} onAction={startEducationEdit}/>}</div>}
          </Panel>
          <Panel title="Languages" icon={<Languages size={17}/>} action={canWrite&&<Button variant="secondary" onClick={()=>languagesEditing?setLanguagesEditing(false):startLanguagesEdit()}>{languagesEditing?'Cancel':'Edit'}</Button>}>
            {languagesEditing?<div className="stack"><LanguagesListEditor value={languagesDraft} onChange={(items)=>setLanguagesDraft(items as EditableLanguage[])} disabled={saveLanguages.isPending}/>{saveLanguages.error&&<p className="form-error" role="alert">{saveLanguages.error.message}</p>}<div className="form-actions"><Button variant="quiet" disabled={saveLanguages.isPending} onClick={()=>setLanguagesEditing(false)}>Cancel</Button><Button loading={saveLanguages.isPending} onClick={()=>saveLanguages.mutate(languagesDraft)}>{'Save'}</Button></div></div>
            :<div className="list">{candidate.candidate_languages?.length?candidate.candidate_languages.map((item)=><article className="list-row" key={item.id}><div><strong>{item.language}</strong><span>{item.proficiency||'Proficiency not recorded'}</span></div>{canWrite&&<Button variant="quiet" aria-label="Remove language" onClick={()=>removeItem.mutate({table:'candidate_languages',id:item.id})}><Trash2 size={14}/></Button>}</article>):<PanelEmpty message="No languages recorded" actionLabel={canWrite?'Add a language':undefined} onAction={startLanguagesEdit}/>}</div>}
          </Panel>
          <Panel title="Skills" icon={<Wrench size={17}/>} action={canWrite&&<Button variant="secondary" onClick={()=>skillsEditing?setSkillsEditing(false):startSkillsEdit()}>{skillsEditing?'Cancel':'Edit'}</Button>}>
            {skillsEditing?<div className="stack"><SkillsListEditor value={skillsDraft} onChange={(items)=>setSkillsDraft(items as EditableSkill[])} disabled={saveSkills.isPending}/>{saveSkills.error&&<p className="form-error" role="alert">{saveSkills.error.message}</p>}<div className="form-actions"><Button variant="quiet" disabled={saveSkills.isPending} onClick={()=>setSkillsEditing(false)}>Cancel</Button><Button loading={saveSkills.isPending} onClick={()=>saveSkills.mutate(skillsDraft)}>{'Save'}</Button></div></div>
            :<div className="list">{candidate.candidate_skills?.length?candidate.candidate_skills.map((item)=><article className="list-row" key={item.skill_id}><div><strong>{item.skills?.name||'Skill'}</strong><span>{[item.proficiency,item.years_experience?`${item.years_experience} years`:null].filter(Boolean).join(' · ')||'Details not recorded'}</span></div>{canWrite&&<Button variant="quiet" aria-label="Remove skill" onClick={()=>removeSkill.mutate(item.skill_id)}><Trash2 size={14}/></Button>}</article>):<PanelEmpty message="No skills recorded" actionLabel={canWrite?'Add a skill':undefined} onAction={startSkillsEdit}/>}</div>}
          </Panel>
          <Panel title="Tags" icon={<Tag size={17}/>} action={canWrite&&<Button variant="secondary" leadingIcon={<Plus size={14}/>} onClick={()=>setAddMode('tag')}>Add</Button>}><div className="tag-list">{candidate.candidate_tags?.length?candidate.candidate_tags.map((item)=><span className="tag-chip" key={item.tag_id}>{item.tags?.name||'Tag'}{canWrite&&<button type="button" aria-label={`Remove ${item.tags?.name||'tag'}`} onClick={()=>removeTag.mutate(item.tag_id)}>×</button>}</span>):<PanelEmpty message="No tags recorded" actionLabel={canWrite?'Add a tag':undefined} onAction={()=>setAddMode('tag')}/>}</div></Panel>
        </div>}

        {tab==='activity'&&<ActivityFeed links={[{candidate_id:candidate.id}]} subtitle="Every call, email, and meeting with this candidate. Pipeline moves and client feedback are recorded automatically." readOnly={!canWrite}/>}

        {tab==='documents'&&<div className="two-column">
          <Panel title="Documents" icon={<FileText size={17}/>} action={canWrite&&<Button variant="secondary" leadingIcon={<Upload size={14}/>} onClick={()=>setCvOpen(true)}>Upload and parse CV</Button>}><div className="list">{documents.data?.length?documents.data.map((document)=><article className="list-row" key={document.id}><div><strong><FileText size={14}/> {document.original_filename||document.file_name}</strong><span>{document.document_type==='candidate_profile'?'Client profile · ':''}{Math.ceil(document.size_bytes/1024)} KB</span></div><div><a className="button button-secondary" href={document.signedUrl} target="_blank" rel="noreferrer">Open</a>{canWrite&&<Button variant="quiet" aria-label="Archive document" onClick={()=>removeDocument.mutate({id:document.id,storagePath:document.storage_path,filename:document.original_filename||document.file_name})}><Trash2 size={14}/></Button>}</div></article>):<PanelEmpty message="No documents uploaded" actionLabel={canWrite?'Upload a CV':undefined} onAction={()=>setCvOpen(true)}/>}</div></Panel>
          {organization?.profile_enabled&&<Panel title="Client profile history" icon={<FileSignature size={17}/>}><div className="list">{profileVersions.data?.length?profileVersions.data.map((profile)=><article className="list-row" key={profile.id}><div><strong>{profile.job_title} · Version {profile.version}</strong><span>{profile.template_name} · {profile.anonymized?'Anonymized':'Named'} · {formatDate(profile.finalized_at||profile.created_at)}</span></div><div><StatusBadge map={profileStatus} value={profile.status}/>{profile.stale&&<Badge tone="warn">Source changed</Badge>}</div></article>):<PanelEmpty message="No generated profiles yet" actionLabel={canWrite?'Generate one':undefined} onAction={()=>setProfileOpen(true)}/>}</div></Panel>}
        </div>}
      </div>
    </>}

    <Modal title="Add tag" open={Boolean(addMode)} onClose={()=>setAddMode(null)}><AddProfileItem mode={addMode} organizationId={organization!.id} candidateId={candidateId} onDone={async()=>{setAddMode(null);await refresh()}}/></Modal>
    <Modal title="Upload and parse CV" open={cvOpen} wide onClose={()=>setCvOpen(false)}><CandidateCvParser organizationId={organization!.id} userId={user!.id} targetCandidateId={candidateId} targetCandidateName={candidate.full_name} onCancel={()=>setCvOpen(false)} onAccepted={async()=>{setCvOpen(false);await refresh()}}/></Modal>
    <Modal title="Generate client profile" open={profileOpen} wide onClose={()=>setProfileOpen(false)}><CandidateProfileGenerator organizationId={organization!.id} userId={user!.id} candidate={candidate} organizationName={organization!.name} accent={organization?.primary_color} logoUrl={organization?.logo_url} footerBannerUrl={organization?.profile_footer_banner_url} defaultPreparedBy={preparedBy} onClose={()=>setProfileOpen(false)} onFinalized={refresh}/></Modal>
    <AddCandidateToJobModal open={jobOpen} onClose={()=>setJobOpen(false)} candidates={[{id:candidate.id,full_name:candidate.full_name,current_position:candidate.current_position,status:candidate.status,consent_status:privateData?.consent_status||'unknown'}]}/>
  </main>
}

/* A dead "No X yet" line makes the reader go hunting for the panel-header Add button. This repeats
 * the action where the eye already is, and falls back to the plain sentence without write access. */
function PanelEmpty({message,actionLabel,onAction}:{message:string;actionLabel?:string;onAction:()=>void}){
  return <div className="panel-empty"><span><Inbox size={15}/>{message}</span>{actionLabel&&<Button variant="quiet" onClick={onAction}>{actionLabel}</Button>}</div>
}

// Employment/education/language/skill used to be added here one at a time; they're now edited
// in place on their own panels (see startEmploymentEdit etc. above). Only tags -- a plain chip
// adder with no repeatable-list pain point -- still go through this generic add form.
function AddProfileItem({mode,organizationId,candidateId,onDone}:{mode:AddMode;organizationId:string;candidateId:string;onDone:()=>Promise<void>}){const mutation=useMutation({mutationFn:async(form:HTMLFormElement)=>{const data=new FormData(form);if(mode==='tag')await addCandidateTag(organizationId,candidateId,String(data.get('tag')||''))},onSuccess:onDone});return <form className="stack" onSubmit={(event)=>{event.preventDefault();mutation.mutate(event.currentTarget)}}>{mode==='tag'&&<Field label="Tag"><Input name="tag" required/> </Field>}{mutation.error&&<p className="form-error" role="alert">{mutation.error.message}</p>}<div className="form-actions"><Button loading={mutation.isPending}>Add</Button></div></form>}
