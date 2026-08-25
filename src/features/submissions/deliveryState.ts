import type {DeliveryWorkbenchRow} from '../../shared/types/domain'

/* How the delivery states READ. Not how they are decided.
 *
 * The ladder itself lives in public.submission_delivery_state (20260826000000) and nowhere else,
 * because the list has to be filtered and ordered by it on the server -- a second copy here would be
 * a second answer to "is this waiting or late", and the two would diverge the first time the
 * threshold moved. Everything in this module takes the state the database returned and says what it
 * means and what to do about it.
 *
 * The one number repeated here is the waiting threshold, and only so the UI can explain itself in
 * words. It is asserted against the migration in deliveryState.test.ts.
 */

/** Must match the arms of public.submission_delivery_state. */
export type DeliveryState='failed'|'link_unavailable'|'feedback_received'|'awaiting_feedback'|'not_opened'|'waiting'|'handled'

/** Must match public.submission_delivery_waiting_days(). */
export const DELIVERY_WAITING_DAYS=3

export interface DeliveryStateDefinition{
  id:DeliveryState
  label:string
  /* Colour carries state, never decoration -- the rule the rest of the product follows. 'bad' is
   * reserved for the two states where the client cannot act at all. */
  tone:'bad'|'warn'|'info'|'good'|'neutral'
  /** The rule, in plain words, shown as the cell's title. A state whose definition lives only in SQL
   *  is a state nobody can trust: the reader cannot tell whether a row is here for the reason they
   *  think it is. */
  rule:string
}

export const deliveryStates:readonly DeliveryStateDefinition[]=[
  {id:'failed',label:'Email failed',tone:'bad',
    rule:'The submission email bounced, failed or was suppressed, so the client never received it.'},
  {id:'link_unavailable',label:'Link unavailable',tone:'bad',
    rule:'The review link was revoked or expired before the client answered.'},
  {id:'feedback_received',label:'Feedback received',tone:'info',
    rule:'The client answered and nobody has recorded acting on it yet.'},
  {id:'awaiting_feedback',label:'Awaiting feedback',tone:'warn',
    rule:`Opened ${DELIVERY_WAITING_DAYS} or more days ago with no answer.`},
  {id:'not_opened',label:'Not opened',tone:'warn',
    rule:`Sent ${DELIVERY_WAITING_DAYS} or more days ago and never opened.`},
  {id:'waiting',label:'Waiting',tone:'neutral',
    rule:`Sent less than ${DELIVERY_WAITING_DAYS} days ago. Nothing is wrong yet.`},
  {id:'handled',label:'Handled',tone:'good',
    rule:'The answer was marked handled, or the package was closed.'},
]

const byState=new Map(deliveryStates.map((state)=>[state.id as string,state]))

/* An unknown state renders as itself rather than as a blank cell or a crash. The server can ship a
 * new arm before this file learns about it, and a row that says "escalated" is more useful to the
 * reader -- and to whoever gets the bug report -- than an empty column. */
export const deliveryStateDefinition=(state:string):DeliveryStateDefinition=>
  byState.get(state)??{id:state as DeliveryState,label:state,tone:'neutral',rule:'This state is newer than the screen showing it.'}

/* The quick views. Each is one value of ?deliveryState=, resolved server-side -- see the CASE in
 * list_delivery_workbench. The names are deliberately about what the consultant intends to do, not
 * about the underlying state: "needs attention" is the working set, and which five states make it up
 * is a detail of the ladder, not a question the reader should have to hold. */
export type DeliveryQuickView='needs_attention'|'waiting'|'feedback_received'|'handled'|'all'

export interface DeliveryQuickViewDefinition{id:DeliveryQuickView;label:string;description:string}

export const deliveryQuickViews:readonly DeliveryQuickViewDefinition[]=[
  {id:'needs_attention',label:'Needs attention',
    description:'Failed, unavailable, answered but not handled, or waiting too long.'},
  {id:'waiting',label:'Waiting',description:`Sent within the last ${DELIVERY_WAITING_DAYS} days.`},
  {id:'feedback_received',label:'Feedback received',description:'The client answered and nobody has acted on it yet.'},
  {id:'handled',label:'Handled',description:'Marked handled, or the package was closed.'},
  {id:'all',label:'All',description:'Everything that has been sent to a client.'},
]

const quickViewIds=new Set(deliveryQuickViews.map((view)=>view.id as string))

/* Narrowed rather than passed through, exactly as parseQueue does for the candidate queues: an
 * unrecognised ?deliveryState= becomes the default rather than a tab that looks active but is not
 * one of ours. The server treats an unknown value as "all", so a typo shows everything -- this makes
 * the tab strip agree with that instead of showing nothing selected. */
export function parseDeliveryQuickView(raw:string|null|undefined):DeliveryQuickView{
  const value=(raw||'').trim()
  return quickViewIds.has(value)?value as DeliveryQuickView:'needs_attention'
}

/* What the row is FOR. Every row in an operational queue has to answer "and now what", or it is a
 * report with buttons.
 *
 * Deterministic from the state alone, so two rows in the same state never offer different actions --
 * and derived, never stored, so it cannot contradict the state beside it.
 *
 * `permission` names what the action needs. 'read' actions are always offered; the two that reach
 * outside the workspace, and the one that writes, need submissions.write. */
export type DeliveryActionKind='open_candidate'|'retry_email'|'resend_link'|'mark_handled'|'reopen'|'open_job'

export interface DeliveryAction{kind:DeliveryActionKind;label:string;needsWrite:boolean}

export function deliveryAction(row:Pick<DeliveryWorkbenchRow,'delivery_state'|'email_delivery_id'|'feedback_id'>):DeliveryAction{
  switch(row.delivery_state){
    /* Retry only when there is a delivery row to retry. A failure recorded with no delivery id is
     * not retryable through send-submission, and offering a button that cannot run is worse than
     * offering none -- the fix there is a fresh link from the composer. */
    case 'failed':return row.email_delivery_id
      ?{kind:'retry_email',label:'Retry email',needsWrite:true}
      :{kind:'resend_link',label:'Send a fresh link',needsWrite:true}
    // Revoked and expired are both fixed the same way, and neither is fixed here: the composer owns
    // sending, and a second send form would be a second set of defaults to keep in step with it.
    case 'link_unavailable':return {kind:'resend_link',label:'Send a fresh link',needsWrite:true}
    case 'feedback_received':return {kind:'mark_handled',label:'Mark handled',needsWrite:true}
    case 'handled':return {kind:'reopen',label:'Reopen',needsWrite:true}
    /* Chasing is a conversation, not a button. The useful next step for a client who has not
     * answered is to open the candidate in the job and act there -- which is also where the
     * consultant can see what they actually sent. */
    default:return {kind:'open_candidate',label:'Open candidate',needsWrite:false}
  }
}
