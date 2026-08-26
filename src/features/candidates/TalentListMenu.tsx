import {useState} from 'react'
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query'
import {Archive,ChevronDown,ListChecks,Lock, Plus,RotateCcw,Users} from 'lucide-react'
import {useOrganization} from '../../app/OrganizationProvider'
import {createCandidateList,listCandidateLists,setCandidateListArchived,updateCandidateList} from '../core/repository'
import type {CandidateList,CandidateListVisibility} from '../../shared/types/domain'
import {Button} from '../../shared/ui/Button'
import {Field,Input,Select,Textarea} from '../../shared/ui/Field'
import {Menu,type MenuItemSpec} from '../../shared/ui/Menu'
import {Modal} from '../../shared/ui/Modal'
import {ErrorState,LoadingState} from '../../shared/ui/States'
import {useToast} from '../../shared/ui/Toast'

/* Which list the candidate table is scoped to, and everything needed to curate one.
 *
 * Sits beside ViewMenu and deliberately looks like it -- same size, same trailing chevron, same
 * "Label: value" trigger -- because both answer "what am I looking at". They must never MERGE,
 * though, and the whole reason this is a second control rather than a section inside the first is
 * that they answer it in incompatible ways:
 *
 *   a saved view stores FILTERS and re-runs them, so its membership changes without anyone deciding
 *   a talent list stores PEOPLE, so its membership changes only when somebody changes it
 *
 * A "Shortlist for Acme" that quietly gained a candidate overnight because they moved to Jakarta
 * would be worse than useless -- it would be a shortlist nobody chose, presented as one somebody
 * did. So the two controls sit side by side and the list id is kept out of the saved-view key set
 * (see viewParamKeys in CandidatesPage).
 *
 * There is no Talent Lists page and no sidebar item. A list is a way of looking at candidates, so it
 * lives on the candidates screen; a top-level destination would make curating a list feel like a
 * separate activity from the searching that produces one.
 */
export function TalentListMenu({activeListId,onSelect}:{
  activeListId:string|null
  onSelect:(listId:string|null)=>void
}){
  const {organization,membership}=useOrganization();const cache=useQueryClient();const toast=useToast()
  const [manageOpen,setManageOpen]=useState(false)
  const [createOpen,setCreateOpen]=useState(false)

  const lists=useQuery({queryKey:['candidate-lists',organization?.id],enabled:Boolean(organization),
    queryFn:()=>listCandidateLists(organization!.id)})
  /* Archived lists are a second, deliberately separate request, made only while the management modal
   * is open. The picker is bounded by how many live lists a workspace keeps; folding finished ones
   * into the same fetch would grow it without bound for a set nobody browses. */
  const archived=useQuery({queryKey:['candidate-lists',organization?.id,'archived'],enabled:manageOpen&&Boolean(organization),
    queryFn:()=>listCandidateLists(organization!.id,true)})
  const refresh=()=>cache.invalidateQueries({queryKey:['candidate-lists',organization?.id]})

  const active=lists.data?.find((list)=>list.id===activeListId)||null
  /* A `?list=` naming something this member cannot see resolves to nothing, and the control says so
   * rather than showing a uuid or silently reading as "All candidates" while the table shows an
   * empty page. The server has already made the filter inert; this is the sentence explaining it. */
  const unknownList=Boolean(activeListId&&lists.data&&!active)

  const items:MenuItemSpec[]=[
    {id:'__all',label:'All candidates',icon:<ListChecks size={15}/>,onSelect:()=>onSelect(null),disabled:!activeListId},
    ...(lists.data||[]).map((list,index)=>({
      id:list.id,
      label:<span className="talent-list-item"><span>{list.name}</span><span className="talent-list-count">{list.member_count}</span></span>,
      text:list.name,
      icon:list.visibility==='workspace'?<Users size={15}/>:<Lock size={15}/>,
      onSelect:()=>onSelect(list.id),
      separatorBefore:index===0,
    })),
    {id:'__new',label:'New talent list…',icon:<Plus size={15}/>,separatorBefore:true,onSelect:()=>setCreateOpen(true)},
    {id:'__manage',label:'Manage talent lists…',icon:<ListChecks size={15}/>,onSelect:()=>setManageOpen(true)},
  ]

  return <>
    <Menu label="Talent lists" align="start" className="view-menu" items={items} trigger={(props)=>
      <Button {...props} type="button" size="sm" variant="secondary" trailingIcon={<ChevronDown size={14}/>}>
        <span className="view-menu-label">Talent list:</span> {active?.name||(unknownList?'Unavailable list':'All candidates')}
      </Button>}/>

    <TalentListFormModal open={createOpen} onClose={()=>setCreateOpen(false)}
      onSaved={(list)=>{setCreateOpen(false);onSelect(list.id)}}/>

    <ManageTalentListsModal open={manageOpen} onClose={()=>setManageOpen(false)}
      lists={archived.data} loading={archived.isLoading} error={archived.error}
      activeListId={activeListId} memberId={membership?.id||null}
      onArchivedActive={()=>onSelect(null)}
      onChanged={refresh} toast={toast}/>
  </>
}

