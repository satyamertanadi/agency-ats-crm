import {useState,type FocusEvent,type FormEvent} from 'react'
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query'
import {Archive,ArrowLeft,Briefcase,FileSignature,FileText,GraduationCap,Inbox,Languages,Layers3,Mail,MoreHorizontal,Plus,RotateCcw,Tag,Trash2,Upload,Wrench} from 'lucide-react'
import {Link,useParams,useSearchParams} from 'react-router-dom'
import {useOrganization} from '../../app/OrganizationProvider'
import {useAuth} from '../../app/AuthProvider'
import {addCandidateEducation,addCandidateEmployment,addCandidateLanguage,addCandidateSkill,addCandidateTag,deleteCandidateDocument,deleteCandidateProfileItem,getCandidateDetail,listCandidateDocuments,listCandidateProfileVersions,listTeamMembers,removeCandidateSkill,removeCandidateTag,setCandidateArchived,updateCandidateProfile} from '../core/commercialRepository'
import {Button} from '../../shared/ui/Button'
import {Field,Input,Select,Textarea} from '../../shared/ui/Field'
import {Modal} from '../../shared/ui/Modal'
import {Badge,Panel,StatusBadge} from '../../shared/ui/Page'
import {candidateStatus,consentStatus,lookup,profileStatus,type Tone} from '../../shared/lib/status'
import {EmptyState,ErrorState,LoadingState} from '../../shared/ui/States'
import {formatCvDate,formatDate,formatSalary} from '../../shared/lib/format'
import {CandidateCvParser} from './CandidateCvParser'
import {CandidateProfileGenerator} from './CandidateProfileGenerator'
import {ActivityFeed} from '../activities/ActivityFeed'
import {useWorkspaceCapabilities} from '../../app/useWorkspaceCapabilities'
import {Table} from '../../shared/ui/Table'
import {listCandidatePipelineAssignments} from '../core/repository'
import {phaseForStage,pipelinePhases} from '../workflow/workflow'
import {AddCandidateToJobModal} from './AddCandidateToJobModal'
import {TaskButton} from '../activities/TaskButton'

type AddMode='employment'|'education'|'language'|'skill'|'tag'|null

/* The record used to be one ~11-panel scroll. The panels are unchanged; they are now grouped into
 * four tabs so the common case (where is this person in our pipelines, how do I reach them) is the
 * default view and costs no scrolling. Tab state lives in `?tab=` rather than useState so a tab is
 * deep-linkable and survives refresh and back -- the same reason JobWorkspacePage keys `?view=`. */
const TABS=[{key:'overview',label:'Overview'},{key:'profile',label:'Profile'},{key:'activity',label:'Activity'},{key:'documents',label:'Documents & profiles'}] as const
type TabKey=typeof TABS[number]['key']

