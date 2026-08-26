/* Saying out loud what a `datetime-local` field actually means.
 *
 * The control renders in the VIEWER'S BROWSER LOCALE, from shadow DOM that cannot be restyled, and
 * it carries no timezone at all -- `2026-08-12T17:00` is a wall-clock reading with no zone attached.
 * `new Date(value)` then resolves it in the device's timezone, which is what gets stored.
 *
 * Two separate problems fall out of that, and this module addresses them by explaining rather than
 * by converting:
 *
 * 1. An en-US machine renders 08/09/2026, which half the world reads as 8 September and half as
 *    9 August. The layout of the control cannot be changed, so the resolved value is echoed back in
 *    words instead -- the same approach ScorecardPage already takes for its date range.
 *
 * 2. The workspace reports in its OWN timezone (organizations.timezone -- Asia/Makassar for this
 *    client), and a consultant travelling or working from a machine set to another zone will enter
 *    17:00 and have colleagues read something else. The preview states the stored instant as the
 *    workspace will see it, and says so explicitly when the two zones differ.
 *
 * Deliberately NOT a conversion. Reinterpreting the typed value into the workspace timezone would
 * change what the control means mid-flight -- the number under the cursor would stop being the
 * number saved -- and it would need a date picker to do honestly. The value continues to mean what
 * the browser says it means; this makes that visible instead of leaving it to be discovered.
 *
 * No dependency. Intl.DateTimeFormat is in every browser this app supports.
 */

/* The device zone is a PARAMETER with a default rather than something read inside, so a test can
 * state which zone it is asking about instead of mocking Intl -- and so a caller that already knows
 * (a stored interview timezone, say) can pass it. */
/** The device's own timezone, or null when the environment will not say. */
export function deviceTimeZone():string|null{
  try{return Intl.DateTimeFormat().resolvedOptions().timeZone||null}catch{return null}
}

/* `timeZoneName:'short'` gives WITA / GMT+8 / BST -- the abbreviation people actually say, which is
 * more use beside a time than the IANA identifier alone. */
function partsIn(instant:Date,timeZone:string){
  return new Intl.DateTimeFormat('en-GB',{
    timeZone,day:'numeric',month:'short',year:'numeric',
    hour:'2-digit',minute:'2-digit',hour12:false,timeZoneName:'short',
  }).format(instant)
}

/** Is this a timezone this runtime can format? An organisation row is free text and an import can
 *  put anything in it; an unknown zone must degrade to no preview rather than throwing under a form. */
export function isUsableTimeZone(timeZone:string|null|undefined):timeZone is string{
  if(!timeZone)return false
  try{new Intl.DateTimeFormat('en-GB',{timeZone});return true}catch{return false}
}

export interface DateTimePreview{
  /** The stored instant, written out in the workspace timezone. */
  text:string
  /** True when the device and the workspace disagree, which is the case worth pointing at. */
  differsFromDevice:boolean
}

/* Takes the raw `datetime-local` value, exactly as the input reports it.
 *
 * Returns null for an empty or unparseable value -- a half-typed date must not put an error under a
 * field somebody is still filling in.
 */
export function dateTimePreview(localValue:string|null|undefined,organizationTimeZone:string|null|undefined,device:string|null=deviceTimeZone()):DateTimePreview|null{
  const value=(localValue||'').trim()
  if(!value)return null
  /* Shape-checked before parsing, because Date is too forgiving to rely on here: V8 reads '2026-' as
   * the first of January 2026, so a field halfway through being typed would flash a confident
   * preview of a date nobody chose. A datetime-local input only ever emits '' or at least
   * YYYY-MM-DDTHH:mm, and the ISO instants the round-trip tests use share that prefix. */
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value))return null
  const instant=new Date(value)
  if(Number.isNaN(instant.getTime()))return null
  if(!isUsableTimeZone(organizationTimeZone))return null
  return {
    text:partsIn(instant,organizationTimeZone),
    /* Compared by identifier rather than by current offset. Two zones can share an offset today and
     * diverge in six months -- Europe/London and UTC are the same thing in January and an hour apart
     * in July -- and a hint that disappears seasonally is worse than one that is always there. */
    differsFromDevice:Boolean(device&&device!==organizationTimeZone),
  }
}

/** The sentence to put under the field. Names the workspace timezone always, and the device's own
 *  only when it differs -- otherwise it would be telling the reader something they already assumed. */
export function dateTimeHint(localValue:string|null|undefined,organizationTimeZone:string|null|undefined,device:string|null=deviceTimeZone()):string|null{
  const preview=dateTimePreview(localValue,organizationTimeZone,device)
  if(!preview)return isUsableTimeZone(organizationTimeZone)?`Workspace time: ${organizationTimeZone}`:null
  if(!preview.differsFromDevice)return `Saved as ${preview.text}`
  return `Saved as ${preview.text} — your device is set to ${device}`
}