/* Creating a list. Separate from the management modal rather than a row inside it, because creating
 * one is the common act and managing them is the rare one -- putting the form at the bottom of a
 * table of existing lists would make the frequent thing the harder thing to reach. */
function TalentListFormModal({open,onClose,onSaved}:{
  open:boolean
  onClose:()=>void
  onSaved:(list:{id:string;name:string})=>void
}){
  const {organization}=useOrganization();const cache=useQueryClient();const toast=useToast()
  const [name,setName]=useState('');const [description,setDescription]=useState('')
  const [visibility,setVisibility]=useState<CandidateListVisibility>('private')
  const create=useMutation({
    mutationFn:()=>createCandidateList(organization!.id,{name:name.trim(),description:description.trim()||undefined,visibility}),
    onSuccess:async(list)=>{
      const created=name.trim()
      setName('');setDescription('');setVisibility('private')
      await cache.invalidateQueries({queryKey:['candidate-lists',organization?.id]})
      toast.success(`Talent list created: ${created}`,'It is empty until you add candidates to it.')
      onSaved(list)
    },
    onError:(error)=>toast.error(error,'The talent list was not created.'),
  })
  return <Modal title="New talent list" open={open} onClose={onClose}>
    <form className="stack" onSubmit={(event)=>{event.preventDefault();create.mutate()}}>
      <Field label="List name"><Input autoFocus value={name} maxLength={80} placeholder="Shortlist — Acme CFO search"
        onChange={(event)=>setName(event.target.value)} required/></Field>
      <Field label="What is this list for? (optional)"><Textarea rows={2} value={description} maxLength={400}
        onChange={(event)=>setDescription(event.target.value)}/></Field>
      <Field label="Who can see it"><Select value={visibility} onChange={(event)=>setVisibility(event.target.value as CandidateListVisibility)}>
        <option value="private">Only me</option>
        <option value="workspace">Everyone in the workspace</option>
      </Select></Field>
      {/* Stated plainly because the two halves of the rule are genuinely different, and a colleague
        * discovering by accident that they cannot edit a list they can see is a worse way to learn
        * it. Same rule saved views already use. */}
      <p className="muted">A shared list can be used by colleagues; only you can rename, archive, or change who is on it.</p>
      {create.error&&<p className="form-error" role="alert">{create.error.message}</p>}
      <div className="form-actions">
        <Button type="button" variant="quiet" onClick={onClose}>Cancel</Button>
        <Button type="submit" loading={create.isPending} disabled={!name.trim()}>Create list</Button>
      </div>
    </form>
  </Modal>
}

/* Renaming and archiving, over every list including the finished ones.
 *
 * Archive rather than delete, and the button says so. The request behind "get rid of this list" is
 * almost always "stop showing it to me", and the record of which eleven people were shortlisted for
 * a search that closed is worth more than the row it occupies. Restoring is one press away for the
 * same reason. */
