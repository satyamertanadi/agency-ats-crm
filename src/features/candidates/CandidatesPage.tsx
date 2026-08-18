import {useMemo,useRef,useState,type ReactNode} from 'react'
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query'
import {ChevronLeft,ChevronRight,Merge,Plus,Search,Users} from 'lucide-react'
import {Link,useNavigate,useSearchParams} from 'react-router'
import {useOrganization} from '../../app/OrganizationProvider'
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
import {SavedViewBar} from '../core/SavedViewBar'
import {csvFilename,downloadCsv,toCsv} from '../../shared/lib/csv'
import {Table} from '../../shared/ui/Table'
import {AddCandidateModal} from './AddCandidateModal'
import {AddCandidateToJobModal,type PlacementCandidate} from './AddCandidateToJobModal'
import {CandidatePreviewPane} from './CandidatePreviewPane'
import {describeBulk,runBulk} from '../core/bulkResult'
import {ActiveFilterChips} from '../core/ActiveFilterChips'
import {candidateFilterChips,candidateFilterKeys} from './candidateFilterChips'
import {useListNavigation} from '../../shared/lib/useListNavigation'
import {useShortcut} from '../../shared/lib/useShortcut'
import {followUpSignal,pipelineSignal,statusFacets,type FollowUpSignal} from './candidateRowSignals'
import {emptyQueueMessage,parseQueue} from './candidateQueues'
import {CandidateQueueTabs} from './CandidateQueueTabs'
import {DENSITY_OPTIONS,readDensity,writeDensity,type CandidateDensity} from './candidateDensity'
import {SegmentedControl} from '../../shared/ui/SegmentedControl'
import type {CandidateSearchRow} from '../../shared/types/domain'

type SelectionMode='none'|'bulk'|'merge'
/* "Unassigned" as a deliberate choice, distinct from '' meaning "nothing picked yet". */
const UNASSIGN='__unassign__'

/* A fact the record is missing, drawn as something to fill rather than left blank.
 *
 * "Unassigned" and "No skills tagged" used to render as ordinary muted text, which reads as "this
 * column is empty" and gets scanned past. A dashed outline reads as a slot, so a page of them looks
 * like a queue of work instead of an unfinished database. It is deliberately NOT a button: three
 * inline actions per row would add controls to a screen whose problem is already too many controls.
 * The action lives where it always did -- the Action column, bulk assign, and the queue tabs. */
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
    <span>{signal.stageLabel||'Stage not recorded'}</span>
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
    <span>{facets.availabilityLabel||'Availability not set'}</span>
  </>
}

