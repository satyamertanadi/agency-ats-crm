import {useState} from 'react'
import {useQuery} from '@tanstack/react-query'
import {ChevronLeft,ChevronRight,FileText,MapPin,TriangleAlert} from 'lucide-react'
import {Link} from 'react-router'
import {useOrganization} from '../../app/OrganizationProvider'
import {candidateStatus} from '../../shared/lib/status'
import {initials} from '../../shared/lib/format'
import {Badge,StatusBadge} from '../../shared/ui/Page'
import {Button} from '../../shared/ui/Button'
import {Drawer} from '../../shared/ui/Drawer'
import {TabPanel,Tabs,useTabsId} from '../../shared/ui/Tabs'
import {EmptyState,ErrorState,LoadingState} from '../../shared/ui/States'
import {useListNavigation} from '../../shared/lib/useListNavigation'
import {listCandidateDocuments} from '../core/commercialRepository'
import {ActivityFeed} from '../activities/ActivityFeed'
import type {CandidateSearchRow} from '../../shared/types/domain'
import {followUpSignal,pipelineSignal,statusFacets} from './candidateRowSignals'
import {NOT_RECORDED} from '../../shared/lib/labels'
import {issueFixHref,qualityIssueDefinition} from './candidateQuality'

/* Reviewing a candidate without leaving the list.
 *
 * This replaces CandidatePreviewPane, which proved the workflow and paid the wrong price for it: a
 * persistent 320px column that only appeared above 1440px, so the table lost a fifth of its width on
 * exactly the screens wide enough to show every column. The useful idea was never the rectangle on
 * the right -- it was reading and acting on a candidate without spending a navigation to get there
 * and another to come back. A drawer does that and costs the table nothing, at every width.
 *
 * Three rules carried over from the pane, because they were right:
 *
 * 1. Summary renders from the CandidateSearchRow the list already has. Paging through with j/k must
 *    not fire a request per keystroke, and a summary that loaded would spend the whole review
 *    flickering between skeletons.
 * 2. No private data. Email, phone and salary live behind the candidates_private permission and are
 *    not in the list row at all. "Open full record" is the door to those, where the permission is
 *    actually checked.
 * 3. Actions that need a dialog of their own CLOSE this one first. Two stacked dialogs means two
 *    focus traps fighting over Tab, and useDialogShell has no notion of a stack.
 *
 * The CV and Activity tabs are the two things the pane could not offer, and they are the reason the
 * tab strip exists rather than one long scroll: both cost a request, and neither is paid for until
 * the consultant asks for it. Only the active TabPanel is rendered, so switching tabs is what mounts
 * the query -- see the `tab` state below.
 */

export type QuickViewTab='summary'|'cv'|'activity'