export function CandidateDetailPage(){
  const {candidateId=''}=useParams();const {organization}=useOrganization();const {user}=useAuth();const capabilities=useWorkspaceCapabilities();const cache=useQueryClient();const [params,setParams]=useSearchParams();const [addMode,setAddMode]=useState<AddMode>(null);const [cvOpen,setCvOpen]=useState(false);const [profileOpen,setProfileOpen]=useState(false);const [editing,setEditing]=useState(false);const [jobOpen,setJobOpen]=useState(false);const [menuOpen,setMenuOpen]=useState(false);const [renderedAt]=useState(Date.now)
  const detail=useQuery({queryKey:['candidate-detail',organization?.id,candidateId],enabled:Boolean(organization&&candidateId),queryFn:()=>getCandidateDetail(organization!.id,candidateId)})
  const documents=useQuery({queryKey:['candidate-documents',organization?.id,candidateId],enabled:Boolean(organization&&candidateId),queryFn:()=>listCandidateDocuments(organization!.id,candidateId)})
  const profileVersions=useQuery({queryKey:['candidate-profile-versions',organization?.id,candidateId],enabled:Boolean(organization&&candidateId&&organization.profile_enabled),queryFn:()=>listCandidateProfileVersions(organization!.id,candidateId)})
  const members=useQuery({queryKey:['members',organization?.id],enabled:Boolean(organization),queryFn:()=>listTeamMembers(organization!.id)})
  const pipelines=useQuery({queryKey:['candidate-pipelines',organization?.id,candidateId],enabled:Boolean(organization&&candidateId),queryFn:()=>listCandidatePipelineAssignments(organization!.id,candidateId)})
  const refresh=()=>Promise.all([cache.invalidateQueries({queryKey:['candidate-detail',organization?.id,candidateId]}),cache.invalidateQueries({queryKey:['candidate-documents',organization?.id,candidateId]}),cache.invalidateQueries({queryKey:['candidate-profile-versions',organization?.id,candidateId]}),cache.invalidateQueries({queryKey:['candidates-page',organization?.id]})])
  const save=useMutation({mutationFn:async(form:HTMLFormElement)=>{const values=new FormData(form);await updateCandidateProfile(organization!.id,candidateId,{full_name:values.get('full_name'),current_company:values.get('current_company'),current_position:values.get('current_position'),location:values.get('location'),linkedin_url:values.get('linkedin_url'),portfolio_url:values.get('portfolio_url'),status:values.get('status'),owner_member_id:values.get('owner_member_id'),source:values.get('source'),availability:values.get('availability'),notice_period_days:values.get('notice_period_days')},{email:values.get('email'),phone:values.get('phone'),current_salary:values.get('current_salary'),expected_salary:values.get('expected_salary'),salary_currency:values.get('salary_currency'),work_authorization:values.get('work_authorization'),consent_status:values.get('consent_status'),consent_expires_at:values.get('consent_expires_at')})},onSuccess:async()=>{setEditing(false);await refresh()}})
  const archive=useMutation({mutationFn:(archived:boolean)=>setCandidateArchived(organization!.id,candidateId,archived),onSuccess:refresh})
  const removeItem=useMutation({mutationFn:({table,id}:{table:'candidate_employment'|'candidate_education'|'candidate_languages';id:string})=>deleteCandidateProfileItem(table,organization!.id,id),onSuccess:refresh})
  const removeSkill=useMutation({mutationFn:(skillId:string)=>removeCandidateSkill(organization!.id,candidateId,skillId),onSuccess:refresh})
  const removeTag=useMutation({mutationFn:(tagId:string)=>removeCandidateTag(organization!.id,candidateId,tagId),onSuccess:refresh})
  if(detail.isLoading||documents.isLoading||members.isLoading||profileVersions.isLoading||pipelines.isLoading)return <LoadingState/>;if(detail.error||documents.error||members.error||profileVersions.error||pipelines.error||!detail.data)return <ErrorState error={detail.error||documents.error||members.error||profileVersions.error||pipelines.error}/>
  const candidate=detail.data;const privateData=Array.isArray(candidate.candidate_private_details)?candidate.candidate_private_details[0]:candidate.candidate_private_details
  const preparedBy=members.data?.find((member)=>member.user_id===user?.id)?.profiles?.full_name||''
  const canWrite=Boolean(capabilities.data?.canWriteCandidates)
  const tab=(TABS.find((item)=>item.key===params.get('tab'))?.key||'overview') as TabKey
  const selectTab=(next:TabKey)=>{const nextParams=new URLSearchParams(params);if(next==='overview')nextParams.delete('tab');else nextParams.set('tab',next);setParams(nextParams)}
  const initials=candidate.full_name.split(/\s+/).filter(Boolean).slice(0,2).map((part)=>part[0]?.toUpperCase()||'').join('')||'?'
  const pipelineCount=pipelines.data?.length||0
  /* The readiness facts a recruiter checks before doing anything else, lifted out of the old
   * mid-page panel into a band under the name. Consent borrows tone from the domain status map so
   * this strip cannot drift from how consent is coloured everywhere else. */
  const consentMeta=lookup(consentStatus,privateData?.consent_status||'unknown')
  const readiness:{label:string;value:string;tone:Tone}[]=[
    {label:'Consent',value:consentMeta.label,tone:consentMeta.tone},
    {label:'Contactable',value:candidate.status==='do_not_contact'?'Do not contact':'Yes',tone:candidate.status==='do_not_contact'?'bad':'good'},
    {label:'CV',value:documents.data?.length?'Available':'Upload required',tone:documents.data?.length?'good':'warn'},
    {label:'Availability',value:candidate.availability||'Not recorded',tone:candidate.availability?'neutral':'warn'},
    {label:'Expected salary',value:formatSalary(privateData?.expected_salary,privateData?.salary_currency||organization?.base_currency),tone:'neutral'},
    {label:'In pipelines',value:String(pipelineCount),tone:pipelineCount?'info':'neutral'},
  ]
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
        {canWrite&&<Button variant="secondary" onClick={()=>setEditing((value)=>!value)}>{editing?'Cancel edit':'Edit candidate'}</Button>}
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
    <dl className="readiness-strip">{readiness.map((item)=><div className={`readiness-chip tone-${item.tone}`} key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>

    {/* While editing, the two edit panels take the place of the tab content exactly as before; the
      * tab bar is hidden because switching tabs would not change what is on screen. */}
    {editing?<form key={candidate.updated_at} className="stack" onSubmit={(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();save.mutate(event.currentTarget)}}>
      <Panel title="Profile and ownership"><div className="form-grid"><Field label="Full name"><Input name="full_name" defaultValue={candidate.full_name} required/></Field><Field label="Owner"><Select name="owner_member_id" defaultValue={candidate.owner_member_id||''}><option value="">Unassigned</option>{members.data?.filter((member)=>member.status==='active').map((member)=><option key={member.id} value={member.id}>{member.profiles?.full_name||member.profiles?.email}</option>)}</Select></Field><Field label="Current company"><Input name="current_company" defaultValue={candidate.current_company||''}/></Field><Field label="Current position"><Input name="current_position" defaultValue={candidate.current_position||''}/></Field><Field label="Location"><Input name="location" defaultValue={candidate.location||''}/></Field><Field label="Source"><Input name="source" defaultValue={candidate.source||''}/></Field><Field label="LinkedIn"><Input type="url" name="linkedin_url" defaultValue={candidate.linkedin_url||''}/></Field><Field label="Portfolio"><Input type="url" name="portfolio_url" defaultValue={candidate.portfolio_url||''}/></Field><Field label="Availability"><Input name="availability" defaultValue={candidate.availability||''}/></Field><Field label="Notice period (days)"><Input type="number" min="0" name="notice_period_days" defaultValue={candidate.notice_period_days??''}/></Field><Field label="Status"><Select name="status" defaultValue={candidate.status}><option value="active">Active</option><option value="passive">Passive</option><option value="placed">Placed</option><option value="do_not_contact">Do not contact</option><option value="archived">Archived</option></Select></Field></div></Panel>
      <Panel title="Private details and consent"><div className="form-grid"><Field label="Email"><Input type="email" name="email" defaultValue={privateData?.email||''}/></Field><Field label="Phone"><Input name="phone" defaultValue={privateData?.phone||''}/></Field><Field label="Current salary"><Input type="number" min="0" name="current_salary" defaultValue={privateData?.current_salary??''}/></Field><Field label="Expected salary"><Input type="number" min="0" name="expected_salary" defaultValue={privateData?.expected_salary??''}/></Field><Field label="Currency"><Input name="salary_currency" maxLength={3} defaultValue={privateData?.salary_currency||organization?.base_currency}/></Field><Field label="Work authorization"><Input name="work_authorization" defaultValue={privateData?.work_authorization||''}/></Field><Field label="Consent status"><Select name="consent_status" defaultValue={privateData?.consent_status||'unknown'}><option value="unknown">Unknown</option><option value="requested">Requested</option><option value="granted">Granted</option><option value="withdrawn">Withdrawn</option><option value="expired">Expired</option></Select></Field><Field label="Consent expires"><Input type="date" name="consent_expires_at" defaultValue={privateData?.consent_expires_at?.slice(0,10)||''}/></Field></div><p className="muted">Salary and contact details remain behind the candidate-private permission boundary.</p></Panel>
      {save.error&&<p className="form-error" role="alert">{save.error.message}</p>}<div className="form-actions"><Button disabled={save.isPending}>{save.isPending?'Saving…':'Save candidate'}</Button></div>
    </form>:<>
      <div className="record-tabs" role="tablist">{TABS.map((item)=><button key={item.key} type="button" role="tab" aria-selected={tab===item.key} className={tab===item.key?'active':''} onClick={()=>selectTab(item.key)}>{item.label}</button>)}</div>
      <div className="page-content">
        {tab==='overview'&&<>
          <Panel title="In pipelines" icon={<Layers3 size={17}/>} subtitle="Every job this candidate is being considered for, with both the recruitment phase and exact working stage.">{pipelineCount?<Table headers={['Job','Client','Phase','Detailed stage','Owner','Added','Days in stage']}>{pipelines.data!.map((assignment)=>{const stage=assignment.pipeline_stages;const phase=stage?pipelinePhases.find((item)=>item.key===phaseForStage(stage))?.label:'Unknown';const changed=assignment.stage_history[0]?.occurred_at||assignment.updated_at;const days=Math.max(0,Math.floor((renderedAt-new Date(changed).getTime())/86_400_000));return <tr key={assignment.id}><td><Link className="record-link" to={`/app/${organization?.slug}/jobs/${assignment.job_id}`}>{assignment.jobs?.title||'Job'}</Link></td><td>{assignment.jobs?.companies?.name||'—'}</td><td>{phase}</td><td>{stage?.name||'—'}</td><td>{assignment.jobs?.organization_members?.profiles?.full_name||assignment.jobs?.organization_members?.profiles?.email||'Unassigned'}</td><td>{formatDate(assignment.added_at)}</td><td>{days}</td></tr>})}</Table>:<EmptyState title="Not in a job pipeline" description="This candidate is not being considered for any job yet. Add them to one to start tracking their progress." action={capabilities.data?.canMovePipeline&&<Button onClick={()=>setJobOpen(true)} disabled={Boolean(candidate.deleted_at)||candidate.status==='do_not_contact'}>Add to job</Button>}/>}</Panel>
          <Panel title="Contact details" icon={<Mail size={17}/>}><dl className="record-summary"><div><dt>Email</dt><dd>{privateData?.email||'Not recorded'}</dd></div><div><dt>Phone</dt><dd>{privateData?.phone||'Not recorded'}</dd></div><div><dt>Notice period</dt><dd>{candidate.notice_period_days!=null?`${candidate.notice_period_days} days`:'Not recorded'}</dd></div><div><dt>Source</dt><dd>{candidate.source||'Not recorded'}</dd></div><div><dt>LinkedIn</dt><dd>{candidate.linkedin_url?<a className="record-link" href={candidate.linkedin_url} target="_blank" rel="noreferrer">Profile</a>:'Not recorded'}</dd></div><div><dt>Portfolio</dt><dd>{candidate.portfolio_url?<a className="record-link" href={candidate.portfolio_url} target="_blank" rel="noreferrer">Portfolio</a>:'Not recorded'}</dd></div></dl></Panel>
        </>}

        {tab==='profile'&&<div className="two-column">
          <Panel title="Employment" icon={<Briefcase size={17}/>} action={canWrite&&<Button variant="secondary" onClick={()=>setAddMode('employment')}><Plus size={14}/>Add</Button>}><div className="list">{candidate.candidate_employment?.length?candidate.candidate_employment.map((item)=><article className="list-row" key={item.id}><div><strong>{item.title}</strong><span>{item.company_name} · {formatCvDate(item.started_on,item.started_on_precision)} – {item.is_current?'Present':formatCvDate(item.ended_on,item.ended_on_precision)}</span></div>{canWrite&&<Button variant="quiet" aria-label="Remove employment" onClick={()=>removeItem.mutate({table:'candidate_employment',id:item.id})}><Trash2 size={14}/></Button>}</article>):<PanelEmpty message="No employment history yet" actionLabel={canWrite?'Add the first role':undefined} onAction={()=>setAddMode('employment')}/>}</div></Panel>
          <Panel title="Education" icon={<GraduationCap size={17}/>} action={canWrite&&<Button variant="secondary" onClick={()=>setAddMode('education')}><Plus size={14}/>Add</Button>}><div className="list">{candidate.candidate_education?.length?candidate.candidate_education.map((item)=><article className="list-row" key={item.id}><div><strong>{item.institution}</strong><span>{[item.degree,item.field_of_study].filter(Boolean).join(' · ')}</span><span>{formatCvDate(item.started_on,item.started_on_precision)} – {formatCvDate(item.ended_on,item.ended_on_precision)}</span></div>{canWrite&&<Button variant="quiet" aria-label="Remove education" onClick={()=>removeItem.mutate({table:'candidate_education',id:item.id})}><Trash2 size={14}/></Button>}</article>):<PanelEmpty message="No education history yet" actionLabel={canWrite?'Add a qualification':undefined} onAction={()=>setAddMode('education')}/>}</div></Panel>
          <Panel title="Languages" icon={<Languages size={17}/>} action={canWrite&&<Button variant="secondary" onClick={()=>setAddMode('language')}><Plus size={14}/>Add</Button>}><div className="list">{candidate.candidate_languages?.length?candidate.candidate_languages.map((item)=><article className="list-row" key={item.id}><div><strong>{item.language}</strong><span>{item.proficiency||'Proficiency not recorded'}</span></div>{canWrite&&<Button variant="quiet" aria-label="Remove language" onClick={()=>removeItem.mutate({table:'candidate_languages',id:item.id})}><Trash2 size={14}/></Button>}</article>):<PanelEmpty message="No languages recorded" actionLabel={canWrite?'Add a language':undefined} onAction={()=>setAddMode('language')}/>}</div></Panel>
          <Panel title="Skills" icon={<Wrench size={17}/>} action={canWrite&&<Button variant="secondary" onClick={()=>setAddMode('skill')}><Plus size={14}/>Add</Button>}><div className="list">{candidate.candidate_skills?.length?candidate.candidate_skills.map((item)=><article className="list-row" key={item.skill_id}><div><strong>{item.skills?.name||'Skill'}</strong><span>{[item.proficiency,item.years_experience?`${item.years_experience} years`:null].filter(Boolean).join(' · ')||'Details not recorded'}</span></div>{canWrite&&<Button variant="quiet" aria-label="Remove skill" onClick={()=>removeSkill.mutate(item.skill_id)}><Trash2 size={14}/></Button>}</article>):<PanelEmpty message="No skills recorded" actionLabel={canWrite?'Add a skill':undefined} onAction={()=>setAddMode('skill')}/>}</div></Panel>
          <Panel title="Tags" icon={<Tag size={17}/>} action={canWrite&&<Button variant="secondary" onClick={()=>setAddMode('tag')}><Plus size={14}/>Add</Button>}><div className="tag-list">{candidate.candidate_tags?.length?candidate.candidate_tags.map((item)=><span className="tag-chip" key={item.tag_id}>{item.tags?.name||'Tag'}{canWrite&&<button type="button" aria-label={`Remove ${item.tags?.name||'tag'}`} onClick={()=>removeTag.mutate(item.tag_id)}>×</button>}</span>):<PanelEmpty message="No tags recorded" actionLabel={canWrite?'Add a tag':undefined} onAction={()=>setAddMode('tag')}/>}</div></Panel>
        </div>}

        {tab==='activity'&&<ActivityFeed links={[{candidate_id:candidate.id}]} subtitle="Every call, email, and meeting with this candidate. Pipeline moves and client feedback are recorded automatically." readOnly={!canWrite}/>}

        {tab==='documents'&&<div className="two-column">
          <Panel title="Documents" icon={<FileText size={17}/>} action={canWrite&&<Button variant="secondary" onClick={()=>setCvOpen(true)}><Upload size={14}/>Upload and parse CV</Button>}><div className="list">{documents.data?.length?documents.data.map((document)=><article className="list-row" key={document.id}><div><strong><FileText size={14}/> {document.original_filename||document.file_name}</strong><span>{document.document_type==='candidate_profile'?'Client profile · ':''}{Math.ceil(document.size_bytes/1024)} KB</span></div><div><a className="button button-secondary" href={document.signedUrl} target="_blank" rel="noreferrer">Open</a>{canWrite&&<Button variant="quiet" aria-label="Archive document" onClick={()=>void deleteCandidateDocument(organization!.id,document.id,document.storage_path).then(refresh)}><Trash2 size={14}/></Button>}</div></article>):<PanelEmpty message="No documents uploaded" actionLabel={canWrite?'Upload a CV':undefined} onAction={()=>setCvOpen(true)}/>}</div></Panel>
          {organization?.profile_enabled&&<Panel title="Client profile history" icon={<FileSignature size={17}/>}><div className="list">{profileVersions.data?.length?profileVersions.data.map((profile)=><article className="list-row" key={profile.id}><div><strong>{profile.job_title} · Version {profile.version}</strong><span>{profile.template_name} · {profile.anonymized?'Anonymized':'Named'} · {formatDate(profile.finalized_at||profile.created_at)}</span></div><div><StatusBadge map={profileStatus} value={profile.status}/>{profile.stale&&<Badge tone="warn">Source changed</Badge>}</div></article>):<PanelEmpty message="No generated profiles yet" actionLabel={canWrite?'Generate one':undefined} onAction={()=>setProfileOpen(true)}/>}</div></Panel>}
        </div>}
      </div>
    </>}

    <Modal title={`Add ${addMode||'profile item'}`} open={Boolean(addMode)} onClose={()=>setAddMode(null)}><AddProfileItem mode={addMode} organizationId={organization!.id} candidateId={candidateId} onDone={async()=>{setAddMode(null);await refresh()}}/></Modal>
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

function AddProfileItem({mode,organizationId,candidateId,onDone}:{mode:AddMode;organizationId:string;candidateId:string;onDone:()=>Promise<void>}){const mutation=useMutation({mutationFn:async(form:HTMLFormElement)=>{const data=new FormData(form);if(mode==='employment')await addCandidateEmployment(organizationId,candidateId,{company_name:String(data.get('company_name')||''),title:String(data.get('title')||''),started_on:String(data.get('started_on')||''),ended_on:String(data.get('ended_on')||''),is_current:data.get('is_current')==='on',summary:String(data.get('summary')||'')});if(mode==='education')await addCandidateEducation(organizationId,candidateId,{institution:String(data.get('institution')||''),degree:String(data.get('degree')||''),field_of_study:String(data.get('field_of_study')||''),started_on:String(data.get('started_on')||''),ended_on:String(data.get('ended_on')||'')});if(mode==='language')await addCandidateLanguage(organizationId,candidateId,String(data.get('language')||''),String(data.get('proficiency')||''));if(mode==='skill')await addCandidateSkill(organizationId,candidateId,String(data.get('skill')||''),String(data.get('proficiency')||''),data.get('years_experience')?Number(data.get('years_experience')):undefined);if(mode==='tag')await addCandidateTag(organizationId,candidateId,String(data.get('tag')||''))},onSuccess:onDone});return <form className="stack" onSubmit={(event)=>{event.preventDefault();mutation.mutate(event.currentTarget)}}>{mode==='employment'&&<><Field label="Company"><Input name="company_name" required/></Field><Field label="Title"><Input name="title" required/></Field><div className="form-grid"><Field label="Started"><Input type="date" name="started_on"/></Field><Field label="Ended"><Input type="date" name="ended_on"/></Field></div><label><input type="checkbox" name="is_current"/> Current role</label><Field label="Summary"><Textarea name="summary"/></Field></>}{mode==='education'&&<><Field label="Institution"><Input name="institution" required/></Field><Field label="Degree"><Input name="degree"/></Field><Field label="Field of study"><Input name="field_of_study"/></Field><div className="form-grid"><Field label="Started"><Input type="date" name="started_on"/></Field><Field label="Ended"><Input type="date" name="ended_on"/></Field></div></>}{mode==='language'&&<><Field label="Language"><Input name="language" required/></Field><Field label="Proficiency"><Input name="proficiency"/></Field></>}{mode==='skill'&&<><Field label="Skill"><Input name="skill" required/></Field><Field label="Proficiency"><Input name="proficiency"/></Field><Field label="Years of experience"><Input type="number" min="0" step="0.5" name="years_experience"/></Field></>}{mode==='tag'&&<Field label="Tag"><Input name="tag" required/> </Field>}{mutation.error&&<p className="form-error" role="alert">{mutation.error.message}</p>}<div className="form-actions"><Button disabled={mutation.isPending}>Add</Button></div></form>}
