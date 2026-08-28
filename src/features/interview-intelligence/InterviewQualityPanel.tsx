import {useState} from 'react'
import {useQuery} from '@tanstack/react-query'
import {useOrganization} from '../../app/OrganizationProvider'
import {getQualityScorecard,getTeamPatterns,type QualityScope} from './qualityRepository'
import {
  bandLabel,compareDimension,coverageLabel,dimensionLabel,orderedThemes,
  processingNotes,sampleNote,speakingShareNote,
} from './qualityPresentation'
import {Panel} from '../../shared/ui/Page'
import {Table} from '../../shared/ui/Table'
import {EmptyState,ErrorState,TableSkeleton} from '../../shared/ui/States'
import {InterviewDrilldownDrawer} from './InterviewDrilldownDrawer'

/* The interview-quality view of the Scorecard.
 *
 * Two things this deliberately does not render. There is no overall score for a consultant -- the
 * bands are a distribution, not a grade, and averaging them into one figure would create the hidden
 * employee score this feature is not allowed to have. And there is no consultant table in the team
 * view: the aggregate behind it carries no member identifier at all, so a ranking cannot be built
 * here even by a future edit that wanted one.
 *
 * Every count opens the interviews behind it. A number about a named colleague's work that the reader
 * has to take on faith is the opposite of what an evidence-backed tool is for.
 */

interface Drilldown {
  title:string
  definition:string
  ids:string[]
  count:number
}

function CountButton({count,onOpen,label}:{count:number;onOpen:()=>void;label:string}){
  if(count===0)return <span className="muted">0</span>
  return <button type="button" className="count-button" onClick={onOpen}
    aria-label={`${label}: show the ${count} interviews behind this number`}>{count}</button>
}

