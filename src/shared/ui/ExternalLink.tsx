import {TriangleAlert} from 'lucide-react'
import {externalUrl} from '../lib/externalUrl'
import {NOT_RECORDED} from '../lib/labels'

/* A stored URL, rendered as a link only when it actually is one.
 *
 * See externalUrl.ts for what qualifies. When it does not, the value is shown as plain text with a
 * quiet correction flag rather than hidden: an imported record holding "ask Budi" in its website
 * column is a data-quality item somebody has to fix, and hiding it means it is never found. What must
 * NOT happen is presenting it as a trusted link -- which is what produced <a href="N/A"> on the client
 * detail page, resolving to a path on the ATS itself.
 *
 * `label` is for the cases where the URL itself is not the useful text ("Profile", "Open document").
 * An INVALID value always shows its raw text regardless, because "Profile" over a broken link tells
 * the reader nothing about what needs correcting.
 */
export function ExternalLink({value,label,fallback=NOT_RECORDED}:{
  value:string|null|undefined
  label?:string
  /** What to show when there is no value at all -- distinct from a value that is present but unusable. */
  fallback?:string
}){
  const resolved=externalUrl(value)
  if(!resolved)return <span className="cell-gap">{fallback}</span>
  if(!resolved.valid)return <span className="broken-link" title="This does not look like a web address. Edit the record to correct it.">
    <TriangleAlert size={13} aria-hidden="true"/>
    <span>{resolved.text}</span>
    <span className="sr-only"> — not a valid web address; edit the record to correct it</span>
  </span>
  return <a className="record-link" href={resolved.href!} target="_blank" rel="noreferrer noopener">{label||resolved.text}</a>
}
