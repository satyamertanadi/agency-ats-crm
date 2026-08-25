/* What a data-quality issue means, and what to do about it.
 *
 * The rules themselves are NOT here. public.candidate_quality_issues owns them, because the queue
 * predicate, the summary counts and the per-row codes all have to be the same answer -- a second
 * copy in TypeScript would be a second answer, and the two would diverge the first time a rule moved.
 * Everything below takes a code the database returned and says what it means, where it is fixed, and
 * how to say it in a sentence.
 *
 * There is deliberately no score and no completeness percentage. A score says a record is worse
 * without saying what is wrong, which is the opposite of the thing this screen exists to provide; and
 * a number that goes up when you fill in a portfolio URL quietly teaches people that filling in
 * fields is the goal. More fields filled does not automatically mean better data -- sometimes it only
 * means a more confidently decorated void.
 */

/** Must match the arms of public.candidate_quality_issues, in the same order. */
export type QualityIssue='missing_role'|'missing_location'|'missing_skills'|'missing_cv'|'missing_contact_method'

export interface QualityIssueDefinition{
  id:QualityIssue
  /** The gap, named as a thing that is absent. Used on the chip and in the summary strip. */
  label:string
  /** Why it stops the record being usable. Shown as the chip's title, and in Quick View. */
  reason:string
  /** The tab on the full record where this is actually fixed. */
  tab:'overview'|'profile'|'documents'
  /** The verb, for the link into that tab. */
  action:string
}

/* Ordered as the SQL builds the array, so a row's chips and the summary strip read in the same
 * sequence and neither has to sort. */
export const qualityIssues:readonly QualityIssueDefinition[]=[
  {id:'missing_role',label:'No current role',tab:'overview',action:'Add their role',
    reason:'Without a current title there is nothing to match against a vacancy, and a client profile would go out blank.'},
  {id:'missing_location',label:'No location',tab:'overview',action:'Add a location',
    reason:'Location decides which searches this candidate can appear in at all.'},
  {id:'missing_skills',label:'No skills tagged',tab:'profile',action:'Tag their skills',
    reason:'Skill search is how this person gets found for a role nobody has thought of them for yet.'},
  {id:'missing_cv',label:'No CV',tab:'documents',action:'Upload a CV',
    reason:'Nothing can be submitted to a client without one.'},
  {id:'missing_contact_method',label:'No way to reach them',tab:'overview',action:'Add contact details',
    reason:'Neither an email nor a phone number is recorded, so this record cannot be worked at all.'},
]

const byId=new Map(qualityIssues.map((issue)=>[issue.id as string,issue]))

/* An unrecognised code renders as itself rather than disappearing. The server can gain a rule before
 * this screen learns about it, and a chip reading "missing_visa" is more use to the consultant -- and
 * to whoever gets the bug report -- than a row that silently shows one fewer problem than it has. */
export const qualityIssueDefinition=(code:string):QualityIssueDefinition=>
  byId.get(code)??{id:code as QualityIssue,label:code,tab:'overview',action:'Open the record',
    reason:'This data-quality rule is newer than the screen showing it.'}

/** Narrows a raw `?issue=` to one we serve; anything else is no filter, matching the SQL's fail-closed
 *  CASE. Trimmed for the same reason parseQueue trims: the value that reaches the RPC must be one it
 *  can match. */
export function parseIssue(raw:string|null|undefined):QualityIssue|null{
  const value=(raw||'').trim()
  return byId.has(value)?value as QualityIssue:null
}

export const issueLabel=(code:string|null|undefined)=>code?qualityIssueDefinition(code).label:null

/** Where the fix is made. Kept next to the definitions so a new issue cannot be added without one. */
export const issueFixHref=(organizationSlug:string,candidateId:string,code:string)=>
  `/app/${organizationSlug}/candidates/${candidateId}?tab=${qualityIssueDefinition(code).tab}`
