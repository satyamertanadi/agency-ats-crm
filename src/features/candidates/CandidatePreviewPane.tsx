import {MapPin} from 'lucide-react'
import {Link} from 'react-router'
import {candidateStatus} from '../../shared/lib/status'
import {initials} from '../../shared/lib/format'
import {Badge,StatusBadge} from '../../shared/ui/Page'
import {Button} from '../../shared/ui/Button'
import type {CandidateSearchRow} from '../../shared/types/domain'
import {followUpSignal,pipelineSignal,statusFacets} from './candidateRowSignals'

/* Who the keyboard is currently on, beside the list rather than after a navigation.
 *
 * Deciding whether a candidate is worth opening used to cost a round trip: click into the record,
 * read four fields, come back, lose your place. This shows those fields next to the row.
 *
 * Two constraints shape what it may contain:
 *
 * 1. It is fed entirely from the row already in the list query -- no fetch of its own. Moving through
 *    the list with j/k must not fire a request per keystroke, and a pane that loaded would spend the
 *    whole review flickering between skeletons.
 * 2. No private data. Email, phone and salary live behind the candidates_private permission and are
 *    not in the list row at all; the page's own description promises the list does not expose them.
 *    "Open full record" is the door to those, where the permission is actually checked.
 *
 * Hidden below 1440px in CSS, and when the user collapses it, rather than unmounted here: there is no
 * behaviour to fork. j/k still moves the row, Enter still opens the record. The pane is additive
 * display, so a narrow screen simply does not show it and the page behaves exactly as it did.
 *
 * 1440, not the 1024 this originally shipped with: at 1024 the sidebar plus this pane left the table
 * about 436px, which is why the identity column wrapped to three lines and Status was clipped.
 */
export function CandidatePreviewPane({candidate,organizationSlug,onAddToJob,canAddToJob}:{
  candidate:CandidateSearchRow|null
  organizationSlug:string
  onAddToJob:(candidate:CandidateSearchRow)=>void
  canAddToJob:boolean
}){
  if(!candidate)return <aside className="candidate-preview candidate-preview-empty" aria-label="Candidate preview">
    <p className="muted">Choose a candidate to see their details here.</p>
    {/* The pane is also where the keyboard model becomes discoverable: a consultant who never opens
      * the shortcut sheet still learns j/k from sitting here. */}
    <p className="candidate-preview-hint"><kbd>j</kbd><kbd>k</kbd> move · <kbd>↵</kbd> open · <kbd>x</kbd> select</p>
  </aside>

  const unavailable=candidate.status==='do_not_contact'||candidate.status==='archived'
  // One clock per render, for the same reason the table keeps one: two facts about the same
  // candidate must not disagree about what "today" is.
  const now=new Date()
  const pipeline=pipelineSignal(candidate,now)
  const followUp=followUpSignal(candidate,now)
  const facets=statusFacets(candidate)
  /* "Plant Engineering Manager · Screening · 6d" -- role, where they are, how long. Assembled from
   * whichever parts exist rather than padded with placeholders, so a candidate in no pipeline gets a
   * shorter line instead of a line full of "Not recorded". */
  const contextLine=[
    candidate.current_position||null,
    pipeline.inPipeline?pipeline.stageLabel||pipeline.jobTitle:null,
    followUp.state==='overdue'||followUp.state==='today'?followUp.dueLabel:null,
  ].filter(Boolean).join(' · ')
  return <aside className="candidate-preview" aria-label={`Preview of ${candidate.full_name}`}>
    <header className="candidate-preview-header">
      <span className="avatar-sm" aria-hidden="true">{initials(candidate.full_name)}</span>
      <div>
        <strong>{candidate.full_name}</strong>
        <span className="muted">{candidate.current_position||'Role not recorded'}{candidate.current_company?` at ${candidate.current_company}`:''}</span>
      </div>
    </header>

    {/* One context line, not a second copy of the row.
      *
      * This used to repeat Pipeline, Stage, Last activity and Next action as their own rows -- all of
      * which the table already shows, in columns that never drop. Two renderings of the same facts,
      * side by side, is what made the screen feel like it was showing everything at once. What is
      * genuinely useful is orientation: enough to confirm the pane is describing the row your eye
      * just left. Hence one line, and the detail stays where it already was.
      *
      * Built from open_job_count, so a member without jobs.read gets the plain role rather than a
      * half-built line claiming a stage. */}
    {contextLine&&<p className="candidate-preview-context" title={contextLine}>{contextLine}</p>}

    <dl className="candidate-preview-facts">
      <div><dt>Status</dt><dd>{facets.lifecycle
        ?<StatusBadge map={candidateStatus} value={facets.lifecycle}/>
        :<span>{facets.posture||'—'}</span>}</dd></div>
      <div><dt>Availability</dt><dd>{facets.availabilityLabel||<span className="muted">Not set</span>}</dd></div>
      <div><dt>Location</dt><dd>{candidate.location?<span className="inline-stat"><MapPin size={13}/>{candidate.location}</span>:'Not recorded'}</dd></div>
      <div><dt>Owner</dt><dd>{candidate.owner_name||'Unassigned'}</dd></div>
      <div><dt>Source</dt><dd>{candidate.source||'Not recorded'}</dd></div>
    </dl>

    {/* Skills and tags are truncated to two in the table row to keep the column narrow. The pane has
      * the width to show the set, which is most of the reason to look at it before opening. */}
    <section className="candidate-preview-section">
      <h3>Skills</h3>
      {candidate.skill_names.length
        ?<div className="chip-row">{candidate.skill_names.map((skill)=><Badge key={skill} tone="neutral">{skill}</Badge>)}</div>
        :<p className="muted">No skills tagged.</p>}
    </section>

    {candidate.tag_names.length>0&&<section className="candidate-preview-section">
      <h3>Tags</h3>
      <div className="chip-row">{candidate.tag_names.map((tag)=><Badge key={tag} tone="info">{tag}</Badge>)}</div>
    </section>}

    <footer className="candidate-preview-actions">
      {canAddToJob&&<Button size="sm" variant="secondary" disabled={unavailable}
        onClick={()=>onAddToJob(candidate)}>Add to job</Button>}
      <Link className="button button-quiet button-sm" to={`/app/${organizationSlug}/candidates/${candidate.id}`}>Open full record</Link>
    </footer>
    {/* Stated rather than left as an absence, so nobody reads a preview with no salary as a candidate
      * with no salary recorded. */}
    <p className="candidate-preview-note muted">Contact details and salary are on the full record.</p>
  </aside>
}
