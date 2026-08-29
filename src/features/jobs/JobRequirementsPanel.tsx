import {useEffect,useRef,useState} from 'react'
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query'
import {ChevronDown,ChevronUp,ListChecks,Paperclip,Sparkles,Trash2} from 'lucide-react'
import {Badge,Panel} from '../../shared/ui/Page'
import {Button} from '../../shared/ui/Button'
import {Field,Input,Select} from '../../shared/ui/Field'
import {useToast} from '../../shared/ui/Toast'
import {draftJobRequirements,listJobDescriptionDocuments,listJobRequirements,saveJobRequirements,uploadJobDescription} from '../core/commercialRepository'
import {
  emptyJobRequirement,MAX_JOB_REQUIREMENTS,mergeDraftedRequirements,moveRequirement,
  requirementCategories,requirementCategoryLabels,requirementLevelLabels,requirementLevels,
  summarizeRequirements,type JobRequirement,type RequirementCategory,type RequirementLevel,
} from './jobRequirements'

/* The requirement editor on Job Workspace.
 *
 * This lives on the page rather than inside the Edit job modal on purpose. A requirement set is a
 * list a consultant reorders, re-levels and revisits while reading a JD, and the modal is already at
 * the limit of what fits without scrolling two panes. It also has to sit next to the JD attachment,
 * because the two are one task: attach the brief, draft from it, correct it, save.
 *
 * Nothing here writes on its own. Drafting proposes rows into local state and saving is an explicit
 * action, so a model never authors the criteria a candidate is scored against.
 */