function ManageTalentListsModal({open,onClose,lists,loading,error,activeListId,memberId,onArchivedActive,onChanged,toast}:{
  open:boolean
  onClose:()=>void
  lists:CandidateList[]|undefined
  loading:boolean
  error:unknown
  activeListId:string|null
  /* Whose lists are editable. A colleague's shared list is shown -- knowing it exists and how big it
   * is, is useful -- with no buttons at all rather than buttons that fail on press. The server would
   * refuse either way; this is so the refusal never has to happen. */
  memberId:string|null
  onArchivedActive:()=>void
  onChanged:()=>Promise<unknown>
  toast:ReturnType<typeof useToast>
}){
  const [renaming,setRenaming]=useState<string|null>(null)
  const [draftName,setDraftName]=useState('')

  const rename=useMutation({
    mutationFn:({list,name}:{list:CandidateList;name:string})=>updateCandidateList(list.id,{name}),
    onSuccess:async()=>{setRenaming(null);setDraftName('');await onChanged();toast.success('The list was renamed.')},
    onError:(mutationError)=>toast.error(mutationError,'The list was not renamed.'),
  })
  const archive=useMutation({
    mutationFn:({list,archived}:{list:CandidateList;archived:boolean})=>setCandidateListArchived(list.id,archived),
    onSuccess:async(_result,{list,archived})=>{
      await onChanged()
      /* Archiving the list the table is currently scoped to would leave the page filtered by
       * something the picker no longer offers -- so the scope goes back to all candidates rather
       * than stranding the user in a list they just put away. */
      if(archived&&list.id===activeListId)onArchivedActive()
      toast.success(archived?`Archived: ${list.name}`:`Restored: ${list.name}`)
    },
    onError:(mutationError)=>toast.error(mutationError,'Nothing was changed.'),
  })

  const live=(lists||[]).filter((list)=>!list.archived_at)
  const done=(lists||[]).filter((list)=>list.archived_at)

  const renderRow=(list:CandidateList)=>{
  const mine=Boolean(memberId)&&list.owner_member_id===memberId
  return <li key={list.id}>
    <div>
      {renaming===list.id
        ?<Input aria-label={`Rename ${list.name}`} autoFocus value={draftName} maxLength={80}
          onChange={(event)=>setDraftName(event.target.value)}/>
        :<strong>{list.name}</strong>}
      <span className="muted">{[
        `${list.member_count} ${list.member_count===1?'candidate':'candidates'}`,
        list.visibility==='workspace'?'Shared with the workspace':'Only you',
        list.owner_name?`Owner: ${list.owner_name}`:null,
      ].filter(Boolean).join(' · ')}</span>
    </div>
    {mine&&<span className="managed-view-actions">
      {renaming===list.id
        ?<>
          <Button size="sm" variant="quiet" onClick={()=>{setRenaming(null);setDraftName('')}}>Cancel</Button>
          <Button size="sm" loading={rename.isPending} disabled={!draftName.trim()}
            onClick={()=>rename.mutate({list,name:draftName.trim()})}>Save</Button>
        </>
        :<>
          {!list.archived_at&&<Button size="sm" variant="secondary"
            onClick={()=>{setRenaming(list.id);setDraftName(list.name)}}>Rename</Button>}
          <Button size="sm" variant={list.archived_at?'secondary':'caution'}
            loading={archive.isPending&&archive.variables?.list.id===list.id}
            leadingIcon={list.archived_at?<RotateCcw size={14}/>:<Archive size={14}/>}
            onClick={()=>archive.mutate({list,archived:!list.archived_at})}>
            {list.archived_at?'Restore':'Archive'}
          </Button>
        </>}
    </span>}
  </li>
  }

  return <Modal title="Manage talent lists" open={open} onClose={onClose}>
    <div className="stack">
      {/* The rule, once, where the buttons are. Lists a colleague shared are listed so their size is
        * visible, and their buttons are simply absent rather than present-and-refusing. */}
      <p className="muted">Your lists, and the shared lists your colleagues have made. Only the person who created a list can rename or archive it.</p>
      {loading?<LoadingState label="Loading talent lists…"/>
        :error?<ErrorState error={error}/>
        :live.length===0&&done.length===0
          ?<p className="muted">No talent lists yet. Select candidates and choose “Add to talent list” to start one.</p>
          :<>
            <ul className="managed-view-list">{live.map(renderRow)}</ul>
            {done.length>0&&<>
              <p className="muted">Archived</p>
              <ul className="managed-view-list managed-view-list-archived">{done.map(renderRow)}</ul>
            </>}
          </>}
    </div>
  </Modal>
}
