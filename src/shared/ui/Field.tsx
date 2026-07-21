import { forwardRef } from 'react'
import { ChevronDown } from 'lucide-react'
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'

export function Field({ label, error, children }: { label:string; error?:string; children:ReactNode }) {
  return <label className="field"><span>{label}</span>{children}{error && <small role="alert">{error}</small>}</label>
}
export const Input=forwardRef<HTMLInputElement,InputHTMLAttributes<HTMLInputElement>>(function Input(props,ref){return <input ref={ref} className="input" {...props}/>})
// Native selects otherwise render the browser's own arrow, which is inconsistent across
// browsers/zoom levels and reads as "slightly off" -- appearance:none removes it in favor of one
// icon, positioned the same everywhere .select-wrap is used (see components.css).
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) { return <span className="select-wrap"><select className="input" {...props}/><ChevronDown className="select-chevron" size={14} aria-hidden="true"/></span> }
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) { return <textarea className="input textarea" {...props}/> }
