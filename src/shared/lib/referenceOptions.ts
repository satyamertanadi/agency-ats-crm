/* Keeping a record's CURRENT value selectable, even when the option list does not contain it.
 *
 * The failure this exists to prevent is silent and destructive. A `<select defaultValue={x}>` whose
 * options do not include `x` does not stay empty and does not warn -- the browser falls back to the
 * FIRST option. Save the form and you have written a different value than the one displayed a moment
 * earlier. On the contact record that meant a contact being reassigned to a different client, with a
 * success toast, because the list feeding the picker is capped at 1,000 companies and theirs was not
 * in it.
 *
 * This is the same rule optionSet.options() already applies to the curated text vocabularies, and for
 * the same stated reason -- "an unrecognised current value PREPENDED so editing a record can never
 * silently discard what a colleague or an import already wrote". That rule was right; it just never
 * covered the pickers backed by entity tables rather than by a fixed vocabulary.
 *
 * Correct at any table size, and costs no extra query: the record being edited already carries its
 * own reference (contacts embed `companies(id,name)`), so the value is in hand before the list loads.
 */
export interface ReferenceOption{id:string;name:string}

/** A reference the record already holds. `name` is optional because an embed can be permission-filtered
 *  to null under RLS -- in which case the option still has to exist, just without a friendly label. */
export interface CurrentReference{id?:string|null;name?:string|null}

export function withCurrentOption(
  options:readonly ReferenceOption[]|undefined,
  current:CurrentReference|null|undefined,
):ReferenceOption[]{
  const list=options?[...options]:[]
  const id=current?.id
  if(!id)return list
  if(list.some((option)=>option.id===id))return list
  /* Prepended rather than appended: it is the selected value, so it belongs where the eye lands, and
   * a `<select>` renders its selected option regardless of position anyway. The fallback label names
   * what is missing instead of rendering a bare uuid, which reads as corruption to a consultant. */
  return [{id,name:current?.name?.trim()||'Current selection (not in list)'},...list]
}
