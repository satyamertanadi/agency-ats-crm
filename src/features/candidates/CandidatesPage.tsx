import {useCallback,useMemo,useRef,useState,type ReactNode} from 'react'
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query'
import {ChevronLeft,ChevronRight,CopyCheck,Merge,MoreHorizontal,PanelRightOpen,Plus,Rows3,Search,SquareCheck,UserRoundSearch,Users} from 'lucide-react'
import {Link,useNavigate,useSearchParams} from 'react-router'
import {useOrganization} from '../../app/OrganizationProvider'
import {prefetchHandlers,usePrefetchRecord} from '../core/usePrefetchRecord'
import {TruncatedText} from '../../shared/ui/TruncatedText'
import {useAuth} from '../../app/AuthProvider'
import {useWorkspaceCapabilities} from '../../app/useWorkspaceCapabilities'
import {listCandidatesPage,type CandidateListFilters} from '../core/repository'
import {listTeamMembers,mergeCandidates,updateCandidateProfile} from '../core/commercialRepository'
import {candidateStatus} from '../../shared/lib/status'
import {candidateAvailability,candidateSource} from '../../shared/lib/optionSets'
import {initials} from '../../shared/lib/format'
import {useOpenOnNewParam} from '../../shared/lib/useOpenOnNewParam'
import {Button} from '../../shared/ui/Button'
import {Field,Input,Select,Textarea} from '../../shared/ui/Field'
import {Modal} from '../../shared/ui/Modal'
import {Badge,Page,Panel,StatusBadge} from '../../shared/ui/Page'
import {Callout} from '../../shared/ui/Callout'
import {EmptyState,ErrorState,TableSkeleton} from '../../shared/ui/States'
import {useToast} from '../../shared/ui/Toast'
import {ViewMenu} from '../core/ViewMenu'
import {FilterPopover} from '../core/FilterPopover'
import {Menu,type MenuItemSpec} from '../../shared/ui/Menu'
import {csvFilename,downloadCsv,toCsv} from '../../shared/lib/csv'
import {Table} from '../../shared/ui/Table'
import {AddCandidateModal} from './AddCandidateModal'
import {AddCandidateToJobModal,type PlacementCandidate} from './AddCandidateToJobModal'
import {CandidateQuickViewDrawer} from './CandidateQuickViewDrawer'
import {describeBulk,runBulk} from '../core/bulkResult'
import {ActiveFilterChips} from '../core/ActiveFilterChips'
import {candidateFilterChips,candidateFilterKeys} from './candidateFilterChips'
import {useListNavigation} from '../../shared/lib/useListNavigation'
import {useShortcut} from '../../shared/lib/useShortcut'
import {followUpSignal,pipelineSignal,statusFacets,type FollowUpSignal} from './candidateRowSignals'
import {emptyQueueMessage,parseQueue} from './candidateQueues'
import {CandidateQueueTabs} from './CandidateQueueTabs'
import {DENSITY_OPTIONS,readDensity,writeDensity,type CandidateDensity} from './candidateDensity'
import {resolveColumnTier,visibleCandidateColumns,type CandidateColumnId} from './candidateColumns'
import {useContainerTier} from '../../shared/lib/useContainerTier'
import type {CandidateSearchRow} from '../../shared/types/domain'
import {NOT_RECORDED} from '../../shared/lib/labels'
import {isRowInteractive} from './candidateRowInteraction'
import {recordWorkflowEvent} from '../../shared/lib/productAnalytics'

type SelectionMode='none'|'bulk'|'merge'
/* "Unassigned" as a deliberate choice, distinct from '' meaning "nothing picked yet". */
const UNASSIGN='__unassign__'

/* A fact the record is missing.
 *
 * This used to draw a dashed outline around the value, on the theory that a slot reads as work to do
 * where plain text reads as an empty column. At one or two per screen that holds. At fifty rows x
 * three columns it does not: "Unassigned", "Not in a pipeline" and "No follow-up set" are the NORMAL
 * state of most of a talent database, so the dashes drew a page of dotted boxes around the absence of
 * news -- and, being the only outlined thing in the row, they pulled the eye away from the candidate
 * names. It is now quiet text in the muted colour, which is what "nothing here" should look like.
 * Real risk still gets a badge; see DueChip and StatusCell. */
const Gap=({children}:{children:ReactNode})=><span className="cell-gap">{children}</span>

/* Badge weight carries urgency, following the rule TodayPage established: a solid fill for overdue
 * reading its real lateness, an outline for today, and NOTHING for a future date. A follow-up booked
 * for next Tuesday is not a problem and must not be drawn as one. */
function DueChip({signal}:{signal:FollowUpSignal}){
  if(signal.state==='overdue')return <span className="due-chip due-chip-late">{signal.dueLabel}</span>
  if(signal.state==='today')return <span className="due-chip due-chip-today">{signal.dueLabel}</span>
  return null
}

