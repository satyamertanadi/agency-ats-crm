import {useQuery} from '@tanstack/react-query'
import {candidateQualitySummary,type CandidateListFilters} from '../core/repository'
import {qualityIssueDefinition,qualityIssues} from './candidateQuality'

/* What is actually wrong with the records in Needs enrichment, and how many of each.
 *
 * The queue on its own told a consultant that fifty records were unusable and nothing about why --
 * so the only way to find out was to open fifty of them. This is the missing half: the counts, and a
 * way to work one gap at a time.
 *
 * The counts and the filter are ONE control, not a strip beside a dropdown. They are the same
 * question asked twice -- "how many are missing a CV" and "show me the ones missing a CV" -- and two
 * controls for one question is how a count and a filtered list come to disagree about which is
 * authoritative. Pressing a count applies it; pressing it again clears it.
 *
 * The counts are deliberately taken WITHOUT the issue filter applied (see candidate_quality_summary),
 * which is what makes "No CV (12)" mean twelve rows when you press it. A count taken after the choice
 * would always read as the number already on screen, which is a number nobody needs.
 *
 * Mounted only while the enrichment queue is active. Beside any other queue these counts would be
 * answering a question nobody asked, and the request would be pure cost.
 */
export function CandidateQualityStrip({organizationId,filters,issue,onIssue}:{
  organizationId:string
  /** The list's filters. `queue` and `issue` are deliberately not read: see the header. */
  filters:CandidateListFilters
  issue:string|null
  onIssue:(next:string|null)=>void
}){
  /* Keyed on the eight shared filters only. Choosing an issue must not refetch the counts -- they do
   * not change, and a strip that flickered every time you pressed one of its own buttons would read
   * as the numbers being recalculated against the choice. */
  const key={query:filters.query||'',status:filters.status||'',location:filters.location||'',
    source:filters.source||'',ownerMemberId:filters.ownerMemberId||'',tag:filters.tag||'',
    skill:filters.skill||'',availability:filters.availability||''}
  const summary=useQuery({
    queryKey:['candidate-quality-summary',organizationId,key],
    queryFn:()=>candidateQualitySummary(organizationId,key),
  })

  const counts=new Map((summary.data||[]).map((row)=>[row.issue_code,row.candidate_count]))
  /* Ordered by the definitions rather than by count, so the strip does not reshuffle itself between
   * visits -- a control whose buttons move is one people stop aiming at. Codes the server returned
   * that this build does not know about are appended, so a new rule is visible rather than silently
   * dropped from a total the reader is trying to reconcile. */
  const known=qualityIssues.map((definition)=>definition.id as string)
  const extra=[...counts.keys()].filter((code)=>!known.includes(code))
  const codes=[...known,...extra]

  /* Never rendered as zeroes while the counts are still loading, and never as an error banner: this
   * is a refinement of a queue that is already on screen and usable without it. A failed count leaves
   * the queue exactly as it was before this strip existed. */
  if(summary.isLoading||summary.error)return null

  return <div className="quality-strip" role="group" aria-label="Data quality issues">
    <button type="button" className={`queue-tab${issue===null?' queue-tab-active':''}`}
      aria-pressed={issue===null}
      title="Every record in this queue, whatever is missing from it."
      onClick={()=>onIssue(null)}>All issues</button>
    {codes.map((code)=>{
      const definition=qualityIssueDefinition(code)
      const count=counts.get(code)||0
      return <button key={code} type="button"
        className={`queue-tab${issue===code?' queue-tab-active':''}`}
        aria-pressed={issue===code}
        /* Zero is shown, not hidden. "No CV (0)" is a useful thing to learn about a talent database,
          * and a strip whose buttons appear and disappear as the data changes cannot be aimed at. */
        disabled={count===0&&issue!==code}
        title={definition.reason}
        onClick={()=>onIssue(issue===code?null:code)}>
        {definition.label} <span className="quality-strip-count">{count}</span>
      </button>
    })}
  </div>
}
