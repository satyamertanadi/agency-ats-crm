import {describe,expect,it} from 'vitest'
import {buildConsultantRows,buildRecruitmentFunnel,isRecordedPlacement} from './reportMetrics'
import {drilldowns,parseMetric,type DrilldownContext,type DrilldownInput} from './scorecardDrilldown'

/* The one property worth testing, and it is a comparison rather than an assertion about numbers:
 *
 *   FOR EVERY OPENABLE TILE, THE SELECTOR'S SET SIZE EQUALS THE BUILDER'S NUMBER.
 *
 * Hard-coding "expect 3" would pass while both sides were wrong in the same way, and would keep
 * passing if someone changed one of the two definitions. So every test below computes the tile from
 * buildRecruitmentFunnel or buildConsultantRows -- the functions the page actually renders -- and
 * compares the drilldown against that. If either definition moves, this fails, which is the entire
 * point of a drilldown that promises to contain exactly what the tile counted.
 *
 * The fixture is deliberately awkward: a duplicate submission, a cancelled interview, a draft offer,
 * a cancelled placement, a milestone belonging to somebody submitted BEFORE the period, and two
 * consultants. Every one of those is a way the two sides could disagree.
 */

const ME='user-me'
const THEM='user-them'

/* Submitted inside the period. */
const JC1='jc-1'
const JC2='jc-2'
/* Submitted before the period: it has an interview and a placement in this period, but no submission
 * row. The team funnel excludes it (not in the cohort); the personal tiles include it (the consultant
 * did that work this month). This single record is what makes the two scopes differ. */
const JC_EARLIER='jc-earlier'

const input:DrilldownInput={
  submissions:[
    {job_candidate_id:JC1,created_by:ME},
    // The same candidate-and-job submitted twice in the period is ONE submission on the tile.
    {job_candidate_id:JC1,created_by:ME},
    {job_candidate_id:JC2,created_by:THEM},
  ],
  interviews:[
    {job_candidate_id:JC1,created_by:ME,status:'scheduled'},
    {job_candidate_id:JC1,created_by:ME,status:'completed'},
    {job_candidate_id:JC2,created_by:THEM,status:'cancelled'},
    {job_candidate_id:JC_EARLIER,created_by:ME,status:'completed'},
  ],
  offers:[
    {job_candidate_id:JC1,created_by:ME,status:'accepted'},
    {job_candidate_id:JC2,created_by:THEM,status:'draft'},
    {job_candidate_id:JC_EARLIER,created_by:ME,status:'presented'},
  ],
  placements:[
    {job_candidate_id:JC1,created_by:ME,status:'active'},
    {job_candidate_id:JC2,created_by:THEM,status:'cancelled'},
    {job_candidate_id:JC_EARLIER,created_by:ME,status:'completed'},
  ],
}

const metric=(id:string)=>{
  const found=drilldowns.find((entry)=>entry.id===id)
  if(!found)throw new Error(`No drilldown named ${id}`)
  return found
}
const select=(id:string,context:DrilldownContext)=>metric(id).select(input,context)

const TEAM:DrilldownContext={scope:'team'}
const MINE:DrilldownContext={scope:'mine',userId:ME}

const funnel=buildRecruitmentFunnel(input)
const funnelValue=(name:string)=>funnel.find((row)=>row.name===name)?.value

const consultantRows=buildConsultantRows({
  members:[
    {id:'member-me',user_id:ME,status:'active',profiles:{full_name:'Satya'}},
    {id:'member-them',user_id:THEM,status:'active',profiles:{full_name:'Kadek'}},
  ],
  submissions:input.submissions.map((row)=>({...row,status:row.status??undefined})),
  interviews:input.interviews.map((row)=>({...row,status:row.status??undefined})),
  offers:input.offers.map((row)=>({...row,status:row.status??undefined})),
  placements:input.placements.map((row)=>({...row,currency:'IDR',placement_fee:0})),
  activeJobs:[],overdueTasks:[],baseCurrency:'IDR',
})
const myRow=consultantRows.find((row)=>row.id==='member-me')

