/* Seeding the interview-notes box from debriefs already in the activity feed.
 *
 * The consultant who just interviewed someone has usually already written what they learned as a
 * call or meeting activity. Asking them to type it a second time is how an optional field ends up
 * permanently empty, so the box starts from what is already recorded and is edited from there.
 *
 * Pure functions only, so the selection rules are testable without a query.
 */

/* Matches the CHECK on candidate_profile_versions.interview_notes and the cap the edge function
 * applies. Declared here because the form has to show a counter against the same number. */
export const MAX_INTERVIEW_NOTES=4000

/* Only the activity types that represent actually speaking to the candidate. An email or a generic
 * 'other' entry is far more likely to be logistics ("sent the brief", "chased for a CV") than an
 * observation about the person, and seeding the box with those trains consultants to clear it. */
const INTERVIEW_ACTIVITY_TYPES=new Set(['call','meeting'])

/* Enough to cover a screen and a follow-up without pasting a quarter of relationship history into a
 * prompt. The consultant can always add more by hand. */
const MAX_SEEDED_ACTIVITIES=3

export interface NoteSourceActivity {
  activity_type?:string|null
  subject?:string|null
  summary?:string|null
  occurred_at?:string|null
}

export function interviewNotesFromActivities(activities:readonly NoteSourceActivity[]):string{
  const relevant=activities
    .filter((activity)=>INTERVIEW_ACTIVITY_TYPES.has(String(activity.activity_type||''))&&String(activity.summary||'').trim())
    // Most recent first: if the cap bites, the newest conversation is the one that survives.
    .sort((left,right)=>String(right.occurred_at||'').localeCompare(String(left.occurred_at||'')))
    .slice(0,MAX_SEEDED_ACTIVITIES)

  const blocks=relevant.map((activity)=>{
    const summary=String(activity.summary).trim()
    const subject=String(activity.subject||'').trim()
    // The subject is a useful label ("Second interview") but is often just the activity type again,
    // so it is only prepended when it adds something the summary does not already open with.
    return subject&&!summary.toLowerCase().startsWith(subject.toLowerCase())?`${subject}: ${summary}`:summary
  })

  return blocks.join('\n\n').slice(0,MAX_INTERVIEW_NOTES)
}
