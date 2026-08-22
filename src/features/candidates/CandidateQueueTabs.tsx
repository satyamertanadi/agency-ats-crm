import type {CandidateQueue} from '../core/repository'
import {candidateQueues} from './candidateQueues'

/* The workflow control the page was missing.
 *
 * Filters answer "which candidates match these attributes". These answer "what needs doing", which is
 * the question a consultant actually opens the screen with -- and which eight dropdowns behind a
 * collapsed disclosure could not express at all.
 *
 * Two axes on one strip, kept visually distinct because they compose rather than replace each other:
 *
 *   queue -- exactly one at a time, radio semantics, writes ?queue=
 *   mine  -- an independent toggle, writes the existing ?owner= filter
 *
 * "Mine" is deliberately NOT a seventh tab. As a tab it would be mutually exclusive with the others,
 * making "my overdue follow-ups" -- the single most useful view on the page -- inexpressible. As a
 * toggle it combines with any queue. It sets the owner filter that already existed, so it also stays
 * consistent with the owner dropdown and its chip rather than becoming a second way to say the same
 * thing.
 *
 * A tablist rather than links: this changes what the list shows, it does not navigate. Roving
 * tabindex would fight the j/k row navigation that owns the arrow keys on this page, so every tab
 * stays focusable and selection is carried by aria-pressed/aria-checked on each control. */
export function CandidateQueueTabs({queue,mine,mineAvailable,onQueue,onMine}:{
  queue:CandidateQueue|null
  mine:boolean
  /** False when we cannot resolve who "me" is -- the toggle is hidden rather than shown inert. */
  mineAvailable:boolean
  onQueue:(next:CandidateQueue|null)=>void
  onMine:(next:boolean)=>void
}){
  return <div className="queue-tabs" role="group" aria-label="Candidate views">
    <div className="queue-tab-set" role="radiogroup" aria-label="Queue">
      <button type="button" role="radio" aria-checked={queue===null}
        className={`queue-tab${queue===null?' queue-tab-active':''}`}
        onClick={()=>onQueue(null)}>All</button>
      {candidateQueues.map((definition)=>
        <button key={definition.id} type="button" role="radio" aria-checked={queue===definition.id}
          className={`queue-tab${queue===definition.id?' queue-tab-active':''}`}
          /* The rule, one hover away. A queue whose definition is invisible cannot be trusted:
           * you cannot tell an excluded candidate from a missing one. */
          title={definition.rule}
          onClick={()=>onQueue(definition.id)}>{definition.label}</button>)}
    </div>
    {mineAvailable&&<button type="button" aria-pressed={mine}
      className={`queue-tab queue-tab-mine${mine?' queue-tab-active':''}`}
      title="Only candidates you own. Combines with any queue."
      onClick={()=>onMine(!mine)}>Mine</button>}
  </div>
}