export function JobRequirementsPanel({organizationId,jobId,userId,canWrite}:{organizationId:string;jobId:string;userId:string;canWrite:boolean}){
  const toast=useToast()
  const queryClient=useQueryClient()
  const fileInput=useRef<HTMLInputElement>(null)
  const [rows,setRows]=useState<JobRequirement[]>([])
  const [dirty,setDirty]=useState(false)
  const [expanded,setExpanded]=useState(false)

  const requirements=useQuery({queryKey:['job-requirements',organizationId,jobId],queryFn:()=>listJobRequirements(organizationId,jobId)})
  const documents=useQuery({queryKey:['job-documents',organizationId,jobId],queryFn:()=>listJobDescriptionDocuments(organizationId,jobId)})

  /* Server state seeds local state once per load, and never overwrites an edit in progress -- a
   * background refetch landing mid-sentence would silently discard typing. */
  useEffect(()=>{
    if(requirements.data&&!dirty)setRows(requirements.data)
  },[requirements.data,dirty])

  const update=(index:number,patch:Partial<JobRequirement>)=>{
    setDirty(true)
    setRows((current)=>current.map((row,position)=>position===index?{...row,...patch}:row))
  }
  const remove=(index:number)=>{setDirty(true);setRows((current)=>current.filter((_,position)=>position!==index))}
  const move=(from:number,to:number)=>{setDirty(true);setRows((current)=>moveRequirement(current,from,to))}
  const add=()=>{
    if(rows.length>=MAX_JOB_REQUIREMENTS){toast.error(new Error(`A vacancy can carry at most ${MAX_JOB_REQUIREMENTS} requirements.`),'Nothing was added.');return}
    setDirty(true);setExpanded(true);setRows((current)=>[...current,emptyJobRequirement()])
  }

  const save=useMutation({
    mutationFn:()=>saveJobRequirements(organizationId,jobId,rows),
    onSuccess:async(count)=>{
      setDirty(false)
      await Promise.all([
        queryClient.invalidateQueries({queryKey:['job-requirements',organizationId,jobId]}),
        /* The job row's updated_at is bumped by a trigger on every requirement write, which is what
         * marks existing candidate profiles stale. Refetching the job keeps this page agreeing with
         * that rather than showing a timestamp from before the save. */
        queryClient.invalidateQueries({queryKey:['job',organizationId,jobId]}),
      ])
      toast.success(count===1?'1 requirement saved.':`${count} requirements saved.`)
    },
    onError:(error)=>toast.error(error,'The requirements are unchanged.'),
  })

  const draft=useMutation({
    mutationFn:(documentId:string|null)=>draftJobRequirements(organizationId,jobId,documentId),
    onSuccess:(drafted)=>{
      const {merged,addedCount,skippedCount}=mergeDraftedRequirements(rows,drafted)
      setRows(merged);setDirty(true);setExpanded(true)
      if(!addedCount)toast.success('Nothing new — the draft matched what is already listed.')
      else toast.success(`${addedCount} requirement${addedCount===1?'':'s'} proposed${skippedCount?`, ${skippedCount} already listed`:''}. Review and save.`)
    },
    onError:(error)=>toast.error(error,'Nothing was added.'),
  })

  const upload=useMutation({
    mutationFn:(file:File)=>uploadJobDescription(organizationId,jobId,userId,file),
    onSuccess:async()=>{
      await queryClient.invalidateQueries({queryKey:['job-documents',organizationId,jobId]})
      toast.success('Job description attached.')
    },
    onError:(error)=>toast.error(error,'The job description was not attached.'),
  })

  const attached=documents.data?.[0]??null
  const busy=save.isPending||draft.isPending||upload.isPending
  /* Drafting alone waits for the attachment list. Firing before it arrives would draft from the job
   * fields and silently ignore the JD the recruiter attached -- the same button, a quietly worse
   * result, and nothing on screen to say which one happened. Adding a row by hand and saving have
   * nothing to do with the document list, so they are not held up by it. */
  const draftBlocked=busy||documents.isLoading

  return <Panel
    title="Requirements"
    icon={<ListChecks size={16}/>}
    action={canWrite&&<div className="panel-actions">
      <Button variant="quiet" onClick={()=>fileInput.current?.click()} loading={upload.isPending} disabled={busy}>
        <Paperclip size={14}/> {attached?'Replace JD':'Attach JD'}
      </Button>
      <Button variant="quiet" onClick={()=>draft.mutate(attached?.id??null)} loading={draft.isPending} disabled={draftBlocked}>
        <Sparkles size={14}/> Draft from JD
      </Button>
      <Button onClick={()=>save.mutate()} loading={save.isPending} disabled={busy||!dirty}>Save requirements</Button>
    </div>}
  >
    <input ref={fileInput} type="file" accept="application/pdf,.pdf" hidden
      onChange={(event)=>{const file=event.target.files?.[0];event.target.value='';if(file)upload.mutate(file)}}/>

    <p className="muted">{summarizeRequirements(rows)}</p>
    {attached&&<p className="muted"><Paperclip size={12}/> {attached.file_name}</p>}
    {/* Said plainly because it is the difference between a score a consultant can defend and one they
        cannot: without rows here the assessment falls back to whatever prose the job carries. */}
    {!rows.length&&<p className="muted">Attach the client&apos;s JD and draft from it, or add requirements by hand. Every one you list is assessed and cited separately on a candidate profile.</p>}
    {dirty&&<Badge tone="warn">Unsaved changes</Badge>}

    {rows.length>0&&<>
      <ul className="requirement-list">
        {(expanded?rows:rows.slice(0,5)).map((row,index)=>
          <li key={index} className="requirement-row">
            <div className="requirement-row-main">
              <Field label={`Requirement ${index+1}`}>
                <Input value={row.label} disabled={!canWrite} placeholder="e.g. 5+ years managing engineering teams"
                  onChange={(event)=>update(index,{label:event.target.value})}/>
              </Field>
              <Field label="Level">
                <Select value={row.requirement_level} disabled={!canWrite}
                  onChange={(event)=>update(index,{requirement_level:event.target.value as RequirementLevel})}>
                  {requirementLevels.map((level)=><option key={level} value={level}>{requirementLevelLabels[level]}</option>)}
                </Select>
              </Field>
              <Field label="Category">
                <Select value={row.category} disabled={!canWrite}
                  onChange={(event)=>update(index,{category:event.target.value as RequirementCategory})}>
                  {requirementCategories.map((category)=><option key={category} value={category}>{requirementCategoryLabels[category]}</option>)}
                </Select>
              </Field>
              {/* 0 is a real choice, not an empty field: it records the requirement on the vacancy
                  without letting it move the score. */}
              <Field label="Weight" hint={row.weight===0?'Recorded but not scored.':undefined}>
                <Input type="number" min="0" max="10" step="0.5" value={row.weight} disabled={!canWrite}
                  onChange={(event)=>update(index,{weight:Number(event.target.value)})}/>
              </Field>
            </div>
            {canWrite&&<div className="requirement-row-actions">
              <Button variant="quiet" size="sm" aria-label={`Move requirement ${index+1} up`} disabled={index===0} onClick={()=>move(index,index-1)}><ChevronUp size={14}/></Button>
              <Button variant="quiet" size="sm" aria-label={`Move requirement ${index+1} down`} disabled={index===rows.length-1} onClick={()=>move(index,index+1)}><ChevronDown size={14}/></Button>
              <Button variant="quiet" size="sm" aria-label={`Remove requirement ${index+1}`} onClick={()=>remove(index)}><Trash2 size={14}/></Button>
            </div>}
          </li>)}
      </ul>
      {rows.length>5&&<Button variant="quiet" onClick={()=>setExpanded((open)=>!open)}>
        {expanded?'Show fewer':`Show all ${rows.length}`}
      </Button>}
    </>}

    {canWrite&&<Button variant="secondary" onClick={add} disabled={busy}>Add requirement</Button>}
    {save.error&&<p className="form-error" role="alert">{save.error.message}</p>}
  </Panel>
}