export function CandidateQuickViewDrawer({candidate,siblingIds,onNavigate,onClose,organizationSlug,canAddToJob,onAddToJob,onAddFollowUp}:{
  candidate:CandidateSearchRow
  /** The ids on the loaded page, in render order. Paging clamps at its ends -- see useListNavigation. */
  siblingIds:readonly string[]
  onNavigate:(id:string)=>void
  onClose:()=>void
  organizationSlug:string
  canAddToJob:boolean
  onAddToJob:(candidate:CandidateSearchRow)=>void
  onAddFollowUp:(candidate:CandidateSearchRow)=>void
}){
  /* Kept across a page move on purpose. Reviewing ten CVs in a row is the flow this exists for, and
   * resetting to Summary on every Next would make it eleven clicks instead of ten. */
  const [tab,setTab]=useState<QuickViewTab>('summary')
  const tabsId=useTabsId()
  const navigation=useListNavigation({ids:siblingIds,activeId:candidate.id,onChange:onNavigate})
  const unavailable=candidate.status==='do_not_contact'||candidate.status==='archived'
  const role=candidate.current_position
    ?`${candidate.current_position}${candidate.current_company?` at ${candidate.current_company}`:''}`
    :NOT_RECORDED

  const pager=navigation.count>1?<div className="drawer-pager">
    <span className="drawer-pager-count" aria-live="polite">{navigation.index+1} of {navigation.count}</span>
    <button type="button" className="icon-button" onClick={navigation.previous} disabled={!navigation.hasPrevious} aria-label="Previous candidate"><ChevronLeft size={18}/></button>
    <button type="button" className="icon-button" onClick={navigation.next} disabled={!navigation.hasNext} aria-label="Next candidate"><ChevronRight size={18}/></button>
  </div>:null

  return <Drawer open eyebrow="Quick view" title={candidate.full_name} description={role}
    onClose={onClose} headerActions={pager} onKeyDown={navigation.onKeyDown}
    footer={<div className="quick-view-actions">
      {canAddToJob&&<Button size="sm" variant="secondary" disabled={unavailable} onClick={()=>onAddToJob(candidate)}>Add to job</Button>}
      <Button size="sm" variant="secondary" onClick={()=>onAddFollowUp(candidate)}>Add follow-up</Button>
      <Link className="button button-quiet button-sm" to={`/app/${organizationSlug}/candidates/${candidate.id}`}>Open full record</Link>
    </div>}>
    <Tabs id={tabsId} label="Candidate quick view sections" value={tab} onChange={setTab} items={[
      {id:'summary' as const,label:'Summary'},
      {id:'cv' as const,label:'CV'},
      {id:'activity' as const,label:'Activity'},
    ]}/>
    <TabPanel tabsId={tabsId} id={tab} className="quick-view-panel">
      {tab==='summary'&&<SummaryTab candidate={candidate} organizationSlug={organizationSlug}/>}
      {tab==='cv'&&<CvTab candidateId={candidate.id}/>}
      {/* readOnly, so the composer stays on the full record. A second place to write activity is a
        * second place for the two to disagree about what was logged. */}
      {tab==='activity'&&<ActivityFeed links={[{candidate_id:candidate.id}]} readOnly title="Activity"
        subtitle="Calls, emails, and meetings, plus pipeline movement recorded automatically."/>}
    </TabPanel>
  </Drawer>
}

function SummaryTab({candidate,organizationSlug}:{candidate:CandidateSearchRow;organizationSlug:string}){
  // One clock per render, for the same reason the table keeps one: two facts about the same candidate
  // must not disagree about what "today" is.
  const now=new Date()
  const pipeline=pipelineSignal(candidate,now)
  const followUp=followUpSignal(candidate,now)
  const facets=statusFacets(candidate)
  /* "Plant Engineering Manager · Screening · 6d" -- role, where they are, how long. Assembled from
   * whichever parts exist rather than padded with placeholders, so a candidate in no pipeline gets a
   * shorter line instead of a line full of "Not recorded". Built from open_job_count, so a member
   * without jobs.read gets the plain role rather than a half-built line claiming a stage. */
  const contextLine=[
    candidate.current_position||null,
    pipeline.inPipeline?pipeline.stageLabel||pipeline.jobTitle:null,
    followUp.state==='overdue'||followUp.state==='today'?followUp.dueLabel:null,
  ].filter(Boolean).join(' · ')

  return <div className="quick-view-summary">
    <header className="quick-view-identity">
      <span className="avatar-sm" aria-hidden="true">{initials(candidate.full_name)}</span>
      <div>
        <strong>{candidate.full_name}</strong>
        <span className="muted">{candidate.current_position||NOT_RECORDED}{candidate.current_company?` at ${candidate.current_company}`:''}</span>
      </div>
    </header>

    {/* One context line, not a second copy of the row. The table already shows pipeline, stage and
      * next action in columns that never drop; repeating them here is what made the old pane feel
      * like it was showing everything at once. */}
    {contextLine&&<p className="quick-view-context" title={contextLine}>{contextLine}</p>}

    <dl className="quick-view-facts">
      <div><dt>Status</dt><dd>{facets.lifecycle
        ?<StatusBadge map={candidateStatus} value={facets.lifecycle}/>
        :<span>{facets.posture||'—'}</span>}</dd></div>
      <div><dt>Availability</dt><dd>{facets.availabilityLabel||<span className="muted">Not set</span>}</dd></div>
      <div><dt>Location</dt><dd>{candidate.location?<span className="inline-stat"><MapPin size={13}/>{candidate.location}</span>:NOT_RECORDED}</dd></div>
      <div><dt>Owner</dt><dd>{candidate.owner_name||'Unassigned'}</dd></div>
      <div><dt>Source</dt><dd>{candidate.source||NOT_RECORDED}</dd></div>
    </dl>

    {/* Skills and tags are truncated to two in the table row to keep the column narrow. The drawer has
      * the width to show the set, which is most of the reason to open it before the record. */}
    <section className="quick-view-section">
      <h3>Skills</h3>
      {candidate.skill_names.length
        ?<div className="chip-row">{candidate.skill_names.map((skill)=><Badge key={skill} tone="neutral">{skill}</Badge>)}</div>
        :<p className="muted">No skills tagged.</p>}
    </section>

    {candidate.tag_names.length>0&&<section className="quick-view-section">
      <h3>Tags</h3>
      <div className="chip-row">{candidate.tag_names.map((tag)=><Badge key={tag} tone="info">{tag}</Badge>)}</div>
    </section>}

    {/* What is missing, and where it is fixed.
      *
      * This is the whole point of the Needs enrichment queue having reasons rather than a count: the
      * consultant sees the exact gap and a link straight to the part of the record that closes it,
      * instead of opening the full record and hunting for what the queue objected to.
      *
      * Each row is the RULE, not the value. `missing_contact_method` says a way to reach them is
      * absent -- it never renders an email or a phone, which are not in the search row at all, and it
      * is not produced by the server for a member without candidates_private.read. */}
    {candidate.quality_issue_codes.length>0&&<section className="quick-view-section quick-view-issues">
      <h3>Needs enrichment</h3>
      <ul>
        {candidate.quality_issue_codes.map((code)=>{
          const definition=qualityIssueDefinition(code)
          return <li key={code}>
            <span className="quick-view-issue-label"><TriangleAlert size={13}/>{definition.label}</span>
            <span className="cell-quiet">{definition.reason}</span>
            <Link className="record-link" to={issueFixHref(organizationSlug,candidate.id,code)}>{definition.action}</Link>
          </li>
        })}
      </ul>
    </section>}

    {/* Stated rather than left as an absence, so nobody reads a quick view with no salary as a
      * candidate with no salary recorded. */}
    <p className="quick-view-note muted">Contact details and salary are on the full record.</p>
  </div>
}