export function CandidatesPage(){
  const {organization}=useOrganization();const {user}=useAuth();const capabilities=useWorkspaceCapabilities();const cache=useQueryClient();const toast=useToast();const navigate=useNavigate();const [params,setParams]=useSearchParams()
  const [open,setOpen]=useState(false);const [selectionMode,setSelectionMode]=useState<SelectionMode>('none');const [mergeOpen,setMergeOpen]=useState(false);const [selected,setSelected]=useState<string[]>([]);const [keptId,setKeptId]=useState('');const [mergeReason,setMergeReason]=useState('Duplicate candidate record');const [placementCandidates,setPlacementCandidates]=useState<PlacementCandidate[]>([]);const placementOpen=placementCandidates.length>0||params.get('addToJob')==='1';const pageSize=50
  useOpenOnNewParam(setOpen)
  /* A browser preference, not workspace state, so it lives in localStorage and not in the URL: it
   * must not travel in a shared link or get captured by a saved view, where one person's row height
   * would become everybody's. */
  const [density,setDensity]=useState<CandidateDensity>(readDensity)
  const chooseDensity=(next:CandidateDensity)=>{setDensity(next);writeDensity(next)}
  /* Narrowed rather than passed through: an unrecognised ?queue= becomes null here, matching the SQL,
   * where an unknown value matches nothing. Without this a typo'd URL would render an active-looking
   * tab that is not one of ours and an empty list with no explanation. */
  const queue=parseQueue(params.get('queue'))
  const page=Math.max(0,Number(params.get('page')||0));const filters:CandidateListFilters={query:params.get('q')||'',status:params.get('status')||'',location:params.get('location')||'',source:params.get('source')||'',ownerMemberId:params.get('owner')||'',tag:params.get('tag')||'',skill:params.get('skill')||'',availability:params.get('availability')||'',queue:queue||undefined,sort:(params.get('sort') as CandidateListFilters['sort'])||'updated',direction:(params.get('dir') as CandidateListFilters['direction'])||'desc'}
  const setFilter=(key:string,value:string)=>{const next=new URLSearchParams(params);if(value)next.set(key,value);else next.delete(key);next.delete('page');setParams(next,{replace:true});setSelected([])}
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
  const focusRow=(id:string)=>{
    setActiveId(id)
    // data-row-id is unique to this table, so no container ref (and no extra wrapper element) is
    // needed to scope the lookup.
    const row=document.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(id)}"]`)
    // 'nearest' so a keypress never jumps the page when the row is already on screen.
    row?.scrollIntoView({block:'nearest'})
    row?.focus({preventScroll:true})
  }
  // Bound globally, so the return value is unused -- the page has its own pager and needs no counter.
  useListNavigation({ids:rowIds,activeId:active,onChange:focusRow,
    onOpen:(id)=>{void navigate(`/app/${organization?.slug}/candidates/${id}`)},global:true,enabled:!open&&!mergeOpen&&!placementOpen})
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
  const dialogOpen=open||mergeOpen||placementOpen
  useShortcut('f',()=>searchRef.current?.focus(),!dialogOpen)
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
  const clearAllFilters=()=>{const next=new URLSearchParams(params);for(const key of candidateFilterKeys)next.delete(key);next.delete('page');setParams(next,{replace:true});setSelected([])}
  // Straight off the loaded page, so the pane costs no request and j/k stays instant.
  const previewed=rows.find((row)=>row.id===active)||null
  const pages=Math.max(1,Math.ceil((query.data?.count||0)/pageSize));const showPagination=(query.data?.count||0)>pageSize
  return <Page title="Candidates" eyebrow="Talent database" description="Find the right people, check readiness, and place them into a job without exposing private data in the list." actions={<>{selectionMode==='bulk'&&selected.length>0&&<Button variant="secondary" leadingIcon={<Users size={15}/>} onClick={()=>openPlacement()}>Add {selected.length} to job</Button>}{selectionMode==='merge'&&selected.length===2&&<Button variant="secondary" leadingIcon={<Merge size={15}/>} onClick={openMerge}>Merge selected</Button>}{capabilities.data?.canMovePipeline&&<Button variant="secondary" onClick={()=>{setSelectionMode((mode)=>mode==='bulk'?'none':'bulk');setSelected([])}}>{selectionMode==='bulk'?'Done selecting':'Select candidates'}</Button>}{capabilities.data?.canWriteCandidates&&<><Button variant="quiet" onClick={()=>{setSelectionMode((mode)=>mode==='merge'?'none':'merge');setSelected([])}}>{selectionMode==='merge'?'Done':'Manage duplicates'}</Button><Button leadingIcon={<Plus size={15}/>} onClick={()=>{setOpen(true)}}>Add candidate</Button></>}</>}>
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
    <Panel><SavedViewBar resource="candidates" paramKeys={viewParamKeys} params={params} onApply={(next)=>setParams(next,{replace:true})} onExport={()=>exportView.mutate()} exporting={exportView.isPending}/><div className="toolbar"><div className="search-box"><Search size={15}/><Input ref={searchRef} aria-label="Search candidates" placeholder="Name, company, or position" value={filters.query} onChange={(event)=>setFilter('q',event.target.value)}/></div><Select aria-label="Candidate status" value={filters.status} onChange={(event)=>setFilter('status',event.target.value)}><option value="">All statuses</option><option value="active">Active</option><option value="passive">Passive</option><option value="placed">Placed</option><option value="do_not_contact">Do not contact</option><option value="archived">Archived</option></Select><span className="muted">{query.data?.count??0} candidates</span><SegmentedControl className="density-control" label="Row density" options={DENSITY_OPTIONS} value={density} onChange={chooseDensity}/></div>
    <CandidateQueueTabs queue={queue} mine={Boolean(currentMemberId)&&filters.ownerMemberId===currentMemberId}
      mineAvailable={Boolean(currentMemberId)}
      onQueue={(next)=>setFilter('queue',next||'')}
      onMine={(next)=>setFilter('owner',next?currentMemberId||'':'')}/>
    <ActiveFilterChips filters={chips} onClear={(key)=>setFilter(key,'')} onClearAll={clearAllFilters}/>
      <details className="filter-panel"><summary>Filters and sorting</summary><div className="filter-grid"><Field label="Location"><Input value={filters.location} onChange={(event)=>setFilter('location',event.target.value)}/></Field>{/* Was a free-text box against an `ilike` predicate, so "Linkedin" found nothing when the column
        said "LinkedIn". Both sides are curated values now, and the filter offers the same list the
        candidate form writes. */}
      <Field label="Source"><Select value={filters.source} onChange={(event)=>setFilter('source',event.target.value)}><option value="">Any source</option>{candidateSource.all.map((option)=><option key={option.value} value={option.value}>{option.label}</option>)}</Select></Field><Field label="Owner"><Select value={filters.ownerMemberId} onChange={(event)=>setFilter('owner',event.target.value)}><option value="">Anyone</option>{team.data?.filter((member)=>member.status==='active').map((member)=><option value={member.id} key={member.id}>{member.profiles?.full_name||member.profiles?.email}</option>)}</Select></Field><Field label="Tag"><Input value={filters.tag} onChange={(event)=>setFilter('tag',event.target.value)}/></Field><Field label="Skill"><Input value={filters.skill} onChange={(event)=>setFilter('skill',event.target.value)}/></Field><Field label="Availability"><Select value={filters.availability} onChange={(event)=>setFilter('availability',event.target.value)}><option value="">Any availability</option>{candidateAvailability.all.map((option)=><option key={option.value} value={option.value}>{option.label}</option>)}</Select></Field><Field label="Sort"><Select value={`${filters.sort}:${filters.direction}`} onChange={(event)=>{const [sort='updated',dir='desc']=event.target.value.split(':');const next=new URLSearchParams(params);next.set('sort',sort);next.set('dir',dir);next.delete('page');setParams(next,{replace:true})}}><option value="updated:desc">Recently updated</option><option value="created:desc">Newest added</option><option value="name:asc">Name A–Z</option><option value="location:asc">Location A–Z</option></Select></Field></div></details>
      <div className="candidate-split">
      {/* Six columns, down from seven, carrying far more. Location and the old "Skills and tags"
        * are gone: the header was inaccurate (only skills ever rendered), both are fully in the
        * preview pane, and both remain filterable -- which bought the room for Pipeline and
        * Follow-up, the two facts a consultant actually triages on. */}
      {query.isLoading?<TableSkeleton rows={8} columns={selectionMode!=='none'?7:6} label="Loading candidates…"/>:query.error?<ErrorState error={query.error} retry={()=>void query.refetch()}/>:query.data?.rows.length===0?<EmptyState {...emptyQueueMessage(queue)}/>:<Table className={`candidates-table candidates-density-${density}`} headers={[...(selectionMode!=='none'?['Select']:[]),'Candidate','Pipeline','Follow-up','Owner','Status','Action']}>{rows.map((candidate)=><tr key={candidate.id} data-row-id={candidate.id} tabIndex={candidate.id===active?0:-1}
        aria-selected={selected.includes(candidate.id)}
        onFocus={()=>setActiveId(candidate.id)}
        className={[candidate.status==='do_not_contact'||candidate.status==='archived'?'candidate-row-muted':'',candidate.id===active?'candidate-row-active':''].filter(Boolean).join(' ')||undefined}>{selectionMode!=='none'&&<td><input aria-label={`Select ${candidate.full_name}`} type="checkbox" checked={selected.includes(candidate.id)} disabled={selectionMode==='merge'&&!selected.includes(candidate.id)&&selected.length===2} onClick={(event)=>{if(selectionMode!=='merge')toggleRow(candidate.id,!selected.includes(candidate.id),event.shiftKey)}} onChange={(event)=>{if(selectionMode==='merge')toggle(candidate.id,event.target.checked)}}/></td>}<td><div className="candidate-row-identity"><span className="avatar-sm" aria-hidden="true">{initials(candidate.full_name)}</span><div><Link className="record-link" to={`/app/${organization?.slug}/candidates/${candidate.id}`}><strong>{candidate.full_name}</strong></Link><span>{candidate.current_position?`${candidate.current_position}${candidate.current_company?` at ${candidate.current_company}`:''}`:'Role not recorded'}</span></div></div></td><td><PipelineCell row={candidate} now={now}/></td><td><FollowUpCell row={candidate} now={now}/></td><td>{candidate.owner_name||<Gap>Unassigned</Gap>}</td><td><StatusCell row={candidate}/></td><td>{capabilities.data?.canMovePipeline&&<Button size="sm" variant="secondary" disabled={candidate.status==='do_not_contact'||candidate.status==='archived'} onClick={()=>openPlacement([candidate])}>Add to job</Button>}</td></tr>)}</Table>}
      {/* Rendered at every width; CSS hides it below 1024px. See CandidatePreviewPane for why there
        * is no behaviour to fork. */}
      <CandidatePreviewPane candidate={previewed} organizationSlug={organization?.slug||'workspace'}
        canAddToJob={Boolean(capabilities.data?.canMovePipeline)} onAddToJob={(candidate)=>openPlacement([candidate])}/>
      </div>
      {showPagination&&<div className="pagination"><Button variant="secondary" disabled={page===0||query.isFetching} leadingIcon={<ChevronLeft size={14}/>} onClick={()=>{const next=new URLSearchParams(params);next.set('page',String(page-1));setParams(next,{replace:true})}}>Previous</Button><span>Page {page+1} of {pages}</span><Button variant="secondary" disabled={page+1>=pages||query.isFetching} trailingIcon={<ChevronRight size={14}/>} onClick={()=>{const next=new URLSearchParams(params);next.set('page',String(page+1));setParams(next,{replace:true})}}>Next</Button></div>}
    </Panel>
    <AddCandidateModal open={open} onClose={()=>setOpen(false)} organizationId={organization!.id} organizationSlug={organization!.slug}
      userId={user!.id} baseCurrency={organization?.base_currency||'USD'} salaryPeriod={organization?.salary_period}
      owners={team.data||[]} defaultOwnerMemberId={currentMemberId}
      onSaved={async(id:string)=>{setOpen(false);await cache.invalidateQueries({queryKey:['candidates-page',organization?.id]});navigate(`/app/${organization!.slug}/candidates/${id}`)}}/>
    <Modal title="Merge duplicate candidates" open={mergeOpen} onClose={()=>setMergeOpen(false)}><div className="stack"><p className="warning-box">This moves history, documents, tasks, notes, pipeline assignments, and private details into one record. The other record is archived and the action is audit logged.</p><Field label="Record to keep"><Select value={keptId} onChange={(event)=>setKeptId(event.target.value)}>{selectedRows.map((item)=><option value={item.id} key={item.id}>{item.full_name} · {item.current_position||'No current role'}</option>)}</Select></Field><Field label="Reason"><Textarea value={mergeReason} onChange={(event)=>setMergeReason(event.target.value)}/></Field>{mergeMutation.error&&<p className="form-error" role="alert">{mergeMutation.error.message}</p>}<div className="form-actions"><Button variant="quiet" onClick={()=>setMergeOpen(false)}>Cancel</Button><Button variant="danger" loading={mergeMutation.isPending} disabled={!keptId} onClick={()=>mergeMutation.mutate()}>{'Merge records'}</Button></div></div></Modal>
    <AddCandidateToJobModal open={placementOpen} onClose={closePlacement} candidates={placementCandidates}/>
  </Page>
}
