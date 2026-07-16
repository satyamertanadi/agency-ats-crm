import type { ReactNode } from 'react'
import { Button } from './Button'
import { Modal } from './Modal'

/* The gate in front of a `danger`-tier action (see Severity in lib/status.ts). Those actions destroy
 * data or kill a live credential and cannot be undone, so they get a stop rather than just a red
 * button -- red alone had stopped meaning anything, since every destructive action was wearing it.
 *
 * `body` should name what is about to be lost in specifics (which batch, how many rows), not restate
 * the button. The user is being asked to check a fact, not to read a warning.
 *
 * `confirmLabel` repeats the verb ("Roll back", "Revoke") instead of saying "Confirm" -- the last
 * thing clicked should say what it does, so a mis-aimed click is still readable.
 */
export function ConfirmDialog({ title, body, confirmLabel, open, onConfirm, onClose, loading=false }:
  {title:string;body:ReactNode;confirmLabel:string;open:boolean;onConfirm:()=>void;onClose:()=>void;loading?:boolean}) {
  return <Modal title={title} open={open} onClose={onClose}>
    <div className="stack">
      <div className="confirm-body">{body}</div>
      <div className="form-actions">
        <Button type="button" variant="quiet" onClick={onClose}>Cancel</Button>
        <Button type="button" variant="danger" loading={loading} onClick={onConfirm}>{confirmLabel}</Button>
      </div>
    </div>
  </Modal>
}