/* Whether the browser will render this inline. Only PDFs get an embedded preview: a DOCX in an
 * <iframe> is a download prompt in Chrome and a blank frame in Safari, which reads as a broken
 * preview rather than as "this format needs an app". Those get the ordinary open action instead. */
const isPdf=(mimeType:string)=>mimeType==='application/pdf'

function CvTab({candidateId}:{candidateId:string}){
  const {organization}=useOrganization()
  /* The same key CandidateDetailPage uses, so opening the record after previewing here reuses the
   * signed URLs already fetched instead of asking for a second set. */
  const documents=useQuery({queryKey:['candidate-documents',organization?.id,candidateId],
    enabled:Boolean(organization),queryFn:()=>listCandidateDocuments(organization!.id,candidateId)})
  if(documents.isLoading)return <LoadingState label="Loading documents…"/>
  if(documents.error)return <ErrorState error={documents.error} retry={()=>void documents.refetch()}/>
  const files=documents.data||[]
  if(files.length===0)return <EmptyState title="No CV uploaded"
    description="Upload a CV on the full record. This candidate also appears in the Needs enrichment queue."/>
  const preview=files.find((file)=>isPdf(file.mime_type)&&file.signedUrl)
  return <div className="quick-view-cv">
    <ul className="quick-view-file-list">
      {files.map((file)=><li key={file.id}>
        <span className="quick-view-file-name"><FileText size={14}/>{file.original_filename||file.file_name}</span>
        <span className="quick-view-file-meta">
          {file.document_type==='candidate_profile'?'Client profile · ':''}{Math.ceil(file.size_bytes/1024)} KB
        </span>
        {/* A signed URL can be absent when storage declines to sign it. Saying so beats an anchor
          * with href="undefined" that navigates to the app's own route and looks like a crash. */}
        {file.signedUrl
          ?<a className="button button-secondary button-sm" href={file.signedUrl} target="_blank" rel="noreferrer">Open</a>
          :<span className="muted">Unavailable</span>}
      </li>)}
    </ul>
    {preview&&<iframe className="quick-view-cv-frame" src={preview.signedUrl}
      title={`Preview of ${preview.original_filename||preview.file_name}`}/>}
  </div>
}
