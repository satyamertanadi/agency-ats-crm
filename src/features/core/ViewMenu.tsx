import {useEffect,useMemo,useRef,useState} from 'react'
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query'
import {BookmarkPlus,ChevronDown,Download,ListFilter,Star,Trash2,Users} from 'lucide-react'
import {useOrganization} from '../../app/OrganizationProvider'
import {deleteSavedView,listSavedViews,saveView} from './commercialRepository'
import type {SavedView,SavedViewResource} from '../../shared/types/domain'
import {Button} from '../../shared/ui/Button'
import {Field,Input} from '../../shared/ui/Field'
import {Menu,type MenuItemSpec} from '../../shared/ui/Menu'
import {Modal} from '../../shared/ui/Modal'
import {useToast} from '../../shared/ui/Toast'

/* A saved view is the list's URL parameters under a name.
 *
 * Storing params rather than a typed filter object is deliberate: filters gain and lose keys as the
 * product grows, and a view that cannot round-trip a key it does not recognise is a view that breaks
 * on every feature addition. Unknown keys are preserved and reapplied verbatim; keys the list no
 * longer honours are simply ignored by the page reading them.
 *
 * This used to render as a full-width band above the toolbar: a row of chips on the left, Export and
 * Save view on the right, and -- for the overwhelmingly common case of a workspace that has never
 * saved a view -- the words "No saved views yet." So the first horizontal layer between the page
 * heading and the candidate list was a strip whose entire content was a statement that it had
 * nothing to show. It is now one control in the list's own rail, which is also where a user looks
 * for it: "which view am I in" is a property of the list, not an announcement above it.
 *
 * Save view and Export moved inside the menu because both are occasional; the menu also absorbed
 * per-view deletion, which previously needed a second button inside every chip.
 */
export function ViewMenu({resource,paramKeys,params,onApply,onExport,exporting,baseLabel}:{
  resource:SavedViewResource
  paramKeys:string[]
  params:URLSearchParams
  onApply:(next:URLSearchParams)=>void
  onExport?:()=>void
  exporting?:boolean
  /* What the unfiltered list is called -- "All candidates", "Active jobs". Shown on the trigger when
   * no saved view is applied, so the control always names the current view rather than reading as an
   * empty dropdown. */
  baseLabel:string
}){
  const {organization,membership}=useOrganization();const cache=useQueryClient();const toast=useToast()
  const [saveOpen,setSaveOpen]=useState(false);const [manageOpen,setManageOpen]=useState(false)
  const [name,setName]=useState('');const [shared,setShared]=useState(false);const [makeDefault,setMakeDefault]=useState(false)
  const member=membership
  const views=useQuery({queryKey:['saved-views',organization?.id,resource],enabled:Boolean(organization),queryFn:()=>listSavedViews(organization!.id,resource)})
  const refresh=()=>cache.invalidateQueries({queryKey:['saved-views',organization?.id,resource]})

  const currentFilters=Object.fromEntries(paramKeys.map((key)=>[key,params.get(key)||'']).filter(([,value])=>value))
  const activeCount=Object.keys(currentFilters).length

  const create=useMutation({
    mutationFn:()=>saveView(organization!.id,member!.id,resource,{name,filters:currentFilters,isShared:shared,isDefault:makeDefault}),
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

  /* The star on a default view used to persist and do nothing -- marking a view default changed no
   * behaviour anywhere. It now applies on arrival.
   *
   * Two guards keep that from fighting the user. It runs once per mount (`applied`), so clearing the
   * filters does not immediately reinstate them; and only when the URL carries none of this list's
   * own parameters, so a link, a back-navigation or a hand-edited URL always wins over the default. */
  const applied=useRef(false)
  useEffect(()=>{
    if(applied.current||!views.data)return
    applied.current=true
    if(paramKeys.some((key)=>params.get(key)))return
    const fallback=views.data.find((view)=>view.is_default&&view.owner_member_id===member?.id)
    if(fallback)apply(fallback)
    // Keyed on the loaded views alone: this is a once-per-mount bootstrap, not a subscription to
    // param changes.
  },[views.data])

  const mine=(view:SavedView)=>view.owner_member_id===member?.id

  /* Which view the list is currently showing, by comparing the saved filters against the live params
   * rather than by tracking "last clicked". Editing a filter after applying a view genuinely leaves
   * that view, and the trigger should stop claiming otherwise -- a label that lies about the current
   * state is worse than no label. */
  const activeView=useMemo(()=>views.data?.find((view)=>{
    const saved=Object.entries(view.filters).filter(([,value])=>value)
    if(saved.length!==activeCount)return false
    return saved.every(([key,value])=>params.get(key)===String(value))
  }),[views.data,params,activeCount])

  const items:MenuItemSpec[]=[
    {id:'__base',label:baseLabel,icon:<ListFilter size={15}/>,onSelect:()=>onApply(new URLSearchParams()),disabled:!activeView&&activeCount===0},
    ...(views.data||[]).map((view,index)=>({
      id:view.id,
      label:view.name,
      text:view.name,
      icon:view.is_default?<Star size={15}/>:!mine(view)?<Users size={15}/>:<ListFilter size={15}/>,
      onSelect:()=>apply(view),
      separatorBefore:index===0,
    })),
    {id:'__save',label:'Save current filters as a view…',icon:<BookmarkPlus size={15}/>,separatorBefore:true,
      disabled:!member||activeCount===0,onSelect:()=>setSaveOpen(true)},
    ...(views.data?.some(mine)?[{id:'__manage',label:'Manage saved views…',icon:<Trash2 size={15}/>,onSelect:()=>setManageOpen(true)}]:[]),
    ...(onExport?[{id:'__export',label:exporting?'Exporting…':'Export CSV',icon:<Download size={15}/>,separatorBefore:true,disabled:exporting,onSelect:()=>onExport()}]:[]),
  ]

  return <>
    <Menu label={`Views for ${resource}`} align="start" className="view-menu" items={items} trigger={(props)=>
      <Button {...props} type="button" size="sm" variant="secondary" trailingIcon={<ChevronDown size={14}/>}>
        <span className="view-menu-label">Saved view:</span> {activeView?.name||baseLabel}
      </Button>}/>

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

    {/* Deletion lives here rather than as a second button inside each chip. A chip carrying its own
      * destructive control put a Trash2 within a few pixels of the thing it destroys, on a row the
      * user is clicking to APPLY a view -- and it had to be rendered for every view, permanently, for
      * an action taken perhaps twice a year. */}
    <Modal title="Manage saved views" open={manageOpen} onClose={()=>setManageOpen(false)}>
      <div className="stack">
        <p className="muted">Views you created. Shared views made by colleagues can be used but not deleted.</p>
        <ul className="managed-view-list">
          {views.data?.filter(mine).map((view)=><li key={view.id}>
            <div>
              <strong>{view.name}</strong>
              <span className="muted">{[view.is_default?'Default':null,view.is_shared?'Shared with the workspace':'Only you'].filter(Boolean).join(' · ')}</span>
            </div>
            <Button size="sm" variant="caution" loading={remove.isPending&&remove.variables?.id===view.id}
              leadingIcon={<Trash2 size={14}/>} onClick={()=>remove.mutate(view)}>Delete</Button>
          </li>)}
        </ul>
      </div>
    </Modal>
  </>
}
