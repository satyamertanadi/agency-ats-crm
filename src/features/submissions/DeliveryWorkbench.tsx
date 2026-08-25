import {useMemo,useState} from 'react'
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query'
import {Search} from 'lucide-react'
import {Link,useSearchParams} from 'react-router'
import {useOrganization} from '../../app/OrganizationProvider'
import {useWorkspaceCapabilities} from '../../app/useWorkspaceCapabilities'
import {listDeliveryWorkbench,setSubmissionFeedbackHandled} from '../core/repository'
import {listTeamMembers,retryClientSubmission} from '../core/commercialRepository'
import {Badge} from '../../shared/ui/Page'
import {Button} from '../../shared/ui/Button'
import {Input,Select} from '../../shared/ui/Field'
import {Table} from '../../shared/ui/Table'
import {Pagination} from '../../shared/ui/Pagination'
import {EmptyState,ErrorState,TableSkeleton} from '../../shared/ui/States'
import {useToast} from '../../shared/ui/Toast'
import {formatDate,formatDateTime} from '../../shared/lib/format'
import {recordWorkflowEvent} from '../../shared/lib/productAnalytics'
import {NOT_RECORDED} from '../../shared/lib/labels'
import type {DeliveryWorkbenchRow} from '../../shared/types/domain'
import {deliveryAction,deliveryQuickViews,deliveryStateDefinition,parseDeliveryQuickView} from './deliveryState'

/* Everything that has been sent to a client, across every job.
 *
 * The workspace has always managed submissions well inside ONE job. What it could not answer is the
 * question a consultant actually starts the day with: what have I sent that is failing, waiting, or
 * answered and not yet acted on. That answer was spread across a rail per job, two Today rows, and
 * -- in practice -- a spreadsheet and a WhatsApp thread.
 *
 * The grain is one candidate sent to one client, not one package: a shortlist of four is four
 * conversations, and the client can approve one and say nothing about the other three. A
 * package-grained row would have to invent a single state for four different answers.
 *
 * Nothing here decides what state a row is in. public.submission_delivery_state does, on the server,
 * on every read, from the delivery row / link / feedback / package status that already exist -- so
 * the state cannot drift from the records it summarises, and the list can be ORDERED by urgency
 * before it is paged. That last part is why this is an RPC rather than a filter over the package
 * list: you cannot page a list by a property the client has to fetch everything to compute.
 */

const PAGE_SIZE=25

