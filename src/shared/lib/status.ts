import type {
  AccountStatus, BusinessDevelopmentStage, CalendarConnectionStatus, CalendarSyncStatus,
  CandidateStatus, ContactStatus, DeliveryStatus, FeedbackDecision, ImportStatus, InterviewStatus,
  InvoiceStatus, JobPriority, JobStatus, MemberStatus, OfferStatus, PilotStatus, PlacementStatus,
  ProfileStatus, SubmissionPackageStatus, TaskPriority, TaskStatus, TodayWorkKind,
} from '../types/domain'

/* The vocabulary layer: every domain status decides its colour and its wording HERE, once.
 *
 * Before this, each call site bound status to tone with its own ternary, which is why the same
 * concept disagreed with itself across the app -- and why PlacementsPage rendered EVERY placement
 * green, including 'failed_guarantee' and 'cancelled'. A ternary's trailing branch is a silent
 * default; a map is a decision you can read.
 *
 * Why a map per entity rather than one global status->tone table: the same word means different
 * things depending on what it is attached to. 'cancelled' is neutral on an interview (it just did
 * not happen) but bad on a placement (revenue lost). 'failed' is bad on an import but merely
 * informational on a delivery retry. One table would have to pick one, and would be wrong half the
 * time.
 *
 * Tone semantics, applied consistently below:
 *   good    - a desirable terminal state (open, accepted, paid, placed)
 *   info    - in flight, going well, no action needed (presented, sent, filled)
 *   warn    - needs a human eventually (on_hold, overdue-soon, missing CV)
 *   bad     - a loss or a failure someone should look at (declined, failed, do_not_contact)
 *   neutral - inert. Drafts, and states that are over without being a loss (closed, withdrawn).
 *
 * Two facts about one identity (a candidate's lifecycle status AND their pipeline stage, say) are not
 * duplicates and both may be real -- but they should not both render as a full StatusBadge next to
 * each other. Pick whichever currently blocks or explains the next action as the badge; the other
 * fact stays as plain text beside it. Two badges of equal weight reads as "we were not sure which
 * one mattered," which is the opposite of what a badge is for.
 */
/* The five tonal roles, each backed by a --tone-*-{bg,fg,border} triplet in tokens.css. Lives here
 * rather than beside Badge so the dependency runs one way (ui -> lib): this module is where meaning
 * is mapped onto a tone, and Badge is one consumer of the result. */
export type Tone='neutral'|'good'|'warn'|'bad'|'info'
export type StatusMeta={tone:Tone;label:string}

/* Enforces that the map covers the union exactly -- omit a status and this is a compile error.
 * That is the whole point of narrowing the types in domain.ts. */
const map=<T extends string>(entries:Record<T,StatusMeta>)=>entries

/* Every read goes through here, never `someMap[value]` directly.
 *
 * This is not defensive padding, it is load-bearing: the repositories return
 * `data as unknown as X[]` (see the note in domain.ts), and a double cast through `unknown` checks
 * nothing. So a status union is a claim about the DB, not a guarantee from it -- if a migration adds
 * a value and nobody updates the union, that value still arrives here at runtime. The fallback
 * renders it readably ('not_requested' -> 'not requested') instead of showing an empty badge. */
export const lookup=(entries:Partial<Record<string,StatusMeta>>,value:string|null|undefined):StatusMeta=>
  (value&&entries[value])||{tone:'neutral',label:value?value.replaceAll('_',' '):'unknown'}

export const jobStatus=map<JobStatus>({
  draft:{tone:'neutral',label:'Draft'},
  open:{tone:'good',label:'Open'},
  on_hold:{tone:'warn',label:'On hold'},
  filled:{tone:'info',label:'Filled'},
  cancelled:{tone:'neutral',label:'Cancelled'},
  closed:{tone:'neutral',label:'Closed'},
})

/* jobs.priority has no CHECK constraint (migration :255 is a bare `text not null default 'normal'`),
 * so unlike every other map here this one is genuinely open at runtime. lookup()'s fallback is what
 * carries an unexpected value; the union is only our best understanding of what the app writes. */
export const jobPriority=map<JobPriority>({
  low:{tone:'neutral',label:'Low'},
  normal:{tone:'neutral',label:'Normal'},
  high:{tone:'warn',label:'High'},
  urgent:{tone:'bad',label:'Urgent'},
})

export const accountStatus=map<AccountStatus>({
  prospect:{tone:'info',label:'Prospect'},
  active_client:{tone:'good',label:'Active client'},
  inactive:{tone:'neutral',label:'Inactive'},
  do_not_contact:{tone:'bad',label:'Do not contact'},
})

