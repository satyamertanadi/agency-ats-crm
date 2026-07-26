import { Button } from './Button'

/* Rendered inside the dialog it guards rather than as a second stacked dialog: a modal-over-modal
 * needs its own focus trap and its own Escape precedence, and gets both wrong more often than not.
 * As an overlay within the trapped container, Tab is already contained and Escape already belongs to
 * the dialog underneath -- which is why this deliberately has no key handling of its own.
 *
 * The verb is repeated on the destructive button ("Discard changes", not "OK") for the same reason
 * ConfirmDialog insists on it: a user who reads only the button must still know what it does. */
export function DiscardPrompt({message,onDiscard,onCancel}:{message:string;onDiscard:()=>void;onCancel:()=>void}){
  return <div className="discard-prompt" role="alertdialog" aria-label="Discard unsaved changes">
    <div className="discard-prompt-card">
      <strong>Discard your changes?</strong>
      <p>{message}</p>
      <div className="form-actions">
        <Button variant="quiet" onClick={onCancel}>Keep editing</Button>
        <Button variant="danger" onClick={onDiscard}>Discard changes</Button>
      </div>
    </div>
  </div>
}