function PipelineCell({row,now}:{row:CandidateSearchRow;now:Date}){
  const signal=pipelineSignal(row,now)
  if(!signal.inPipeline)return <Gap>Not in a pipeline</Gap>
  return <>
    <div className="cell-lead">
      <strong className="cell-strong">{signal.jobTitle}</strong>
      {signal.moreLabel&&<Badge tone="neutral">{signal.moreLabel}</Badge>}
    </div>
    <span>{signal.stageLabel||NOT_RECORDED}</span>
  </>
}

function FollowUpCell({row,now}:{row:CandidateSearchRow;now:Date}){
  const signal=followUpSignal(row,now)
  return <>
    <div className="cell-lead">
      <DueChip signal={signal}/>
      {signal.state==='none'
        ?<Gap>No follow-up set</Gap>
        :<span className="cell-strong">{signal.taskTitle}</span>}
      {signal.state==='future'&&<span className="cell-quiet">{signal.dueLabel}</span>}
    </div>
    <span>{signal.activityLabel}</span>
  </>
}

/* The three concepts candidates.status conflates, separated by visual weight rather than by a
 * migration. Only a real lifecycle outcome earns a badge; active/passive is posture and stays quiet,
 * which is what stops every row carrying an identical green chip that says nothing. Availability --
 * a column that has existed all along and was rendered nowhere -- becomes the sub-line. */
function StatusCell({row}:{row:CandidateSearchRow}){
  const facets=statusFacets(row)
  return <>
    {facets.lifecycle
      ?<StatusBadge map={candidateStatus} value={facets.lifecycle}/>
      :<span className="cell-quiet">{facets.posture||'—'}</span>}
    <span>{facets.availabilityLabel||NOT_RECORDED}</span>
  </>
}