export function InterviewQualityPanel({scope,fromIso,toIso}:{
  scope:QualityScope
  fromIso:string
  toIso:string
}){
  const {organization}=useOrganization()
  const [drilldown,setDrilldown]=useState<Drilldown|null>(null)

  const scorecard=useQuery({
    queryKey:['interview-quality',organization?.id,scope,fromIso,toIso],
    enabled:Boolean(organization),
    queryFn:()=>getQualityScorecard(organization!.id,fromIso,toIso,scope),
  })
  /* Only fetched for the team view. A consultant has no permission for it and the RPC would refuse,
   * so requesting it speculatively would put a guaranteed error in everyone's network log. */
  const patterns=useQuery({
    queryKey:['interview-quality-patterns',organization?.id,fromIso,toIso],
    enabled:Boolean(organization)&&scope==='team',
    queryFn:()=>getTeamPatterns(organization!.id,fromIso,toIso),
  })

  if(scorecard.isLoading||(scope==='team'&&patterns.isLoading)){
    return <Panel title="Interview quality"><TableSkeleton rows={4} columns={4} label="Reading analysed interviews…"/></Panel>
  }
  if(scorecard.error)return <ErrorState error={scorecard.error}/>
  if(patterns.error)return <ErrorState error={patterns.error}/>

  const data=scorecard.data!
  const open=(next:Drilldown)=>setDrilldown(next)

  if(data.analysedInterviews===0){
    /* Not an error state and not a zero. A workspace that has analysed nothing yet is the normal
     * starting condition, and the page should say what would fill it. */
    return <Panel title="Interview quality">
      <EmptyState title="No analysed interviews in this period"
        description={scope==='team'
          ?'Interview quality appears here once interviews in this period have been analysed. Nothing is inferred from interviews that were not.'
          :'Once your interviews in this period have been analysed, your own coverage, question quality and speaking share appear here.'}/>
    </Panel>
  }

  const drawer=drilldown
    ?<InterviewDrilldownDrawer title={drilldown.title} definition={drilldown.definition}
      ids={drilldown.ids} count={drilldown.count} cap={data.drilldownCap} onClose={()=>setDrilldown(null)}/>
    :null

  const header=<div className="kpi-grid">
    <article className="kpi">
      <div>
        <p>Analysed interviews</p>
        <strong>
          <CountButton count={data.analysedInterviews} label="Analysed interviews"
            onOpen={()=>open({title:'Analysed interviews',
              definition:scope==='team'
                ?'Interviews in this period with a completed consultant-quality analysis.'
                :'Your interviews in this period with a completed consultant-quality analysis.',
              ids:data.interviewIds,count:data.analysedInterviews})}/>
        </strong>
        {/* The comparison base, stated rather than implied, because every trend below is measured
          * against it. */}
        <small className="kpi-caption">{data.previousAnalysedInterviews} in the previous period</small>
      </div>
    </article>
    <article className="kpi"><div><p>Coaching open</p><strong>{data.coaching.open+data.coaching.acknowledged}</strong>
      <small className="kpi-caption">{data.coaching.overdue} overdue · {data.coaching.completed} completed</small></div></article>
  </div>

  const dimensionTable=<Panel title="Coverage and technique"
    subtitle={scope==='team'
      ?'Across the desk, scored 0-4 by the rubric. Averages appear once a dimension has enough analysed interviews behind it.'
      :'Your own dimensions, scored 0-4 by the rubric and compared only against your own previous period.'}>
    <Table caption="Interview quality by dimension"
      headers={['Dimension','Interviews','Average','Against previous period','Needs attention']}>
      {data.dimensions.map((trend)=>{
        const comparison=compareDimension(trend,data.minimumSample)
        const note=sampleNote(trend.interviews,data.minimumSample)
        return <tr key={trend.dimension}>
          <td><strong>{dimensionLabel(trend.dimension)}</strong></td>
          <td>{trend.interviews}</td>
          {/* The database withholds the average below the floor. The cell says why rather than
            * printing a dash the reader has to interpret. */}
          <td>{trend.averageScore===null?<span className="muted">{note??'Not enough yet'}</span>:trend.averageScore.toFixed(2)}</td>
          <td className={comparison.direction==='declined'?'overdue-text':undefined}>{comparison.note}</td>
          <td>
            <CountButton count={trend.attentionFindings} label={`${dimensionLabel(trend.dimension)} needing attention`}
              onOpen={()=>open({title:`${dimensionLabel(trend.dimension)} · needs attention`,
                definition:'Interviews with an attention or critical finding in this dimension.',
                ids:trend.attentionInterviewIds,count:trend.attentionFindings})}/>
          </td>
        </tr>
      })}
    </Table>
  </Panel>

  const bandTable=<Panel title="Outcome bands" subtitle="A distribution, not a grade. There is no combined score for a consultant.">
    <Table caption="Interview outcome bands" headers={['Band','Interviews']}>
      {data.bands.map((band)=><tr key={band.band}>
        <td>{bandLabel(band.band)}</td>
        <td><CountButton count={band.interviews} label={bandLabel(band.band)}
          onOpen={()=>open({title:bandLabel(band.band),
            definition:`Interviews whose overall assessment was "${bandLabel(band.band)}".`,
            ids:band.interviewIds,count:band.interviews})}/></td>
      </tr>)}
    </Table>
  </Panel>

  if(scope==='mine'){
    return <>
      {header}
      {dimensionTable}
      <div className="two-column">
        {bandTable}
        <Panel title="Speaking share" subtitle="Your own share over time. There is no ideal ratio, so there is no target here.">
          <p>{speakingShareNote(data)}</p>
          {data.conversation.unmeasuredInterviews>0&&<p className="muted">
            An interview is only measured when its transcript carries enough timestamps to be counted reliably.
          </p>}
        </Panel>
      </div>
      {drawer}
    </>
  }

  const team=patterns.data!
  return <>
    {header}
    <div className="kpi-grid">
      <article className="kpi"><div><p>Findings needing review</p><strong>
        <CountButton count={team.attentionFindings} label="Findings needing review"
          onOpen={()=>open({title:'Findings needing review',
            definition:'Attention and critical findings nobody has reviewed yet.',
            ids:team.attentionInterviewIds,count:team.attentionFindings})}/>
      </strong></div></article>
      {/* Processing quality sits beside interview quality but answers a different question: whether
        * the pipeline worked. A desk whose transcripts arrive partial does not have a coaching
        * problem. */}
      {processingNotes(team).map((note)=>
        <article className="kpi" key={note.label}><div><p>{note.label}</p><strong>{note.value}</strong>
          <small className="kpi-caption">{note.caption}</small></div></article>)}
    </div>
    {dimensionTable}
    <div className="two-column">
      <Panel title="Essential coverage" subtitle="How often the essentials were actually asked, across the desk.">
        <Table caption="Essential coverage across the desk" headers={['Outcome','Interviews']}>
          {team.coverage.map((entry)=><tr key={entry.result}>
            <td>{coverageLabel(entry.result)}</td>
            <td><CountButton count={entry.interviews} label={coverageLabel(entry.result)}
              onOpen={()=>open({title:`Essential coverage · ${coverageLabel(entry.result)}`,
                definition:'Interviews whose essential-coverage finding had this outcome.',
                ids:entry.interviewIds,count:entry.interviews})}/></td>
          </tr>)}
        </Table>
      </Panel>
      <Panel title="Common coaching themes" subtitle="Training topics, ordered by how widely they appear. Never by who.">
        <Table caption="Common coaching themes" headers={['Theme','Interviews','Findings']}>
          {orderedThemes(team).map((theme)=><tr key={theme.dimension}>
            <td>{dimensionLabel(theme.dimension)}</td>
            <td><CountButton count={theme.interviews} label={dimensionLabel(theme.dimension)}
              onOpen={()=>open({title:`${dimensionLabel(theme.dimension)} · coaching theme`,
                definition:'Interviews with a coaching, attention or critical finding in this dimension.',
                ids:theme.interviewIds,count:theme.interviews})}/></td>
            <td>{theme.findings}</td>
          </tr>)}
        </Table>
      </Panel>
    </div>
    {bandTable}
    {drawer}
  </>
}
