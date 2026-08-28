import {useQuery} from '@tanstack/react-query'
import {Link} from 'react-router'
import {ClipboardList} from 'lucide-react'
import {Badge,Panel} from '../../shared/ui/Page'
import {listTodayInterviewItems} from './reviewRepository'
import {splitTodayItems,todayItemLabel,todayItemTone} from './reviewPresentation'

/* Interview work on Today.
 *
 * ONE query, as the plan caps it. Today already assembles work from six sources, and a feature that
 * added four more round trips to the busiest screen in the product would pay for itself in latency
 * long before anyone read the rows.
 *
 * Renders nothing at all when there is no interview work or the feature is off, rather than an empty
 * card. Today is a worklist: a section that says "nothing here" on most days is a section people stop
 * seeing, and then miss on the day it is not empty.
 */
export function InterviewTodayPanel({organizationId,base}:{organizationId:string;base:string}){
  const {data:items=[],isLoading}=useQuery({
    queryKey:['interview-today',organizationId],
    queryFn:()=>listTodayInterviewItems(organizationId,25),
  })

  if(isLoading||items.length===0)return null
  const {mine,toReview}=splitTodayItems(items)

  return <Panel title="Interviews" icon={<ClipboardList size={16}/>}>
    {mine.length>0&&<TodayGroup title="Your interviews" items={mine} base={base}/>}
    {toReview.length>0&&<TodayGroup title="Needs your review" items={toReview} base={base}/>}
  </Panel>
}

function TodayGroup({title,items,base}:{
  title:string
  items:ReturnType<typeof splitTodayItems>['mine']
  base:string
}){
  return <>
    <h3 className="today-group-title">{title}</h3>
    <ul className="interview-today">
      {items.map((item)=><li key={`${item.kind}-${item.referenceId??item.interviewId}`}>
        <Badge tone={todayItemTone(item.kind)}>{todayItemLabel(item.kind)}</Badge>
        <span className="interview-today-headline">{item.headline}</span>
        {/* Deep-links to the candidate the interview belongs to. A row nobody can act on from Today
            is a row that belongs somewhere else. */}
        {item.jobCandidateId&&<Link to={`${base}/jobs?candidate=${item.jobCandidateId}`}>Open</Link>}
      </li>)}
    </ul>
  </>
}
