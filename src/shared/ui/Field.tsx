import { forwardRef, useId } from 'react'
import { ChevronDown } from 'lucide-react'
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'

/* `hint` is guidance shown before anything goes wrong; `error` is what is shown after. They are
 * different jobs and both are needed: a URL field whose rule ("a full web address") only surfaces once
 * the browser has already refused the submit teaches the rule at the least useful moment. The hint
 * renders below the control and is quiet; the error keeps role="alert" so it is announced. */
export function Field({ label, error, hint, children }: { label:string; error?:string; hint?:ReactNode; children:ReactNode }) {
  return <label className="field"><span>{label}</span>{children}{hint&&!error&&<small className="field-hint">{hint}</small>}{error && <small role="alert">{error}</small>}</label>
}
export const Input=forwardRef<HTMLInputElement,InputHTMLAttributes<HTMLInputElement>>(function Input(props,ref){return <input ref={ref} className="input" {...props}/>})
// Native selects otherwise render the browser's own arrow, which is inconsistent across
// browsers/zoom levels and reads as "slightly off" -- appearance:none removes it in favor of one
// icon, positioned the same everywhere .select-wrap is used (see components.css).
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) { return <span className="select-wrap"><select className="input" {...props}/><ChevronDown className="select-chevron" size={14} aria-hidden="true"/></span> }
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) { return <textarea className="input textarea" {...props}/> }

/* Checkbox and Radio wrap their own label because a bare styled <input> cannot be clicked by its text
 * -- which is how they were written at the ~15 raw call sites this replaces, each re-deriving the same
 * flex row. `description` is the second line those call sites wrote as a sibling <small> that was not
 * part of the accessible name; aria-describedby ties it in properly.
 *
 * base.css already sets accent-color on checkbox/radio, so the native control is kept rather than
 * replaced with a drawn box: it inherits platform focus, high-contrast, and forced-colors handling
 * that a div-based control has to reimplement and usually doesn't. */
export function Checkbox({label,description,...props}:{label:ReactNode;description?:ReactNode}&Omit<InputHTMLAttributes<HTMLInputElement>,'type'>){
  return <CheckableRow type="checkbox" label={label} description={description} {...props}/>
}
export function Radio({label,description,...props}:{label:ReactNode;description?:ReactNode}&Omit<InputHTMLAttributes<HTMLInputElement>,'type'>){
  return <CheckableRow type="radio" label={label} description={description} {...props}/>
}
function CheckableRow({type,label,description,...props}:{type:'checkbox'|'radio';label:ReactNode;description?:ReactNode}&Omit<InputHTMLAttributes<HTMLInputElement>,'type'>){
  const describedBy=useId()
  return <label className="check-row"><input type={type} aria-describedby={description?describedBy:undefined} {...props}/><span>{label}{description&&<small id={describedBy}>{description}</small>}</span></label>
}