export function DeliveryWorkbench({scope,currentMemberId}:{
  /* Shares Today's My work / Team switch rather than adding a second scope control. 'mine' resolves
   * to the current member's own deliveries -- owned at the job-candidate level, falling back to the
   * job's owner, which is what the RPC's owner column already means. */
  scope:'mine'|'team'
  currentMemberId?:string
}){
  const {organization}=useOrganization()
  const capabilities=useWorkspaceCapabilities()
  const cache=useQueryClient()
  const toast=useToast()
  const [params,setParams]=useSearchParams()

  /* Everything that narrows the list lives in the URL, prefixed so it cannot collide with Today's own
   * params or with a future filter on the Actions side. That also makes a delivery view shareable:
   * "look at this" between two consultants is a link, not a description of which tabs to press. */
  const quickView=parseDeliveryQuickView(params.get('deliveryState'))
  const search=params.get('deliveryQ')||''
  const ownerFilter=params.get('deliveryOwner')||''
  const page=Math.max(0,Number(params.get('deliveryPage')||0))
  const setParam=(key:string,value:string)=>{
    const next=new URLSearchParams(params)
    if(value)next.set(key,value);else next.delete(key)
    // Any change to what is shown resets the page. Landing on page 4 of a two-page result is the
    // classic way a filtered list appears empty when it is not.
    if(key!=='deliveryPage')next.delete('deliveryPage')
    setParams(next,{replace:true})
  }

  /* Scope wins over the explicit owner filter when it can, so "My work" means the same thing on both
   * halves of Today. The dropdown is how a manager looks at one colleague, and it only applies in
   * Team view -- offering both at once would let the two disagree in a way neither control shows. */
  const ownerMemberId=scope==='mine'?currentMemberId||'':ownerFilter
  const filters=useMemo(()=>({state:quickView,ownerMemberId,query:search}),[quickView,ownerMemberId,search])

  const query=useQuery({
    queryKey:['delivery-workbench',organization?.id,filters,page],
    enabled:Boolean(organization),
    queryFn:()=>listDeliveryWorkbench(organization!.id,filters,page,PAGE_SIZE),
  })
  const team=useQuery({queryKey:['team',organization?.id],enabled:Boolean(organization),queryFn:()=>listTeamMembers(organization!.id)})

  const refresh=()=>cache.invalidateQueries({queryKey:['delivery-workbench',organization?.id]})
  const track=(actionKey:string)=>{
    if(organization)recordWorkflowEvent({organizationId:organization.id,eventName:'action_completed',
      surface:'delivery_workbench',actionKey})
  }

  /* Which row is mid-write. A single boolean would grey out every button in the table while one
   * retry was in flight, which reads as the whole screen having failed. */
  const [working,setWorking]=useState<string|null>(null)

  const handled=useMutation({
    mutationFn:({feedbackId,next}:{feedbackId:string;next:boolean})=>setSubmissionFeedbackHandled(feedbackId,next),
    onSuccess:async(_result,variables)=>{
      track(variables.next?'mark_handled':'reopen')
      await refresh()
      toast.success(variables.next?'Marked as handled.':'Reopened.',
        variables.next?'It moves out of Needs attention.':'It is back in Needs attention.')
    },
    onError:(error)=>toast.error(error,'Nothing was changed.'),
    onSettled:()=>setWorking(null),
  })
  const retry=useMutation({
    mutationFn:(deliveryId:string)=>retryClientSubmission(organization!.id,deliveryId),
    onSuccess:async(result)=>{
      track('retry_email')
      await refresh()
      /* The edge function returns the new delivery status rather than throwing on a second failure,
       * so a retry that failed again must not be reported as a success. */
      if(result.deliveryStatus==='failed')toast.error(new Error(result.errorMessage||'Email delivery failed.'),'The shortlist is still saved.')
      else toast.success('Submission email sent.','The existing review link was reused.')
    },
    onError:(error)=>toast.error(error,'The submission email was not retried.'),
    onSettled:()=>setWorking(null),
  })

  const rows=query.data?.rows||[]
  const total=query.data?.count||0
  const pages=Math.max(1,Math.ceil(total/PAGE_SIZE))
  const base=`/app/${organization?.slug||'workspace'}`
  const canWrite=Boolean(capabilities.data?.canSubmit)

  return <div className="delivery-workbench">
    <div className="toolbar">
      {/* Radio semantics, one active at a time, exactly like the candidate queue strip: these are
        * views of one list, not composable filters. Each carries its own rule as a title, because a
        * queue whose definition is invisible cannot be trusted -- you cannot tell an excluded row
        * from a missing one. */}
      <div className="queue-tab-set" role="radiogroup" aria-label="Delivery view">
        {deliveryQuickViews.map((view)=>
          <button key={view.id} type="button" role="radio" aria-checked={quickView===view.id}
            className={`queue-tab${quickView===view.id?' queue-tab-active':''}`}
            title={view.description}
            onClick={()=>setParam('deliveryState',view.id)}>{view.label}</button>)}
      </div>
      <div className="search-box"><Search size={15}/>
        <Input aria-label="Search deliveries" placeholder="Candidate, job, or client"
          value={search} onChange={(event)=>setParam('deliveryQ',event.target.value)}/>
      </div>
      {/* Only in Team view: in My work the scope already answers "whose", and a second control that
        * silently does nothing is worse than no control. */}
      {scope==='team'&&<Select aria-label="Delivery owner" value={ownerFilter}
        onChange={(event)=>setParam('deliveryOwner',event.target.value)}>
        <option value="">Anyone</option>
        {team.data?.filter((member)=>member.status==='active').map((member)=>
          <option key={member.id} value={member.id}>{member.profiles?.full_name||member.profiles?.email}</option>)}
      </Select>}
      <span className="toolbar-count">{total} {total===1?'delivery':'deliveries'}</span>
    </div>

    {query.isLoading?<TableSkeleton rows={6} columns={6} label="Loading client deliveries…"/>
      :query.error?<ErrorState error={query.error} retry={()=>void query.refetch()}/>
      :rows.length===0?<EmptyState title={emptyTitle(quickView)} description={emptyDescription(quickView)}/>
      :<Table className="delivery-table" headers={[
        {label:'Candidate'},{label:'Job / client',width:'200px'},{label:'Delivery',width:'210px'},
        {label:'State',width:'150px'},{label:'Owner',width:'130px'},{label:'Next action',width:'170px'},
      ]}>
        {rows.map((row)=><tr key={row.candidate_submission_id}>
          <td>
            {/* Straight to the candidate inside the job that sent them -- the panel that holds what
              * was submitted, the client's answer and every action that follows from it. */}
            <Link className="record-link" to={`${base}/jobs/${row.job_id}?candidate=${row.job_candidate_id}`}>
              <strong>{row.candidate_name||NOT_RECORDED}</strong>
            </Link>
            {/* .cell-sub, not a bare <span>: components.css only styles `td span:not([class])` as the
              * sub-line, so a classed one silently loses the treatment. See the note on .cell-sub. */}
            <span className="cell-sub">{row.package_title||'Client submission'}</span>
          </td>
          <td>
            <Link className="record-link" to={`${base}/jobs/${row.job_id}`}><strong>{row.job_title||NOT_RECORDED}</strong></Link>
            <span className="cell-sub">{row.company_name||'Client'}</span>
          </td>
          <td><DeliveryCell row={row}/></td>
          <td><StateCell row={row}/></td>
          <td>{row.owner_name||<span className="cell-gap">Unassigned</span>}</td>
          <td><NextActionCell row={row} base={base} canWrite={canWrite}
            busy={working===row.candidate_submission_id}
            onMarkHandled={(next)=>{
              if(!row.feedback_id)return
              setWorking(row.candidate_submission_id)
              handled.mutate({feedbackId:row.feedback_id,next})
            }}
            onRetry={()=>{
              if(!row.email_delivery_id)return
              setWorking(row.candidate_submission_id)
              retry.mutate(row.email_delivery_id)
            }}/></td>
        </tr>)}
      </Table>}

    <Pagination page={page} pages={pages} busy={query.isFetching} label="Delivery pages"
      onPage={(next)=>setParam('deliveryPage',String(next))}/>
  </div>
}

