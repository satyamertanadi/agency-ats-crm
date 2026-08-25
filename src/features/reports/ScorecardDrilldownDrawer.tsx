import {useMemo,useState} from 'react'
import {useQuery} from '@tanstack/react-query'
import {ChevronLeft,ChevronRight} from 'lucide-react'
import {Link} from 'react-router'
import {useOrganization} from '../../app/OrganizationProvider'
import {listJobCandidateSummaries} from '../core/commercialRepository'
import {Button} from '../../shared/ui/Button'
import {Drawer} from '../../shared/ui/Drawer'
import {EmptyState,ErrorState,TableSkeleton} from '../../shared/ui/States'
import {Table} from '../../shared/ui/Table'
import {NOT_RECORDED} from '../../shared/lib/labels'
import type {DrilldownDefinition} from './scorecardDrilldown'

const PAGE_SIZE=25

/* The records behind one number.
 *
 * The count in the header is `ids.length` -- the size of the set the tile itself counted -- and never
 * the number of rows the name query returned. Those two differ under RLS: a member who may read
 * submissions but not a particular candidate gets that row back without a name. If the header counted
 * resolved rows instead, the total would quietly shrink for exactly the people whose permissions are
 * narrowest, and the drilldown would contradict the tile that opened it for them alone -- the hardest
 * kind of discrepancy to notice and the worst kind to have.
 *
 * So an unresolvable row is still a row. It says the record is not visible rather than disappearing,
 * which is the truthful statement: the work happened, this reader may not see who it was about.
 *
 * Paginated over the id set in memory, resolving names one page at a time. A year of submissions is
 * a few hundred ids; asking for all of their names to render twenty-five of them would be a large
 * request for a drawer somebody is about to close.
 */
export function ScorecardDrilldownDrawer({metric,definition,ids,onClose}:{
  metric:DrilldownDefinition
  /* Resolved by the caller rather than read off `metric` here, because the sentence depends on the
   * scope and the drawer has no business knowing which scope it was opened from -- it renders one
   * population and the words that describe it. */
  definition:string
  /** The exact ids the tile counted, in the order the selector produced them. */
  ids:string[]
  onClose:()=>void
}){
  const {organization}=useOrganization()
  const [page,setPage]=useState(0)

  const pages=Math.max(1,Math.ceil(ids.length/PAGE_SIZE))
  // Clamped rather than trusted: the metric can change under an open drawer when the scope toggles.
  const current=Math.min(page,pages-1)
  const visible=useMemo(()=>ids.slice(current*PAGE_SIZE,current*PAGE_SIZE+PAGE_SIZE),[ids,current])

  /* Keyed on the visible ids, so paging fetches once per page and returning to a page is free. Not
   * keyed on the metric name: two metrics that happen to contain the same records should share the
   * cached answer, because they are asking the same question of the same rows. */
  const summaries=useQuery({
    queryKey:['scorecard-drilldown',organization?.id,visible],
    enabled:Boolean(organization)&&visible.length>0,
    queryFn:()=>listJobCandidateSummaries(organization!.id,visible),
  })
  const byId=new Map((summaries.data||[]).map((summary)=>[summary.id,summary]))
  const base=`/app/${organization?.slug}`

  return <Drawer open eyebrow="Scorecard" title={metric.label} description={definition} onClose={onClose}
    footer={pages>1?<div className="pagination">
      <Button variant="secondary" size="sm" disabled={current===0} leadingIcon={<ChevronLeft size={14}/>}
        onClick={()=>setPage(current-1)}>Previous</Button>
      <span>Page {current+1} of {pages}</span>
      <Button variant="secondary" size="sm" disabled={current+1>=pages} trailingIcon={<ChevronRight size={14}/>}
        onClick={()=>setPage(current+1)}>Next</Button>
    </div>:undefined}>
    {/* The reconciliation statement, said out loud. The number a consultant just clicked is repeated
      * here beside the records, so agreeing with the tile is something they can see rather than
      * something they have to take on trust. */}
    <p className="drilldown-total"><strong>{ids.length}</strong> {ids.length===1?'record':'records'} — the same {ids.length===1?'one':ids.length} counted by this number.</p>
    {ids.length===0
      ?<EmptyState title="Nothing in this period" description="No records met this definition in the selected date range."/>
      :summaries.isLoading
        ?<TableSkeleton rows={Math.min(visible.length,8)} columns={2} label="Loading records…"/>
        :summaries.error
          ?<ErrorState error={summaries.error} retry={()=>void summaries.refetch()}/>
          :<Table className="drilldown-table" caption={`Records behind ${metric.label}`} headers={['Candidate','Job']}>
            {visible.map((id)=>{
              const summary=byId.get(id)
              return <tr key={id}>
                <td>
                  {summary?.candidate_id&&summary.candidates
                    ?<Link className="record-link" to={`${base}/candidates/${summary.candidate_id}`}>{summary.candidates.full_name}</Link>
                    // Counted, and not visible to this reader. Stated rather than omitted -- see the
                    // header comment for why the row must survive.
                    :<span className="cell-gap">Not visible to you</span>}
                </td>
                <td>
                  {summary?.job_id&&summary.jobs
                    ?<><Link className="record-link" to={`${base}/jobs/${summary.job_id}`}>{summary.jobs.title}</Link>
                      <span className="cell-quiet"> · {summary.jobs.companies?.name||NOT_RECORDED}</span></>
                    :<span className="cell-gap">{NOT_RECORDED}</span>}
                </td>
              </tr>
            })}
          </Table>}
  </Drawer>
}
