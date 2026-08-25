/* Whether a click on a candidate row landed on something that already means something.
 *
 * Making the row itself open Quick View is the cheapest entry point there is -- no menu, no
 * shortcut to learn, just press the person you were already reading. The cost is that a row is not a
 * leaf: it contains the link to the record, the selection checkbox and the row menu, and every one
 * of those is a click the user aimed somewhere specific. A row handler with no guard swallows all
 * three, and the failure is silent -- the drawer opens, the intended action does not happen, and
 * nothing on screen says why.
 *
 * Matched by tag and role rather than by "did this event bubble from a child", because the useful
 * click target IS a child: the empty space inside a <td> beside the text. `closest` walks up from the
 * exact element pressed, so a click on the <strong> inside the record link still resolves to the
 * anchor above it.
 *
 * `label` is in the list because a checkbox's label forwards its own click to the input; without it
 * the row would open on the way past. `[role="button"]`/`[role="menuitem"]`/`[role="checkbox"]` cover
 * controls built from non-button elements -- the Menu trigger renders a real <button> today, but a
 * predicate that only holds while that stays true is a predicate that breaks quietly.
 */
export const ROW_INTERACTIVE='a,button,input,select,textarea,label,[role="button"],[role="menuitem"],[role="checkbox"]'

export function isRowInteractive(target:EventTarget|null):boolean{
  const element=target as HTMLElement|null
  return Boolean(element?.closest?.(ROW_INTERACTIVE))
}
