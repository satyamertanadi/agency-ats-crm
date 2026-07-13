import type { ReactNode } from 'react'
import { AlertCircle, Inbox, LoaderCircle } from 'lucide-react'
import { Button } from './Button'

export function LoadingState({ label='Loading…' }: {label?:string}) { return <div className="state"><LoaderCircle className="spin"/><p>{label}</p></div> }
export function EmptyState({ title, description, action }: {title:string;description:string;action?:ReactNode}) { return <div className="state"><Inbox/><h3>{title}</h3><p>{description}</p>{action}</div> }
export function ErrorState({ error, retry }: {error:unknown;retry?:()=>void}) { const message=error instanceof Error?error.message:'Something went wrong.'; return <div className="state state-error"><AlertCircle/><h3>Could not load this view</h3><p>{message}</p>{retry&&<Button onClick={retry}>Try again</Button>}</div> }

