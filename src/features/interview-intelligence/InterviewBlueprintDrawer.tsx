import {useState} from 'react'
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query'
import {Trash2} from 'lucide-react'
import {Drawer} from '../../shared/ui/Drawer'
import {Button} from '../../shared/ui/Button'
import {Callout} from '../../shared/ui/Callout'
import {Field,Select,Textarea} from '../../shared/ui/Field'
import {Badge} from '../../shared/ui/Page'
import {useToast} from '../../shared/ui/Toast'
import {
  activateBlueprint,
  generateBlueprintDraft,
  listBlueprintItems,
  listJobDocuments,
  removeBlueprintItem,
  updateBlueprintItem,
  type BlueprintItem,
  type BlueprintStatus,
  type RequirementLevel,
} from './blueprintRepository'
import {DIMENSION_ORDER,dimensionLabel,itemTypeLabel,requirementLabel} from './blueprintPresentation'

/* Review, edit and activate a blueprint.
 *
 * The rule this component exists to express is that generation produces a DRAFT and a human decides.
 * Nothing here activates automatically, generating never replaces the blueprint currently in use, and
 * an active version is read-only -- editing it would silently rewrite the yardstick that historical
 * analyses were measured against, so a change means a new version.
 */
export function InterviewBlueprintDrawer({organizationId,jobId,status,canConfigure,onClose}:{
  organizationId:string
  jobId:string
  status:BlueprintStatus
  canConfigure:boolean
  onClose:()=>void
}){
  const toast=useToast()
  const queryClient=useQueryClient()
  const [documentId,setDocumentId]=useState<string>('')

  // A waiting draft is what the consultant needs to act on; otherwise show what is live.
  const viewingRubricId=status.draftRubricId??status.rubricId
  const isDraft=Boolean(status.draftRubricId)

  const {data:items=[],isLoading}=useQuery({
    queryKey:['interview-blueprint-items',viewingRubricId],
    queryFn:()=>viewingRubricId?listBlueprintItems(viewingRubricId):Promise.resolve([]),
    enabled:Boolean(viewingRubricId),
  })

  const {data:documents=[]}=useQuery({
    queryKey:['job-documents',organizationId,jobId],
    queryFn:()=>listJobDocuments(organizationId,jobId),
    enabled:canConfigure,
  })

  const refresh=()=>{
    queryClient.invalidateQueries({queryKey:['interview-blueprint',organizationId,jobId]})
    queryClient.invalidateQueries({queryKey:['interview-blueprint-items']})
  }

  const generate=useMutation({
    mutationFn:()=>generateBlueprintDraft(organizationId,jobId,documentId||null),
    onSuccess:(result)=>{toast.success(`Draft blueprint created with ${result.itemCount} items.`,'Review it before activating.');refresh()},
    onError:(error)=>toast.error(error,'Could not generate a blueprint.'),
  })

  const activate=useMutation({
    mutationFn:()=>activateBlueprint(organizationId,viewingRubricId as string),
    onSuccess:()=>{toast.success('Blueprint activated.');refresh();onClose()},
    onError:(error)=>toast.error(error,'Could not activate the blueprint.'),
  })

  const saveItem=useMutation({
    mutationFn:({id,changes}:{id:string;changes:Parameters<typeof updateBlueprintItem>[1]})=>updateBlueprintItem(id,changes),
    onSuccess:refresh,
    onError:(error)=>toast.error(error,'Could not save the question.'),
  })

  const removeItem=useMutation({
    mutationFn:(id:string)=>removeBlueprintItem(id),
    onSuccess:refresh,
    onError:(error)=>toast.error(error,'Could not remove the question.'),
  })

  const grouped=DIMENSION_ORDER.map((dimension)=>({dimension,entries:items.filter((item)=>item.dimension===dimension)})).filter((group)=>group.entries.length>0)

  return <Drawer
    open
    onClose={onClose}
    eyebrow="Interview blueprint"
    title={isDraft?'Draft blueprint':status.rubricId?`Version ${status.version}`:'No blueprint yet'}
    description={isDraft
      ?'Generated as a draft. Review every question, then activate it.'
      :'What this interview should establish. Activating a new version never changes an interview already analysed.'}
    footer={canConfigure?<div className="drawer-footer-actions">
      <Button variant="quiet" onClick={onClose}>Close</Button>
      {isDraft&&<Button onClick={()=>activate.mutate()} disabled={activate.isPending||items.length===0}>
        {activate.isPending?'Activating…':'Activate this version'}
      </Button>}
    </div>:undefined}
  >
    {status.isStale&&<Callout tone="warning" title="The job brief has changed">
      This blueprint is still the one in use. Nothing has been regenerated automatically — generate a new
      draft if the change affects what an interviewer should ask.
    </Callout>}

    {canConfigure&&<section className="blueprint-generate">
      <Field label="Job description document" hint="Optional. PDF only. The job's own description and requirements are always used.">
        <Select value={documentId} onChange={(event)=>setDocumentId(event.target.value)}>
          <option value="">Use the job fields only</option>
          {documents.filter((document)=>document.mimeType==='application/pdf').map((document)=>
            <option key={document.id} value={document.id}>{document.fileName}</option>)}
        </Select>
      </Field>
      <Button variant="secondary" onClick={()=>generate.mutate()} disabled={generate.isPending}>
        {generate.isPending?'Generating…':status.rubricId?'Generate a new draft':'Generate draft'}
      </Button>
      <p className="blueprint-generate-note">
        A generated blueprint is always a draft. It is never activated for you, and it never edits the job itself.
      </p>
    </section>}

    {isLoading&&<p>Loading the blueprint…</p>}
    {!isLoading&&items.length===0&&<p>This blueprint has no questions yet.</p>}

    {grouped.map((group)=><section key={group.dimension} className="blueprint-group">
      <h3>{dimensionLabel(group.dimension)}</h3>
      {group.entries.map((item)=><BlueprintRow
        key={item.id}
        item={item}
        editable={isDraft&&canConfigure}
        onSave={(changes)=>saveItem.mutate({id:item.id,changes})}
        onRemove={()=>removeItem.mutate(item.id)}
      />)}
    </section>)}
  </Drawer>
}

