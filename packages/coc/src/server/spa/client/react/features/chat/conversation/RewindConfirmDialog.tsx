import { Dialog } from '../../../ui/Dialog';
import { Button } from '../../../ui/Button';

export interface RewindConfirmDialogProps {
    /** Whether the dialog is shown (i.e. a rewind target turn is selected). */
    open: boolean;
    /** In-flight state while the rewind request runs — disables both actions. */
    pending?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}

/**
 * Confirmation for the destructive "Rewind to here" action.
 *
 * Rewinding permanently discards the target user message and every turn after
 * it from the conversation history — chat history only; workspace files, git
 * state, and code edits are NOT reverted. On confirm the message's text and
 * attachments are restored into the composer for edit/resend.
 */
export function RewindConfirmDialog({ open, pending = false, onConfirm, onCancel }: RewindConfirmDialogProps) {
    return (
        <Dialog
            id="rewind-confirm-dialog"
            open={open}
            onClose={pending ? () => {} : onCancel}
            title="Rewind conversation?"
            disableClose={pending}
            footer={
                <>
                    <Button variant="secondary" id="rewind-cancel-btn" onClick={onCancel} disabled={pending}>
                        Cancel
                    </Button>
                    <Button variant="danger" id="rewind-confirm-btn" onClick={onConfirm} disabled={pending}>
                        {pending ? 'Rewinding…' : 'Rewind'}
                    </Button>
                </>
            }
        >
            <div className="space-y-2">
                <p>
                    This permanently discards this message and <strong>everything after it</strong> from the
                    conversation, then restores the message into the composer so you can edit and resend.
                </p>
                <p className="text-[#848484]">
                    Chat history only — your workspace files, git state, and code edits are not reverted.
                </p>
            </div>
        </Dialog>
    );
}
