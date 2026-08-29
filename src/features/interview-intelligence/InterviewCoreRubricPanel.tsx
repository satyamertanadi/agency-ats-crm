import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query'
import {CheckCircle2,FilePlus2,Trash2} from 'lucide-react'
import {Panel,Badge} from '../../shared/ui/Page'
import {Button} from '../../shared/ui/Button'
import {Callout} from '../../shared/ui/Callout'
import {Table} from '../../shared/ui/Table'
import {ErrorState,TableSkeleton} from '../../shared/ui/States'
import {useToast} from '../../shared/ui/Toast'
import {activateBlueprint,listBlueprintItems,removeBlueprintItem} from './blueprintRepository'
import {dimensionLabel,requirementLabel} from './blueprintPresentation'
import {createCoreRubricDraft,discardCoreRubricDraft,listCoreRubrics} from './adminRepository'
import {CORE_RUBRIC_STARTER,CORE_RUBRIC_STARTER_NAME} from './coreRubricStarter'

/* The agency core rubric: what this desk means by a well-run interview, regardless of the role.
 *
 * It had no creation path at all before this panel. Every analysis reads it alongside the job's own
 * blueprint, so a workspace could set up a job, import a transcript, confirm its speakers, and only
 * then be refused -- with nowhere in the product to resolve it.
 *
 * The starter set is offered as a draft to argue with rather than as a recommendation. What counts as
 * a good interview is genuinely the agency's call: a search firm placing CFOs and a volume desk
 * filling warehouse roles do not agree, and a rubric nobody edited is a rubric nobody owns.
 *
 * Activation follows the same rule as job blueprints -- a draft is edited freely, an active version
 * is read-only, and a change means a new version. Rewriting the live one would silently move the
 * yardstick that past assessments were measured against.
 */
export function InterviewCoreRubricPanel({organizationId,activeRubricId,draftRubricId,onChanged}:{
  organizationId:string
  activeRubricId:string|null
  draftRubricId:string|null
  onChanged:()=>void
}){
  const toast=useToast()
  const cache=useQueryClient()

  const rubrics=useQuery({
    queryKey:['core-rubrics',organizationId],
    queryFn:()=>listCoreRubrics(organizationId),
  })

  // A waiting draft is what needs acting on; otherwise show what is live.
  const viewingId=draftRubricId??activeRubricId
  const items=useQuery({
    queryKey:['interview-blueprint-items',viewingId],
    queryFn:()=>viewingId?listBlueprintItems(viewingId):Promise.resolve([]),
    enabled:Boolean(viewingId),
  })

  const refresh=async()=>{
    await cache.invalidateQueries({queryKey:['core-rubrics',organizationId]})
    await cache.invalidateQueries({queryKey:['interview-blueprint-items']})
    onChanged()
  }

  const createDraft=useMutation({
    mutationFn:()=>createCoreRubricDraft(organizationId,CORE_RUBRIC_STARTER_NAME,CORE_RUBRIC_STARTER),
    onSuccess:async()=>{await refresh();toast.success('Draft created.','Edit it, then activate when it reflects how this desk interviews.')},
    onError:(error)=>toast.error(error,'No draft was created.'),
  })
  const discard=useMutation({
    mutationFn:(rubricId:string)=>discardCoreRubricDraft(organizationId,rubricId),
    onSuccess:async()=>{await refresh();toast.success('Draft discarded.')},
    onError:(error)=>toast.error(error,'The draft is still there.'),
  })
  const activate=useMutation({
    mutationFn:(rubricId:string)=>activateBlueprint(organizationId,rubricId),
    onSuccess:async()=>{await refresh();toast.success('Core rubric active.','Interviews can now be analysed.')},
    onError:(error)=>toast.error(error,'The rubric was not activated.'),
  })
  const removeItem=useMutation({
    mutationFn:(itemId:string)=>removeBlueprintItem(itemId),
    onSuccess:async()=>{await refresh()},
    onError:(error)=>toast.error(error,'That criterion is still there.'),
  })

  if(rubrics.isLoading)return <Panel title="Agency core rubric"><TableSkeleton rows={4} columns={3} label="Loading the core rubric…"/></Panel>
  if(rubrics.error)return <ErrorState error={rubrics.error}/>

  const history=rubrics.data||[]
  const viewing=history.find((rubric)=>rubric.id===viewingId)
  const editable=Boolean(draftRubricId)

  const action=draftRubricId
    ? <Button leadingIcon={<CheckCircle2 size={15}/>} loading={activate.isPending}
        disabled={(items.data?.length??0)===0}
        onClick={()=>activate.mutate(draftRubricId)}>Activate this version</Button>
    : <Button variant="secondary" leadingIcon={<FilePlus2 size={15}/>} loading={createDraft.isPending}
        onClick={()=>createDraft.mutate()}>{activeRubricId?'Draft a new version':'Create the core rubric'}</Button>

  return <Panel title="Agency core rubric" action={action}
    subtitle="What a well-run interview looks like on this desk, whatever the role. Every analysis reads this alongside the job's own blueprint.">

    {!activeRubricId&&!draftRubricId&&
      <Callout tone="warning" title="Interviews cannot be analysed yet">
        No core rubric has been activated. Create one to start — you will get a starting set of criteria
        to edit rather than a finished standard, because what counts as a good interview is this
        agency's call.
      </Callout>}

    {draftRubricId&&
      <Callout tone="info" title="Draft — not in use yet">
        Edit this until it reflects how this desk actually interviews, then activate it. Activating never
        changes an interview that has already been analysed.
      </Callout>}

    {viewing&&<p className="muted">
      Showing <strong>version {viewing.version}</strong> · {viewing.status==='active'?'in use':viewing.status} · {viewing.itemCount} criteria
      {viewing.status==='active'&&' · read-only, because past assessments were measured against it'}
    </p>}

    {items.isLoading&&<TableSkeleton rows={5} columns={3} label="Loading criteria…"/>}

    {!items.isLoading&&(items.data?.length??0)>0&&
      <Table caption="Agency core rubric criteria"
        headers={editable?['Dimension','Criterion','Level','']:['Dimension','Criterion','Level']}>
        {(items.data||[]).map((item)=><tr key={item.id}>
          <td>{dimensionLabel(item.dimension)}</td>
          <td>
            <strong>{item.label}</strong>
            {item.evidenceExpected&&<><br/><small className="muted">{item.evidenceExpected}</small></>}
          </td>
          <td><Badge tone={item.requirementLevel==='must_have'?'warn':'neutral'}>{requirementLabel(item.requirementLevel)}</Badge></td>
          {editable&&<td>
            <Button variant="caution" leadingIcon={<Trash2 size={13}/>} loading={removeItem.isPending}
              aria-label={`Remove ${item.label}`} onClick={()=>removeItem.mutate(item.id)}>Remove</Button>
          </td>}
        </tr>)}
      </Table>}

    {draftRubricId&&<div className="form-actions">
      <Button variant="caution" leadingIcon={<Trash2 size={14}/>} loading={discard.isPending}
        onClick={()=>discard.mutate(draftRubricId)}>Discard draft</Button>
    </div>}

    {history.length>1&&<>
      <h4 className="settings-subhead">Previous versions</h4>
      <Table caption="Core rubric version history" headers={['Version','Status','Criteria']}>
        {history.filter((rubric)=>rubric.id!==viewingId).map((rubric)=><tr key={rubric.id}>
          <td>v{rubric.version}</td>
          <td>{rubric.status}</td>
          <td>{rubric.itemCount}</td>
        </tr>)}
      </Table>
    </>}
  </Panel>
}
