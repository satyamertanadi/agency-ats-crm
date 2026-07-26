import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'

/* One back affordance. The same markup was duplicated as a local helper in RecordDetailPages, inlined
 * again in JobWorkspacePage, and placed in a third slot (breadcrumbs, not actions) by
 * CandidateDetailPage -- so the way back moved between the top-left and the top-right depending on
 * which record you were looking at.
 *
 * Belongs in Page's `breadcrumbs` slot: the way back is orientation, not an action, and putting it
 * among the actions competes with the primary button for the same corner. */
export function BackLink({to,children}:{to:string;children:ReactNode}){
  return <Link className="button button-quiet" to={to}><ArrowLeft size={14}/>{children}</Link>
}