/* The second axis on a client, and the reason 'Inactive' sitting beside 'Lost' is not a
 * contradiction: accountStatus is what the relationship IS now, businessDevelopmentStage is how the
 * last commercial pursuit ENDED. A dormant account whose last deal was lost is honestly both. The
 * client page labels them so that reads as deliberate rather than as two disagreeing truths.
 *
 * The column has no CHECK (migration :112 is a bare `text not null default 'lead'`), but both writers
 * now go through set_company_bd_stage, which rejects anything outside these seven. This used to be a
 * different six -- qualified/proposal/negotiation -- while the BD board used qualifying/pitching/
 * negotiating/dormant and the RPC only accepted the board's list. The edit form bypassed the RPC with
 * a plain update, so each surface wrote stages the other could not represent and the board grew a
 * trailing column per stray value. One vocabulary now, the RPC's, because that is the one the database
 * actually enforces. lookup() still carries whatever an import left behind. */
export const businessDevelopmentStage=map<BusinessDevelopmentStage>({
  lead:{tone:'neutral',label:'Lead'},
  qualifying:{tone:'info',label:'Qualifying'},
  pitching:{tone:'info',label:'Pitching'},
  negotiating:{tone:'warn',label:'Negotiating'},
  won:{tone:'good',label:'Won'},
  lost:{tone:'bad',label:'Lost'},
  dormant:{tone:'neutral',label:'Dormant'},
})

/* Like jobPriority, not DB-constrained -- the contact form (RecordDetailPages.tsx:19) is the only
 * writer and offers exactly these three. */
export const contactStatus=map<ContactStatus>({
  active:{tone:'good',label:'Active'},
  inactive:{tone:'neutral',label:'Inactive'},
  do_not_contact:{tone:'bad',label:'Do not contact'},
})

export const candidateStatus=map<CandidateStatus>({
  active:{tone:'good',label:'Active'},
  passive:{tone:'info',label:'Passive'},
  placed:{tone:'good',label:'Placed'},
  do_not_contact:{tone:'bad',label:'Do not contact'},
  archived:{tone:'neutral',label:'Archived'},
})


export const offerStatus=map<OfferStatus>({
  draft:{tone:'neutral',label:'Draft'},
  presented:{tone:'info',label:'Presented'},
  accepted:{tone:'good',label:'Accepted'},
  declined:{tone:'bad',label:'Declined'},
  withdrawn:{tone:'neutral',label:'Withdrawn'},
})

export const interviewStatus=map<InterviewStatus>({
  scheduled:{tone:'info',label:'Scheduled'},
  completed:{tone:'good',label:'Completed'},
  cancelled:{tone:'neutral',label:'Cancelled'},
  no_show:{tone:'bad',label:'No show'},
})

/* 'failed_guarantee' is bad and 'cancelled' is a loss -- both rendered green before this map
 * existed, because PlacementsPage hardcoded tone="good" for every placement. */
export const placementStatus=map<PlacementStatus>({
  confirmed:{tone:'info',label:'Confirmed'},
  started:{tone:'good',label:'Started'},
  failed_guarantee:{tone:'bad',label:'Failed guarantee'},
  completed:{tone:'good',label:'Completed'},
  cancelled:{tone:'bad',label:'Cancelled'},
})

export const invoiceStatus=map<InvoiceStatus>({
  not_issued:{tone:'neutral',label:'Not issued'},
  draft:{tone:'neutral',label:'Draft'},
  issued:{tone:'info',label:'Issued'},
  overdue:{tone:'bad',label:'Overdue'},
  paid:{tone:'good',label:'Paid'},
  void:{tone:'neutral',label:'Void'},
})

export const taskStatus=map<TaskStatus>({
  open:{tone:'info',label:'Open'},
  in_progress:{tone:'info',label:'In progress'},
  completed:{tone:'good',label:'Completed'},
  cancelled:{tone:'neutral',label:'Cancelled'},
})

export const taskPriority=map<TaskPriority>({
  low:{tone:'neutral',label:'Low'},
  normal:{tone:'neutral',label:'Normal'},
  high:{tone:'warn',label:'High'},
  urgent:{tone:'bad',label:'Urgent'},
})

/* The client's verdict on a submitted candidate. 'interview' is the best outcome the review page can
 * produce and so reads as good, not merely informational -- a client asking to meet someone is the
 * point of the submission. 'hold' warns because it is the one answer that decays: it needs chasing,
 * and left alone it becomes a candidate quietly stuck in client review. */
export const feedbackDecision=map<FeedbackDecision>({
  interview:{tone:'good',label:'Wants to interview'},
  approve:{tone:'good',label:'Approved'},
  hold:{tone:'warn',label:'On hold'},
  reject:{tone:'bad',label:'Not progressing'},
})

/* A shortlist package's own life. 'shared' is in flight and going well, so it is info rather than
 * good -- the good outcome is the client answering, which is what 'reviewed' records. */
export const submissionPackageStatus=map<SubmissionPackageStatus>({
  draft:{tone:'neutral',label:'Draft'},
  shared:{tone:'info',label:'With the client'},
  reviewed:{tone:'good',label:'Client responded'},
  closed:{tone:'neutral',label:'Closed'},
})

