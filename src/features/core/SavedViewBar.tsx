import {useState} from 'react'
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query'
import {BookmarkPlus,Download,Star,Trash2,Users} from 'lucide-react'
import {useOrganization} from '../../app/OrganizationProvider'
import {deleteSavedView,listSavedViews,saveView} from './commercialRepository'
import type {SavedView,SavedViewResource} from '../../shared/types/domain'
import {Button} from '../../shared/ui/Button'
import {Field,Input} from '../../shared/ui/Field'
import {Modal} from '../../shared/ui/Modal'
import {useToast} from '../../shared/ui/Toast'

/* A saved view is the list's URL parameters under a name.
 *
 * Storing params rather than a typed filter object is deliberate: filters gain and lose keys as the
 * product grows, and a view that cannot round-trip a key it does not recognise is a view that breaks
 * on every feature addition. Unknown keys are preserved and reapplied verbatim; keys the list no
 * longer honours are simply ignored by the page reading them.
 */
export function SavedViewBar({resource,paramKeys,params,onApply,onExport,exporting}:{
  resource:SavedViewResource
  paramKeys:string[]
  params:URLSearchParams
  onApply:(next:URLSearchParams)=>void
  onExport?:()=>void
  exporting?:boolean
}){
  const {organization,membership}=useOrganization();const cache=useQueryClient();const toast=useToast()
  const [saveOpen,setSaveOpen]=useState(false);const [name,setName]=useState('');const [shared,setShared]=useState(false);const [makeDefault,setMakeDefault]=useState(false)
  const member=membership
  const views=useQuery({queryKey:['saved-views',organization?.id,resource],enabled:Boolean(organization),queryFn:()=>listSavedViews(organization!.id,resource)})
  const refresh=()=>cache.invalidateQueries({queryKey:['saved-views',organization?.id,resource]})

  const currentFilters=Object.fromEntries(paramKeys.map((key)=>[key,params.get(key)||'']).filter(([,value])=>value))
  const activeCount=Object.keys(currentFilters).length

  const create=useMutation({
    mutationFn:()=>saveView(organization!.id,member!.id,resource,{name,filters:currentFilters,columns:[],isShared:shared,isDefault:makeDefault}),
    onSuccess:async()=>{const saved=name;setSaveOpen(false);setName('');setShared(false);setMakeDefault(false);await refresh();toast.success(`View saved: ${saved}`)},
    onError:(error)=>toast.error(error,'The view was not saved.'),
  })
  const remove=useMutation({
    mutationFn:(view:SavedView)=>deleteSavedView(view.id),
    onSuccess:async(_data,view)=>{await refresh();toast.success(`Deleted view: ${view.name}`)},
    onError:(error)=>toast.error(error,'The view was not deleted.'),
  })

  const apply=(view:SavedView)=>{
    // Replace, never merge: a saved view that inherits whatever filter happened to be set before it
    // was clicked is not the view that was saved.
    const next=new URLSearchParams()
    for(const [key,value] of Object.entries(view.filters))if(value)next.set(key,String(value))
    onApply(next)
  }

  const mine=(view:SavedView)=>view.owner_member_id===member?.id

  return <div className="saved-views">
    <div className="saved-view-chips">
      {views.data?.map((view)=><span className={`saved-view-chip ${mine(view)?'':'saved-view-chip-shared'}`} key={view.id}>
        <button type="button" onClick={()=>apply(view)} title={view.is_shared?'Shared with the workspace':'Only you can see this view'}>
          {view.is_default&&<Star size={12} aria-label="Default view"/>}
          {!mine(view)&&<Users size={12} aria-label="Shared view"/>}
          {view.name}
        </button>
        {mine(view)&&<button type="button" className="saved-view-delete" aria-label={`Delete view ${view.name}`} onClick={()=>remove.mutate(view)}><Trash2 size={12}/></button>}
      </span>)}
      {views.data?.length===0&&<span className="muted">No saved views yet.</span>}
    </div>
    <div className="table-actions">
      {onExport&&<Button size="sm" variant="secondary" loading={exporting} leadingIcon={<Download size={14}/>} onClick={onExport}>Export CSV</Button>}
      {member&&<Button size="sm" variant="secondary" disabled={activeCount===0} title={activeCount===0?'Set a filter or sort before saving a view.':undefined} leadingIcon={<BookmarkPlus size={14}/>} onClick={()=>setSaveOpen(true)}>Save view</Button>}
    </div>

    <Modal title="Save this view" open={saveOpen} onClose={()=>setSaveOpen(false)}>
      <form className="stack" onSubmit={(event)=>{event.preventDefault();create.mutate()}}>
        <Field label="View name"><Input autoFocus value={name} onChange={(event)=>setName(event.target.value)} maxLength={60}/></Field>
        <p className="muted">Saves {activeCount} active {activeCount===1?'filter':'filters'}: {Object.keys(currentFilters).join(', ')}</p>
        <label className="checkbox-row"><input type="checkbox" checked={makeDefault} onChange={(event)=>setMakeDefault(event.target.checked)}/><span>Make this my default view</span></label>
        <label className="checkbox-row"><input type="checkbox" checked={shared} onChange={(event)=>setShared(event.target.checked)}/><span>Share with the workspace <small>Colleagues can use it; only you can edit or delete it.</small></span></label>
        {create.error&&<p className="form-error" role="alert">{create.error.message}</p>}
        <div className="form-actions"><Button type="button" variant="quiet" onClick={()=>setSaveOpen(false)}>Cancel</Button><Button loading={create.isPending} disabled={name.trim().length<1}>Save view</Button></div>
      </form>
    </Modal>
  </div>
}
