/* The product's nouns, decided once.
 *
 * status.ts owns the wording of every domain STATUS. This owns the wording of the product's own
 * chrome -- the words that are not values from a row.
 *
 * It exists because the sidebar and the topbar each computed the workspace subtitle with their own
 * inline ternary over the same flag, and disagreed: the sidebar rendered "Recruitment workspace"
 * while the topbar rendered "Consultant workspace", on the same screen, for the same user. Nobody
 * chose that -- it is simply what two copies of one decision do once one of them is edited.
 *
 * Recruitment software is largely a language interface. A term that changes between two adjacent
 * elements is not a cosmetic slip; it makes a reader wonder whether the two are different things.
 */

/* The one term for "the place a consultant works". Read-only is a genuinely different state and so
 * says so; the rest is one word for one concept.
 *
 * 'Recruitment workspace' over 'Consultant workspace' names the domain rather than the seat: it is
 * still true when an admin or a researcher is the one looking at it. */
export const workspaceSubtitle=({readOnly}:{readOnly?:boolean}={})=>
  readOnly?'Read-only workspace':'Recruitment workspace'

/* The one phrase for "this record does not carry that fact".
 *
 * The product had at least five: "None", "None set", "Not set", an em dash, "Industry not recorded",
 * "Availability not set", "No follow-up set", "Role not recorded". A reader cannot tell whether four
 * different phrasings mean four different things -- does "None" mean the value is empty, and "Not
 * set" mean nobody has looked yet? -- so they end up meaning nothing, which is worse than either.
 *
 * "Not recorded" is the wording because it is true in both cases the product actually has: the fact
 * is genuinely absent, OR the viewer's permissions hid it (several list RPCs are security invoker and
 * return nulls rather than erroring -- see candidateRowSignals). "None" would be a claim about the
 * data that this app is not always in a position to make.
 *
 * Deliberately NOT applied to the cases where the absence has its own meaning and its own action:
 * "Unassigned" (an ownership gap with a queue behind it), "No follow-up set" (the thing the Next
 * action column exists to prompt) and "Empty pipeline" all say something more specific than "not
 * recorded", and flattening them would lose the distinction rather than tidy it. */
export const NOT_RECORDED='Not recorded'
