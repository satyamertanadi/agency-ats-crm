import {useMemo,useState} from 'react'
import {useQuery} from '@tanstack/react-query'
import {ChevronLeft,ChevronRight} from 'lucide-react'
import {Link} from 'react-router'
import {useOrganization} from '../../app/OrganizationProvider'
import {listInterviewSummaries} from './qualityRepository'
import {Button} from '../../shared/ui/Button'
import {Drawer} from '../../shared/ui/Drawer'
import {Callout} from '../../shared/ui/Callout'
import {EmptyState,ErrorState,TableSkeleton} from '../../shared/ui/States'
import {Table} from '../../shared/ui/Table'
import {formatDateTime} from '../../shared/lib/format'
import {NOT_RECORDED} from '../../shared/lib/labels'
import {drilldownTruncated} from './qualityPresentation'

const PAGE_SIZE=25

/* The interviews behind one Scorecard figure.
 *
 * The header count is the aggregate's count, never the number of rows that resolved. Those differ
 * under RLS: a reader who may see the aggregate but not a particular candidate gets the row back
 * without a name. Counting resolved rows instead would quietly shrink the total for exactly the
 * people whose permissions are narrowest, so the drilldown would contradict the tile that opened it
 * for them alone -- the hardest kind of discrepancy to notice.
 *
 * An unresolvable row therefore stays a row and says so. The interview happened; this reader may not
 * see whose it was.
 */
export function InterviewDrilldownDrawer({title,definition,ids,count,cap,onClose}:{
  title:string
  definition:string
  /** The exact ids the aggregate returned for this figure. */
  ids:string[]
  /** The aggregate's own count, which can exceed ids.length when the cap bit. */
  count:number
  cap:number
  onClose:()=>void
}){
  const {organization}=useOrganization()
  const [page,setPage]=useState(0)

  const pages=Math.max(1,Math.ceil(ids.length/PAGE_SIZE))
  const current=Math.min(page,pages-1)
  const visible=useMemo(()=>ids.slice(current*PAGE_SIZE,current*PAGE_SIZE+PAGE_SIZE),[ids,current])

  const summaries=useQuery({
    queryKey:['interview-drilldown',organization?.id,visible],
    enabled:Boolean(organization)&&visible.length>0,
    queryFn:()=>listInterviewSummaries(organization!.id,visible),
  })
  const byId=new Map((summaries.data||[]).map((row)=>[row.id,row]))
  const base=`/app/${organization?.slug}`
  const truncated=drilldownTruncated(count,ids.length,cap)

  return <Drawer open title={title} eyebrow="Interview quality" onClose={onClose}>
    <p className="muted">{definition}</p>
    <p><strong>{count}</strong> {count===1?'interview':'interviews'}</p>
    {/* Said out loud rather than left for the reader to notice that the list is shorter than the
      * number above it. A drilldown that silently stops short is worse than one that refuses. */}
    {truncated&&<Callout tone="info" title="Showing the most recent records">
      This list shows the most recent {ids.length} of {count}. The count above is complete.
    </Callout>}
    {summaries.isLoading&&<TableSkeleton rows={5} columns={3} label="Loading interviews…"/>}
    {summaries.error&&<ErrorState error={summaries.error}/>}
    {!summaries.isLoading&&!summaries.error&&(ids.length===0
      ?<EmptyState title="Nothing to show" description="No interviews are recorded behind this number."/>
      :<>
        <Table caption={`Interviews behind ${title}`} headers={['Interview','Job','Candidate']}>
          {visible.map((id)=>{
            const row=byId.get(id)
            return <tr key={id}>
              <td>{row?.startsAt
                ?<Link className="record-link" to={`${base}/interviews`}>{formatDateTime(row.startsAt)}</Link>
                :<span className="muted">Not visible to you</span>}</td>
              <td>{row?.jobTitle??NOT_RECORDED}</td>
              <td>{row?.candidateName??NOT_RECORDED}</td>
            </tr>
          })}
        </Table>
        {pages>1&&<div className="form-actions">
          <Button variant="secondary" leadingIcon={<ChevronLeft size={14}/>} disabled={current===0}
            onClick={()=>setPage(current-1)}>Previous</Button>
          <span className="muted">Page {current+1} of {pages}</span>
          <Button variant="secondary" leadingIcon={<ChevronRight size={14}/>} disabled={current>=pages-1}
            onClick={()=>setPage(current+1)}>Next</Button>
        </div>}
      </>)}
  </Drawer>
}
