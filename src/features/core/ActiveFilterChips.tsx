import {X} from 'lucide-react'

export interface ActiveFilter {key:string;label:string;value:string}

/* What is currently narrowing a list, stated where the list is.
 *
 * Every filter on the candidates page lives behind a collapsed "Filters and sorting" disclosure, so a
 * filtered list and an unfiltered one looked identical -- a consultant could read "12 candidates" as
 * the whole database while a location filter from ten minutes ago was still applied. The count alone
 * cannot say that; only naming the filters can.
 *
 * Derived entirely from the URL params the page already owns, so there is no second source of truth
 * to fall out of sync -- clearing a chip is the same setFilter call the control inside the disclosure
 * makes. Sort is deliberately excluded: ordering changes what you see first, not what you can see,
 * and listing it would make "no filters" almost never true.
 */
export function ActiveFilterChips({filters,onClear,onClearAll}:{
  filters:ActiveFilter[]
  onClear:(key:string)=>void
  onClearAll:()=>void
}){
  if(filters.length===0)return null
  return <div className="active-filters" role="group" aria-label="Active filters">
    <span className="active-filters-label">{filters.length===1?'1 filter':`${filters.length} filters`}</span>
    {filters.map((filter)=>
      <button key={filter.key} type="button" className="active-filter-chip" onClick={()=>onClear(filter.key)}
        aria-label={`Remove ${filter.label} filter: ${filter.value}`}>
        <span className="active-filter-chip-label">{filter.label}</span>
        <span className="active-filter-chip-value">{filter.value}</span>
        <X size={13} aria-hidden="true"/>
      </button>)}
    <button type="button" className="active-filters-clear" onClick={onClearAll}>Clear all</button>
  </div>
}
