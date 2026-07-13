import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'

export function Field({ label, error, children }: { label:string; error?:string; children:ReactNode }) {
  return <label className="field"><span>{label}</span>{children}{error && <small role="alert">{error}</small>}</label>
}
export function Input(props: InputHTMLAttributes<HTMLInputElement>) { return <input className="input" {...props}/> }
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) { return <select className="input" {...props}/> }
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) { return <textarea className="input textarea" {...props}/> }