function BlueprintRow({item,editable,onSave,onRemove}:{
  item:BlueprintItem
  editable:boolean
  onSave:(changes:{questionText?:string|null;requirementLevel?:RequirementLevel})=>void
  onRemove:()=>void
}){
  const [question,setQuestion]=useState(item.questionText??'')

  return <article className="blueprint-item">
    <header>
      <strong>{item.label}</strong>
      <span className="blueprint-item-meta">
        <Badge tone="neutral">{itemTypeLabel(item.itemType)}</Badge>
        <Badge tone={item.requirementLevel==='must_have'?'warn':'neutral'}>{requirementLabel(item.requirementLevel)}</Badge>
      </span>
    </header>

    {editable
      ? <>
          <Field label="Question">
            <Textarea
              value={question}
              rows={2}
              onChange={(event)=>setQuestion(event.target.value)}
              onBlur={()=>{if(question!==(item.questionText??''))onSave({questionText:question||null})}}
            />
          </Field>
          <div className="blueprint-item-controls">
            <Field label="Requirement level">
              <Select value={item.requirementLevel} onChange={(event)=>onSave({requirementLevel:event.target.value as RequirementLevel})}>
                <option value="must_have">Must have</option>
                <option value="nice_to_have">Nice to have</option>
                <option value="not_applicable">Not applicable</option>
              </Select>
            </Field>
            <Button variant="quiet" onClick={onRemove} aria-label={`Remove ${item.label}`}><Trash2 size={15}/> Remove</Button>
          </div>
        </>
      : <>
          {item.questionText&&<p className="blueprint-item-question">{item.questionText}</p>}
          {item.evidenceExpected&&<p className="blueprint-item-evidence">Looks like: {item.evidenceExpected}</p>}
        </>}
  </article>
}
