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
export const workspaceSubtitle=({simplified,readOnly}:{simplified:boolean;readOnly?:boolean})=>
  readOnly?'Read-only workspace':simplified?'Recruitment workspace':'Agency operations'