/* When it went, to whom, and whether they opened it. Three facts on two lines, because "have they
 * even looked at it" is the question behind most of the chasing this screen replaces. */
function DeliveryCell({row}:{row:DeliveryWorkbenchRow}){
  return <>
    <strong>Sent {formatDate(row.sent_at)}</strong>
    <span className="cell-sub" title={row.recipient_email||undefined}>
      {row.recipient_email||'No recipient recorded'}
      {' · '}
      {row.opened_at?`opened ${formatDateTime(row.opened_at)}`:'not opened'}
    </span>
  </>
}

function StateCell({row}:{row:DeliveryWorkbenchRow}){
  const definition=deliveryStateDefinition(row.delivery_state)
  return <>
    <span title={definition.rule}><Badge tone={definition.tone}>{definition.label}</Badge></span>
    {/* The specific cause, where there is one. "Email failed" without the provider's reason sends the
      * consultant to the logs; with it, most failures are self-explanatory (a typo'd address, a full
      * mailbox). Feedback shows the client's decision for the same reason. */}
    <span className="cell-sub">{stateDetail(row)}</span>
  </>
}

function stateDetail(row:DeliveryWorkbenchRow):string{
  if(row.delivery_state==='failed')return row.email_error||row.email_status||'No reason recorded'
  if(row.delivery_state==='link_unavailable'){
    return row.link_revoked_at?`Revoked ${formatDate(row.link_revoked_at)}`
      :row.link_expires_at?`Expired ${formatDate(row.link_expires_at)}`
      :'No live link'
  }
  if(row.feedback_at)return `${decisionLabel(row.feedback_decision)} · ${formatDate(row.feedback_at)}`
  if(row.link_expires_at&&!row.link_revoked_at)return `Link expires ${formatDate(row.link_expires_at)}`
  return ''
}

const decisionLabel=(decision:DeliveryWorkbenchRow['feedback_decision'])=>{
  if(decision==='approve')return 'Approved'
  if(decision==='reject')return 'Rejected'
  if(decision==='interview')return 'Wants to interview'
  if(decision==='hold')return 'On hold'
  return 'Answered'
}

/* One control per row, decided by the state alone -- see deliveryAction. Two rows in the same state
 * never offer different things, and the control is never a button that cannot run: the write actions
 * fall back to a plain link when the member lacks submissions.write, so a read-only consultant sees
 * where to go rather than a disabled control with no explanation. */
function NextActionCell({row,base,canWrite,busy,onMarkHandled,onRetry}:{
  row:DeliveryWorkbenchRow
  base:string
  canWrite:boolean
  busy:boolean
  onMarkHandled:(next:boolean)=>void
  onRetry:()=>void
}){
  const action=deliveryAction(row)
  const candidateLink=`${base}/jobs/${row.job_id}?candidate=${row.job_candidate_id}`
  if(action.needsWrite&&!canWrite)return <Link className="record-link" to={candidateLink}>Open candidate</Link>
  switch(action.kind){
    case 'mark_handled':return <Button size="sm" variant="secondary" loading={busy} onClick={()=>onMarkHandled(true)}>{action.label}</Button>
    case 'reopen':return <Button size="sm" variant="quiet" loading={busy} onClick={()=>onMarkHandled(false)}>{action.label}</Button>
    case 'retry_email':return <Button size="sm" variant="secondary" loading={busy} onClick={onRetry}>{action.label}</Button>
    /* Sending is the composer's job. `?open=submit` opens it on this candidate in their job rather
      * than growing a second send form here, which would be a second set of defaults, a second
      * expiry rule and a second place to get the recipient wrong. */
    case 'resend_link':return <Link className="button button-secondary button-sm"
      to={`${base}/jobs/${row.job_id}?candidate=${row.job_candidate_id}&open=submit`}>{action.label}</Link>
    default:return <Link className="record-link" to={candidateLink}>{action.label}</Link>
  }
}

/* Never "there are none". This RPC is security invoker over tables behind submissions.read,
 * jobs.read and candidates.read, so a member without them gets an empty result rather than an error.
 * Naming the view's rule lets the reader tell an empty queue from an invisible one. */
function emptyTitle(view:string){
  if(view==='needs_attention')return 'Nothing needs chasing'
  if(view==='all')return 'Nothing has been sent yet'
  return 'Nothing in this view'
}
function emptyDescription(view:string){
  const definition=deliveryQuickViews.find((entry)=>entry.id===view)
  if(view==='all')return 'Shortlists you send to clients appear here, with whether the link worked and whether they answered.'
  return `${definition?.description||''} Nothing here matches, and the search and owner filters still apply.`
}
