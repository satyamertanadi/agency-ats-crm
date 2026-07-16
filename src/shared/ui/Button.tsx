import { LoaderCircle } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /* 'danger' is reserved for irreversible actions and 'caution' for reversible ones -- see Severity
   * in lib/status.ts. Reach for 'caution' by default when something is destructive; 'danger' is for
   * the cases that also warrant a ConfirmDialog. */
  variant?: 'primary'|'secondary'|'danger'|'caution'|'quiet'|'bronze'
  size?: 'sm'|'md'|'lg'
  loading?: boolean
  leadingIcon?: ReactNode
  trailingIcon?: ReactNode
  iconOnlyLabel?: string
  children?: ReactNode
}

export function Button({
  variant='primary', size='md', loading=false, leadingIcon, trailingIcon,
  iconOnlyLabel, className='', children, disabled, ...props
}: ButtonProps) {
  const iconOnly=Boolean(iconOnlyLabel&&!children)
  /* No .button-md rule exists -- base .button IS medium -- so emitting it produced a dead class on
   * every default button, and invited the hand-written `button button-secondary button-md` that had
   * appeared on <Link>s styled as buttons. */
  return <button
    className={['button',`button-${variant}`,size==='md'?'':`button-${size}`,iconOnly?'button-icon-only':'',className].filter(Boolean).join(' ')}
    aria-label={iconOnlyLabel}
    aria-busy={loading||undefined}
    disabled={disabled||loading}
    {...props}
  >
    {loading?<LoaderCircle className="spin" size={16}/>:leadingIcon}
    {children&&<span>{children}</span>}
    {!loading&&trailingIcon}
  </button>
}
