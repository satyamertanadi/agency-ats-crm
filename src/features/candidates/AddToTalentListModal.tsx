import {useEffect,useState} from 'react'
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query'
import {Lock,Users} from 'lucide-react'
import {useOrganization} from '../../app/OrganizationProvider'
import {addCandidatesToList,createCandidateList,listCandidateLists} from '../core/repository'
import type {CandidateListVisibility} from '../../shared/types/domain'
import {Button} from '../../shared/ui/Button'
import {Field,Input,Select} from '../../shared/ui/Field'
import {Modal} from '../../shared/ui/Modal'
import {ErrorState,LoadingState} from '../../shared/ui/States'
import {useToast} from '../../shared/ui/Toast'

/* Putting the people you have chosen onto a list you have chosen.
 *
 * One modal for one candidate and for forty, because it is one act: the row menu passes a single
 * candidate and the bulk bar passes the selection, and nothing below branches on which. A separate
 * "add this one" path would be a second place for the reporting to be wrong.
 *
 * Creating a list from inside here rather than sending the user away to make one first. The moment
 * somebody realises they want a list is the moment they are looking at the people who should be on
 * it, and a flow that loses that selection to go and create an empty container is a flow people stop
 * using.
 *
 * Deliberately no filtering by status. A do-not-contact or archived candidate can go on an internal
 * list -- it stays a legitimate record of who was considered -- and the rules that actually restrict
 * outreach and pipeline moves are enforced where they belong, untouched by membership. See the
 * header of the migration.
 */
export function AddToTalentListModal({open,onClose,candidates,onAdded}:{
  open:boolean
  onClose:()=>void
  candidates:{id:string;full_name:string}[]
  /** Fired after a successful add, so the caller can drop its selection and refresh its own list. */
  onAdded?:()=>void
}){
  const {organization}=useOrganization();const cache=useQueryClient();const toast=useToast()
  const [listId,setListId]=useState('')
  const [creating,setCreating]=useState(false)
  const [name,setName]=useState('');const [visibility,setVisibility]=useState<CandidateListVisibility>('private')

  const lists=useQuery({queryKey:['candidate-lists',organization?.id],enabled:open&&Boolean(organization),
    queryFn:()=>listCandidateLists(organization!.id)})

  /* A workspace with no lists yet opens straight into the create form: offering an empty picker and
   * a "new list" toggle would be asking the user to choose between one real option and nothing. */
  useEffect(()=>{
    if(!open)return
    if(lists.data&&lists.data.length===0)setCreating(true)
  },[open,lists.data])

  const reset=()=>{setListId('');setCreating(false);setName('');setVisibility('private')}
  const close=()=>{reset();onClose()}

  const add=useMutation({
    mutationFn:async()=>{
      /* Create-then-add rather than one combined RPC. The two are genuinely separate facts -- the
       * list exists whether or not the membership write succeeds -- and a failed add leaves a real,
       * usable, empty list rather than rolling back something the user asked for. */
      const target=creating
        ?(await createCandidateList(organization!.id,{name:name.trim(),visibility})).id
        :listId
      const result=await addCandidatesToList(target,candidates.map((candidate)=>candidate.id))
      return {...result,target}
    },
    onSuccess:async(result)=>{
      await Promise.all([
        cache.invalidateQueries({queryKey:['candidate-lists',organization?.id]}),
        // The table itself may be scoped to this list, in which case its rows just changed.
        cache.invalidateQueries({queryKey:['candidates-page',organization?.id]}),
      ])
      /* Both numbers, always, because they answer different questions. "Nothing was added" with a
       * skipped count is a success -- everyone was already there -- and reporting it as a bare
       * success would leave the consultant wondering whether the click registered. */
      const added=`${result.added} ${result.added===1?'candidate':'candidates'}`
      toast.success(result.added>0?`Added ${added} to the list.`:'Nothing new to add.',
        result.skipped>0?`${result.skipped} ${result.skipped===1?'was':'were'} already on this list.`:undefined)
      onAdded?.()
      close()
    },
    onError:(error)=>toast.error(error,'Nothing was added to the list.'),
  })

  const ready=creating?name.trim().length>0:Boolean(listId)
  const count=candidates.length
  const subject=count===1?candidates[0]?.full_name:`${count} candidates`

  return <Modal title="Add to talent list" open={open} onClose={close}>
    <form className="stack" onSubmit={(event)=>{event.preventDefault();if(ready)add.mutate()}}>
      <p className="muted">Adding {subject}.</p>
      {lists.isLoading?<LoadingState label="Loading talent lists…"/>
        :lists.error?<ErrorState error={lists.error} retry={()=>void lists.refetch()}/>
        :<>
          {!creating&&<Field label="Talent list">
            <Select autoFocus aria-label="Choose a talent list" value={listId} onChange={(event)=>setListId(event.target.value)}>
              <option value="">Choose a list…</option>
              {lists.data?.map((list)=><option key={list.id} value={list.id}>
                {list.name} · {list.member_count} {list.member_count===1?'candidate':'candidates'}
                {list.visibility==='workspace'?' · shared':''}
              </option>)}
            </Select>
          </Field>}
          {creating&&<>
            <Field label="New list name"><Input autoFocus value={name} maxLength={80}
              placeholder="Shortlist — Acme CFO search" onChange={(event)=>setName(event.target.value)}/></Field>
            <Field label="Who can see it"><Select value={visibility}
              onChange={(event)=>setVisibility(event.target.value as CandidateListVisibility)}>
              <option value="private">Only me</option>
              <option value="workspace">Everyone in the workspace</option>
            </Select></Field>
          </>}
          {/* The toggle is present in both directions, and absent in neither -- except when there is
            * nothing to go back to. */}
          {(lists.data?.length||0)>0&&<p className="muted">
            <Button type="button" size="sm" variant="quiet"
              leadingIcon={creating?<Users size={14}/>:<Lock size={14}/>}
              onClick={()=>{setCreating(!creating);setListId('');setName('')}}>
              {creating?'Use an existing list instead':'Create a new list instead'}
            </Button>
          </p>}
        </>}
      {/* Said once, here, because it is the thing most likely to be assumed otherwise: a list is a
        * note about people and grants nothing. */}
      <p className="muted">A talent list is for organising. It does not change who may be contacted or added to a job.</p>
      {add.error&&<p className="form-error" role="alert">{add.error.message}</p>}
      <div className="form-actions">
        <Button type="button" variant="quiet" onClick={close}>Cancel</Button>
        <Button type="submit" loading={add.isPending} disabled={!ready||count===0}>
          {creating?'Create list and add':`Add ${count===1?'candidate':`${count} candidates`}`}
        </Button>
      </div>
    </form>
  </Modal>
}