describe('the team drilldowns match the team tiles',()=>{
  it('submits exactly what the funnel submitted',()=>{
    expect(select('submissions',TEAM)).toHaveLength(funnelValue('Submitted')!)
  })

  /* The cohort constraint, tested by the record that would break it: jc-earlier has an interview in
   * this period and no submission in it, so the funnel excludes it and so must the drilldown. */
  it('interviews exactly what the funnel interviewed, cohort and all',()=>{
    const ids=select('interviews',TEAM)
    expect(ids).toHaveLength(funnelValue('Interview')!)
    expect(ids).not.toContain(JC_EARLIER)
  })

  it('offers exactly what the funnel offered, excluding drafts',()=>{
    const ids=select('offers',TEAM)
    expect(ids).toHaveLength(funnelValue('Offer')!)
    expect(ids).not.toContain(JC2)
  })

  /* The team's placement TILE is the recorded figure, not the funnel bar -- the two differ and the
   * page shows both. The drilldown has to match the tile it hangs off. */
  it('matches the recorded-placement tile rather than the funnel bar',()=>{
    const tile=new Set(input.placements.filter(isRecordedPlacement).map((row)=>row.job_candidate_id)).size
    expect(select('recordedPlacements',TEAM)).toHaveLength(tile)
    expect(tile).not.toBe(funnelValue('Placement'))
  })
})

describe('the personal drilldowns match the personal tiles',()=>{
  it('submits exactly what buildConsultantRows counted',()=>{
    expect(select('submissions',MINE)).toHaveLength(myRow!.submissions)
  })

  /* No cohort constraint in this scope, and jc-earlier is the proof: buildConsultantRows counts an
   * interview run this month for someone submitted last month, so the drilldown must contain it.
   * This is the assertion that would have failed against a single shared selector. */
  it('interviews exactly what buildConsultantRows counted, without the cohort',()=>{
    const ids=select('interviews',MINE)
    expect(ids).toHaveLength(myRow!.interviews)
    expect(ids).toContain(JC_EARLIER)
  })

  it('offers exactly what buildConsultantRows counted',()=>{
    expect(select('offers',MINE)).toHaveLength(myRow!.offers)
  })

  it('places exactly what buildConsultantRows counted',()=>{
    expect(select('recordedPlacements',MINE)).toHaveLength(myRow!.placements)
  })

  it('contains nobody else’s work',()=>{
    for(const id of ['submissions','interviews','offers','recordedPlacements']){
      expect(select(id,MINE)).not.toContain(JC2)
    }
  })
})

describe('the two scopes are genuinely different questions',()=>{
  it('counts more interviews for the consultant than the cohort funnel does',()=>{
    // Not a bug: the team funnel answers "of those submitted, how many progressed", and the personal
    // tile answers "what did I do this period". Both are right and they differ.
    expect(select('interviews',MINE).length).toBeGreaterThan(0)
    expect(select('interviews',TEAM)).not.toContain(JC_EARLIER)
    expect(select('interviews',MINE)).toContain(JC_EARLIER)
  })

  it('states a different definition in each scope where the definitions differ',()=>{
    expect(metric('interviews').definition(TEAM)).not.toBe(metric('interviews').definition(MINE))
    expect(metric('offers').definition(TEAM)).not.toBe(metric('offers').definition(MINE))
    // Submissions and recorded placements mean the same thing in both, so they say the same thing.
    expect(metric('submissions').definition(TEAM)).toBe(metric('submissions').definition(MINE))
    expect(metric('recordedPlacements').definition(TEAM)).toBe(metric('recordedPlacements').definition(MINE))
  })
})

describe('parseMetric',()=>{
  it('resolves a metric we serve',()=>{
    expect(parseMetric('submissions')?.id).toBe('submissions')
    expect(parseMetric('  offers  ')?.id).toBe('offers')
  })

  // Fails closed, like parseQueue and parseIssue: a hand-edited value opens nothing rather than an
  // empty drawer claiming to be a metric.
  it('refuses anything else',()=>{
    expect(parseMetric('fees')).toBeNull()
    expect(parseMetric('')).toBeNull()
    expect(parseMetric(null)).toBeNull()
  })

  /* Fees and jobs are deliberately absent. A fee total is an amount rather than a population, so no
   * list has its length; "jobs opened" has no destination meaning the same set. Pinned here so
   * adding one later is a deliberate act with a test to change, not an oversight. */
  it('serves no metric whose drilldown could not match its tile',()=>{
    expect(drilldowns.map((entry)=>entry.id)).toEqual(['submissions','interviews','offers','recordedPlacements'])
  })
})
