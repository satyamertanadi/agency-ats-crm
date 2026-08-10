import { AlertCircle, CheckCircle2, Info, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'

/* Panel vs Callout vs a bare section: Panel is a distinct record/data surface with its own identity
 * (a list, a form section, a board) -- it earns a border because it IS the thing being looked at.
 * Callout is a transient message ABOUT the surface it sits in, never a container for other
 * containers, and should not be the sole/first child of a Panel body -- that reproduces the Panel's
 * own border one step in, which reads as a card inside a card rather than a message on a surface.
 * When a Callout's subject is really the whole Panel (a blocked action, a stale record), hoist it
 * above the Panel instead. When it is one fact among several inside a Panel that's already full of
 * other content, it is fine where it is -- the rule is about being the box's only reason to exist,
 * not about appearing near a Panel at all.
 *
 * One inline message component, replacing four hand-written treatments that had drifted apart:
 * `.warning-box` (12 uses), `.success-box` (5), `.callout.callout-info` (4, with its own dismiss), and
 * bare `.form-error` used for non-error advisories.
 *
 * The drift was not only visual. `.success-box` paired an accent (blue) background and foreground with
 * a `--tone-good-border` (green) -- exactly the mismatch the tone triplets exist to prevent. Rendering
 * every tone from its own triplet makes that class of bug unrepresentable here.
 *
 * Roles follow what the message actually is: an error the user must notice is `role="alert"`
 * (assertive), everything else is `role="status"` (polite). Passing neither would leave screen-reader
 * users with no announcement at all, which is what several of the replaced call sites did. */

const tones={
  info:{className:'callout-info',Icon:Info},
  success:{className:'callout-success',Icon:CheckCircle2},
  warning:{className:'callout-warning',Icon:TriangleAlert},
  danger:{className:'callout-danger',Icon:AlertCircle},
} as const

export type CalloutTone=keyof typeof tones

export function Callout({tone='info',title,children,action,className=''}:{
  tone?:CalloutTone
  /* Optional lead-in rendered bold above the body. Use it when the message has a headline worth
   * scanning ("Candidate already exists"); omit it for a single sentence. */
  title?:string
  children?:ReactNode
  /* Buttons or links -- a Callout that reports a blocked action should carry the way to unblock it. */
  action?:ReactNode
  className?:string
}){
  const {className:toneClass,Icon}=tones[tone]
  return <div className={['callout',toneClass,className].filter(Boolean).join(' ')} role={tone==='danger'?'alert':'status'}>
    <Icon size={17} aria-hidden="true"/>
    <span>{title&&<strong>{title}</strong>}{children}</span>
    {action}
  </div>
}
