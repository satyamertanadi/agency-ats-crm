import {useState} from 'react'
import {Input,Select} from './Field'

/* A native <select> over a curated vocabulary, with the escape hatch that makes imposing a curated
 * vocabulary safe: "Other…" reveals a free-text box whose contents become the field's value verbatim.
 *
 * The alternative -- constraining the column and rejecting anything unlisted -- is how a CRM becomes
 * the thing consultants keep a spreadsheet beside. companies.industry has no CHECK for exactly this
 * reason, so the control, not the database, is what makes the common case one click and the rare case
 * still possible.
 *
 * Not Combobox: this is a closed-ish list of a couple of dozen known values, where seeing all of them
 * beats typing a prefix, and where a native select gets platform typeahead, mobile pickers and
 * forced-colors handling for free. Combobox stays the right control for open normalized sets that have
 * to be searched server-side (tags, skills).
 *
 * Controlled OR uncontrolled, deliberately, because both callers already exist: the add-client drawer
 * drives useState, and the client edit form is a bare <form> read with FormData. Pass value/onChange
 * for the first; pass name/defaultValue for the second and the hidden input carries the value into
 * FormData. The visible <select> is intentionally unnamed -- two same-named controls would make
 * FormData.get() a coin flip between the chosen option and the free text. */
const OTHER='__other__'

export function OptionSelect({options,label,value,defaultValue,onChange,name,id,disabled,otherLabel='Other…',placeholder='Not recorded',otherPlaceholder}:{
  options:readonly {value:string;label:string}[]
  /* Names the free-text row for screen readers. Field renders a <label> that binds to the first
   * labelable descendant -- the select -- so the revealed input would otherwise be nameless. */
  label:string
  value?:string
  defaultValue?:string
  onChange?:(value:string)=>void
  name?:string
  id?:string
  disabled?:boolean
  otherLabel?:string
  placeholder?:string
  otherPlaceholder?:string
}){
  const [internal,setInternal]=useState(defaultValue??'')
  const current=value??internal
  /* Only the INITIAL off-list value opens the free-text row. Once open it stays open while the user
   * types, including through the empty string they pass on the way to a real answer -- deriving this
   * from `current` each render would snap the row shut the moment they cleared the box. */
  const [other,setOther]=useState(()=>{const seed=value??defaultValue??'';return Boolean(seed)&&!options.some((option)=>option.value===seed)})
  const set=(next:string)=>{setInternal(next);onChange?.(next)}

  return <span className="option-select">
    {/* aria-label on the select too, not only on the revealed input: half the call sites are inline
        grid rows (the CV skill and language editors) with no Field wrapper to name them. Where there
        IS a Field, its text and this prop are the same string, so nothing is overridden misleadingly. */}
    <Select id={id} aria-label={label} disabled={disabled} value={other?OTHER:current}
      onChange={(event)=>{const next=event.target.value;if(next===OTHER){setOther(true);set('')}else{setOther(false);set(next)}}}>
      <option value="">{placeholder}</option>
      {options.map((option)=><option key={option.value} value={option.value}>{option.label}</option>)}
      <option value={OTHER}>{otherLabel}</option>
    </Select>
    {other&&<Input aria-label={`${label} — other`} placeholder={otherPlaceholder??`Type the ${label.toLowerCase()}`} disabled={disabled}
      value={current} onChange={(event)=>set(event.target.value)}/>}
    {name&&<input type="hidden" name={name} value={current}/>}
  </span>
}
