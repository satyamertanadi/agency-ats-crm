import { LoaderCircle } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /* React 19 passes `ref` to function components as an ordinary prop, so declaring it here is all
   * that is needed -- no forwardRef wrapper. Added for Menu, whose `trigger` hands the caller a ref
   * it must attach so focus can return to the trigger on Escape. Without this, every menu trigger in
   * the app had to be a hand-written <button className="button button-secondary button-sm">, which is
   * exactly the drift the comment below warns about, and it silently missed the loading and
   * icon-slot behaviour this component owns. */
  ref?: Ref<HTMLButtonElement>
  /* 'danger' is reserved for irreversible actions and 'caution' for reversible ones -- see Severity
   * in lib/status.ts. Reach for 'caution' by default when something is destructive; 'danger' is for
   * the cases that also warrant a ConfirmDialog. */
  variant?: 'primary'|'secondary'|'danger'|'caution'|'quiet'
  size?: 'sm'|'md'|'lg'
  loading?: boolean
  /* Pass an icon here, not as a bare JSX child alongside the label -- `children` gets wrapped in its
   * own <span>, so `<Button><Icon/>Label</Button>` packs the icon inside that span instead of beside
   * it. That escapes .button's flex `gap` entirely and drops the icon back to inline baseline
   * alignment, so it reads as cramped and vertically off. This exact mistake has recurred
   * independently across the app; leadingIcon/trailingIcon are flex siblings of the label and don't
   * have either problem. */
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