export function CandidatesPage(){
  const {organization}=useOrganization();const {user}=useAuth();const capabilities=useWorkspaceCapabilities();const cache=useQueryClient();const toast=useToast();const navigate=useNavigate();const [params,setParams]=useSearchParams()
  const [open,setOpen]=useState(false);const [selectionMode,setSelectionMode]=useState<SelectionMode>('none');const [mergeOpen,setMergeOpen]=useState(false);const [selected,setSelected]=useState<string[]>([]);const [keptId,setKeptId]=useState('');const [mergeReason,setMergeReason]=useState('Duplicate candidate record');const [placementCandidates,setPlacementCandidates]=useState<PlacementCandidate[]>([]);const placementOpen=placementCandidates.length>0||params.get('addToJob')==='1';const pageSize=50
  const prefetch=usePrefetchRecord()
  useOpenOnNewParam(setOpen)
  /* A browser preference, not workspace state, so it lives in localStorage and not in the URL: it
   * must not travel in a shared link or get captured by a saved view, where one person's row height
   * would become everybody's. */
  const [density,setDensity]=useState<CandidateDensity>(readDensity)
  const chooseDensity=(next:CandidateDensity)=>{setDensity(next);writeDensity(next)}

  /* Which columns fit. Driven by the measured region alone: the sidebar changes that measurement, so
   * it needs no branch here, and Quick View -- an overlay rather than a second column -- does not
   * change it at all, which is the whole point of moving the preview into a drawer.
   *
   * selectionMode is folded into the resolver rather
   * than applied afterwards because its checkbox column costs 44px of real budget -- it has to be
   * able to DEMOTE a tier, not merely prepend a column to whatever tier was already chosen. */
  const tableRegion=useRef<HTMLDivElement>(null)
  const selectionActive=selectionMode!=='none'
  const resolveTier=useCallback((width:number|null)=>resolveColumnTier(width,selectionActive),[selectionActive])
  const tier=useContainerTier(tableRegion,resolveTier)
  const columns=useMemo(()=>visibleCandidateColumns(tier,selectionActive),[tier,selectionActive])
  /* Narrowed rather than passed through: an unrecognised ?queue= becomes null here, matching the SQL,
   * where an unknown value matches nothing. Without this a typo'd URL would render an active-looking
   * tab that is not one of ours and an empty list with no explanation. */
  const queue=parseQueue(params.get('queue'))
  const page=Math.max(0,Number(params.get('page')||0));const filters:CandidateListFilters={query:params.get('q')||'',status:params.get('status')||'',location:params.get('location')||'',source:params.get('source')||'',ownerMemberId:params.get('owner')||'',tag:params.get('tag')||'',skill:params.get('skill')||'',availability:params.get('availability')||'',queue:queue||undefined,sort:(params.get('sort') as CandidateListFilters['sort'])||'updated',direction:(params.get('dir') as CandidateListFilters['direction'])||'desc'}
  /* Every filter change also closes Quick View. A drawer left open across a filter change would be
   * describing a candidate the list no longer contains, and its pager would page through a set that
   * is no longer on screen. */
  const setFilter=(key:string,value:string)=>{const next=new URLSearchParams(params);if(value)next.set(key,value);else next.delete(key);next.delete('page');setParams(next,{replace:true});setSelected([]);setQuickViewId(null)}
  /* `queue` is here so a saved view carries the queue it was saved in -- a view called "My overdue"
   * that silently dropped the queue would be a lie. It is NOT in candidateFilterKeys, so it gets no
   * dismissible chip: the tab row already shows its state, and two ways to clear one thing is how
   * they end up disagreeing. */
  const viewParamKeys=['q','status','location','source','owner','tag','skill','availability','queue','sort','dir']
  /* Export refetches the whole filtered set rather than writing the page on screen -- "export this
   * view" meaning "export the 50 rows you happen to be looking at" is the kind of quiet wrongness
   * that gets discovered in a client meeting. The cap is explicit and reported rather than silently
   * truncating. */
  const EXPORT_LIMIT=5000
  const exportView=useMutation({
    mutationFn:()=>listCandidatesPage(organization!.id,filters,0,EXPORT_LIMIT),
    onSuccess:(result)=>{
      const rows=result.rows.map((row)=>({name:row.full_name,current_position:row.current_position||'',current_company:row.current_company||'',location:row.location||'',status:row.status,source:row.source||'',owner:row.owner_name||'',skills:row.skill_names.join('; '),tags:row.tag_names.join('; '),updated_at:row.updated_at}))
      downloadCsv(csvFilename('candidates'),toCsv(rows))
      toast.success(`Exported ${rows.length} ${rows.length===1?'candidate':'candidates'}.`,result.count>rows.length?`This view has ${result.count} candidates; the first ${rows.length} were exported.`:undefined)
    },
    onError:(error)=>toast.error(error,'Nothing was exported.'),
  })
  const query=useQuery({queryKey:['candidates-page',organization?.id,filters,page],enabled:Boolean(organization),queryFn:()=>listCandidatesPage(organization!.id,filters,page,pageSize)})
  const team=useQuery({queryKey:['team',organization?.id],enabled:Boolean(organization),queryFn:()=>listTeamMembers(organization!.id)})
  const currentMemberId=team.data?.find((member)=>member.user_id===user?.id)?.id
  const mergeMutation=useMutation({mutationFn:()=>{const duplicateId=selected.find((id)=>id!==keptId);if(!duplicateId)throw new Error('Select a second candidate to merge');return mergeCandidates(organization!.id,keptId,duplicateId,mergeReason)},onSuccess:async(id)=>{setMergeOpen(false);setSelected([]);await cache.invalidateQueries({queryKey:['candidates-page',organization?.id]});navigate(`/app/${organization!.slug}/candidates/${id}`);toast.success('The duplicate was merged into the kept record.','Stage history and activity from both records were preserved.')},onError:(error)=>toast.error(error,'Nothing was merged.')})
  /* Assigning an owner to a batch. Batches the per-row RPC rather than adding a bulk one: the RPC
   * already carries the permission check and the audit write, and a new one would have to reimplement
   * both. `runBulk` is what keeps a five-of-seven result from being reported as seven. */
  const [assignOwnerId,setAssignOwnerId]=useState('')
  const assignOwner=useMutation({
    mutationFn:async()=>{
      const targets=(query.data?.rows||[]).filter((row)=>selected.includes(row.id))
      /* Deliberately unassigning is a real choice, and an empty <option> value cannot express it --
       * '' already means "nothing picked yet", which is what disables the button. Hence the sentinel,
       * mapped to null here so it never reaches the RPC as a member id. */
      const ownerMemberId=assignOwnerId===UNASSIGN?null:assignOwnerId
      return runBulk(targets,(row)=>row.full_name,
        (row)=>updateCandidateProfile(organization!.id,row.id,{owner_member_id:ownerMemberId},{}))
    },
    onSuccess:async(outcome)=>{
      await cache.invalidateQueries({queryKey:['candidates-page',organization?.id]})
      const {tone,message}=describeBulk(outcome,'reassigned')
      // A partial write is never a success toast. The error tone carries the cause; 'info' states a
      // partial plainly without claiming either.
      if(tone==='success'){setSelected([]);setAssignOwnerId('');toast.success(message)}
      else if(tone==='failure')toast.error(outcome.error??new Error(message),message)
      else toast.info(message,'The selection is kept so you can retry the ones that failed.')
    },
    onError:(error)=>toast.error(error,'No owner was changed.'),
  })
  const selectedRows=(query.data?.rows||[]).filter((item)=>selected.includes(item.id));const openMerge=()=>{setKeptId(selected[0]||'');setMergeOpen(true)};const openPlacement=(rows=selectedRows)=>{setPlacementCandidates(rows.map((item)=>({id:item.id,full_name:item.full_name,current_position:item.current_position,status:item.status})))}
  const closePlacement=()=>{setPlacementCandidates([]);const next=new URLSearchParams(params);next.delete('addToJob');setParams(next,{replace:true})}
  const toggle=(id:string,checked:boolean)=>setSelected((current)=>checked?[...current,id]:current.filter((item)=>item!==id))
  const rows=query.data?.rows||[]
  /* One clock for the whole table, refreshed when the data is. Calling new Date() inside each cell
   * would let two rows disagree about what "today" is across a slow render, and would also re-run
   * every relative label on every unrelated re-render. */
  const now=useMemo(()=>new Date(),[query.dataUpdatedAt])
  const rowIds=useMemo(()=>rows.map((row)=>row.id),[rows])
  /* Which row the keyboard is on. Distinct from `selected`: moving through a list is not the same act
   * as choosing from it, and conflating them would mean j/k silently built a bulk selection. */
  const [activeId,setActiveId]=useState<string|null>(null)
  const active=activeId&&rowIds.includes(activeId)?activeId:null
  const searchRef=useRef<HTMLInputElement>(null)
  // data-row-id is unique to this table, so no container ref (and no extra wrapper element) is
  // needed to scope the lookup. 'nearest' so a keypress never jumps the page when the row is already
  // on screen.
  const rowElement=(id:string)=>document.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(id)}"]`)
  /* Move the cursor WITHOUT taking focus. This is what the drawer's pager uses: focus belongs to the
   * open dialog, and pulling it back to a row behind the scrim would break the focus trap and leave
   * Tab walking the inert page. The list still follows along, so closing the drawer lands the user
   * where they actually got to. */
  const revealRow=(id:string)=>{setActiveId(id);rowElement(id)?.scrollIntoView({block:'nearest'})}
  const focusRow=(id:string)=>{revealRow(id);rowElement(id)?.focus({preventScroll:true})}

  /* Quick View: which candidate the drawer is showing, or null.
   *
   * Held as an id rather than a row so it cannot go stale against a refetch -- the drawer always
   * renders the row the current page holds, and an id that is no longer on the page simply closes it
   * rather than showing a frozen copy of a candidate the filters have since excluded. */
  const [quickViewId,setQuickViewId]=useState<string|null>(null)
  const quickView=rows.find((row)=>row.id===quickViewId)||null
  const openQuickView=(id:string,entry:'row'|'menu'|'keyboard')=>{
    setActiveId(id);setQuickViewId(id)
    /* Non-PII by construction: an event name, the surface, and which of the three entry points was
      * used. No candidate id, no name. `action_started` rather than a new event_name because the
      * telemetry table's CHECK constraint owns that vocabulary, and widening it for a UI-only change
      * would be a migration whose only content is a string. */
    if(organization)recordWorkflowEvent({organizationId:organization.id,eventName:'action_started',
      surface:'candidate_quick_view',actionKey:`open_${entry}`})
  }
  /* `restoreFocus` is false when the close is a HANDOFF -- Add to job and Add follow-up both open a
   * modal of their own, and that modal claims focus for itself. Racing it back to a row behind two
   * scrims would be the drawer reaching past the dialog that replaced it. */
  const closeQuickView=(restoreFocus=true)=>{
    const id=quickViewId
    setQuickViewId(null)
    /* useDialogShell restores focus to whatever was focused when the drawer opened -- the row the
      * user came from. After paging inside the drawer that is no longer the row they are looking at,
      * so this runs one frame later (the restore happens synchronously in the unmount commit) and
      * puts the cursor back on the candidate that was actually on screen. */
    if(id&&restoreFocus)requestAnimationFrame(()=>focusRow(id))
  }
  // Bound globally, so the return value is unused -- the page has its own pager and needs no counter.
  useListNavigation({ids:rowIds,activeId:active,onChange:focusRow,
    onOpen:(id)=>{void navigate(`/app/${organization?.slug}/candidates/${id}`)},global:true,enabled:!open&&!mergeOpen&&!placementOpen&&!quickView})
  /* Shift-click selects the block between the last click and this one, because selecting eleven
   * consecutive candidates by clicking eleven checkboxes is the kind of thing that makes people
   * export to a spreadsheet instead. */
  const lastClicked=useRef<string|null>(null)
  const toggleRow=(id:string,checked:boolean,shiftKey:boolean)=>{
    const anchor=lastClicked.current
    if(shiftKey&&anchor&&anchor!==id){
      const from=rowIds.indexOf(anchor);const to=rowIds.indexOf(id)
      if(from>=0&&to>=0){
        const block=rowIds.slice(Math.min(from,to),Math.max(from,to)+1)
        setSelected((current)=>checked?[...new Set([...current,...block])]:current.filter((value)=>!block.includes(value)))
        lastClicked.current=id
        return
      }
    }
    lastClicked.current=id
    toggle(id,checked)
  }
  /* `f` for the search field and `x` for select, the two things a keyboard user reaches for after
   * j/k. Both are suspended while a dialog is open -- useShortcut's own guard already refuses to fire
   * inside one, and the explicit `enabled` keeps them off while a modal owns the screen. */
  const dialogOpen=open||mergeOpen||placementOpen||Boolean(quickView)
  useShortcut('f',()=>searchRef.current?.focus(),!dialogOpen)
  /* `v` for the row the cursor is on, so the whole review loop -- j/k to move, v to look, Escape to
   * come back -- never needs the mouse. */
  useShortcut('v',()=>{if(active)openQuickView(active,'keyboard')},!dialogOpen)
  const canSelect=Boolean(capabilities.data?.canMovePipeline)
  useShortcut('x',()=>{
    if(!active)return
    // Pressing x with nothing in selection mode starts it, rather than doing nothing and leaving the
    // user to find the button first.
    if(selectionMode==='none')setSelectionMode('bulk')
    if(selectionMode!=='merge')toggleRow(active,!selected.includes(active),false)
  },!dialogOpen&&canSelect)
  const ownerNames=useMemo(()=>Object.fromEntries((team.data||[]).map((member)=>[member.id,member.profiles?.full_name||member.profiles?.email||'Selected member'])),[team.data])
  const chips=useMemo(()=>candidateFilterChips(params,{ownerNames}),[params,ownerNames])
  const clearAllFilters=()=>{const next=new URLSearchParams(params);for(const key of candidateFilterKeys)next.delete(key);next.delete('page');setParams(next,{replace:true});setSelected([]);setQuickViewId(null)}
  /* Search and status have their own controls in the rail, so the Filters trigger counts only what is
   * hidden inside it. A "(3)" that included the search box the user is looking at would be counting
   * something they can already see, and would never read zero. */
  const railFilterKeys=['q','status']
  const secondaryFilterKeys=candidateFilterKeys.filter((key)=>!railFilterKeys.includes(key))
  const secondaryFilterCount=chips.filter((chip)=>!railFilterKeys.includes(chip.key)).length
  const clearSecondaryFilters=()=>{const next=new URLSearchParams(params);for(const key of secondaryFilterKeys)next.delete(key);next.delete('page');setParams(next,{replace:true});setSelected([]);setQuickViewId(null)}
  /* Row density is a rendering preference, not a filter, so it belongs behind the overflow rather
   * than beside the controls that change which records are shown -- it was a three-segment control
   * sitting permanently in the rail for a setting most users touch once. A check mark rather than a
   * radiogroup because a menu item cannot be a radio without lying about its role. */
  const listOptions:MenuItemSpec[]=DENSITY_OPTIONS.map((option)=>({
    id:`density-${option.id}`,
    label:`${option.label} rows`,
    text:option.label,
    icon:<Rows3 size={15}/>,
    onSelect:()=>chooseDensity(option.id),
    disabled:density===option.id,
  }))
  const pages=Math.max(1,Math.ceil((query.data?.count||0)/pageSize));const showPagination=(query.data?.count||0)>pageSize

  /* One cell per column id, so dropping a column is purely a matter of it not being in the list.
   * The previous shape hard-coded every <td> inline, which meant a hidden column had to be a
   * conditional in two places (header array and row) that could drift apart. */
  const renderCell=(id:CandidateColumnId,candidate:CandidateSearchRow):ReactNode=>{
    switch(id){
      case 'select':return <input aria-label={`Select ${candidate.full_name}`} type="checkbox" checked={selected.includes(candidate.id)}
        disabled={selectionMode==='merge'&&!selected.includes(candidate.id)&&selected.length===2}
        onClick={(event)=>{if(selectionMode!=='merge')toggleRow(candidate.id,!selected.includes(candidate.id),event.shiftKey)}}
        onChange={(event)=>{if(selectionMode==='merge')toggle(candidate.id,event.target.checked)}}/>
      case 'candidate':{
        // title is a desktop convenience for a truncated name, never the accessible route -- the
        // preview pane and the full record are that.
        const role=candidate.current_position?`${candidate.current_position}${candidate.current_company?` at ${candidate.current_company}`:''}`:NOT_RECORDED
        return <div className="candidate-row-identity">
          <span className="avatar-sm" aria-hidden="true">{initials(candidate.full_name)}</span>
          <div className="candidate-row-identity-text">
            <Link className="record-link" to={`/app/${organization?.slug}/candidates/${candidate.id}`} {...prefetchHandlers(()=>prefetch('candidate',candidate.id))}><TruncatedText as="strong">{candidate.full_name}</TruncatedText></Link>
            <TruncatedText>{role}</TruncatedText>
          </div>
        </div>
      }
      case 'pipeline':return <PipelineCell row={candidate} now={now}/>
      case 'followUp':return <FollowUpCell row={candidate} now={now}/>
      case 'owner':return candidate.owner_name||<Gap>Unassigned</Gap>
      case 'status':return <StatusCell row={candidate}/>
      case 'menu':{
        /* Add to job stays gated exactly as the button was: the two lifecycle statuses that forbid it
         * disable the item rather than hiding it, so a consultant learns the rule instead of
         * wondering where the action went. */
        const blocked=candidate.status==='do_not_contact'||candidate.status==='archived'
        const items:MenuItemSpec[]=[
          {id:'quick',label:'Quick view',icon:<PanelRightOpen size={15}/>,onSelect:()=>openQuickView(candidate.id,'menu')},
          {id:'open',label:'Open candidate',icon:<UserRoundSearch size={15}/>,href:`/app/${organization?.slug}/candidates/${candidate.id}`},
          ...(capabilities.data?.canMovePipeline?[{id:'add',label:'Add to job',icon:<Users size={15}/>,disabled:blocked,
            text:blocked?'Add to job (not available for this candidate)':'Add to job',
            onSelect:()=>openPlacement([candidate])}]:[]),
        ]
        return <Menu align="end" label={`Actions for ${candidate.full_name}`} items={items} trigger={(props)=>
          <button {...props} type="button" className="icon-button icon-button-sm row-menu-trigger" aria-label={`Actions for ${candidate.full_name}`}>
            <MoreHorizontal size={16}/>
          </button>}/>
      }
    }
  }
  /* The page header held up to five buttons at equal weight -- "Add N to job", "Merge selected",
   * "Select candidates", "Manage duplicates" and "Add candidate" -- so the one action a consultant
   * takes constantly had no more presence than the one taken twice a year. It is now one primary
   * button plus an overflow, with the two selection-mode actions promoted into the header only while
   * that mode is running, which is the only time they can do anything. */
  const headerActions:MenuItemSpec[]=[
    ...(capabilities.data?.canMovePipeline?[{id:'select',label:'Select candidates',icon:<SquareCheck size={15}/>,
      onSelect:()=>{setSelectionMode('bulk');setSelected([])}}]:[]),
    ...(capabilities.data?.canWriteCandidates?[{id:'merge',label:'Manage duplicates',icon:<CopyCheck size={15}/>,
      onSelect:()=>{setSelectionMode('merge');setSelected([])}}]:[]),
  ]
  return <Page title="Candidates" eyebrow="Talent database" description="Find the right people, check readiness, and place them into a job." actions={<>
    {selectionMode==='bulk'&&selected.length>0&&<Button variant="secondary" leadingIcon={<Users size={15}/>} onClick={()=>openPlacement()}>Add {selected.length} to job</Button>}
    {selectionMode==='merge'&&selected.length===2&&<Button variant="secondary" leadingIcon={<Merge size={15}/>} onClick={openMerge}>Merge selected</Button>}
    {selectionMode!=='none'
      ?<Button variant="quiet" onClick={()=>{setSelectionMode('none');setSelected([])}}>Done</Button>
      :headerActions.length>0&&<Menu label="More candidate actions" items={headerActions} trigger={(props)=>
        <Button {...props} type="button" variant="secondary" iconOnlyLabel="More candidate actions" leadingIcon={<MoreHorizontal size={16}/>}/>}/>}
    {capabilities.data?.canWriteCandidates&&<Button leadingIcon={<Plus size={15}/>} onClick={()=>{setOpen(true)}}>Add candidate</Button>}
  </>}>
    {/* Selecting rows used to be silent -- checkboxes ticked and the header buttons enabled, with
      * nothing else on the page saying what was selected or what to do next. Merge specifically
      * needs exactly two, which a bare button count does not communicate. */}
    {selectionMode==='bulk'&&<Callout tone="info">
      <div className="bulk-bar">
        <span>{selected.length===0?'Select candidates to act on them together.':`${selected.length} candidate${selected.length===1?'':'s'} selected.`}</span>
        {/* Owner assignment lives beside the count rather than in the page header, because it needs a
          * value chosen before it can run -- a header button would have nowhere to put the picker. */}
        {selected.length>0&&<span className="bulk-bar-action">
          <Select aria-label="Assign owner to selected candidates" value={assignOwnerId} onChange={(event)=>setAssignOwnerId(event.target.value)}>
            <option value="">Choose an owner…</option>
            <option value={UNASSIGN}>Unassigned</option>
            {team.data?.filter((member)=>member.status==='active').map((member)=><option key={member.id} value={member.id}>{member.profiles?.full_name||member.profiles?.email}</option>)}
          </Select>
          <Button size="sm" variant="secondary" disabled={!assignOwnerId||assignOwner.isPending}
            loading={assignOwner.isPending} onClick={()=>assignOwner.mutate()}>Assign owner</Button>
        </span>}
      </div>
    </Callout>}
    {selectionMode==='merge'&&<Callout tone="info">{selected.length===0?'Select two candidates to merge.':selected.length===1?'Select one more candidate to merge.':'Two candidates selected — choose which record to keep.'}</Callout>}
    <Panel>
      {/* One rail, in reading order: which view, then narrowing it, then how many are left, then the
        * options that are not about this search at all.
        *
        * There used to be four horizontal layers here before a single candidate appeared -- a saved-
        * views band, this toolbar, the queue tabs, the filter chips -- plus a collapsed "Filters and
        * sorting" disclosure under them. The saved-views band folded into the View menu, the eight
        * secondary filters folded into the Filters popover, and row density moved to the overflow, so
        * the rail now states the whole filter state in one line and the first row sits roughly a
        * hundred pixels higher. The queue tabs and the active-filter chips stay as their own rows:
        * one is the workflow question the page exists to answer, and the other only appears when
        * something is actually narrowing the list. */}
      <div className="toolbar">
        <ViewMenu resource="candidates" baseLabel="All candidates" paramKeys={viewParamKeys} params={params}
          onApply={(next)=>setParams(next,{replace:true})} onExport={()=>exportView.mutate()} exporting={exportView.isPending}/>
        <div className="search-box"><Search size={15}/><Input ref={searchRef} aria-label="Search candidates" placeholder="Name, company, or position" value={filters.query} onChange={(event)=>setFilter('q',event.target.value)}/></div>
        <Select aria-label="Candidate status" value={filters.status} onChange={(event)=>setFilter('status',event.target.value)}><option value="">All statuses</option><option value="active">Active</option><option value="passive">Passive</option><option value="placed">Placed</option><option value="do_not_contact">Do not contact</option><option value="archived">Archived</option></Select>
        <FilterPopover count={secondaryFilterCount} onClearAll={clearSecondaryFilters}>
          <Field label="Location"><Input value={filters.location} onChange={(event)=>setFilter('location',event.target.value)}/></Field>{/* Was a free-text box against an `ilike` predicate, so "Linkedin" found nothing when the column
        said "LinkedIn". Both sides are curated values now, and the filter offers the same list the
        candidate form writes. */}
      <Field label="Source"><Select value={filters.source} onChange={(event)=>setFilter('source',event.target.value)}><option value="">Any source</option>{candidateSource.all.map((option)=><option key={option.value} value={option.value}>{option.label}</option>)}</Select></Field><Field label="Owner"><Select value={filters.ownerMemberId} onChange={(event)=>setFilter('owner',event.target.value)}><option value="">Anyone</option>{team.data?.filter((member)=>member.status==='active').map((member)=><option value={member.id} key={member.id}>{member.profiles?.full_name||member.profiles?.email}</option>)}</Select></Field><Field label="Tag"><Input value={filters.tag} onChange={(event)=>setFilter('tag',event.target.value)}/></Field><Field label="Skill"><Input value={filters.skill} onChange={(event)=>setFilter('skill',event.target.value)}/></Field><Field label="Availability"><Select value={filters.availability} onChange={(event)=>setFilter('availability',event.target.value)}><option value="">Any availability</option>{candidateAvailability.all.map((option)=><option key={option.value} value={option.value}>{option.label}</option>)}</Select></Field><Field label="Sort"><Select value={`${filters.sort}:${filters.direction}`} onChange={(event)=>{const [sort='updated',dir='desc']=event.target.value.split(':');const next=new URLSearchParams(params);next.set('sort',sort);next.set('dir',dir);next.delete('page');setParams(next,{replace:true})}}><option value="updated:desc">Recently updated</option><option value="created:desc">Newest added</option><option value="name:asc">Name A–Z</option><option value="location:asc">Location A–Z</option></Select></Field>
        </FilterPopover>
        <span className="toolbar-count">{query.data?.count??0} candidates</span>
        <Menu className="toolbar-overflow" label="List options" items={listOptions} trigger={(props)=>
          <Button {...props} type="button" size="sm" variant="quiet" iconOnlyLabel="List options" leadingIcon={<MoreHorizontal size={16}/>}/>}/>
      </div>
    <CandidateQueueTabs queue={queue} mine={Boolean(currentMemberId)&&filters.ownerMemberId===currentMemberId}
      mineAvailable={Boolean(currentMemberId)}
      onQueue={(next)=>setFilter('queue',next||'')}
      onMine={(next)=>setFilter('owner',next?currentMemberId||'':'')}/>
    <ActiveFilterChips filters={chips} onClear={(key)=>setFilter(key,'')} onClearAll={clearAllFilters}/>
      {/* The measured region. Deliberately the track the table occupies -- AFTER the sidebar has taken
        * its share -- so the column ladder responds to space the table can actually use. Measuring the
        * viewport instead would need media queries for window width and sidebar state that can
        * disagree; one observer here cannot. Quick View is an overlay and takes no share, so this
        * measurement no longer moves when a candidate is being previewed. */}
      <div className="candidate-table-region" ref={tableRegion}>
      {query.isLoading?<TableSkeleton rows={8} columns={columns.length} label="Loading candidates…"/>:query.error?<ErrorState error={query.error} retry={()=>void query.refetch()}/>:query.data?.rows.length===0?<EmptyState {...emptyQueueMessage(queue)}/>:<Table className={`candidates-table candidates-density-${density} candidates-table-${tier}`} headers={columns.map((column)=>({label:column.label,width:column.width,hideLabel:column.hideLabel}))}>{rows.map((candidate)=><tr key={candidate.id} data-row-id={candidate.id} tabIndex={candidate.id===active?0:-1}
        aria-selected={selected.includes(candidate.id)}
        onFocus={()=>setActiveId(candidate.id)}
        /* The row is not a button and must not claim to be one: the name inside it is the link to the
          * record, and that stays the accessible route. This is a mouse convenience on the dead space
          * beside it, which is why there is a `v` shortcut and a menu item doing the same job. */
        onClick={(event)=>{if(!isRowInteractive(event.target))openQuickView(candidate.id,'row')}}
        className={[candidate.status==='do_not_contact'||candidate.status==='archived'?'candidate-row-muted':'',candidate.id===active?'candidate-row-active':''].filter(Boolean).join(' ')||undefined}>{columns.map((column)=><td key={column.id}>{renderCell(column.id,candidate)}</td>)}</tr>)}</Table>}
      </div>
      {showPagination&&<div className="pagination"><Button variant="secondary" disabled={page===0||query.isFetching} leadingIcon={<ChevronLeft size={14}/>} onClick={()=>{const next=new URLSearchParams(params);next.set('page',String(page-1));setParams(next,{replace:true});setQuickViewId(null)}}>Previous</Button><span>Page {page+1} of {pages}</span><Button variant="secondary" disabled={page+1>=pages||query.isFetching} trailingIcon={<ChevronRight size={14}/>} onClick={()=>{const next=new URLSearchParams(params);next.set('page',String(page+1));setParams(next,{replace:true});setQuickViewId(null)}}>Next</Button></div>}
    </Panel>
    <AddCandidateModal open={open} onClose={()=>setOpen(false)} organizationId={organization!.id} organizationSlug={organization!.slug}
      userId={user!.id} baseCurrency={organization?.base_currency||'USD'} salaryPeriod={organization?.salary_period}
      owners={team.data||[]} defaultOwnerMemberId={currentMemberId}
      onSaved={async(id:string)=>{setOpen(false);await cache.invalidateQueries({queryKey:['candidates-page',organization?.id]});navigate(`/app/${organization!.slug}/candidates/${id}`)}}/>
    <Modal title="Merge duplicate candidates" open={mergeOpen} onClose={()=>setMergeOpen(false)}><div className="stack"><p className="warning-box">This moves history, documents, tasks, notes, pipeline assignments, and private details into one record. The other record is archived and the action is audit logged.</p><Field label="Record to keep"><Select value={keptId} onChange={(event)=>setKeptId(event.target.value)}>{selectedRows.map((item)=><option value={item.id} key={item.id}>{item.full_name} · {item.current_position||'No current role'}</option>)}</Select></Field><Field label="Reason"><Textarea value={mergeReason} onChange={(event)=>setMergeReason(event.target.value)}/></Field>{mergeMutation.error&&<p className="form-error" role="alert">{mergeMutation.error.message}</p>}<div className="form-actions"><Button variant="quiet" onClick={()=>setMergeOpen(false)}>Cancel</Button><Button variant="danger" loading={mergeMutation.isPending} disabled={!keptId} onClick={()=>mergeMutation.mutate()}>{'Merge records'}</Button></div></div></Modal>
    {/* AddCandidateToJobModal's own onSuccess invalidates pipeline/job-health/candidate-pipelines/
      * today -- never candidates-page, the key THIS list reads. Without onAdded, the Pipeline column
      * stays "Not in a pipeline" after a successful add until something else remounts the query (an
      * F5). Same idiom already used by mergeMutation, assignOwner and AddCandidateModal below. */}
    <AddCandidateToJobModal open={placementOpen} onClose={closePlacement} candidates={placementCandidates}
      onAdded={()=>cache.invalidateQueries({queryKey:['candidates-page',organization?.id]})}/>
    {/* Mounted only while a candidate is chosen, so its CV and Activity queries cannot exist -- let
      * alone run -- for a list nobody is previewing.
      *
      * Both quick actions CLOSE the drawer before opening their own dialog. useDialogShell traps Tab
      * and listens for Escape at the document, with no notion of a stack: two open at once would give
      * the drawer's trap the chance to yank focus out of the modal on top of it. */}
    {quickView&&<CandidateQuickViewDrawer candidate={quickView} siblingIds={rowIds}
      organizationSlug={organization?.slug||'workspace'}
      onNavigate={(id)=>{revealRow(id);setQuickViewId(id)}} onClose={()=>closeQuickView()}
      canAddToJob={Boolean(capabilities.data?.canMovePipeline)}
      onAddToJob={(candidate)=>{closeQuickView(false);openPlacement([candidate])}}
      onAddFollowUp={(candidate)=>{
        closeQuickView(false)
        const next=new URLSearchParams(params);next.set('task','1');next.set('linkType','candidate');next.set('linkId',candidate.id)
        setParams(next,{replace:true})
      }}/>}
  </Page>
}
