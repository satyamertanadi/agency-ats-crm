import { LoaderCircle } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary'|'secondary'|'danger'|'quiet'|'bronze'
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
  return <button
    className={`button button-${variant} button-${size} ${iconOnly?'button-icon-only':''} ${className}`.trim()}
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