export const importStatus=map<ImportStatus>({
  staged:{tone:'neutral',label:'Staged'},
  validating:{tone:'info',label:'Validating'},
  ready:{tone:'info',label:'Ready'},
  approved:{tone:'info',label:'Approved'},
  committing:{tone:'info',label:'Committing'},
  completed:{tone:'good',label:'Completed'},
  failed:{tone:'bad',label:'Failed'},
  rolled_back:{tone:'neutral',label:'Rolled back'},
})

/* 'not_requested' is the default for interviews nobody asked to sync, so it is inert rather than a
 * problem -- it appears on most rows and must not read as an error. */
export const calendarSyncStatus=map<CalendarSyncStatus>({
  not_requested:{tone:'neutral',label:'Not requested'},
  pending:{tone:'info',label:'Syncing'},
  synced:{tone:'good',label:'Synced'},
  failed:{tone:'bad',label:'Sync failed'},
  cancelled:{tone:'neutral',label:'Sync cancelled'},
})

export const calendarConnectionStatus=map<CalendarConnectionStatus>({
  connected:{tone:'good',label:'Connected'},
  reauthorization_required:{tone:'warn',label:'Reauthorization required'},
  disconnected:{tone:'neutral',label:'Disconnected'},
  error:{tone:'bad',label:'Error'},
})

export const deliveryStatus=map<DeliveryStatus>({
  pending:{tone:'neutral',label:'Pending'},
  sent:{tone:'info',label:'Sent'},
  delivered:{tone:'good',label:'Delivered'},
  failed:{tone:'bad',label:'Failed'},
  bounced:{tone:'bad',label:'Bounced'},
  suppressed:{tone:'warn',label:'Suppressed'},
})

export const memberStatus=map<MemberStatus>({
  invited:{tone:'info',label:'Invited'},
  active:{tone:'good',label:'Active'},
  suspended:{tone:'warn',label:'Suspended'},
})

export const profileStatus=map<ProfileStatus>({
  draft:{tone:'warn',label:'Draft'},
  finalized:{tone:'good',label:'Finalized'},
  failed:{tone:'bad',label:'Failed'},
})

/* Not a stored status but a derived urgency (see buildTodayWorkItems). It belongs here anyway: it was
 * a second vocabulary map living in TodayPage, which is exactly how "Needs attention" ends up meaning
 * one thing on the dashboard and something else everywhere else. */
export const todayWorkKind=map<TodayWorkKind>({
  blocked:{tone:'bad',label:'Needs attention'},
  overdue:{tone:'bad',label:'Overdue'},
  today:{tone:'warn',label:'Today'},
  upcoming:{tone:'info',label:'Upcoming'},
  recommended:{tone:'neutral',label:'Next step'},
})

/* 'active' means the workspace is live, so it gets no badge at all -- see pilotIndicator(). The
 * other five all mean "what you are looking at is not ordinary production data". */
export const pilotStatus=map<PilotStatus>({
  preparing:{tone:'warn',label:'Preparing'},
  uat:{tone:'warn',label:'UAT'},
  pilot:{tone:'warn',label:'Pilot data'},
  active:{tone:'good',label:'Active'},
  suspended:{tone:'bad',label:'Suspended'},
  closed:{tone:'bad',label:'Closed'},
})

/* Returns null for a live workspace so callers can render nothing. A pilot or UAT workspace holds
 * fictional records, and the whole point is that they must never be mistaken for real ones. */
export const pilotIndicator=(value:PilotStatus|null|undefined):StatusMeta|null=>
  !value||value==='active'?null:lookup(pilotStatus,value)

/* Invitation state is derived, not stored: the row carries accepted_at, revoked_at AND a
 * delivery_status, and which one wins is a precedence rule rather than a column lookup. It gets a
 * function instead of a map because there is no single field to key on. */
export const invitationState=(invitation:{accepted_at:string|null;revoked_at:string|null;delivery_status:string}):StatusMeta=>
  invitation.accepted_at?{tone:'good',label:'Accepted'}
  :invitation.revoked_at?{tone:'neutral',label:'Revoked'}
  :lookup(deliveryStatus,invitation.delivery_status)

/* How much damage can this action do, and can the user undo it?
 *
 * Everything destructive currently renders in the same red, so rolling back a committed import
 * (deletes rows, unrecoverable) looks exactly like cancelling an interview (sets a column, the
 * record survives). Two tiers, because the distinction users need is not "how alarming" but
 * "can I take this back":
 *   danger  - irreversible. Data is destroyed or a live credential dies. Red, and MUST confirm.
 *   caution - a reversible state change. Styled quietly: danger-coloured text on a secondary
 *             button, so it reads as available-but-not-routine rather than alarming.
 */
export type Severity='danger'|'caution'
